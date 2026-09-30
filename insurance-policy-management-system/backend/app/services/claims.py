"""Claim filing and the approval workflow (Module 3).

Authorisation reuses Module 1's scope (app.services.access): administrators
see every claim, agents the claims on policies they service, policyholders
the claims on their own policies. A claim outside the caller's scope is 404,
exactly like one that does not exist. Who may make which move is decided by
the central state machine (app.services.claim_transitions); nothing here
accepts a target status from the client.

Every transition runs through `_transition`, one transaction:

    end the request's read snapshot -> SELECT claim FOR UPDATE (fresh) ->
    scope -> legal move for this role? -> step rules -> update claim + stage
    record -> INSERT history row -> COMMIT      (any failure: ROLLBACK)

so a status never changes without its history row and a history row never
exists without its status change. Two requests on the same claim queue on the
row lock; the second re-reads the new status and fails as an invalid move.
"""

import logging
from collections.abc import Callable
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import (
    Claim,
    ClaimAction,
    ClaimAssessment,
    ClaimDocument,
    ClaimDocumentStatus,
    ClaimEvent,
    ClaimSettlement,
    ClaimStatus,
    ClaimType,
    ClaimVerification,
    Policy,
    ProductType,
    User,
)
from app.models.role import RoleName
from app.repositories import claims as claim_repo
from app.repositories import policies as policy_repo
from app.repositories import premiums as premium_repo
from app.repositories.claims import ClaimSort
from app.schemas.claims import (
    ActorOut,
    AllowedActionOut,
    AssessmentOut,
    ChecklistOut,
    CheckOut,
    ClaimCountsOut,
    ClaimCreate,
    ClaimDetailOut,
    ClaimDocumentOut,
    ClaimEventOut,
    ClaimListOut,
    ClaimPolicyOut,
    ClaimSummaryOut,
    ClaimTimelineOut,
    ClaimTypeOptionOut,
    ClaimTypeOptionsOut,
    ClaimTypeOut,
    CoverageItemOut,
    DecisionOut,
    DocumentRequirementOut,
    EligibilityOut,
    EligiblePolicyListOut,
    EligiblePolicyOut,
    FilingContextOut,
    LimitOut,
    PremiumStandingOut,
    SettlementOut,
    VerificationOut,
)
from app.services import claim_rules as rules
from app.services import premium_rules
from app.services.access import PolicyScope, resolve_scope
from app.services.claim_transitions import CLAIM_TRANSITIONS

logger = logging.getLogger(__name__)

S = ClaimStatus
CLAIM_NOT_FOUND = 'No claim found for "{number}".'
POLICY_NOT_FOUND = 'No issued policy found for "{number}".'
AGENT_FILING_NOTE = "Filed by the agent on behalf of the policyholder."
ELIGIBLE_POLICY_LIMIT = 200


def _now() -> datetime:
    """UTC, naive: every MySQL session runs with time_zone '+00:00'."""
    return datetime.now(UTC).replace(tzinfo=None)


def _field_errors(errors: dict[str, str]) -> list[dict[str, str]]:
    return [
        {"field": f"body.{k}", "message": v, "type": "business_rule"} for k, v in errors.items()
    ]


# --- facts from the database -------------------------------------------------------


def _claim_type_facts(claim_type: ClaimType) -> rules.ClaimTypeFacts:
    return rules.ClaimTypeFacts(
        code=claim_type.code,
        label=claim_type.label,
        product_type=claim_type.product_type,
        coverage_item=claim_type.coverage_item,
        percent_of_coverage=claim_type.percent_of_coverage,
        max_amount=claim_type.max_amount,
        limit_basis=claim_type.limit_basis,
        documents=tuple(
            rules.DocumentRequirement(d.doc_type, d.label, d.is_required)
            for d in claim_type.documents
        ),
    )


def _policy_facts(db: Session, policy: Policy) -> rules.PolicyFacts:
    return rules.PolicyFacts(
        policy_number=policy.policy_number,
        product_name=policy.product.name,
        product_type=policy.product.product_type,
        status=policy.status,
        issue_date=policy.issue_date,
        start_date=policy.start_date,
        end_date=policy.end_date,
        coverage_amount=policy.coverage_amount,
        coverage_items=claim_repo.coverage_item_names(db, policy.product_id),
    )


