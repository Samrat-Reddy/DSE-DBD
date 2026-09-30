"""Module 3 - Claim Filing & Approval Workflow.

claim_types 1 --- * claim_type_documents       (reference data: claimable cover)
policies    1 --- * claims * --- 1 claim_types
claims      1 --- * claim_documents            (document metadata, no files)
claims      1 --- * claim_events               (append-only workflow history)
claims      1 --- 0..1 claim_verifications / claim_assessments / claim_settlements

The claimant is the policy's customer (not stored twice); "filed by" and
"assigned to" are read from the history, not duplicated on the claim.
"""

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    inspect,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db.base import Base, IntPK, Money, TimestampMixin, code_string
from app.models.enums import (
    ClaimAction,
    ClaimDocumentStatus,
    ClaimStatus,
    ProductType,
    sql_in,
)
from app.models.policy import Policy
from app.models.role import RoleName
from app.services.claim_transitions import LEGAL_TRANSITIONS

DESCRIPTION_MIN, DESCRIPTION_MAX = 30, 1000
REJECTION_REASON_MIN = 15

_LEGAL_EVENT_CHECK = "(from_status, to_status, action) IN ({})".format(
    ", ".join(f"('{f.value}', '{t.value}', '{a.value}')" for f, t, a in LEGAL_TRANSITIONS)
)


class ClaimType(TimestampMixin, Base):
    """A claimable benefit: tied to a product type and to a coverage item that
    the product must carry (matched on the coverage item's name)."""

    __tablename__ = "claim_types"
    __table_args__ = (
        CheckConstraint("code REGEXP '^[a-z][a-z-]*[a-z]$'", name="code_format"),
        CheckConstraint(sql_in("product_type", ProductType), name="product_type_allowed"),
        CheckConstraint("percent_of_coverage BETWEEN 1 AND 100", name="percent_range"),
        CheckConstraint("max_amount IS NULL OR max_amount > 0", name="max_amount_positive"),
    )

    id: Mapped[IntPK]
    code: Mapped[str] = mapped_column(code_string(40), unique=True)
    label: Mapped[str] = mapped_column(String(100))
    product_type: Mapped[str] = mapped_column(code_string(24), index=True)
    coverage_item: Mapped[str] = mapped_column(String(255))
    percent_of_coverage: Mapped[int] = mapped_column(SmallInteger)
    max_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    limit_basis: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(String(255))

    documents: Mapped[list["ClaimTypeDocument"]] = relationship(
        lazy="selectin", order_by="ClaimTypeDocument.position"
    )


class ClaimTypeDocument(Base):
    """A document a claim of this type needs (or accepts)."""

    __tablename__ = "claim_type_documents"
    __table_args__ = (
        UniqueConstraint("claim_type_id", "doc_type"),
        CheckConstraint("doc_type REGEXP '^[a-z][a-z-]*[a-z]$'", name="doc_type_format"),
        CheckConstraint("position >= 1", name="position_positive"),
    )

    id: Mapped[IntPK]
    claim_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("claim_types.id", ondelete="CASCADE")
    )
    doc_type: Mapped[str] = mapped_column(code_string(40))
    label: Mapped[str] = mapped_column(String(100))
    suggested_name: Mapped[str] = mapped_column(String(100))
    is_required: Mapped[bool] = mapped_column(Boolean)
    position: Mapped[int] = mapped_column(SmallInteger)


class Claim(TimestampMixin, Base):
    __tablename__ = "claims"
    __table_args__ = (
        CheckConstraint(
            "claim_number REGEXP '^CLM-[0-9]{4}-[0-9]{6}$'", name="claim_number_format"
        ),
        CheckConstraint(sql_in("status", ClaimStatus), name="status_allowed"),
        CheckConstraint("claimed_amount > 0", name="claimed_amount_positive"),
        CheckConstraint("incident_date <= filing_date", name="incident_not_after_filing"),
        CheckConstraint(
            f"CHAR_LENGTH(description) BETWEEN {DESCRIPTION_MIN} AND {DESCRIPTION_MAX}",
            name="description_length",
        ),
        # A decision amount exists exactly for approved/settled claims, never
        # above what was claimed.
        CheckConstraint(
            "(status IN ('approved', 'settled')) = (approved_amount IS NOT NULL)",
            name="approved_amount_for_approved",
        ),
        CheckConstraint(
            "approved_amount IS NULL "
            "OR (approved_amount > 0 AND approved_amount <= claimed_amount)",
            name="approved_amount_range",
        ),
        # A rejection always carries its reason, and only a rejection does.
        CheckConstraint(
            "(status = 'rejected') = (rejection_reason IS NOT NULL)",
            name="rejection_reason_for_rejected",
        ),
        CheckConstraint(
            f"rejection_reason IS NULL OR CHAR_LENGTH(rejection_reason) >= {REJECTION_REASON_MIN}",
            name="rejection_reason_length",
        ),
        Index("ix_claims_status_updated_at", "status", "updated_at"),
    )

    id: Mapped[IntPK]
    claim_number: Mapped[str] = mapped_column(code_string(20), unique=True)
    policy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("policies.id", ondelete="RESTRICT"), index=True
    )
    claim_type_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("claim_types.id", ondelete="RESTRICT"), index=True
    )
    incident_date: Mapped[date] = mapped_column(Date)
    filing_date: Mapped[date] = mapped_column(Date)
    description: Mapped[str] = mapped_column(Text)
    claimed_amount: Mapped[Money]
    approved_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    rejection_reason: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(code_string(16))

    policy: Mapped[Policy] = relationship(lazy="joined")
    claim_type: Mapped[ClaimType] = relationship(lazy="joined")
    documents: Mapped[list["ClaimDocument"]] = relationship(
        lazy="selectin", order_by="ClaimDocument.id"
    )
    events: Mapped[list["ClaimEvent"]] = relationship(
        lazy="selectin", order_by="ClaimEvent.sequence_no"
    )
    verification: Mapped["ClaimVerification | None"] = relationship(lazy="selectin")
    assessment: Mapped["ClaimAssessment | None"] = relationship(lazy="selectin")
    settlement: Mapped["ClaimSettlement | None"] = relationship(lazy="selectin")


