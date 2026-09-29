"""Issued policies and the counter table that numbers them."""

from datetime import date

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Computed,
    Date,
    ForeignKey,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPK, Money, TimestampMixin, code_string
from app.models.enums import NomineeRelationship, PolicyStatus, PremiumFrequency, sql_in
from app.models.party import Agent, Customer
from app.models.product import Product


class Policy(TimestampMixin, Base):
    __tablename__ = "policies"
    __table_args__ = (
        # Guards against the same proposal being submitted twice.
        UniqueConstraint("customer_id", "product_id", "start_date"),
        CheckConstraint(
            "policy_number REGEXP '^POL-[0-9]{4}-[0-9]{6}$'", name="policy_number_format"
        ),
        CheckConstraint(sql_in("status", PolicyStatus), name="status_allowed"),
        CheckConstraint(sql_in("premium_frequency", PremiumFrequency), name="frequency_allowed"),
        CheckConstraint(
            sql_in("nominee_relationship", NomineeRelationship), name="nominee_relationship_allowed"
        ),
        CheckConstraint("coverage_amount > 0", name="coverage_positive"),
        CheckConstraint("annual_premium > 0", name="premium_positive"),
        CheckConstraint("term_years BETWEEN 1 AND 50", name="term_range"),
        # Only a pending proposal may lack an issue date, and cover never
        # starts before the policy was issued.
        CheckConstraint(
            "status = 'pending' OR issue_date IS NOT NULL", name="issued_has_issue_date"
        ),
        CheckConstraint(
            "issue_date IS NULL OR issue_date <= start_date", name="issue_before_start"
        ),
    )

    id: Mapped[IntPK]
    policy_number: Mapped[str] = mapped_column(code_string(20), unique=True)
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="RESTRICT"), index=True
    )
    # Indexed by the leading column of the (customer, product, start) unique key.
    customer_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("customers.id", ondelete="RESTRICT")
    )
    agent_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("agents.id", ondelete="RESTRICT"), index=True
    )
    # Who issued it through the API (null for migrated/seeded records).
    issued_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[str] = mapped_column(code_string(16), index=True)
    coverage_amount: Mapped[Money]
    # The premium rated at issuance, per year. The per-instalment amount is
    # derived (annual / instalments per year), so it is not stored twice.
    annual_premium: Mapped[Money]
    premium_frequency: Mapped[str] = mapped_column(code_string(16))
    term_years: Mapped[int] = mapped_column(SmallInteger)
    issue_date: Mapped[date | None] = mapped_column(Date)
    start_date: Mapped[date] = mapped_column(Date)
    # Derived by MySQL from start date and term, so it can never disagree with them.
    end_date: Mapped[date] = mapped_column(
        Date,
        Computed("((start_date + interval term_years year) - interval 1 day)", persisted=True),
        index=True,
    )
    nominee_name: Mapped[str] = mapped_column(String(80))
    nominee_relationship: Mapped[str] = mapped_column(code_string(16))
    nominee_date_of_birth: Mapped[date] = mapped_column(Date)

    product: Mapped[Product] = relationship(lazy="joined")
    customer: Mapped[Customer] = relationship(lazy="joined")
    agent: Mapped[Agent | None] = relationship(lazy="joined")


class IdSequence(Base):
    """Per-name counters for business identifiers (e.g. `policy:2026`,
    `customer`). Incremented inside the issuing transaction, so the row lock
    serialises concurrent issuers and a rollback also rolls the counter back."""

    __tablename__ = "id_sequences"
    __table_args__ = (CheckConstraint("current_value >= 0", name="current_value_non_negative"),)

    name: Mapped[str] = mapped_column(code_string(40), primary_key=True)
    current_value: Mapped[int] = mapped_column(BigInteger)
