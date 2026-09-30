"""Claim workflow rules — pure functions over plain facts (no database, no clock).

Reproduces the frontend's illustrative rules (frontend/src/utils/
claimWorkflow.js, claimEligibility.js, claimValidation.js, claimAssessment.js)
so the backend enforces them independently. There is no scoring, model or AI:
every outcome and every sentence of explanation comes from an explicit rule
applied to stored facts.
"""

from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from app.models.enums import ClaimStatus, PolicyStatus
from app.models.role import RoleName
from app.services.claim_transitions import CLAIM_TRANSITIONS, Transition

S = ClaimStatus
CENT = Decimal("0.01")
WHOLE_RUPEE = Decimal("1")

FILING_WINDOW_DAYS = 90
DESCRIPTION_MIN, DESCRIPTION_MAX = 30, 1000
REJECTION_REASON_MIN = 15
ASSESSMENT_NOTE_MIN = 10
DOCUMENT_NAME_MIN = 3

STATUS_LABELS = {
    S.DRAFT: "Draft",
    S.SUBMITTED: "Submitted",
    S.UNDER_REVIEW: "Under review",
    S.VERIFIED: "Verified",
    S.ASSESSED: "Assessed",
    S.APPROVED: "Approved",
    S.REJECTED: "Rejected",
    S.SETTLED: "Settled",
    S.CANCELLED: "Cancelled",
}
ROLE_TITLES = {
    RoleName.POLICYHOLDER: "Policyholder",
    RoleName.AGENT: "Agent",
    RoleName.ADMINISTRATOR: "Claims Officer",  # display title of the administrator role
}


def format_date(value: date) -> str:
    return value.strftime("%d %b %Y").lstrip("0")


def format_inr(amount: Decimal | int) -> str:
    """₹ with Indian digit grouping (1,23,456), paise only when present."""
    amount = Decimal(amount).quantize(CENT)
    whole, fraction = f"{amount:.2f}".split(".")
    head, tail = whole[:-3], whole[-3:]
    groups = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    text = ",".join([*groups, tail]) if groups else tail
    return f"₹{text}" + ("" if fraction == "00" else f".{fraction}")


# --- state machine ---------------------------------------------------------------


class TransitionError(Exception):
    """Base for workflow errors. `kind` maps to the HTTP status."""

    kind = "invalid"


class InvalidTransition(TransitionError):
    """The move does not exist in the state machine (409)."""

    kind = "invalid"


class UnauthorizedTransition(TransitionError):
    """The move exists but this role may not make it (403)."""

    kind = "unauthorized"


def allowed_targets(status: ClaimStatus | str) -> list[ClaimStatus]:
    return list(CLAIM_TRANSITIONS.get(ClaimStatus(status), {}))


def is_terminal(status: ClaimStatus | str) -> bool:
    return not allowed_targets(status)


def assert_transition(from_status: str, to_status: str, role: str) -> Transition:
    """Return the rule for a legal move by `role`, else raise.

    Validity is checked before authority (as in the frontend), so an impossible
    move is always reported as invalid, whoever attempts it.
    """
    source, target, role = ClaimStatus(from_status), ClaimStatus(to_status), RoleName(role)
    rule = CLAIM_TRANSITIONS[source].get(target)
    if rule is None:
        allowed = [STATUS_LABELS[t] for t in allowed_targets(source)]
        suffix = (
            f"From {STATUS_LABELS[source]} it can only move to: {', '.join(allowed)}."
            if allowed
            else f"{STATUS_LABELS[source]} is a final status."
        )
        raise InvalidTransition(
            f"A claim cannot move from {STATUS_LABELS[source]} to {STATUS_LABELS[target]}. {suffix}"
        )
    if role not in rule.roles:
        titles = " or ".join(sorted(ROLE_TITLES[r] for r in rule.roles))
        raise UnauthorizedTransition(
            f"{ROLE_TITLES[role]} cannot move a claim from {STATUS_LABELS[source]} to "
            f"{STATUS_LABELS[target]}. Only a {titles} can."
        )
    return rule