def _premium_facts(db: Session, policy: Policy, today: date) -> rules.PremiumFacts | None:
    """Module 2's live standing of the policy's premium schedule."""
    schedule = premium_repo.get_schedule_by_policy_id(db, policy.id)
    if schedule is None:
        return None
    views = [
        premium_rules.InstallmentView(
            id=i.id,
            number=i.installment_number,
            due_date=i.due_date,
            amount_due=i.amount_due,
            amount_paid=i.amount_paid,
        )
        for i in schedule.installments
    ]
    summary = premium_rules.summarise(views, schedule.total_premium, today)
    oldest = summary["oldest_overdue"]
    return rules.PremiumFacts(
        standing=summary["standing"],
        overdue_count=summary["counts"]["overdue"],
        overdue_amount=summary["overdue_amount"],
        oldest_overdue_date=oldest.due_date if oldest else None,
    )


def _all_type_facts(db: Session) -> tuple[list[ClaimType], list[rules.ClaimTypeFacts]]:
    types = claim_repo.list_claim_types(db)
    return types, [_claim_type_facts(t) for t in types]


def _actor(db: Session, user: User, policy: Policy) -> tuple[str, RoleName]:
    """The name recorded on history: the policyholder's or agent's business
    name, or the administrator's own name."""
    role = RoleName(user.role.name)
    if role == RoleName.POLICYHOLDER:
        return policy.customer.full_name, role
    if role == RoleName.AGENT:
        agent = policy_repo.get_agent_by_user_id(db, user.id)
        return (agent.full_name if agent else f"{user.first_name} {user.last_name}"), role
    return f"{user.first_name} {user.last_name}", role


# --- response builders ---------------------------------------------------------------


def _check_out(check: rules.Check) -> CheckOut:
    return CheckOut(id=check.id, label=check.label, outcome=check.outcome, detail=check.detail)


def _eligibility_out(result: rules.Eligibility) -> EligibilityOut:
    return EligibilityOut(
        eligible=result.eligible,
        checks=[_check_out(c) for c in result.checks],
        reasons=result.reasons,
        warnings=result.warnings,
        compatible_claim_types=result.compatible_types,
        incident_earliest=result.incident_earliest,
        incident_latest=result.incident_latest,
        filing_deadline=result.filing_deadline,
    )


def _limit_out(limit: rules.Limit) -> LimitOut:
    return LimitOut(
        limit=limit.limit,
        coverage_amount=limit.coverage_amount,
        percent_of_coverage=limit.percent_of_coverage,
        max_amount=limit.max_amount,
        basis=limit.basis,
        capped_by_maximum=limit.capped_by_maximum,
    )


def _claim_type_out(claim_type: ClaimType) -> ClaimTypeOut:
    return ClaimTypeOut(
        code=claim_type.code,
        label=claim_type.label,
        product_type=ProductType(claim_type.product_type),
        coverage_item=claim_type.coverage_item,
        percent_of_coverage=claim_type.percent_of_coverage,
        max_amount=claim_type.max_amount,
        limit_basis=claim_type.limit_basis,
        description=claim_type.description,
        documents=[
            DocumentRequirementOut(
                doc_type=d.doc_type,
                label=d.label,
                suggested_name=d.suggested_name,
                required=d.is_required,
            )
            for d in claim_type.documents
        ],
    )


def _policy_out(policy: Policy) -> ClaimPolicyOut:
    return ClaimPolicyOut(
        policy_number=policy.policy_number,
        product_code=policy.product.code,
        product_name=policy.product.name,
        product_type=ProductType(policy.product.product_type),
        status=policy.status,
        coverage_amount=policy.coverage_amount,
        issue_date=policy.issue_date,
        start_date=policy.start_date,
        end_date=policy.end_date,
        policyholder_name=policy.customer.full_name,
        customer_code=policy.customer.customer_code,
        agent_name=policy.agent.full_name if policy.agent else None,
    )


