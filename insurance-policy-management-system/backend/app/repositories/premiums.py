"""Premium schedule, instalment and payment queries. Never commits.

`agent_id` / `customer_id` arguments are the caller's authorisation scope,
already resolved by the service (None = no restriction for that dimension).

Locking: `lock_installment` and `pending_payment_exists(lock=True)` are
*locking* reads (SELECT ... FOR UPDATE). Under InnoDB REPEATABLE READ a plain
SELECT can return the transaction's older snapshot, so any value a payment
decision depends on is read with a lock, which always sees the latest
committed row and holds it until COMMIT/ROLLBACK.
"""

from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Customer,
    Installment,
    InstallmentStatus,
    Payment,
    PaymentMethod,
    PaymentStatus,
    Policy,
    PolicyStatus,
    PremiumSchedule,
    Product,
)
from app.services.premium_rules import DUE_WINDOW_DAYS

AccountSort = Literal[
    "next-due-asc", "overdue-desc", "outstanding-desc", "policy-asc", "policyholder-asc"
]
Standing = Literal["overdue", "due", "up_to_date", "fully_paid"]
PaymentSort = Literal["date-desc", "date-asc", "amount-desc", "amount-asc"]


def _scoped(stmt: Select, agent_id: int | None, customer_id: int | None) -> Select:
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    return stmt


# --- schedules and instalments ---------------------------------------------------


def get_schedule_by_policy_id(db: Session, policy_id: int) -> PremiumSchedule | None:
    return db.scalars(
        select(PremiumSchedule).where(PremiumSchedule.policy_id == policy_id)
    ).one_or_none()


def get_installment(db: Session, installment_id: int) -> Installment | None:
    return db.get(Installment, installment_id)


def lock_installment(db: Session, installment_id: int) -> Installment | None:
    """SELECT ... FOR UPDATE OF installments: current values, row held until commit."""
    return db.scalars(
        select(Installment)
        .where(Installment.id == installment_id)
        .with_for_update(of=Installment)
        .execution_options(populate_existing=True)
    ).one_or_none()


def pending_payment_exists(db: Session, installment_id: int, *, lock: bool = False) -> bool:
    stmt = select(Payment.id).where(
        Payment.installment_id == installment_id, Payment.status == PaymentStatus.PENDING
    )
    if lock:
        stmt = stmt.with_for_update()
    return db.scalars(stmt.limit(1)).first() is not None


def payment_facts(db: Session, installment_ids: list[int]) -> dict[int, dict]:
    """Per instalment: pending payment number, failed attempts, last successful payment."""
    facts = {
        i: {"pending": None, "failed": 0, "last_paid_at": None, "last_payment_number": None}
        for i in installment_ids
    }
    if not installment_ids:
        return facts
    rows = db.execute(
        select(
            Payment.installment_id, Payment.status, Payment.payment_number, Payment.paid_at
        ).where(Payment.installment_id.in_(installment_ids))
    ).all()
    for installment_id, status, number, paid_at in rows:
        entry = facts[installment_id]
        if status == PaymentStatus.PENDING:
            entry["pending"] = number
        elif status == PaymentStatus.FAILED:
            entry["failed"] += 1
        elif entry["last_paid_at"] is None or paid_at > entry["last_paid_at"]:
            entry["last_paid_at"] = paid_at
            entry["last_payment_number"] = number
    return facts


# --- premium accounts (one per schedule) ---------------------------------------------


def _account_aggregates(today: date):
    """Per-schedule money and counts, bucketed exactly like premium_rules.timing."""
    window_end = today + timedelta(days=DUE_WINDOW_DAYS)
    outstanding = Installment.amount_due - Installment.amount_paid
    unpaid = Installment.status != InstallmentStatus.PAID
    buckets = {
        "overdue": and_(unpaid, Installment.due_date < today),
        "due": and_(unpaid, Installment.due_date >= today, Installment.due_date <= window_end),
        "upcoming": and_(unpaid, Installment.due_date > window_end),
    }
    columns = [
        Installment.schedule_id.label("schedule_id"),
        func.sum(Installment.amount_paid).label("total_paid"),
        func.sum(case((~unpaid, 1), else_=0)).label("paid_count"),
        func.min(case((unpaid, Installment.due_date))).label("next_due_date"),
    ]
    for name, condition in buckets.items():
        columns.append(func.sum(case((condition, outstanding), else_=0)).label(f"{name}_amount"))
        columns.append(func.sum(case((condition, 1), else_=0)).label(f"{name}_count"))
    return select(*columns).group_by(Installment.schedule_id).subquery("account")


