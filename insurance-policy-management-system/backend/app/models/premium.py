"""Module 2 - Premium Schedule & Payments.

policies 1 --- 0..1 premium_schedules 1 --- * installments 1 --- * payments

The schedule stores only what it adds to the policy: how many instalments
and the total premium they must add up to. Frequency, term, start date and
annual premium stay on `policies` (the schedule is generated from them).
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
    inspect,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base, IntPK, Money, TimestampMixin, code_string
from app.models.enums import (
    STORED_INSTALLMENT_STATUSES,
    PaymentMethod,
    PaymentStatus,
    sql_in,
)
from app.models.policy import Policy


class PremiumSchedule(TimestampMixin, Base):
    __tablename__ = "premium_schedules"
    __table_args__ = (
        CheckConstraint("installment_count BETWEEN 1 AND 600", name="installment_count_range"),
        CheckConstraint("total_premium > 0", name="total_premium_positive"),
    )

    id: Mapped[IntPK]
    # UNIQUE: exactly one schedule per policy.
    policy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("policies.id", ondelete="RESTRICT"), unique=True
    )
    installment_count: Mapped[int] = mapped_column(SmallInteger)
    # annual premium x term: the amount the instalments must sum to exactly.
    total_premium: Mapped[Money]

    policy: Mapped[Policy] = relationship(lazy="joined")
    installments: Mapped[list["Installment"]] = relationship(
        back_populates="schedule", order_by="Installment.installment_number", lazy="selectin"
    )


class Installment(TimestampMixin, Base):
    __tablename__ = "installments"
    __table_args__ = (
        UniqueConstraint("schedule_id", "installment_number"),
        UniqueConstraint("schedule_id", "due_date"),
        CheckConstraint("installment_number >= 1", name="installment_number_positive"),
        CheckConstraint("amount_due > 0", name="amount_due_positive"),
        CheckConstraint(
            "amount_paid >= 0 AND amount_paid <= amount_due", name="amount_paid_within_due"
        ),
        CheckConstraint(sql_in("status", STORED_INSTALLMENT_STATUSES), name="status_allowed"),
        # The stored status can never disagree with the money actually paid.
        CheckConstraint(
            "(status = 'pending' AND amount_paid = 0) "
            "OR (status = 'partially_paid' AND amount_paid > 0 AND amount_paid < amount_due) "
            "OR (status = 'paid' AND amount_paid = amount_due)",
            name="status_matches_amount",
        ),
        Index("ix_installments_status_due_date", "status", "due_date"),
    )

    id: Mapped[IntPK]
    schedule_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("premium_schedules.id", ondelete="RESTRICT")
    )
    installment_number: Mapped[int] = mapped_column(SmallInteger)
    due_date: Mapped[date] = mapped_column(Date)
    amount_due: Mapped[Money]
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(14, 2), server_default=text("0.00"))
    status: Mapped[str] = mapped_column(code_string(16), server_default=text("'pending'"))

    schedule: Mapped[PremiumSchedule] = relationship(back_populates="installments", lazy="joined")


class Payment(TimestampMixin, Base):
    """One payment attempt against one instalment.

    `payment_number` (PAY-YYYY-NNNNNN) is the server-generated business ID.
    `payment_reference` is supplied by the payer for each attempt and is
    UNIQUE, so resubmitting the same attempt can never record it twice.
    Once saved, a payment's instalment, amount, number and reference never
    change (`_immutable_after_insert`); only its status may settle. A MySQL
    trigger would need SUPER under binary logging, so the model enforces it.
    """

    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "payment_number REGEXP '^PAY-[0-9]{4}-[0-9]{6}$'", name="payment_number_format"
        ),
        CheckConstraint(
            "payment_reference REGEXP '^[A-Z0-9][A-Z0-9-]{4,38}[A-Z0-9]$'",
            name="payment_reference_format",
        ),
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(sql_in("status", PaymentStatus), name="status_allowed"),
        CheckConstraint(sql_in("payment_method", PaymentMethod), name="method_allowed"),
        # Only a failed attempt carries a failure reason, and it always does.
        CheckConstraint(
            "(status = 'failed') = (failure_reason IS NOT NULL)", name="failure_reason_for_failed"
        ),
        Index("ix_payments_status_paid_at", "status", "paid_at"),
    )

    id: Mapped[IntPK]
    payment_number: Mapped[str] = mapped_column(code_string(20), unique=True)
    payment_reference: Mapped[str] = mapped_column(code_string(40), unique=True)
    installment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("installments.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Money]
    status: Mapped[str] = mapped_column(code_string(16))
    payment_method: Mapped[str] = mapped_column(code_string(16))
    paid_at: Mapped[datetime] = mapped_column(DateTime)
    failure_reason: Mapped[str | None] = mapped_column(String(255))
    recorded_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )

    installment: Mapped[Installment] = relationship(lazy="joined")

    @validates("installment_id", "installment", "amount", "payment_number", "payment_reference")
    def _immutable_after_insert(self, key, value):
        state = inspect(self)
        if state.persistent or state.detached:
            current = getattr(self, key)
            if current is not None and value is not current and value != current:
                raise ValueError(f"A recorded payment's {key} cannot be changed.")
        return value