def _actor_out(event: ClaimEvent | None) -> ActorOut | None:
    return ActorOut(name=event.actor_name, role=event.actor_role) if event else None


def _event_out(event: ClaimEvent) -> ClaimEventOut:
    rule = CLAIM_TRANSITIONS[ClaimStatus(event.from_status)][ClaimStatus(event.to_status)]
    return ClaimEventOut(
        sequence_no=event.sequence_no,
        action=event.action,
        label=rule.label,
        from_status=event.from_status,
        to_status=event.to_status,
        actor=_actor_out(event),
        note=event.note,
        occurred_at=event.occurred_at,
    )


def _event(claim: Claim, action: ClaimAction) -> ClaimEvent | None:
    """The (latest) history row for an action."""
    matches = [e for e in claim.events if e.action == action]
    return matches[-1] if matches else None


def to_summary(claim: Claim) -> ClaimSummaryOut:
    policy = claim.policy
    first = claim.events[0] if claim.events else None
    return ClaimSummaryOut(
        claim_number=claim.claim_number,
        policy_number=policy.policy_number,
        policyholder_name=policy.customer.full_name,
        customer_code=policy.customer.customer_code,
        product_name=policy.product.name,
        claim_type=claim.claim_type.code,
        claim_type_label=claim.claim_type.label,
        incident_date=claim.incident_date,
        filing_date=claim.filing_date,
        claimed_amount=claim.claimed_amount,
        approved_amount=claim.approved_amount,
        status=claim.status,
        filed_by=_actor_out(first),
        assigned_to=_actor_out(_event(claim, ClaimAction.START_REVIEW)),
        created_at=claim.created_at,
        updated_at=claim.updated_at,
    )


def _checklist(db: Session, claim: Claim, today: date) -> rules.Checklist:
    policy = claim.policy
    facts = _policy_facts(db, policy)
    type_facts = _claim_type_facts(claim.claim_type)
    return rules.verification_checklist(
        incident_date=claim.incident_date,
        filing_date=claim.filing_date,
        claimed_amount=claim.claimed_amount,
        policy=facts,
        claim_type=type_facts,
        document_types={d.doc_type for d in claim.documents},
        premium=_premium_facts(db, policy, today),
        limit=rules.illustrative_limit(type_facts, policy.coverage_amount),
    )