def _standing(agg):
    return case(
        (agg.c.overdue_count > 0, "overdue"),
        (agg.c.due_count > 0, "due"),
        (agg.c.upcoming_count > 0, "up_to_date"),
        else_="fully_paid",
    )


def list_accounts(
    db: Session,
    *,
    today: date,
    agent_id: int | None,
    customer_id: int | None,
    search: str | None,
    standing: Standing | None,
    sort: AccountSort,
    limit: int,
    offset: int,
) -> tuple[list[PremiumSchedule], int, dict]:
    """Page of schedules in scope (filtered/sorted in MySQL) plus portfolio
    totals over the whole scope, unaffected by search/standing filters."""
    agg = _account_aggregates(today)
    standing_expr = _standing(agg)
    base = _scoped(
        select(PremiumSchedule)
        .join(agg, agg.c.schedule_id == PremiumSchedule.id)
        .join(Policy, Policy.id == PremiumSchedule.policy_id)
        .join(Customer, Customer.id == Policy.customer_id)
        .join(Product, Product.id == Policy.product_id),
        agent_id,
        customer_id,
    )

    # Aggregate the scoped rows' OWN columns; referencing `agg` here would
    # cross-join the two subqueries.
    scoped = base.with_only_columns(*agg.c).subquery("scoped_accounts")
    portfolio_row = db.execute(
        select(
            func.count(),
            func.coalesce(func.sum(scoped.c.total_paid), 0),
            func.coalesce(func.sum(scoped.c.paid_count), 0),
            func.coalesce(func.sum(scoped.c.due_amount), 0),
            func.coalesce(func.sum(scoped.c.due_count), 0),
            func.coalesce(func.sum(scoped.c.overdue_amount), 0),
            func.coalesce(func.sum(scoped.c.overdue_count), 0),
            func.coalesce(func.sum(scoped.c.upcoming_amount), 0),
            func.coalesce(func.sum(scoped.c.upcoming_count), 0),
            func.coalesce(func.sum(case((scoped.c.overdue_count > 0, 1), else_=0)), 0),
        ).select_from(scoped)
    ).one()
    keys = (
        "policies total_paid paid_count due_amount due_count overdue_amount overdue_count "
        "upcoming_amount upcoming_count policies_overdue"
    ).split()
    portfolio = dict(zip(keys, portfolio_row, strict=True))

    stmt = base
    if search:
        term = search.strip()
        stmt = stmt.where(
            or_(
                Policy.policy_number.contains(term.upper(), autoescape=True),
                Customer.customer_code.contains(term.upper(), autoescape=True),
                Customer.full_name.contains(term, autoescape=True),
                Product.name.contains(term, autoescape=True),
            )
        )
    if standing:
        stmt = stmt.where(standing_expr == standing)

    total = db.scalar(
        select(func.count()).select_from(stmt.with_only_columns(PremiumSchedule.id).subquery())
    )
    order = {
        # Fully paid accounts (no next due date) sort last.
        "next-due-asc": (agg.c.next_due_date.is_(None), agg.c.next_due_date.asc()),
        "overdue-desc": (agg.c.overdue_amount.desc(),),
        "outstanding-desc": ((PremiumSchedule.total_premium - agg.c.total_paid).desc(),),
        "policy-asc": (),
        "policyholder-asc": (Customer.full_name.asc(),),
    }[sort]
    items = (
        db.scalars(stmt.order_by(*order, Policy.policy_number.asc()).limit(limit).offset(offset))
        .unique()
        .all()
    )
    return list(items), total or 0, portfolio


