"""SQLAlchemy models for Module 5 — Agent Commission."""

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    BigInteger,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import BINARY_COLLATION, Base, code_string

if TYPE_CHECKING:
    from app.models.party import Agent
    from app.models.policy import Policy
    from app.models.premium import Payment
    from app.models.product import Product


class CommissionRule(Base):
    """Commission rate rule: product (optionally agent-specific) + effective period."""

    __tablename__ = "commission_rules"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rule_code: Mapped[str] = mapped_column(code_string(30), nullable=False, unique=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    agent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agents.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    first_year_rate_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    renewal_rate_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    description: Mapped[str | None] = mapped_column(
        String(300, collation=BINARY_COLLATION), nullable=True
    )

    product: Mapped["Product"] = relationship(
        "Product", foreign_keys=[product_id], lazy="select"
    )
    agent: Mapped["Agent | None"] = relationship(
        "Agent", foreign_keys=[agent_id], lazy="select"
    )


class Commission(Base):
    """One commission record per successful premium payment."""

    __tablename__ = "commissions"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    commission_number: Mapped[str] = mapped_column(code_string(20), nullable=False, unique=True)
    payment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("payments.id", ondelete="RESTRICT"), nullable=False, unique=True
    )
    policy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("policies.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    agent_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("agents.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    rule_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("commission_rules.id", ondelete="RESTRICT"), nullable=True
    )
    installment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("installments.id", ondelete="RESTRICT"), nullable=False
    )
    policy_year: Mapped[int] = mapped_column(Integer, nullable=False)
    basis: Mapped[str] = mapped_column(code_string(15), nullable=False)
    rate_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    commissionable_amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    status: Mapped[str] = mapped_column(code_string(15), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    # Relationships
    policy: Mapped["Policy"] = relationship(
        "Policy", foreign_keys=[policy_id], lazy="select"
    )
    agent: Mapped["Agent"] = relationship(
        "Agent", foreign_keys=[agent_id], lazy="select"
    )
    payment: Mapped["Payment"] = relationship(
        "Payment", foreign_keys=[payment_id], lazy="select"
    )
    rule: Mapped[CommissionRule | None] = relationship(
        "CommissionRule", foreign_keys=[rule_id], lazy="select"
    )
    events: Mapped[list["CommissionEvent"]] = relationship(
        "CommissionEvent",
        back_populates="commission",
        order_by="CommissionEvent.sequence_no",
        cascade="all, delete-orphan",
    )


class CommissionEvent(Base):
    """Append-only event log for a commission (PENDING → EARNED → PAID)."""

    __tablename__ = "commission_events"
    __table_args__ = (
        UniqueConstraint(
            "commission_id", "sequence_no", name="uq_commission_events_commission_id_sequence_no"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    commission_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("commissions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(code_string(20), nullable=False)
    from_status: Mapped[str | None] = mapped_column(code_string(15), nullable=True)
    to_status: Mapped[str] = mapped_column(code_string(15), nullable=False)
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_name: Mapped[str] = mapped_column(String(200, collation=BINARY_COLLATION), nullable=False)
    actor_role: Mapped[str] = mapped_column(String(50, collation=BINARY_COLLATION), nullable=False)
    payout_reference: Mapped[str | None] = mapped_column(code_string(40), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500, collation=BINARY_COLLATION), nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)

    commission: Mapped[Commission] = relationship(
        "Commission", back_populates="events", foreign_keys=[commission_id]
    )
