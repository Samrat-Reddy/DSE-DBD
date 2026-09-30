"""Module 3 - Claim Filing & Approval Workflow.

Creates the claim reference data (claim_types, claim_type_documents), claims,
their document metadata, the append-only workflow history (claim_events) and
the per-stage records (claim_verifications, claim_assessments,
claim_settlements).

MySQL enforces the workflow's integrity:
  * every history row is a legal (from, to, action) move of the state machine
    (ck_claim_events_legal_transition) with a unique per-claim sequence number;
  * approved_amount exists exactly for approved/settled claims and never
    exceeds the claimed amount; a rejection always carries its reason;
  * an assessment never exceeds its limit; a claim is settled at most once
    (claim_settlements.claim_id is the primary key) under a unique reference.

No data is inserted: claim types and demo claims come from the development
seed (app/scripts/seed_dev_data.py).

Revision ID: 0005_claim_workflow
Revises: 0004_premium_payments
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_claim_workflow"
down_revision: str | Sequence[str] | None = "0004_premium_payments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "claim_types",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=40, collation="utf8mb4_bin"), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("product_type", sa.String(length=24, collation="utf8mb4_bin"), nullable=False),
        sa.Column("coverage_item", sa.String(length=255), nullable=False),
        sa.Column("percent_of_coverage", sa.SmallInteger(), nullable=False),
        sa.Column("max_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("limit_basis", sa.String(length=160), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "code REGEXP '^[a-z][a-z-]*[a-z]$'", name=op.f("ck_claim_types_code_format")
        ),
        sa.CheckConstraint(
            "product_type IN ('health', 'life', 'motor', 'personal_accident', 'home')",
            name=op.f("ck_claim_types_product_type_allowed"),
        ),
        sa.CheckConstraint(
            "max_amount IS NULL OR max_amount > 0", name=op.f("ck_claim_types_max_amount_positive")
        ),
        sa.CheckConstraint(
            "percent_of_coverage BETWEEN 1 AND 100", name=op.f("ck_claim_types_percent_range")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claim_types")),
        sa.UniqueConstraint("code", name=op.f("uq_claim_types_code")),
    )
    op.create_index(
        op.f("ix_claim_types_product_type"), "claim_types", ["product_type"], unique=False
    )
    op.create_table(
        "claim_type_documents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("claim_type_id", sa.BigInteger(), nullable=False),
        sa.Column("doc_type", sa.String(length=40, collation="utf8mb4_bin"), nullable=False),
        sa.Column("label", sa.String(length=100), nullable=False),
        sa.Column("suggested_name", sa.String(length=100), nullable=False),
        sa.Column("is_required", sa.Boolean(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint(
            "doc_type REGEXP '^[a-z][a-z-]*[a-z]$'",
            name=op.f("ck_claim_type_documents_doc_type_format"),
        ),
        sa.CheckConstraint("position >= 1", name=op.f("ck_claim_type_documents_position_positive")),
        sa.ForeignKeyConstraint(
            ["claim_type_id"],
            ["claim_types.id"],
            name=op.f("fk_claim_type_documents_claim_type_id_claim_types"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claim_type_documents")),
        sa.UniqueConstraint(
            "claim_type_id", "doc_type", name=op.f("uq_claim_type_documents_claim_type_id_doc_type")
        ),
    )
    op.create_table(
        "claims",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("claim_number", sa.String(length=20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("policy_id", sa.BigInteger(), nullable=False),
        sa.Column("claim_type_id", sa.BigInteger(), nullable=False),
        sa.Column("incident_date", sa.Date(), nullable=False),
        sa.Column("filing_date", sa.Date(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("claimed_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("approved_amount", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("rejection_reason", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "(status = 'rejected') = (rejection_reason IS NOT NULL)",
            name=op.f("ck_claims_rejection_reason_for_rejected"),
        ),
        sa.CheckConstraint(
            "(status IN ('approved', 'settled')) = (approved_amount IS NOT NULL)",
            name=op.f("ck_claims_approved_amount_for_approved"),
        ),
        sa.CheckConstraint(
            "claim_number REGEXP '^CLM-[0-9]{4}-[0-9]{6}$'",
            name=op.f("ck_claims_claim_number_format"),
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'submitted', 'under_review', 'verified', 'assessed', "
            "'approved', 'rejected', 'settled', 'cancelled')",
            name=op.f("ck_claims_status_allowed"),
        ),
        sa.CheckConstraint(
            "CHAR_LENGTH(description) BETWEEN 30 AND 1000",
            name=op.f("ck_claims_description_length"),
        ),
        sa.CheckConstraint(
            "approved_amount IS NULL OR (approved_amount > 0 AND approved_amount <= "
            "claimed_amount)",
            name=op.f("ck_claims_approved_amount_range"),
        ),
        sa.CheckConstraint("claimed_amount > 0", name=op.f("ck_claims_claimed_amount_positive")),
        sa.CheckConstraint(
            "incident_date <= filing_date", name=op.f("ck_claims_incident_not_after_filing")
        ),
        sa.CheckConstraint(
            "rejection_reason IS NULL OR CHAR_LENGTH(rejection_reason) >= 15",
            name=op.f("ck_claims_rejection_reason_length"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claims")),
        sa.UniqueConstraint("claim_number", name=op.f("uq_claims_claim_number")),
    )
    op.create_index(op.f("ix_claims_claim_type_id"), "claims", ["claim_type_id"], unique=False)
    op.create_index(op.f("ix_claims_policy_id"), "claims", ["policy_id"], unique=False)
    op.create_index("ix_claims_status_updated_at", "claims", ["status", "updated_at"], unique=False)
    op.create_table(
        "claim_assessments",
        sa.Column("claim_id", sa.BigInteger(), nullable=False),
        sa.Column("assessed_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("illustrative_limit", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("limit_basis", sa.String(length=160), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.CheckConstraint(
            "assessed_amount > 0 AND assessed_amount <= illustrative_limit",
            name=op.f("ck_claim_assessments_assessed_within_limit"),
        ),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_claim_assessments_claim_id_claims"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("claim_id", name=op.f("pk_claim_assessments")),
    )
    op.create_table(
        "claim_documents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.BigInteger(), nullable=False),
        sa.Column("doc_type", sa.String(length=40, collation="utf8mb4_bin"), nullable=False),
        sa.Column("file_name", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('submitted', 'verified')", name=op.f("ck_claim_documents_status_allowed")
        ),
        sa.CheckConstraint(
            "CHAR_LENGTH(file_name) >= 3", name=op.f("ck_claim_documents_file_name_length")
        ),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_claim_documents_claim_id_claims"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claim_documents")),
        sa.UniqueConstraint(
            "claim_id", "doc_type", name=op.f("uq_claim_documents_claim_id_doc_type")
        ),
    )
    op.create_table(
        "claim_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("claim_id", sa.BigInteger(), nullable=False),
        sa.Column("sequence_no", sa.SmallInteger(), nullable=False),
        sa.Column("action", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("from_status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("to_status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("actor_user_id", sa.BigInteger(), nullable=True),
        sa.Column("actor_name", sa.String(length=100), nullable=False),
        sa.Column("actor_role", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(from_status, to_status, action) IN (('draft', 'submitted', 'submit'), ('draft', "
            "'cancelled', 'cancel_draft'), ('submitted', 'under_review', 'start_review'), "
            "('submitted', 'cancelled', 'withdraw'), ('under_review', 'verified', 'verify'), "
            "('verified', 'assessed', 'assess'), ('assessed', 'approved', 'approve'), "
            "('assessed', 'rejected', 'reject'), ('approved', 'settled', 'settle'))",
            name=op.f("ck_claim_events_legal_transition"),
        ),
        sa.CheckConstraint(
            "actor_role IN ('administrator', 'agent', 'policyholder')",
            name=op.f("ck_claim_events_actor_role_allowed"),
        ),
        sa.CheckConstraint("sequence_no >= 1", name=op.f("ck_claim_events_sequence_positive")),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_claim_events_claim_id_claims"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_claim_events")),
        sa.UniqueConstraint(
            "claim_id", "sequence_no", name=op.f("uq_claim_events_claim_id_sequence_no")
        ),
    )
    op.create_index(
        op.f("ix_claim_events_actor_user_id"), "claim_events", ["actor_user_id"], unique=False
    )
    op.create_table(
        "claim_settlements",
        sa.Column("claim_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "settlement_reference", sa.String(length=20, collation="utf8mb4_bin"), nullable=False
        ),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("settled_on", sa.Date(), nullable=False),
        sa.CheckConstraint(
            "settlement_reference REGEXP '^SET-[0-9]{4}-[0-9]{6}$'",
            name=op.f("ck_claim_settlements_reference_format"),
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_claim_settlements_amount_positive")),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_claim_settlements_claim_id_claims"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("claim_id", name=op.f("pk_claim_settlements")),
        sa.UniqueConstraint(
            "settlement_reference", name=op.f("uq_claim_settlements_settlement_reference")
        ),
    )
    op.create_table(
        "claim_verifications",
        sa.Column("claim_id", sa.BigInteger(), nullable=False),
        sa.Column("checks_passed", sa.SmallInteger(), nullable=False),
        sa.Column("checks_total", sa.SmallInteger(), nullable=False),
        sa.Column("warnings", sa.SmallInteger(), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        sa.CheckConstraint(
            "checks_total >= 1 AND checks_passed BETWEEN 0 AND checks_total AND warnings "
            "BETWEEN 0 AND checks_total",
            name=op.f("ck_claim_verifications_counts_consistent"),
        ),
        sa.ForeignKeyConstraint(
            ["claim_id"],
            ["claims.id"],
            name=op.f("fk_claim_verifications_claim_id_claims"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("claim_id", name=op.f("pk_claim_verifications")),
    )
    # FKs after their indexes, so MySQL reuses ix_* instead of adding duplicates.
    # Other FK columns are the leading column of a unique key or the primary key.
    op.create_foreign_key(
        op.f("fk_claims_policy_id_policies"),
        "claims",
        "policies",
        ["policy_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_claims_claim_type_id_claim_types"),
        "claims",
        "claim_types",
        ["claim_type_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_claim_events_actor_user_id_users"),
        "claim_events",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # Dropping a table drops its indexes and constraints; children first.
    for table in (
        "claim_settlements",
        "claim_assessments",
        "claim_verifications",
        "claim_events",
        "claim_documents",
        "claims",
        "claim_type_documents",
        "claim_types",
    ):
        op.drop_table(table)