def available_transitions(status: str, role: str) -> list[tuple[ClaimStatus, Transition]]:
    """Moves `role` may make from `status` (what the UI may offer)."""
    return [
        (target, rule)
        for target, rule in CLAIM_TRANSITIONS[ClaimStatus(status)].items()
        if RoleName(role) in rule.roles
    ]


def can_file(role: str) -> bool:
    """Policyholders file their own claims; agents file on a policyholder's
    behalf. Claims officers (administrators) review and never file."""
    return RoleName(role) in (RoleName.POLICYHOLDER, RoleName.AGENT)


# --- facts ------------------------------------------------------------------------


@dataclass(frozen=True)
class DocumentRequirement:
    doc_type: str
    label: str
    required: bool


@dataclass(frozen=True)
class ClaimTypeFacts:
    code: str
    label: str
    product_type: str
    coverage_item: str
    percent_of_coverage: int
    max_amount: Decimal | None
    limit_basis: str
    documents: tuple[DocumentRequirement, ...] = ()


@dataclass(frozen=True)
class PolicyFacts:
    policy_number: str
    product_name: str
    product_type: str
    status: str
    issue_date: date | None
    start_date: date
    end_date: date
    coverage_amount: Decimal
    coverage_items: frozenset[str]


@dataclass(frozen=True)
class PremiumFacts:
    """Module 2 standing of the policy's premium schedule."""

    standing: str  # overdue | due | up_to_date | fully_paid
    overdue_count: int = 0
    overdue_amount: Decimal = Decimal("0.00")
    oldest_overdue_date: date | None = None


@dataclass(frozen=True)
class Check:
    id: str
    label: str
    outcome: str  # pass | fail | warning | skipped
    detail: str


@dataclass(frozen=True)
class Limit:
    limit: Decimal
    coverage_amount: Decimal
    percent_of_coverage: int
    max_amount: Decimal | None
    basis: str
    capped_by_maximum: bool


@dataclass
class Eligibility:
    eligible: bool
    checks: list[Check]
    reasons: list[str]
    warnings: list[str]
    compatible_types: list[str]
    incident_earliest: date | None
    incident_latest: date | None
    filing_deadline: date | None


@dataclass
class Checklist:
    checks: list[Check] = field(default_factory=list)

    @property
    def passed(self) -> int:
        return sum(c.outcome == "pass" for c in self.checks)

    @property
    def warnings(self) -> int:
        return sum(c.outcome == "warning" for c in self.checks)

    @property
    def failures(self) -> int:
        return sum(c.outcome == "fail" for c in self.checks)

    @property
    def blocking(self) -> bool:
        return self.failures > 0


# --- coverage, limits, eligibility ------------------------------------------------


def compatible_claim_types(
    policy: PolicyFacts | None, types: list[ClaimTypeFacts]
) -> list[ClaimTypeFacts]:
    """Types for the policy's product type whose coverage item the product carries."""
    if policy is None:
        return []
    return [
        t
        for t in types
        if t.product_type == policy.product_type and t.coverage_item in policy.coverage_items
    ]


def illustrative_limit(claim_type: ClaimTypeFacts, coverage_amount: Decimal) -> Limit:
    """coverage × percent / 100, rounded half-up to rupees, capped at the maximum."""
    by_percentage = (coverage_amount * claim_type.percent_of_coverage / 100).quantize(
        WHOLE_RUPEE, rounding=ROUND_HALF_UP
    )
    capped = claim_type.max_amount is not None and by_percentage > claim_type.max_amount
    limit = claim_type.max_amount if capped else by_percentage
    return Limit(
        limit=Decimal(limit).quantize(CENT),
        coverage_amount=coverage_amount,
        percent_of_coverage=claim_type.percent_of_coverage,
        max_amount=claim_type.max_amount,
        basis=claim_type.limit_basis,
        capped_by_maximum=capped,
    )


