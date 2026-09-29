"""Premium schedules, instalments and payments (Module 2).

Authorisation reuses Module 1's scope (app.services.access):
* reading: administrator everything, agent serviced policies, policyholder own;
  anything outside scope is 404, like something that does not exist.
* recording a payment: administrator (any policy) or policyholder (own
  policies). Agents are read-only (403).
* settling a pending payment: administrator only.

Transactions: each public write commits exactly once; any failure rolls the
whole operation back (payment row, instalment balance, payment counter).
"""

import logging
from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import (
    Installment,
    InstallmentStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Policy,
    PolicyStatus,
    PremiumFrequency,
    PremiumSchedule,
    ProductType,
    RoleName,
    User,
)
from app.repositories import policies as policy_repo
from app.repositories import premiums as premium_repo
from app.repositories.premiums import AccountSort, PaymentSort, Standing
from app.schemas.premiums import (
    InstallmentCountsOut,
    InstallmentListOut,
    InstallmentOut,
    InstallmentRefOut,
    PaymentCreate,
    PaymentListOut,
    PaymentOut,
    PaymentRecordedOut,
    PaymentResolve,
    PaymentSummaryOut,
    PolicySnapshotOut,
    PortfolioOut,
    PremiumAccountListOut,
    PremiumScheduleOut,
    PremiumSummaryOut,
)
from app.services import premium_rules as rules
from app.services.access import PolicyScope, resolve_scope

logger = logging.getLogger(__name__)

MYSQL_DUPLICATE_ENTRY = 1062
DUPLICATE_REFERENCE_KEY = "uq_payments_payment_reference"
DEFAULT_FAILURE_REASON = "Payment declined (recorded outcome)."

# One message for "does not exist" and "not yours", so IDs cannot be probed.
INSTALLMENT_NOT_FOUND = "Instalment {id} was not found."
PAYMENT_NOT_FOUND = 'No payment found for "{number}".'
POLICY_NOT_FOUND = 'No policy found for number "{number}".'


def _now() -> datetime:
    """UTC, naive: every MySQL session runs with time_zone '+00:00'."""
    return datetime.now(UTC).replace(tzinfo=None)


# --- schedule creation (called inside other transactions) -------------------------


def create_schedule(db: Session, policy: Policy) -> PremiumSchedule:
    """Add the premium schedule for an issued policy. Does NOT commit: callers
    (policy issuance, backfill) own the transaction, so a policy and its
    schedule are always created together or not at all."""
    plan = rules.plan_schedule(
        start_date=policy.start_date,
        term_years=policy.term_years,
        frequency=PremiumFrequency(policy.premium_frequency),
        annual_premium=policy.annual_premium,
    )
    schedule = PremiumSchedule(
        policy=policy,
        installment_count=len(plan),
        total_premium=sum((p.amount for p in plan), rules.ZERO),
        installments=[
            Installment(
                installment_number=p.number,
                due_date=p.due_date,
                amount_due=p.amount,
                amount_paid=rules.ZERO,
                status=InstallmentStatus.PENDING,
            )
            for p in plan
        ],
    )
    db.add(schedule)
    return schedule


def backfill_schedules(db: Session) -> int:
    """Create the missing schedule of every issued policy, in one transaction."""
    policies = premium_repo.policies_without_schedule(db)
    for policy in policies:
        create_schedule(db, policy)
    db.commit()
    return len(policies)


# --- response builders ------------------------------------------------------------


def _views(installments: list[Installment]) -> list[rules.InstallmentView]:
    return [
        rules.InstallmentView(
            id=i.id,
            number=i.installment_number,
            due_date=i.due_date,
            amount_due=i.amount_due,
            amount_paid=i.amount_paid,
        )
        for i in installments
    ]


def _ref(view: rules.InstallmentView | None) -> InstallmentRefOut | None:
    if view is None:
        return None
    return InstallmentRefOut(
        id=view.id,
        installment_number=view.number,
        due_date=view.due_date,
        amount_outstanding=view.outstanding,
    )


def _policy_snapshot(policy: Policy) -> PolicySnapshotOut:
    return PolicySnapshotOut(
        policy_number=policy.policy_number,
        status=PolicyStatus(policy.status),
        product_code=policy.product.code,
        product_name=policy.product.name,
        product_type=ProductType(policy.product.product_type),
        policyholder_name=policy.customer.full_name,
        customer_code=policy.customer.customer_code,
        start_date=policy.start_date,
        end_date=policy.end_date,
        term_years=policy.term_years,
    )