class ClaimDocument(Base):
    """Metadata for a document the filer provided. No file is stored."""

    __tablename__ = "claim_documents"
    __table_args__ = (
        UniqueConstraint("claim_id", "doc_type"),
        CheckConstraint(sql_in("status", ClaimDocumentStatus), name="status_allowed"),
        CheckConstraint("CHAR_LENGTH(file_name) >= 3", name="file_name_length"),
    )

    id: Mapped[IntPK]
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("claims.id", ondelete="RESTRICT"))
    doc_type: Mapped[str] = mapped_column(code_string(40))
    file_name: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(code_string(16))
    submitted_at: Mapped[datetime] = mapped_column(DateTime)


class ClaimEvent(Base):
    """One workflow transition. Append-only: rows are inserted, never changed.

    MySQL enforces that every row is a legal (from, to, action) move of the
    state machine and that sequence numbers are unique per claim. The ORM
    refuses to modify a stored row (`_append_only`); no API edits or deletes
    history. A trigger would need SUPER under binary logging (see Module 2).
    """

    __tablename__ = "claim_events"
    __table_args__ = (
        UniqueConstraint("claim_id", "sequence_no"),
        CheckConstraint("sequence_no >= 1", name="sequence_positive"),
        CheckConstraint(_LEGAL_EVENT_CHECK, name="legal_transition"),
        CheckConstraint(sql_in("actor_role", RoleName), name="actor_role_allowed"),
    )

    id: Mapped[IntPK]
    claim_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("claims.id", ondelete="RESTRICT"))
    sequence_no: Mapped[int] = mapped_column(SmallInteger)
    action: Mapped[str] = mapped_column(code_string(16))
    from_status: Mapped[str] = mapped_column(code_string(16))
    to_status: Mapped[str] = mapped_column(code_string(16))
    # Who acted: their login (null for history migrated from before logins
    # existed) plus the name and role as they were at the time.
    actor_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), index=True
    )
    actor_name: Mapped[str] = mapped_column(String(100))
    actor_role: Mapped[str] = mapped_column(code_string(16))
    note: Mapped[str | None] = mapped_column(String(1000))
    occurred_at: Mapped[datetime] = mapped_column(DateTime)

    @validates(
        "claim_id", "sequence_no", "action", "from_status", "to_status",
        "actor_user_id", "actor_name", "actor_role", "note", "occurred_at",
    )  # fmt: skip
    def _append_only(self, key, value):
        state = inspect(self)
        if state.persistent or state.detached:
            raise ValueError("Claim workflow history is append-only; events cannot be changed.")
        return value


class ClaimVerification(Base):
    """Snapshot of the verification checklist when the claim was verified."""

    __tablename__ = "claim_verifications"
    __table_args__ = (
        CheckConstraint(
            "checks_total >= 1 AND checks_passed BETWEEN 0 AND checks_total "
            "AND warnings BETWEEN 0 AND checks_total",
            name="counts_consistent",
        ),
    )

    claim_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("claims.id", ondelete="RESTRICT"), primary_key=True
    )
    checks_passed: Mapped[int] = mapped_column(SmallInteger)
    checks_total: Mapped[int] = mapped_column(SmallInteger)
    warnings: Mapped[int] = mapped_column(SmallInteger)
    note: Mapped[str | None] = mapped_column(String(1000))


class ClaimAssessment(Base):
    """The assessed payable amount and the limit it was checked against."""

    __tablename__ = "claim_assessments"
    __table_args__ = (
        CheckConstraint(
            "assessed_amount > 0 AND assessed_amount <= illustrative_limit",
            name="assessed_within_limit",
        ),
    )

    claim_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("claims.id", ondelete="RESTRICT"), primary_key=True
    )
    assessed_amount: Mapped[Money]
    illustrative_limit: Mapped[Money]
    limit_basis: Mapped[str] = mapped_column(String(160))
    note: Mapped[str | None] = mapped_column(String(1000))


class ClaimSettlement(Base):
    """A recorded settlement (reference and amount). No money moves."""

    __tablename__ = "claim_settlements"
    __table_args__ = (
        CheckConstraint(
            "settlement_reference REGEXP '^SET-[0-9]{4}-[0-9]{6}$'", name="reference_format"
        ),
        CheckConstraint("amount > 0", name="amount_positive"),
    )

    # PK = claim_id: a claim can be settled at most once, enforced by MySQL.
    claim_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("claims.id", ondelete="RESTRICT"), primary_key=True
    )
    settlement_reference: Mapped[str] = mapped_column(code_string(20), unique=True)
    amount: Mapped[Money]
    settled_on: Mapped[date] = mapped_column(Date)


__all__ = [
    "Claim",
    "ClaimAction",
    "ClaimAssessment",
    "ClaimDocument",
    "ClaimEvent",
    "ClaimSettlement",
    "ClaimType",
    "ClaimTypeDocument",
    "ClaimVerification",
]