def to_detail(db: Session, claim: Claim, user: User, today: date) -> ClaimDetailOut:
    policy = claim.policy
    type_facts = _claim_type_facts(claim.claim_type)
    limit = rules.illustrative_limit(type_facts, policy.coverage_amount)
    premium = _premium_facts(db, policy, today)
    labels = {d.doc_type: d for d in claim.claim_type.documents}

    verification = None
    if claim.verification is not None and (event := _event(claim, ClaimAction.VERIFY)):
        v = claim.verification
        verification = VerificationOut(
            checks_passed=v.checks_passed,
            checks_total=v.checks_total,
            warnings=v.warnings,
            note=v.note,
            verified_at=event.occurred_at,
            verified_by=_actor_out(event),
        )
    assessment = None
    if claim.assessment is not None and (event := _event(claim, ClaimAction.ASSESS)):
        a = claim.assessment
        assessment = AssessmentOut(
            assessed_amount=a.assessed_amount,
            illustrative_limit=a.illustrative_limit,
            limit_basis=a.limit_basis,
            note=a.note,
            assessed_at=event.occurred_at,
            assessed_by=_actor_out(event),
        )
    settlement = None
    if claim.settlement is not None and (event := _event(claim, ClaimAction.SETTLE)):
        settlement = SettlementOut(
            settlement_reference=claim.settlement.settlement_reference,
            amount=claim.settlement.amount,
            settled_on=claim.settlement.settled_on,
            settled_at=event.occurred_at,
            settled_by=_actor_out(event),
        )

    decision = None
    summary = rules.decision_summary(
        status=claim.status,
        claimed_amount=claim.claimed_amount,
        assessed_amount=claim.assessment.assessed_amount if claim.assessment else None,
        illustrative_limit=claim.assessment.illustrative_limit if claim.assessment else None,
        limit_basis=claim.assessment.limit_basis if claim.assessment else None,
        assessment_note=claim.assessment.note if claim.assessment else None,
        approved_amount=claim.approved_amount,
        rejection_reason=claim.rejection_reason,
        settlement_reference=claim.settlement.settlement_reference if claim.settlement else None,
    )
    if summary is not None:
        decided = _event(claim, ClaimAction.APPROVE) or _event(claim, ClaimAction.REJECT)
        decision = DecisionOut(
            claimed_amount=summary.claimed_amount,
            illustrative_limit=summary.illustrative_limit,
            limit_basis=summary.limit_basis,
            assessed_amount=summary.assessed_amount,
            approved_amount=summary.approved_amount,
            decision=summary.decision,
            decision_label=summary.decision_label,
            reasons=summary.reasons,
            decided_at=decided.occurred_at if decided else None,
            decided_by=_actor_out(decided),
        )

    checklist = _checklist(db, claim, today)
    item_limit = claim_repo.coverage_item_limit(
        db, policy.product_id, claim.claim_type.coverage_item
    )
    return ClaimDetailOut(
        claim=to_summary(claim),
        description=claim.description,
        rejection_reason=claim.rejection_reason,
        claim_type=_claim_type_out(claim.claim_type),
        policy=_policy_out(policy),
        limit=_limit_out(limit),
        coverage_item=CoverageItemOut(name=claim.claim_type.coverage_item, limit=item_limit)
        if item_limit is not None
        else None,
        premium=PremiumStandingOut(
            standing=premium.standing,
            overdue_count=premium.overdue_count,
            overdue_amount=premium.overdue_amount,
            oldest_overdue_date=premium.oldest_overdue_date,
        )
        if premium
        else None,
        documents=[
            ClaimDocumentOut(
                doc_type=d.doc_type,
                label=labels[d.doc_type].label if d.doc_type in labels else d.doc_type,
                file_name=d.file_name,
                required=labels[d.doc_type].is_required if d.doc_type in labels else False,
                status=d.status,
                submitted_at=d.submitted_at,
            )
            for d in claim.documents
        ],
        verification_checklist=ChecklistOut(
            checks=[_check_out(c) for c in checklist.checks],
            passed=checklist.passed,
            warnings=checklist.warnings,
            failures=checklist.failures,
            blocking=checklist.blocking,
        ),
        verification=verification,
        assessment=assessment,
        decision=decision,
        settlement=settlement,
        events=[_event_out(e) for e in claim.events],
        allowed_actions=[
            AllowedActionOut(
                action=rule.action, to_status=target, label=rule.label, dedicated=rule.dedicated
            )
            for target, rule in rules.available_transitions(claim.status, user.role.name)
        ],
        as_of=today,
    )


# --- reads ---------------------------------------------------------------------------


def _claim_in_scope(db: Session, scope: PolicyScope, claim_number: str) -> Claim:
    claim = claim_repo.get_claim_by_number(db, claim_number)
    if claim is None or not scope.allows(claim.policy):
        raise NotFoundError(CLAIM_NOT_FOUND.format(number=claim_number))
    return claim


def _policy_in_scope(db: Session, scope: PolicyScope, policy_number: str) -> Policy:
    policy = policy_repo.get_policy_by_number(db, policy_number)
    if policy is None or not scope.allows(policy):
        raise NotFoundError(POLICY_NOT_FOUND.format(number=policy_number))
    return policy


def get_claim(db: Session, user: User, claim_number: str) -> ClaimDetailOut:
    claim = _claim_in_scope(db, resolve_scope(db, user), claim_number)
    return to_detail(db, claim, user, date.today())


def list_claim_types(db: Session) -> ClaimTypeOptionsOut:
    """Reference data: every claim type and its document requirements."""
    return ClaimTypeOptionsOut(items=[_claim_type_out(t) for t in claim_repo.list_claim_types(db)])