def to_schedule_out(schedule: PremiumSchedule, today: date) -> PremiumScheduleOut:
    installments = schedule.installments
    summary = rules.summarise(_views(installments), schedule.total_premium, today)
    frequency = PremiumFrequency(schedule.policy.premium_frequency)
    return PremiumScheduleOut(
        policy=_policy_snapshot(schedule.policy),
        frequency=frequency,
        annual_premium=schedule.policy.annual_premium,
        installment_count=schedule.installment_count,
        regular_installment_amount=rules.regular_installment_amount(
            schedule.policy.annual_premium, frequency
        ),
        total_premium=schedule.total_premium,
        first_due_date=installments[0].due_date,
        last_due_date=installments[-1].due_date,
        summary=PremiumSummaryOut(
            **{
                k: v
                for k, v in summary.items()
                if k not in ("counts", "next_due", "oldest_overdue")
            },
            counts=InstallmentCountsOut(**summary["counts"]),
            next_due=_ref(summary["next_due"]),
            oldest_overdue=_ref(summary["oldest_overdue"]),
        ),
        as_of=today,
    )


def to_installment_out(installment: Installment, facts: dict, today: date) -> InstallmentOut:
    outstanding = installment.amount_due - installment.amount_paid
    pending = facts["pending"]
    return InstallmentOut(
        id=installment.id,
        policy_number=installment.schedule.policy.policy_number,
        installment_number=installment.installment_number,
        due_date=installment.due_date,
        amount_due=installment.amount_due,
        amount_paid=installment.amount_paid,
        amount_outstanding=outstanding,
        status=rules.effective_status(installment.status, installment.due_date, today),
        payable=outstanding > 0
        and pending is None
        and today >= rules.payable_from(installment.due_date),
        payable_from=rules.payable_from(installment.due_date),
        pending_payment_number=pending,
        failed_attempts=facts["failed"],
        last_paid_at=facts["last_paid_at"],
        last_payment_number=facts["last_payment_number"],
    )


def _installment_out(db: Session, installment: Installment, today: date) -> InstallmentOut:
    facts = premium_repo.payment_facts(db, [installment.id])[installment.id]
    return to_installment_out(installment, facts, today)


def to_payment_out(payment: Payment) -> PaymentOut:
    installment = payment.installment
    policy = installment.schedule.policy
    return PaymentOut(
        payment_number=payment.payment_number,
        payment_reference=payment.payment_reference,
        installment_id=installment.id,
        installment_number=installment.installment_number,
        policy_number=policy.policy_number,
        policyholder_name=policy.customer.full_name,
        customer_code=policy.customer.customer_code,
        product_name=policy.product.name,
        amount=payment.amount,
        status=PaymentStatus(payment.status),
        payment_method=PaymentMethod(payment.payment_method),
        paid_at=payment.paid_at,
        failure_reason=payment.failure_reason,
    )


# --- scoped lookups ---------------------------------------------------------------


def _policy_in_scope(db: Session, scope: PolicyScope, policy_number: str) -> Policy:
    policy = policy_repo.get_policy_by_number(db, policy_number)
    if policy is None or not scope.allows(policy):
        raise NotFoundError(POLICY_NOT_FOUND.format(number=policy_number))
    return policy


def _schedule_for(db: Session, policy: Policy) -> PremiumSchedule:
    schedule = premium_repo.get_schedule_by_policy_id(db, policy.id)
    if schedule is not None:
        return schedule
    if policy.status == PolicyStatus.PENDING:
        raise ConflictError(
            f"Policy {policy.policy_number} has not been issued yet, so it has no premium schedule."
        )
    raise NotFoundError(f"No premium schedule found for policy {policy.policy_number}.")


def _installment_in_scope(db: Session, scope: PolicyScope, installment_id: int) -> Installment:
    installment = premium_repo.get_installment(db, installment_id)
    if installment is None or not scope.allows(installment.schedule.policy):
        raise NotFoundError(INSTALLMENT_NOT_FOUND.format(id=installment_id))
    return installment


# --- reads ------------------------------------------------------------------------


def get_schedule(db: Session, user: User, policy_number: str) -> PremiumScheduleOut:
    policy = _policy_in_scope(db, resolve_scope(db, user), policy_number)
    return to_schedule_out(_schedule_for(db, policy), date.today())