def evaluate_eligibility(
    policy: PolicyFacts | None,
    types: list[ClaimTypeFacts],
    premium: PremiumFacts | None,
    today: date,
) -> Eligibility:
    """The five frontend eligibility checks. Premium standing is shown but
    never blocks filing."""
    checks: list[Check] = []
    if policy is None:
        checks.append(
            Check(
                "policy-found",
                "Policy found",
                "fail",
                "No issued policy exists with this policy number.",
            )
        )
        for check_id, label in (
            ("policy-issued", "Policy issued"),
            ("policy-active", "Policy active"),
            ("coverage", "Coverage available"),
            ("premium-standing", "Premium status checked"),
        ):
            checks.append(
                Check(check_id, label, "skipped", "Not checked because the policy was not found.")
            )
        return _eligibility(checks, [], None, None)

    checks.append(
        Check(
            "policy-found",
            "Policy found",
            "pass",
            f"{policy.policy_number} · {policy.product_name}",
        )
    )

    issued = policy.issue_date is not None and policy.status != PolicyStatus.PENDING
    checks.append(
        Check(
            "policy-issued",
            "Policy issued",
            "pass" if issued else "fail",
            f"Issued on {format_date(policy.issue_date)}."
            if issued
            else "The policy is still pending issuance.",
        )
    )

    deadline = policy.end_date + timedelta(days=FILING_WINDOW_DAYS)
    cover = f"{format_date(policy.start_date)} to {format_date(policy.end_date)}"
    if not issued:
        active = Check(
            "policy-active",
            "Policy active",
            "skipped",
            "Not checked because the policy is not issued.",
        )
    elif policy.status == "lapsed":
        active = Check("policy-active", "Policy active", "fail", "The policy has lapsed.")
    elif today < policy.start_date:
        active = Check(
            "policy-active", "Policy active", "fail",
            f"Cover has not started yet. It begins on {format_date(policy.start_date)}.",
        )  # fmt: skip
    elif today <= policy.end_date:
        active = Check("policy-active", "Policy active", "pass", f"Cover runs from {cover}.")
    elif today <= deadline:
        active = Check(
            "policy-active", "Policy active", "warning",
            f"Cover ended on {format_date(policy.end_date)}. Claims for incidents during cover "
            f"can still be filed until {format_date(deadline)}.",
        )  # fmt: skip
    else:
        active = Check(
            "policy-active", "Policy active", "fail",
            f"Cover ended on {format_date(policy.end_date)}. The {FILING_WINDOW_DAYS}-day window "
            f"to file claims closed on {format_date(deadline)}.",
        )  # fmt: skip
    checks.append(active)

    compatible = compatible_claim_types(policy, types)
    if compatible:
        checks.append(
            Check(
                "coverage",
                "Coverage available",
                "pass",
                f"Claimable benefits: {', '.join(t.label for t in compatible)}.",
            )  # fmt: skip
        )
    else:
        checks.append(
            Check(
                "coverage",
                "Coverage available",
                "fail",
                f"No claimable benefit on {policy.product_name} is modelled in this demonstration.",
            )  # fmt: skip
        )

    if not issued:
        premium_check = Check(
            "premium-standing", "Premium status checked", "skipped",
            "Not checked because the policy is not issued, so it has no premium schedule.",
        )  # fmt: skip
    elif premium is None:
        premium_check = Check(
            "premium-standing", "Premium status checked", "warning",
            "No premium schedule was found, so premium standing could not be checked.",
        )  # fmt: skip
    elif premium.standing == "overdue":
        plural = "" if premium.overdue_count == 1 else "s"
        premium_check = Check(
            "premium-standing", "Premium status checked", "warning",
            f"{premium.overdue_count} instalment{plural} overdue "
            f"({format_inr(premium.overdue_amount)}) since "
            f"{format_date(premium.oldest_overdue_date)}. Filing is still allowed; the claims "
            "officer will see this.",
        )  # fmt: skip
    elif premium.standing == "due":
        premium_check = Check(
            "premium-standing", "Premium status checked", "pass",
            "An instalment is due soon; no premium is overdue.",
        )  # fmt: skip
    else:
        premium_check = Check(
            "premium-standing", "Premium status checked", "pass", "No premium is overdue."
        )
    checks.append(premium_check)

    # Incidents must fall inside cover and cannot be in the future.
    latest = policy.end_date if policy.end_date < today else today
    return _eligibility(checks, compatible, (policy.start_date, latest), deadline)