def get_timeline(db: Session, user: User, claim_number: str) -> ClaimTimelineOut:
    claim = _claim_in_scope(db, resolve_scope(db, user), claim_number)
    return ClaimTimelineOut(
        claim_number=claim.claim_number,
        status=claim.status,
        events=[_event_out(e) for e in claim.events],
    )


def list_claims(
    db: Session,
    user: User,
    *,
    search: str | None,
    status: ClaimStatus | None,
    claim_type: str | None,
    policy_number: str | None,
    sort: ClaimSort,
    limit: int,
    offset: int,
) -> ClaimListOut:
    scope = resolve_scope(db, user)
    counts: dict[str, int] = {}
    items: list[Claim] = []
    total = 0
    if not scope.sees_nothing:
        items, total = claim_repo.list_claims(
            db,
            agent_id=scope.agent_id,
            customer_id=scope.customer_id,
            search=search,
            status=status,
            claim_type=claim_type,
            policy_number=policy_number,
            sort=sort,
            limit=limit,
            offset=offset,
        )
        counts = claim_repo.status_counts(
            db, agent_id=scope.agent_id, customer_id=scope.customer_id
        )
    closed = (S.SETTLED, S.REJECTED, S.CANCELLED)
    return ClaimListOut(
        items=[to_summary(c) for c in items],
        total=total,
        limit=limit,
        offset=offset,
        summary=ClaimCountsOut(
            total=sum(counts.values()),
            **{s.value: counts.get(s.value, 0) for s in ClaimStatus},
            open=sum(n for s, n in counts.items() if s not in closed),
        ),
    )


def list_eligible_policies(db: Session, user: User) -> EligiblePolicyListOut:
    """Policies in scope with their claim eligibility, eligible first."""
    scope = resolve_scope(db, user)
    today = date.today()
    items: list[EligiblePolicyOut] = []
    if not scope.sees_nothing:
        policies, _ = policy_repo.list_policies(
            db,
            agent_id=scope.agent_id,
            customer_id=scope.customer_id,
            search=None,
            status=None,
            product_code=None,
            agent_code=None,
            sort="newest",
            limit=ELIGIBLE_POLICY_LIMIT,
            offset=0,
        )
        _, type_facts = _all_type_facts(db)
        for policy in policies:
            result = rules.evaluate_eligibility(
                _policy_facts(db, policy), type_facts, _premium_facts(db, policy, today), today
            )
            items.append(
                EligiblePolicyOut(policy=_policy_out(policy), eligibility=_eligibility_out(result))
            )
    items.sort(key=lambda i: (not i.eligibility.eligible, i.policy.policy_number))
    return EligiblePolicyListOut(
        items=items, eligible_count=sum(i.eligibility.eligible for i in items), as_of=today
    )


def get_filing_context(db: Session, user: User, policy_number: str) -> FilingContextOut:
    policy = _policy_in_scope(db, resolve_scope(db, user), policy_number)
    today = date.today()
    types, type_facts = _all_type_facts(db)
    facts = _policy_facts(db, policy)
    result = rules.evaluate_eligibility(facts, type_facts, _premium_facts(db, policy, today), today)
    compatible = set(result.compatible_types)
    return FilingContextOut(
        policy=_policy_out(policy),
        eligibility=_eligibility_out(result),
        claim_types=[
            ClaimTypeOptionOut(
                **_claim_type_out(t).model_dump(),
                illustrative_limit=_limit_out(rules.illustrative_limit(f, policy.coverage_amount)),
            )
            for t, f in zip(types, type_facts, strict=True)
            if t.code in compatible
        ],
        as_of=today,
    )


# --- filing --------------------------------------------------------------------------