def count_unissued_policies(db: Session, *, agent_id: int | None, customer_id: int | None) -> int:
    stmt = _scoped(
        select(func.count()).select_from(Policy).where(Policy.status == PolicyStatus.PENDING),
        agent_id,
        customer_id,
    )
    return db.scalar(stmt) or 0


def policies_without_schedule(db: Session) -> list[Policy]:
    """Issued policies that are missing their premium schedule (for backfill)."""
    return list(
        db.scalars(
            select(Policy)
            .outerjoin(PremiumSchedule, PremiumSchedule.policy_id == Policy.id)
            .where(
                PremiumSchedule.id.is_(None),
                Policy.status != PolicyStatus.PENDING,
                Policy.issue_date.is_not(None),
            )
            .order_by(Policy.id)
        ).unique()
    )


# --- payments ---------------------------------------------------------------------


def _payments_base(agent_id: int | None, customer_id: int | None) -> Select:
    return _scoped(
        select(Payment)
        .join(Installment, Installment.id == Payment.installment_id)
        .join(PremiumSchedule, PremiumSchedule.id == Installment.schedule_id)
        .join(Policy, Policy.id == PremiumSchedule.policy_id)
        .join(Customer, Customer.id == Policy.customer_id)
        .join(Product, Product.id == Policy.product_id),
        agent_id,
        customer_id,
    )


def get_payment_by_number(
    db: Session, payment_number: str, *, lock: bool = False
) -> Payment | None:
    stmt = select(Payment).where(Payment.payment_number == payment_number)
    if lock:
        stmt = stmt.with_for_update(of=Payment).execution_options(populate_existing=True)
    return db.scalars(stmt).one_or_none()


def list_payments(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    policy_number: str | None,
    installment_id: int | None,
    search: str | None,
    status: PaymentStatus | None,
    method: PaymentMethod | None,
    sort: PaymentSort,
    limit: int,
    offset: int,
) -> tuple[list[Payment], int]:
    stmt = _payments_base(agent_id, customer_id)
    if policy_number:
        stmt = stmt.where(Policy.policy_number == policy_number)
    if installment_id is not None:
        stmt = stmt.where(Payment.installment_id == installment_id)
    if search:
        term = search.strip()
        stmt = stmt.where(
            or_(
                Payment.payment_number.contains(term.upper(), autoescape=True),
                Payment.payment_reference.contains(term.upper(), autoescape=True),
                Policy.policy_number.contains(term.upper(), autoescape=True),
                Customer.full_name.contains(term, autoescape=True),
                Product.name.contains(term, autoescape=True),
            )
        )
    if status:
        stmt = stmt.where(Payment.status == status)
    if method:
        stmt = stmt.where(Payment.payment_method == method)

    total = db.scalar(
        select(func.count()).select_from(stmt.with_only_columns(Payment.id).subquery())
    )
    order = {
        "date-desc": (Payment.paid_at.desc(), Payment.id.desc()),
        "date-asc": (Payment.paid_at.asc(), Payment.id.asc()),
        "amount-desc": (Payment.amount.desc(), Payment.id.desc()),
        "amount-asc": (Payment.amount.asc(), Payment.id.asc()),
    }[sort]
    items = db.scalars(stmt.order_by(*order).limit(limit).offset(offset)).unique().all()
    return list(items), total or 0


def payment_status_summary(
    db: Session, *, agent_id: int | None, customer_id: int | None
) -> dict[str, Decimal | int]:
    """Counts per status and the amount collected, over the caller's whole scope."""
    base = _payments_base(agent_id, customer_id).subquery()
    rows = db.execute(
        select(base.c.status, func.count(), func.coalesce(func.sum(base.c.amount), 0)).group_by(
            base.c.status
        )
    ).all()
    summary: dict[str, Decimal | int] = {"total": 0, "collected": Decimal("0.00")}
    for status in PaymentStatus:
        summary[status.value] = 0
    for status, count, amount in rows:
        summary[status] = count
        summary["total"] += count
        if status == PaymentStatus.SUCCESSFUL:
            summary["collected"] = Decimal(amount)
    return summary