def _eligibility(checks, compatible, window, deadline) -> Eligibility:
    failures = [c for c in checks if c.outcome == "fail"]
    return Eligibility(
        eligible=not failures,
        checks=checks,
        reasons=[c.detail for c in failures],
        warnings=[c.detail for c in checks if c.outcome == "warning"],
        compatible_types=[t.code for t in compatible],
        incident_earliest=window[0] if window else None,
        incident_latest=window[1] if window else None,
        filing_deadline=deadline,
    )


# --- filing form ------------------------------------------------------------------


def validate_claim(
    *,
    policy: PolicyFacts,
    claim_type: ClaimTypeFacts | None,
    compatible_codes: list[str],
    incident_date: date,
    claimed_amount: Decimal,
    description: str,
    documents: dict[str, str],
    today: date,
) -> dict[str, str]:
    """Field -> message (empty when valid). `documents` maps doc_type -> file name."""
    errors: dict[str, str] = {}
    if claim_type is None:
        errors["claim_type"] = "Select a valid claim type."
    elif claim_type.product_type != policy.product_type or claim_type.code not in compatible_codes:
        errors["claim_type"] = f"{claim_type.label} is not covered by this policy."

    if incident_date > today:
        errors["incident_date"] = "The incident date cannot be in the future."
    elif not policy.start_date <= incident_date <= policy.end_date:
        errors["incident_date"] = (
            "The incident must fall within the policy cover period "
            f"({format_date(policy.start_date)} to {format_date(policy.end_date)})."
        )

    if claimed_amount <= 0:
        errors["claimed_amount"] = "The claimed amount must be greater than zero."
    elif claimed_amount != claimed_amount.quantize(CENT):
        errors["claimed_amount"] = "The claimed amount can have at most two decimal places."

    text = description.strip()
    if len(text) < DESCRIPTION_MIN:
        errors["description"] = (
            f"Add more detail: at least {DESCRIPTION_MIN} characters (currently {len(text)})."
        )
    elif len(text) > DESCRIPTION_MAX:
        errors["description"] = f"Keep the description to {DESCRIPTION_MAX} characters or fewer."

    if claim_type is not None:
        known = {d.doc_type for d in claim_type.documents}
        for doc_type in documents:
            if doc_type not in known:
                errors[f"documents.{doc_type}"] = (
                    "This document type is not used for this claim type."
                )
        for requirement in claim_type.documents:
            name = (documents.get(requirement.doc_type) or "").strip()
            if requirement.required and requirement.doc_type not in documents:
                errors[f"documents.{requirement.doc_type}"] = (
                    f"{requirement.label} is required for a {claim_type.label.lower()} claim."
                )
            elif requirement.doc_type in documents and len(name) < DOCUMENT_NAME_MIN:
                errors[f"documents.{requirement.doc_type}"] = (
                    f"Enter a document name for {requirement.label.lower()} "
                    f"(at least {DOCUMENT_NAME_MIN} characters)."
                )
    return errors


# --- verification -----------------------------------------------------------------


