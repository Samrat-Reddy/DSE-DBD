"""Module 2 - Premium Schedule & Payments.

Creates premium_schedules (one per policy), installments and payments, with
CHECK constraints that keep every stored balance consistent:
  * amount_paid between 0 and amount_due;
  * stored status (pending / partially_paid / paid) matches amount_paid;
  * a failure reason exactly on failed payments;
  * unique payment numbers and payment references (duplicate protection).
Payment immutability (installment_id, amount, number, reference) is enforced
by the Payment model, not a trigger: CREATE TRIGGER needs SUPER while binary
logging is on (MySQL error 1419), which the application account must not have.

No data is inserted. Schedules for policies issued before this revision are
created by `python -m app.scripts.backfill_premium_schedules` (idempotent),
which seed_dev_data also runs.

Revision ID: 0004_premium_payments
Revises: 0003_policy_catalog
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_premium_payments"
down_revision: str | Sequence[str] | None = "0003_policy_catalog"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "premium_schedules",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("policy_id", sa.BigInteger(), nullable=False),
        sa.Column("installment_count", sa.SmallInteger(), nullable=False),
        sa.Column("total_premium", sa.Numeric(precision=14, scale=2), nullable=False),
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
            "installment_count BETWEEN 1 AND 600",
            name=op.f("ck_premium_schedules_installment_count_range"),
        ),
        sa.CheckConstraint(
            "total_premium > 0", name=op.f("ck_premium_schedules_total_premium_positive")
        ),
        sa.ForeignKeyConstraint(
            ["policy_id"],
            ["policies.id"],
            name=op.f("fk_premium_schedules_policy_id_policies"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_premium_schedules")),
        sa.UniqueConstraint("policy_id", name=op.f("uq_premium_schedules_policy_id")),
    )
    op.create_table(
        "installments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("schedule_id", sa.BigInteger(), nullable=False),
        sa.Column("installment_number", sa.SmallInteger(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("amount_due", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "amount_paid",
            sa.Numeric(precision=14, scale=2),
            server_default=sa.text("0.00"),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=16, collation="utf8mb4_bin"),
            server_default=sa.text("'pending'"),
            nullable=False,
        ),
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
            "(status = 'pending' AND amount_paid = 0) "
            "OR (status = 'partially_paid' AND amount_paid > 0 AND amount_paid < amount_due) "
            "OR (status = 'paid' AND amount_paid = amount_due)",
            name=op.f("ck_installments_status_matches_amount"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'partially_paid', 'paid')",
            name=op.f("ck_installments_status_allowed"),
        ),
        sa.CheckConstraint("amount_due > 0", name=op.f("ck_installments_amount_due_positive")),
        sa.CheckConstraint(
            "amount_paid >= 0 AND amount_paid <= amount_due",
            name=op.f("ck_installments_amount_paid_within_due"),
        ),
        sa.CheckConstraint(
            "installment_number >= 1", name=op.f("ck_installments_installment_number_positive")
        ),
        sa.ForeignKeyConstraint(
            ["schedule_id"],
            ["premium_schedules.id"],
            name=op.f("fk_installments_schedule_id_premium_schedules"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_installments")),
        sa.UniqueConstraint(
            "schedule_id", "due_date", name=op.f("uq_installments_schedule_id_due_date")
        ),
        sa.UniqueConstraint(
            "schedule_id",
            "installment_number",
            name=op.f("uq_installments_schedule_id_installment_number"),
        ),
    )
    op.create_index(
        "ix_installments_status_due_date", "installments", ["status", "due_date"], unique=False
    )
    op.create_table(
        "payments",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("payment_number", sa.String(length=20, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "payment_reference", sa.String(length=40, collation="utf8mb4_bin"), nullable=False
        ),
        sa.Column("installment_id", sa.BigInteger(), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("payment_method", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("paid_at", sa.DateTime(), nullable=False),
        sa.Column("failure_reason", sa.String(length=255), nullable=True),
        sa.Column("recorded_by_user_id", sa.BigInteger(), nullable=True),
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
            "(status = 'failed') = (failure_reason IS NOT NULL)",
            name=op.f("ck_payments_failure_reason_for_failed"),
        ),
        sa.CheckConstraint(
            "payment_method IN ('upi', 'card', 'net_banking')",
            name=op.f("ck_payments_method_allowed"),
        ),
        sa.CheckConstraint(
            "payment_number REGEXP '^PAY-[0-9]{4}-[0-9]{6}$'",
            name=op.f("ck_payments_payment_number_format"),
        ),
        sa.CheckConstraint(
            "payment_reference REGEXP '^[A-Z0-9][A-Z0-9-]{4,38}[A-Z0-9]$'",
            name=op.f("ck_payments_payment_reference_format"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'successful', 'failed')", name=op.f("ck_payments_status_allowed")
        ),
        sa.CheckConstraint("amount > 0", name=op.f("ck_payments_amount_positive")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_payments")),
        sa.UniqueConstraint("payment_number", name=op.f("uq_payments_payment_number")),
        sa.UniqueConstraint("payment_reference", name=op.f("uq_payments_payment_reference")),
    )
    op.create_index(
        op.f("ix_payments_installment_id"), "payments", ["installment_id"], unique=False
    )
    op.create_index(
        op.f("ix_payments_recorded_by_user_id"), "payments", ["recorded_by_user_id"], unique=False
    )
    op.create_index("ix_payments_status_paid_at", "payments", ["status", "paid_at"], unique=False)
    # FKs after their indexes, so MySQL reuses ix_* instead of adding duplicates.
    # installments.schedule_id is covered by the leading column of its unique keys;
    # premium_schedules.policy_id by uq_premium_schedules_policy_id.
    op.create_foreign_key(
        op.f("fk_payments_installment_id_installments"),
        "payments",
        "installments",
        ["installment_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_payments_recorded_by_user_id_users"),
        "payments",
        "users",
        ["recorded_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # Dropping a table drops its indexes and constraints; children first.
    for table in ("payments", "installments", "premium_schedules"):
        op.drop_table(table)
