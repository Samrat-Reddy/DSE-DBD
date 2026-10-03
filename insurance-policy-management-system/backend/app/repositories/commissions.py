"""Commission repository — all SQL, never commits."""

from __future__ import annotations

from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.commission import Commission, CommissionEvent, CommissionRule
from app.models.party import Agent
from app.models.policy import Policy
from app.models.premium import Installment, Payment
from app.repositories.policies import _next_value
from app.services.commission_rules import CommissionRule as CommissionRuleDomain

CommissionSort = Literal["newest", "oldest", "status"]


# ---------------------------------------------------------------------------
# Business identifiers
# ---------------------------------------------------------------------------


def next_commission_number(db: Session, year: int) -> str:
    prefix = f"COM-{year:04d}-"
    value = _next_value(
        db,
        f"commission:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(commission_number, 10) AS UNSIGNED)) "
        "FROM commissions WHERE commission_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


# ---------------------------------------------------------------------------
# Commission rules
# ---------------------------------------------------------------------------


def list_commission_rules(db: Session) -> list[CommissionRule]:
    return list(db.scalars(select(CommissionRule).order_by(CommissionRule.effective_from)).all())


def get_commission_rule_by_code(db: Session, rule_code: str) -> CommissionRule | None:
    return db.scalars(
        select(CommissionRule).where(CommissionRule.rule_code == rule_code)
    ).one_or_none()


def rules_to_domain(rules: list[CommissionRule]) -> list[CommissionRuleDomain]:
    """Convert ORM rule rows to the pure domain dataclass."""
    return [
        CommissionRuleDomain(
            id=r.id,
            rule_code=r.rule_code,
            product_id=r.product_id,
            agent_id=r.agent_id,
            first_year_rate_percent=r.first_year_rate_percent,
            renewal_rate_percent=r.renewal_rate_percent,
            effective_from=r.effective_from,
            effective_to=r.effective_to,
            description=r.description,
        )
        for r in rules
    ]


# ---------------------------------------------------------------------------
# Commissions
# ---------------------------------------------------------------------------


def get_commission_by_number(db: Session, commission_number: str) -> Commission | None:
    return db.scalars(
        select(Commission).where(Commission.commission_number == commission_number)
    ).one_or_none()


def get_commission_by_payment_id(db: Session, payment_id: int) -> Commission | None:
    return db.scalars(select(Commission).where(Commission.payment_id == payment_id)).one_or_none()


def lock_commission(db: Session, commission_number: str) -> Commission | None:
    return db.scalars(
        select(Commission)
        .where(Commission.commission_number == commission_number)
        .with_for_update()
    ).one_or_none()


def list_commissions(
    db: Session,
    *,
    agent_id: int | None,
    status: str | None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[Commission], int]:
    stmt = select(Commission)
    if agent_id is not None:
        stmt = stmt.where(Commission.agent_id == agent_id)
    if status:
        stmt = stmt.where(Commission.status == status)

    total = db.scalar(
        select(func.count()).select_from(stmt.with_only_columns(Commission.id).subquery())
    )
    items = list(
        db.scalars(stmt.order_by(Commission.generated_at.desc()).limit(limit).offset(offset)).all()
    )
    return items, total or 0


def status_counts(db: Session, *, agent_id: int | None) -> dict[str, int]:
    stmt = select(Commission.status, func.count().label("n")).group_by(Commission.status)
    if agent_id is not None:
        stmt = stmt.where(Commission.agent_id == agent_id)
    return {row.status: row.n for row in db.execute(stmt)}


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------


def next_event_sequence(db: Session, commission_id: int) -> int:
    current = db.scalar(
        select(func.max(CommissionEvent.sequence_no)).where(
            CommissionEvent.commission_id == commission_id
        )
    )
    return (current or 0) + 1


def get_payment_with_installment(db: Session, payment_id: int) -> Payment | None:
    return db.scalars(select(Payment).where(Payment.id == payment_id)).one_or_none()


def get_installment_by_id(db: Session, installment_id: int) -> Installment | None:
    return db.scalars(select(Installment).where(Installment.id == installment_id)).one_or_none()


def get_agent_by_id(db: Session, agent_id: int) -> Agent | None:
    return db.scalars(select(Agent).where(Agent.id == agent_id)).one_or_none()


def list_successful_payments_without_commission(
    db: Session, *, agent_id: int | None, limit: int = 500
) -> list[Payment]:
    """Payments that are SUCCESSFUL and have no commission record yet."""
    stmt = (
        select(Payment)
        .where(Payment.status == "successful")
        .outerjoin(Commission, Commission.payment_id == Payment.id)
        .where(Commission.id.is_(None))
    )
    if agent_id is not None:
        stmt = stmt.join(Installment, Installment.id == Payment.installment_id).join(
            Policy, Policy.id == Installment.premium_schedule_id
        )
        # filter by agent
        stmt = stmt.where(Policy.agent_id == agent_id)
    return list(db.scalars(stmt.limit(limit)).all())