def verification_checklist(
    *,
    incident_date: date,
    filing_date: date,
    claimed_amount: Decimal,
    policy: PolicyFacts | None,
    claim_type: ClaimTypeFacts | None,
    document_types: set[str],
    premium: PremiumFacts | None,
    limit: Limit | None,
) -> Checklist:
    """What a claims officer reviews before verifying. `fail` blocks
    verification; `warning` is shown but does not block."""
    checks: list[Check] = []
    if policy is None:
        checks.append(
            Check(
                "cover-on-incident",
                "Policy valid on incident date",
                "fail",
                "The policy record is unavailable.",
            )
        )
    else:
        within = policy.start_date <= incident_date <= policy.end_date
        cover = f"{format_date(policy.start_date)} to {format_date(policy.end_date)}"
        checks.append(
            Check(
                "cover-on-incident",
                "Policy valid on incident date",
                "pass" if within else "fail",
                f"Incident on {format_date(incident_date)} falls within cover ({cover})."
                if within
                else f"Incident on {format_date(incident_date)} is outside cover ({cover}).",
            )  # fmt: skip
        )

    covered = bool(
        policy
        and claim_type
        and claim_type.product_type == policy.product_type
        and claim_type.coverage_item in policy.coverage_items
    )
    checks.append(
        Check(
            "coverage-applies",
            "Coverage applies",
            "pass" if covered else "fail",
            f'{claim_type.label} is covered under "{claim_type.coverage_item}".'
            if covered
            else "The claim type is not covered by this policy.",
        )  # fmt: skip
    )

    plausible = incident_date <= filing_date
    checks.append(
        Check(
            "incident-date",
            "Incident date",
            "pass" if plausible else "fail",
            f"Incident on {format_date(incident_date)}, filed on {format_date(filing_date)}."
            if plausible
            else "The incident date is after the filing date.",
        )  # fmt: skip
    )

    if claimed_amount <= 0:
        checks.append(
            Check("claimed-amount", "Claimed amount", "fail", "The claimed amount is not positive.")
        )
    elif limit and claimed_amount > limit.limit:
        checks.append(
            Check(
                "claimed-amount",
                "Claimed amount",
                "warning",
                f"{format_inr(claimed_amount)} exceeds the illustrative limit of "
                f"{format_inr(limit.limit)}; assessment will be capped.",
            )  # fmt: skip
        )
    else:
        within = f", within the illustrative limit of {format_inr(limit.limit)}" if limit else ""
        checks.append(
            Check(
                "claimed-amount", "Claimed amount", "pass", f"{format_inr(claimed_amount)}{within}."
            )
        )

    missing = [
        d.label
        for d in (claim_type.documents if claim_type else ())
        if d.required and d.doc_type not in document_types
    ]
    count = len(document_types)
    checks.append(
        Check(
            "documents",
            "Required documents submitted",
            "fail" if missing else "pass",
            f"Missing: {', '.join(missing)}."
            if missing
            else f"{count} document record{'' if count == 1 else 's'} on file.",
        )  # fmt: skip
    )

    if premium is None:
        checks.append(
            Check(
                "premium-standing",
                "Premium standing",
                "warning",
                "Premium standing could not be checked.",
            )
        )
    elif premium.standing == "overdue":
        checks.append(
            Check(
                "premium-standing",
                "Premium standing",
                "warning",
                f"{format_inr(premium.overdue_amount)} overdue since "
                f"{format_date(premium.oldest_overdue_date)}. Noted; it does not block this "
                "illustrative workflow.",
            )  # fmt: skip
        )
    else:
        checks.append(
            Check("premium-standing", "Premium standing", "pass", "No premium is overdue.")
        )
    return Checklist(checks)


# --- assessment and decision --------------------------------------------------------


def validate_assessment(
    *, assessed_amount: Decimal, claimed_amount: Decimal, limit: Decimal | None, note: str | None
) -> dict[str, str]:
    errors: dict[str, str] = {}
    if assessed_amount <= 0:
        errors["assessed_amount"] = (
            "The assessed amount must be greater than zero. "
            "Reject the claim instead if nothing is payable."
        )
    elif assessed_amount != assessed_amount.quantize(CENT):
        errors["assessed_amount"] = "The assessed amount can have at most two decimal places."
    elif assessed_amount > claimed_amount:
        errors["assessed_amount"] = (
            f"The assessed amount cannot exceed the claimed amount of {format_inr(claimed_amount)}."
        )
    elif limit is not None and assessed_amount > limit:
        errors["assessed_amount"] = (
            "The assessed amount cannot exceed the illustrative coverage limit of "
            f"{format_inr(limit)}."
        )
    # A reduction must be explained, so the decision summary can show why.
    if (
        "assessed_amount" not in errors
        and assessed_amount < claimed_amount
        and len((note or "").strip()) < ASSESSMENT_NOTE_MIN
    ):
        errors["note"] = (
            "Explain why the assessed amount is below the claimed amount "
            f"(at least {ASSESSMENT_NOTE_MIN} characters)."
        )
    return errors