def list_installments(db: Session, user: User, policy_number: str) -> InstallmentListOut:
    policy = _policy_in_scope(db, resolve_scope(db, user), policy_number)
    schedule = _schedule_for(db, policy)
    today = date.today()
    facts = premium_repo.payment_facts(db, [i.id for i in schedule.installments])
    return InstallmentListOut(
        items=[to_installment_out(i, facts[i.id], today) for i in schedule.installments],
        as_of=today,
    )


def get_installment(db: Session, user: User, installment_id: int) -> InstallmentOut:
    installment = _installment_in_scope(db, resolve_scope(db, user), installment_id)
    return _installment_out(db, installment, date.today())


def list_accounts(
    db: Session,
    user: User,
    *,
    search: str | None,
    standing: Standing | None,
    sort: AccountSort,
    limit: int,
    offset: int,
) -> PremiumAccountListOut:
    scope = resolve_scope(db, user)
    today = date.today()
    zero = rules.ZERO
    if scope.sees_nothing:
        empty = PortfolioOut(
            policies=0, total_paid=zero, paid_count=0, due_amount=zero, due_count=0,
            overdue_amount=zero, overdue_count=0, upcoming_amount=zero, upcoming_count=0,
            payable_now=zero, policies_overdue=0,
        )  # fmt: skip
        return PremiumAccountListOut(
            items=[], total=0, limit=limit, offset=offset, portfolio=empty,
            awaiting_issuance=0, as_of=today,
        )  # fmt: skip

    items, total, portfolio = premium_repo.list_accounts(
        db,
        today=today,
        agent_id=scope.agent_id,
        customer_id=scope.customer_id,
        search=search,
        standing=standing,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    money = {
        k: Decimal(v).quantize(rules.CENT)
        for k, v in portfolio.items()
        if "amount" in k or k == "total_paid"
    }
    return PremiumAccountListOut(
        items=[to_schedule_out(schedule, today) for schedule in items],
        total=total,
        limit=limit,
        offset=offset,
        portfolio=PortfolioOut(
            **{**{k: int(v) for k, v in portfolio.items()}, **money},
            payable_now=money["due_amount"] + money["overdue_amount"],
        ),
        awaiting_issuance=premium_repo.count_unissued_policies(
            db, agent_id=scope.agent_id, customer_id=scope.customer_id
        ),
        as_of=today,
    )


def list_payments(
    db: Session,
    user: User,
    *,
    policy_number: str | None = None,
    installment_id: int | None = None,
    search: str | None = None,
    status: PaymentStatus | None = None,
    method: PaymentMethod | None = None,
    sort: PaymentSort = "date-desc",
    limit: int = 50,
    offset: int = 0,
) -> PaymentListOut:
    scope = resolve_scope(db, user)
    empty_summary = PaymentSummaryOut(
        total=0, successful=0, failed=0, pending=0, collected=rules.ZERO
    )
    if scope.sees_nothing:
        return PaymentListOut(items=[], total=0, limit=limit, offset=offset, summary=empty_summary)

    items, total = premium_repo.list_payments(
        db,
        agent_id=scope.agent_id,
        customer_id=scope.customer_id,
        policy_number=policy_number,
        installment_id=installment_id,
        search=search,
        status=status,
        method=method,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    summary = premium_repo.payment_status_summary(
        db, agent_id=scope.agent_id, customer_id=scope.customer_id
    )
    return PaymentListOut(
        items=[to_payment_out(p) for p in items],
        total=total,
        limit=limit,
        offset=offset,
        summary=PaymentSummaryOut(**summary),
    )


def list_installment_payments(
    db: Session, user: User, installment_id: int, *, limit: int, offset: int
) -> PaymentListOut:
    _installment_in_scope(db, resolve_scope(db, user), installment_id)
    return list_payments(db, user, installment_id=installment_id, limit=limit, offset=offset)


def get_payment(db: Session, user: User, payment_number: str) -> PaymentOut:
    payment = premium_repo.get_payment_by_number(db, payment_number)
    if payment is None or not resolve_scope(db, user).allows(payment.installment.schedule.policy):
        raise NotFoundError(PAYMENT_NOT_FOUND.format(number=payment_number))
    return to_payment_out(payment)


# --- writes -----------------------------------------------------------------------


def _reject(error: rules.PaymentRejected):
    return (ConflictError if error.conflict else UnprocessableError)(str(error))


def record_payment(
    db: Session, user: User, installment_id: int, payload: PaymentCreate
) -> PaymentRecordedOut:
    """Record one payment attempt, atomically:

    lock instalment row -> re-read balance -> check pending payments (locked)
    -> validate -> insert payment -> update amount_paid/status -> COMMIT.

    Concurrent payments for the same instalment queue on the row lock, so the
    second one sees the first one's effect and cannot overpay.
    """
    if user.role.name not in (RoleName.ADMINISTRATOR, RoleName.POLICYHOLDER):
        raise ForbiddenError("Agents have read-only access to premium payments.")

    scope = resolve_scope(db, user)
    today = date.today()
    try:
        installment = premium_repo.lock_installment(db, installment_id)
        if installment is None or not scope.allows(installment.schedule.policy):
            raise NotFoundError(INSTALLMENT_NOT_FOUND.format(id=installment_id))

        try:
            rules.check_payment(
                amount=payload.amount,
                amount_due=installment.amount_due,
                amount_paid=installment.amount_paid,
                due_date=installment.due_date,
                has_pending_payment=premium_repo.pending_payment_exists(
                    db, installment.id, lock=True
                ),
                today=today,
            )
        except rules.PaymentRejected as error:
            raise _reject(error) from None

        payment = Payment(
            payment_number=policy_repo.next_payment_number(db, today.year),
            payment_reference=payload.payment_reference,
            installment=installment,
            amount=payload.amount,
            status=payload.outcome,
            payment_method=payload.payment_method,
            paid_at=_now(),
            failure_reason=(payload.failure_reason or DEFAULT_FAILURE_REASON)
            if payload.outcome == PaymentStatus.FAILED
            else None,
            recorded_by_user_id=user.id,
        )
        if payload.outcome == PaymentStatus.SUCCESSFUL:
            # Pending and failed attempts never move money.
            installment.amount_paid, installment.status = rules.apply_successful_payment(
                installment.amount_paid, installment.amount_due, payload.amount
            )
        db.add(payment)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        orig = exc.orig
        if orig is not None and orig.args and orig.args[0] == MYSQL_DUPLICATE_ENTRY:
            if DUPLICATE_REFERENCE_KEY in str(orig.args[-1]):
                raise ConflictError(
                    f"A payment with reference {payload.payment_reference} was already recorded."
                ) from None
            raise ConflictError(
                "The payment could not be recorded: a record already exists."
            ) from None
        raise
    except Exception:
        db.rollback()
        raise

    logger.info(
        "Payment recorded",
        extra={
            "payment_number": payment.payment_number,
            "installment_id": installment.id,
            "status": payment.status,
            "recorded_by_user_id": user.id,
        },
    )
    return PaymentRecordedOut(
        payment=to_payment_out(payment), installment=_installment_out(db, installment, today)
    )


def resolve_payment(
    db: Session, user: User, payment_number: str, payload: PaymentResolve
) -> PaymentRecordedOut:
    """Settle a PENDING payment as successful or failed (administrators)."""
    if user.role.name != RoleName.ADMINISTRATOR:
        raise ForbiddenError("Only administrators can settle pending payments.")

    today = date.today()
    try:
        payment = premium_repo.get_payment_by_number(db, payment_number, lock=True)
        if payment is None:
            raise NotFoundError(PAYMENT_NOT_FOUND.format(number=payment_number))
        if not rules.can_transition(payment.status, payload.status):
            raise ConflictError(
                f"Payment {payment_number} is {payment.status}; "
                "only pending payments can be settled."
            )

        installment = premium_repo.lock_installment(db, payment.installment_id)
        payment.status = payload.status
        if payload.status == PaymentStatus.SUCCESSFUL:
            remaining = installment.amount_due - installment.amount_paid
            if payment.amount > remaining:
                raise UnprocessableError(
                    f"Payment amount exceeds the remaining balance of {remaining}."
                )
            installment.amount_paid, installment.status = rules.apply_successful_payment(
                installment.amount_paid, installment.amount_due, payment.amount
            )
        else:
            payment.failure_reason = payload.failure_reason or DEFAULT_FAILURE_REASON
        db.commit()
    except Exception:
        db.rollback()
        raise

    logger.info(
        "Payment settled",
        extra={"payment_number": payment_number, "status": payload.status, "actor_id": user.id},
    )
    return PaymentRecordedOut(
        payment=to_payment_out(payment), installment=_installment_out(db, installment, today)
    )
