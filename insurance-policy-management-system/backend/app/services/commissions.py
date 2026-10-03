"""Agent Commission service (Module 5).

Flow for a payment becoming SUCCESSFUL (called from premiums.py):
  _on_payment_successful(db, payment) → generate_commission_for_payment

Flow for administrator advancing a commission:
  confirm_earned(db, user, commission_number) → PENDING → EARNED
  record_paid(db, user, commission_number, payout_reference) → EARNED → PAID

The service owns the lifecycle. The rules (commission_rules.py) own the math.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import Policy, User
from app.models.commission import Commission, CommissionEvent
from app.models.party import Agent
from app.models.role import RoleName
from app.repositories import commissions as comm_repo
from app.repositories.policies import get_agent_by_user_id
from app.services import commission_rules as rules
from app.services.access import PolicyScope, resolve_scope

logger = logging.getLogger(__name__)

COMMISSION_NOT_FOUND = 'No commission found for "{number}".'

ROLES_ALLOWED_TO_CONFIRM = {RoleName.ADMINISTRATOR}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _today() -> date:
    return date.today()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _actor_name(user: User, db: Session) -> str:
    role = RoleName(user.role.name)
    if role == RoleName.AGENT:
        agent = get_agent_by_user_id(db, user.id)
        return agent.full_name if agent else f"{user.first_name} {user.last_name}"
    return f"{user.first_name} {user.last_name}"


def _commission_out(commission: Commission) -> dict:
    from app.services.commission_rules import derive_commission_state

    state = derive_commission_state(commission.events)

    agent = commission.agent
    policy = commission.policy
    payment = commission.payment

    return {
        "commissionId": commission.commission_number,
        "policyId": policy.policy_number if policy else None,
        "agentId": agent.agent_code if agent else None,
        "agentName": agent.full_name if agent else None,
        "paymentId": payment.payment_number if payment else None,
        "paymentDate": commission.payment_date.isoformat(),
        "generatedAt": commission.generated_at.isoformat(),
        "policyYear": commission.policy_year,
        "basis": commission.basis,
        "basisLabel": "First year" if commission.basis == "first-year" else "Renewal",
        "ratePercent": float(commission.rate_percent),
        "commissionableAmount": str(commission.commissionable_amount),
        "amount": str(commission.amount),
        "status": commission.status,
        "ruleCode": commission.rule.rule_code if commission.rule else None,
        # Lifecycle timestamps from events
        "generatedEventAt": state.generated_at.isoformat()
        if state.generated_at
        else commission.generated_at.isoformat(),
        "earnedAt": state.earned_at.isoformat() if state.earned_at else None,
        "paidAt": state.paid_at.isoformat() if state.paid_at else None,
        "payoutReference": state.payout_reference,
        "productName": policy.product.name if policy and policy.product else None,
        "policyholderName": policy.customer.full_name if policy and policy.customer else None,
        # Earning hold
        "earningHoldDays": rules.EARNING_HOLD_DAYS,
        "earnableFrom": _earnable_from(commission.payment_date).isoformat(),
        "holdActive": _hold_active(commission.payment_date),
        "events": [_event_out(e) for e in commission.events],
    }


def _event_out(event: CommissionEvent) -> dict:
    return {
        "sequenceNo": event.sequence_no,
        "eventType": event.event_type,
        "fromStatus": event.from_status,
        "toStatus": event.to_status,
        "actorName": event.actor_name,
        "actorRole": event.actor_role,
        "payoutReference": event.payout_reference,
        "note": event.note,
        "occurredAt": event.occurred_at.isoformat(),
    }


def _earnable_from(payment_date: date) -> date:
    from datetime import timedelta

    return payment_date + timedelta(days=rules.EARNING_HOLD_DAYS)


def _hold_active(payment_date: date) -> bool:
    return _today() < _earnable_from(payment_date)


def _get_agent_for_scope(scope: PolicyScope, commission: Commission) -> bool:
    """True if the commission is visible to this scope."""
    if scope.everything:
        return True
    if scope.agent_id is not None:
        return commission.agent_id == scope.agent_id
    return False


# ---------------------------------------------------------------------------
# Commission generation (called by premiums service on SUCCESSFUL payment)
# ---------------------------------------------------------------------------


def generate_commission_for_payment(
    db: Session,
    payment_id: int,
    *,
    actor_user_id: int | None = None,
    actor_name: str = "system",
    actor_role: str = "system",
) -> Commission | None:
    """Try to create a commission for a payment. Returns None if not eligible.

    This is called inside the payment's own transaction; the caller commits.
    """
    from app.models.premium import Installment, Payment, PremiumSchedule

    # Avoid duplicate
    existing = comm_repo.get_commission_by_payment_id(db, payment_id)
    if existing:
        return existing

    payment = db.get(Payment, payment_id)
    if payment is None or payment.status != "successful":
        return None

    installment = db.get(Installment, payment.installment_id)
    if installment is None:
        return None

    schedule = db.get(PremiumSchedule, installment.schedule_id)
    if schedule is None:
        return None

    policy = db.get(Policy, schedule.policy_id)
    if policy is None or policy.agent_id is None:
        return None

    agent = db.get(Agent, policy.agent_id)
    if agent is None:
        return None

    # Load rules and resolve
    db_rules = comm_repo.list_commission_rules(db)
    domain_rules = comm_repo.rules_to_domain(db_rules)

    payment_date = payment.paid_at.date() if payment.paid_at else date.today()

    matched_rule = rules.resolve_rule(
        domain_rules,
        product_id=policy.product_id,
        agent_id=policy.agent_id,
        payment_date=payment_date,
    )
    if matched_rule is None:
        return None

    frequency = policy.premium_frequency if hasattr(policy, "premium_frequency") else None
    if frequency is None:
        return None

    policy_year = rules.get_policy_year(installment.installment_number, frequency)
    if policy_year is None:
        return None

    basis = rules.determine_basis(policy_year)
    if basis is None:
        return None

    rate = rules.get_rate_for_basis(matched_rule, basis)
    calc = rules.calculate_commission(payment.amount, rate)
    if not calc.valid:
        logger.warning(
            "Commission calculation invalid for payment %s: %s",
            payment_id,
            calc.message,
        )
        return None

    now = _now()
    commission_number = comm_repo.next_commission_number(db, now.year)

    commission = Commission(
        commission_number=commission_number,
        payment_id=payment_id,
        policy_id=policy.id,
        agent_id=policy.agent_id,
        rule_id=matched_rule.id,
        installment_id=installment.id,
        policy_year=policy_year,
        basis=basis.value,
        rate_percent=rate,
        commissionable_amount=calc.commissionable_amount,
        amount=calc.amount,
        status=rules.CommissionStatus.PENDING.value,
        payment_date=payment_date,
        generated_at=now,
    )
    db.add(commission)
    db.flush()

    db.add(
        CommissionEvent(
            commission_id=commission.id,
            sequence_no=1,
            event_type=rules.CommissionEventType.GENERATED.value,
            from_status=None,
            to_status=rules.CommissionStatus.PENDING.value,
            actor_user_id=actor_user_id,
            actor_name=actor_name,
            actor_role=actor_role,
            note=None,
            occurred_at=now,
        )
    )
    db.flush()

    logger.info(
        "Commission generated",
        extra={
            "commission_number": commission_number,
            "payment_id": payment_id,
            "amount": str(calc.amount),
        },
    )
    return commission


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_commissions(
    db: Session,
    user: User,
    *,
    status_filter: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    scope = resolve_scope(db, user)
    role = RoleName(user.role.name)

    # Policyholders don't see commissions
    if role == RoleName.POLICYHOLDER:
        return {"items": [], "total": 0, "summary": {}}

    agent_id_filter = scope.agent_id if not scope.everything else None

    items, total = comm_repo.list_commissions(
        db, agent_id=agent_id_filter, status=status_filter, limit=limit, offset=offset
    )
    counts = comm_repo.status_counts(db, agent_id=agent_id_filter)

    today = _today()
    return {
        "items": [_commission_out(c) for c in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "summary": {
            "total": sum(counts.values()),
            "pending": counts.get("pending", 0),
            "earned": counts.get("earned", 0),
            "paid": counts.get("paid", 0),
        },
        "asOf": today.isoformat(),
    }


def get_commission(db: Session, user: User, commission_number: str) -> dict:
    scope = resolve_scope(db, user)
    role = RoleName(user.role.name)
    if role == RoleName.POLICYHOLDER:
        raise NotFoundError(COMMISSION_NOT_FOUND.format(number=commission_number))
    commission = comm_repo.get_commission_by_number(db, commission_number)
    if commission is None or not _get_agent_for_scope(scope, commission):
        raise NotFoundError(COMMISSION_NOT_FOUND.format(number=commission_number))
    return _commission_out(commission)


def list_commission_rules(db: Session) -> dict:
    rules_rows = comm_repo.list_commission_rules(db)
    return {
        "items": [
            {
                "ruleCode": r.rule_code,
                "productId": r.product_id,
                "productName": r.product.name if r.product else None,
                "productCode": r.product.code if r.product else None,
                "agentId": r.agent_id,
                "agentName": r.agent.full_name if r.agent else None,
                "agentCode": r.agent.agent_code if r.agent else None,
                "firstYearRatePercent": float(r.first_year_rate_percent),
                "renewalRatePercent": float(r.renewal_rate_percent),
                "effectiveFrom": r.effective_from.isoformat(),
                "effectiveTo": r.effective_to.isoformat() if r.effective_to else None,
                "description": r.description,
            }
            for r in rules_rows
        ],
        "total": len(rules_rows),
    }


# ---------------------------------------------------------------------------
# Lifecycle transitions
# ---------------------------------------------------------------------------


def _transition(
    db: Session,
    user: User,
    commission_number: str,
    *,
    to_status: str,
    payout_reference: str | None = None,
    note: str | None = None,
) -> dict:
    scope = resolve_scope(db, user)
    role = RoleName(user.role.name)
    if role not in ROLES_ALLOWED_TO_CONFIRM:
        raise ForbiddenError("Only an Administrator can change a commission status.")

    today = _today()
    now = _now()
    actor_name = _actor_name(user, db)

    db.commit()  # end read snapshot
    try:
        commission = comm_repo.lock_commission(db, commission_number)
        if commission is None or not _get_agent_for_scope(scope, commission):
            raise NotFoundError(COMMISSION_NOT_FOUND.format(number=commission_number))

        # Verify payment linkage is still intact
        from app.models.premium import Payment

        payment = db.get(Payment, commission.payment_id)
        linkage_valid = (
            payment is not None
            and payment.status == "successful"
            and payment.amount == commission.commissionable_amount
        )

        check = rules.check_transition(
            current_status=commission.status,
            to_status=to_status,
            payment_date=commission.payment_date,
            as_of=today,
            linkage_valid=linkage_valid,
        )
        if not check.allowed:
            if check.code == rules.TransitionCode.EARNING_HOLD_ACTIVE:
                raise ConflictError(check.message)
            if check.code == rules.TransitionCode.INVALID_LINKAGE:
                raise ConflictError(check.message)
            if check.code in (
                rules.TransitionCode.INVALID_TRANSITION,
                rules.TransitionCode.INVALID_STATUS,
            ):
                raise ConflictError(check.message)
            raise ConflictError(check.message)

        from_status = commission.status
        commission.status = to_status
        db.add(
            CommissionEvent(
                commission_id=commission.id,
                sequence_no=comm_repo.next_event_sequence(db, commission.id),
                event_type=rules.CommissionEventType.STATUS_CHANGED.value,
                from_status=from_status,
                to_status=to_status,
                actor_user_id=user.id,
                actor_name=actor_name,
                actor_role=role.value,
                payout_reference=payout_reference,
                note=note,
                occurred_at=now,
            )
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "Commission transition",
        extra={
            "commission_number": commission_number,
            "to": to_status,
            "actor_id": user.id,
        },
    )
    db.expire_all()
    return get_commission(db, user, commission_number)


def confirm_earned(
    db: Session,
    user: User,
    commission_number: str,
    *,
    note: str | None = None,
) -> dict:
    return _transition(
        db,
        user,
        commission_number,
        to_status=rules.CommissionStatus.EARNED.value,
        note=note,
    )


def record_paid(
    db: Session,
    user: User,
    commission_number: str,
    *,
    payout_reference: str,
    note: str | None = None,
) -> dict:
    if not payout_reference or not payout_reference.strip():
        raise UnprocessableError("A payout reference is required to mark a commission as paid.")
    return _transition(
        db,
        user,
        commission_number,
        to_status=rules.CommissionStatus.PAID.value,
        payout_reference=payout_reference.strip().upper(),
        note=note,
    )


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def seed_commission_rules(db: Session, records: list[dict]) -> int:
    """Insert commission rule seed data idempotently."""

    from app.models.commission import CommissionRule as CommissionRuleORM

    inserted = 0
    for rec in records:
        existing = comm_repo.get_commission_rule_by_code(db, rec["rule_code"])
        if existing:
            continue
        rule = CommissionRuleORM(
            rule_code=rec["rule_code"],
            product_id=rec["product_id"],
            agent_id=rec.get("agent_id"),
            first_year_rate_percent=Decimal(str(rec["first_year_rate_percent"])),
            renewal_rate_percent=Decimal(str(rec["renewal_rate_percent"])),
            effective_from=date.fromisoformat(rec["effective_from"]),
            effective_to=date.fromisoformat(rec["effective_to"])
            if rec.get("effective_to")
            else None,
            description=rec.get("description"),
        )
        db.add(rule)
        inserted += 1
    db.flush()
    return inserted