def validate_rejection_reason(reason: str | None) -> str | None:
    text = (reason or "").strip()
    if not text:
        return "A rejection reason is required."
    if len(text) < REJECTION_REASON_MIN:
        return f"Give a clearer rejection reason (at least {REJECTION_REASON_MIN} characters)."
    return None


def approval_readiness(
    *,
    status: str,
    assessed_amount: Decimal | None,
    illustrative_limit: Decimal | None,
    claimed_amount: Decimal,
    note: str | None,
) -> str | None:
    """None when the claim can be approved, else the reason it cannot."""
    if ClaimStatus(status) != S.ASSESSED:
        return "Only an assessed claim can be approved."
    if assessed_amount is None or assessed_amount <= 0:
        return "The claim has no valid assessment. Assess it before approving."
    errors = validate_assessment(
        assessed_amount=assessed_amount,
        claimed_amount=claimed_amount,
        limit=illustrative_limit,
        note=note,
    )
    if errors:
        return f"The recorded assessment is no longer valid: {next(iter(errors.values()))}"
    return None


DECISION_LABELS = {
    "pending": "Awaiting decision",
    S.APPROVED: "Approved",
    S.REJECTED: "Rejected",
    S.SETTLED: "Approved and settled",
}


@dataclass(frozen=True)
class DecisionSummary:
    claimed_amount: Decimal
    illustrative_limit: Decimal
    limit_basis: str
    assessed_amount: Decimal
    approved_amount: Decimal | None
    decision: str
    decision_label: str
    reasons: list[str]


def decision_summary(
    *,
    status: str,
    claimed_amount: Decimal,
    assessed_amount: Decimal | None,
    illustrative_limit: Decimal | None,
    limit_basis: str | None,
    assessment_note: str | None,
    approved_amount: Decimal | None,
    rejection_reason: str | None,
    settlement_reference: str | None,
) -> DecisionSummary | None:
    """Rule-based explanation of the decision; None until the claim is assessed.
    Every reason is produced by an explicit rule from stored facts."""
    if assessed_amount is None or illustrative_limit is None:
        return None
    reasons: list[str] = []
    if assessed_amount == claimed_amount and claimed_amount <= illustrative_limit:
        reasons.append("The claimed amount is within the illustrative coverage limit.")
    elif claimed_amount > illustrative_limit and assessed_amount == illustrative_limit:
        reasons.append(
            "The claimed amount exceeds the illustrative limit, so the assessment is capped at "
            f"{format_inr(illustrative_limit)}."
        )
    elif assessed_amount < claimed_amount:
        why = f": {assessment_note}" if assessment_note else "."
        reasons.append(
            f"Assessed {format_inr(claimed_amount - assessed_amount)} below the claimed amount{why}"
        )

    status = ClaimStatus(status)
    if status == S.REJECTED:
        decision = S.REJECTED
        reasons.append(f"Rejected: {rejection_reason}")
    elif status == S.APPROVED:
        decision = S.APPROVED
        reasons.append(f"Approved for the assessed amount of {format_inr(approved_amount)}.")
    elif status == S.SETTLED:
        decision = S.SETTLED
        reasons.append(
            f"Approved for {format_inr(approved_amount)} and settled under reference "
            f"{settlement_reference}."
        )
    else:
        decision = "pending"
        reasons.append("Awaiting an approval or rejection decision by a claims officer.")

    return DecisionSummary(
        claimed_amount=claimed_amount,
        illustrative_limit=illustrative_limit,
        limit_basis=limit_basis or "",
        assessed_amount=assessed_amount,
        approved_amount=approved_amount,
        decision=str(decision),
        decision_label=DECISION_LABELS[decision],
        reasons=reasons,
    )


def approval_reason(assessed_amount: Decimal, claimed_amount: Decimal) -> str:
    """The recorded reason on the approval event (frontend `approveClaim`)."""
    if assessed_amount == claimed_amount:
        return "Assessed amount is within the illustrative coverage limit."
    return "Approved at the assessed amount."