def _check_filing(
    db: Session, policy: Policy, claim_type: ClaimType | None, values: dict, today: date
) -> None:
    """Eligibility (409) then form rules (422), both re-evaluated server-side."""
    _, type_facts = _all_type_facts(db)
    facts = _policy_facts(db, policy)
    eligibility = rules.evaluate_eligibility(
        facts, type_facts, _premium_facts(db, policy, today), today
    )
    if not eligibility.eligible:
        raise ConflictError(
            f"A claim cannot be filed against {policy.policy_number}: {eligibility.reasons[0]}",
            errors=[
                {"field": "body.policy_number", "message": r, "type": "eligibility"}
                for r in eligibility.reasons
            ],
        )
    errors = rules.validate_claim(
        policy=facts,
        claim_type=_claim_type_facts(claim_type) if claim_type else None,
        compatible_codes=eligibility.compatible_types,
        today=today,
        **values,
    )
    if errors:
        raise UnprocessableError("The claim has validation errors.", errors=_field_errors(errors))


def file_claim(db: Session, user: User, payload: ClaimCreate) -> ClaimDetailOut:
    """Create a claim (and, by default, submit it) in one transaction."""
    if not rules.can_file(user.role.name):
        raise ForbiddenError(
            "Claims are filed by the policyholder or their agent. "
            "Claims officers review claims and cannot file them."
        )
    scope = resolve_scope(db, user)
    today, now = date.today(), _now()
    try:
        policy = _policy_in_scope(db, scope, payload.policy_number)
        claim_type = claim_repo.get_claim_type_by_code(db, payload.claim_type)
        _check_filing(
            db,
            policy,
            claim_type,
            {
                "incident_date": payload.incident_date,
                "claimed_amount": payload.claimed_amount,
                "description": payload.description,
                "documents": payload.documents,
            },
            today,
        )
        claim = Claim(
            claim_number=policy_repo.next_claim_number(db, today.year),
            policy=policy,
            claim_type=claim_type,
            incident_date=payload.incident_date,
            filing_date=today,
            description=payload.description.strip(),
            claimed_amount=payload.claimed_amount,
            status=S.DRAFT,
            documents=[
                ClaimDocument(
                    doc_type=doc_type,
                    file_name=file_name.strip(),
                    status=ClaimDocumentStatus.SUBMITTED,
                    submitted_at=now,
                )
                for doc_type, file_name in payload.documents.items()
            ],
        )
        db.add(claim)
        db.flush()
        if payload.submit:
            name, role = _actor(db, user, policy)
            claim.status = S.SUBMITTED
            db.add(
                ClaimEvent(
                    claim_id=claim.id,
                    sequence_no=1,
                    action=ClaimAction.SUBMIT,
                    from_status=S.DRAFT,
                    to_status=S.SUBMITTED,
                    actor_user_id=user.id,
                    actor_name=name,
                    actor_role=role,
                    note=AGENT_FILING_NOTE if role == RoleName.AGENT else None,
                    occurred_at=now,
                )
            )
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "Claim filed",
        extra={
            "claim_number": claim.claim_number,
            "status": claim.status,
            "filed_by_user_id": user.id,
        },
    )
    return _reload_detail(db, claim.claim_number, user, today)


def _reload_detail(db: Session, claim_number: str, user: User, today: date) -> ClaimDetailOut:
    db.expire_all()  # pick up MySQL-maintained timestamps and new rows
    return to_detail(db, claim_repo.get_claim_by_number(db, claim_number), user, today)


# --- workflow ------------------------------------------------------------------------


def _transition(
    db: Session,
    user: User,
    claim_number: str,
    *,
    action: ClaimAction,
    to_status: ClaimStatus,
    note: str | None = None,
    validate: Callable[[Claim, date], None] | None = None,
    apply: Callable[[Claim, date], str | None] | None = None,
) -> ClaimDetailOut:
    """The single path of every workflow move (see module docstring).

    `apply` may return the note to record on the history row.
    """
    scope = resolve_scope(db, user)
    today, now = date.today(), _now()
    # End the read snapshot this request opened (authentication, scope), so
    # every read below sees data committed up to the moment the lock is held.
    db.commit()
    try:
        claim = claim_repo.lock_claim(db, claim_number)
        if claim is None or not scope.allows(claim.policy):
            raise NotFoundError(CLAIM_NOT_FOUND.format(number=claim_number))
        if action == ClaimAction.SETTLE and claim.status == S.SETTLED:
            reference = claim.settlement.settlement_reference if claim.settlement else "on record"
            raise ConflictError(
                f"Claim {claim_number} is already settled under reference {reference}. "
                "It cannot be settled twice."
            )
        try:
            rule = rules.assert_transition(claim.status, to_status, user.role.name)
        except rules.InvalidTransition as error:
            raise ConflictError(str(error)) from None
        except rules.UnauthorizedTransition as error:
            raise ForbiddenError(str(error)) from None
        if rule.action != action:
            # e.g. "withdraw" on a draft: that move is a draft cancellation.
            raise ConflictError(
                f"{action.value.replace('_', ' ').capitalize()} is not possible for a "
                f"{rules.STATUS_LABELS[ClaimStatus(claim.status)].lower()} claim; "
                f"use {rule.action.value.replace('_', ' ')}."
            )

        if validate:
            validate(claim, today)
        recorded_note = (apply(claim, today) if apply else None) or note

        name, role = _actor(db, user, claim.policy)
        from_status = claim.status
        claim.status = to_status
        db.add(
            ClaimEvent(
                claim_id=claim.id,
                sequence_no=claim_repo.next_event_sequence(db, claim.id),
                action=rule.action,
                from_status=from_status,
                to_status=to_status,
                actor_user_id=user.id,
                actor_name=name,
                actor_role=role,
                note=recorded_note,
                occurred_at=now,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "Claim transition",
        extra={
            "claim_number": claim_number,
            "action": action,
            "to": to_status,
            "actor_id": user.id,
        },
    )
    return _reload_detail(db, claim_number, user, today)


def submit_claim(db: Session, user: User, claim_number: str) -> ClaimDetailOut:
    """Draft -> Submitted, re-checking eligibility and the filing rules."""

    def validate(claim: Claim, today: date) -> None:
        _check_filing(
            db,
            claim.policy,
            claim.claim_type,
            {
                "incident_date": claim.incident_date,
                "claimed_amount": claim.claimed_amount,
                "description": claim.description,
                "documents": {d.doc_type: d.file_name for d in claim.documents},
            },
            today,
        )

    def apply(claim: Claim, today: date) -> str | None:
        return AGENT_FILING_NOTE if user.role.name == RoleName.AGENT else None

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.SUBMIT,
        to_status=S.SUBMITTED,
        validate=validate,
        apply=apply,
    )


def cancel_draft(db: Session, user: User, claim_number: str, note: str | None) -> ClaimDetailOut:
    return _transition(
        db, user, claim_number, action=ClaimAction.CANCEL_DRAFT, to_status=S.CANCELLED, note=note
    )


def withdraw_claim(db: Session, user: User, claim_number: str, note: str | None) -> ClaimDetailOut:
    return _transition(
        db, user, claim_number, action=ClaimAction.WITHDRAW, to_status=S.CANCELLED, note=note
    )


def start_review(db: Session, user: User, claim_number: str, note: str | None) -> ClaimDetailOut:
    return _transition(
        db, user, claim_number, action=ClaimAction.START_REVIEW, to_status=S.UNDER_REVIEW, note=note
    )


def verify_claim(db: Session, user: User, claim_number: str, note: str | None) -> ClaimDetailOut:
    """Under review -> Verified, only when the checklist has no failing check."""
    checklist_holder: dict[str, rules.Checklist] = {}

    def validate(claim: Claim, today: date) -> None:
        checklist = _checklist(db, claim, today)
        if checklist.blocking:
            failed = " ".join(c.detail for c in checklist.checks if c.outcome == "fail")
            raise UnprocessableError(
                f"The claim cannot be verified: {failed}",
                errors=[
                    {"field": f"checks.{c.id}", "message": c.detail, "type": "verification"}
                    for c in checklist.checks
                    if c.outcome == "fail"
                ],
            )
        checklist_holder["checklist"] = checklist

    def apply(claim: Claim, today: date) -> str | None:
        checklist = checklist_holder["checklist"]
        db.add(
            ClaimVerification(
                claim_id=claim.id,
                checks_passed=checklist.passed,
                checks_total=len(checklist.checks),
                warnings=checklist.warnings,
                note=note,
            )
        )
        for document in claim.documents:
            document.status = ClaimDocumentStatus.VERIFIED
        return note

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.VERIFY,
        to_status=S.VERIFIED,
        validate=validate,
        apply=apply,
    )


def assess_claim(
    db: Session, user: User, claim_number: str, assessed_amount, note: str | None
) -> ClaimDetailOut:
    """Verified -> Assessed: the payable amount, within the claimed amount
    and the claim type's illustrative limit; a reduction must be explained."""

    def validate(claim: Claim, today: date) -> None:
        limit = rules.illustrative_limit(
            _claim_type_facts(claim.claim_type), claim.policy.coverage_amount
        )
        errors = rules.validate_assessment(
            assessed_amount=assessed_amount,
            claimed_amount=claim.claimed_amount,
            limit=limit.limit,
            note=note,
        )
        if errors:
            raise UnprocessableError(next(iter(errors.values())), errors=_field_errors(errors))

    def apply(claim: Claim, today: date) -> str:
        limit = rules.illustrative_limit(
            _claim_type_facts(claim.claim_type), claim.policy.coverage_amount
        )
        db.add(
            ClaimAssessment(
                claim_id=claim.id,
                assessed_amount=assessed_amount,
                illustrative_limit=limit.limit,
                limit_basis=limit.basis,
                note=note,
            )
        )
        return f"Assessed at {rules.format_inr(assessed_amount)}." + (f" {note}" if note else "")

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.ASSESS,
        to_status=S.ASSESSED,
        validate=validate,
        apply=apply,
    )


def approve_claim(db: Session, user: User, claim_number: str, note: str | None) -> ClaimDetailOut:
    """Assessed -> Approved at exactly the assessed amount (never client-chosen)."""

    def validate(claim: Claim, today: date) -> None:
        a = claim.assessment
        problem = rules.approval_readiness(
            status=claim.status,
            assessed_amount=a.assessed_amount if a else None,
            illustrative_limit=a.illustrative_limit if a else None,
            claimed_amount=claim.claimed_amount,
            note=a.note if a else None,
        )
        if problem:
            raise UnprocessableError(problem)

    def apply(claim: Claim, today: date) -> str:
        claim.approved_amount = claim.assessment.assessed_amount
        return note or rules.approval_reason(claim.assessment.assessed_amount, claim.claimed_amount)

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.APPROVE,
        to_status=S.APPROVED,
        validate=validate,
        apply=apply,
    )


def reject_claim(db: Session, user: User, claim_number: str, reason: str) -> ClaimDetailOut:
    """Assessed -> Rejected, with a mandatory reason. Final."""

    def validate(claim: Claim, today: date) -> None:
        problem = rules.validate_rejection_reason(reason)
        if problem:
            raise UnprocessableError(problem, errors=_field_errors({"reason": problem}))

    def apply(claim: Claim, today: date) -> str:
        claim.rejection_reason = reason.strip()
        return claim.rejection_reason

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.REJECT,
        to_status=S.REJECTED,
        validate=validate,
        apply=apply,
    )


def settle_claim(db: Session, user: User, claim_number: str) -> ClaimDetailOut:
    """Approved -> Settled: records a settlement for exactly the approved
    amount under a server-generated reference. No money moves."""

    def validate(claim: Claim, today: date) -> None:
        if claim.approved_amount is None or claim.approved_amount <= 0:
            raise UnprocessableError("An approved amount is required before settlement.")

    def apply(claim: Claim, today: date) -> str:
        reference = policy_repo.next_settlement_reference(db, today.year)
        db.add(
            ClaimSettlement(
                claim_id=claim.id,
                settlement_reference=reference,
                amount=claim.approved_amount,
                settled_on=today,
            )
        )
        return f"Settlement reference {reference}."

    return _transition(
        db,
        user,
        claim_number,
        action=ClaimAction.SETTLE,
        to_status=S.SETTLED,
        validate=validate,
        apply=apply,
    )
