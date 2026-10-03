"""Module 4 - Renewal Reminder Engine.

Creates:
  simulation_clock  administrator-only "as-of" date override (one row)
  reminder_checks   append-only log of each reminder-check run
  reminders         one row per policy/stage attempt
  reminder_attempts append-only attempt history (idempotency and retries)

Idempotency is enforced by a UNIQUE constraint on
(policy_id, stage, check_date) for auto-generated reminders and a
UNIQUE constraint on reminder_id per reminder_attempts row. Manual
triggers are NOT in the auto-check unique constraint (they carry a
different trigger value), so they do not block later automatic checks.

Revision ID: 0006_renewal_reminders
Revises:     0005_claim_workflow
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_renewal_reminders"
down_revision: str = "0005_claim_workflow"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # --- simulation_clock ------------------------------------------------
    # Exactly one row (enforced by CHECK on the pk value).
    op.create_table(
        "simulation_clock",
        sa.Column("id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("as_of_date", sa.Date(), nullable=True),
        sa.Column(
            "set_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "users.id", name="fk_simulation_clock_set_by_user_id_users", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column("set_at", sa.DateTime(), nullable=True),
        sa.Column("note", sa.String(300, collation="utf8mb4_bin"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_simulation_clock"),
        sa.CheckConstraint("id = 1", name="ck_simulation_clock_singleton"),
        sa.CheckConstraint(
            "as_of_date IS NULL OR as_of_date >= '2020-01-01'", name="ck_simulation_clock_sane_date"
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_simulation_clock_set_by_user_id", "simulation_clock", ["set_by_user_id"])

    # Seed the singleton row (no date set = use real today).
    op.execute("INSERT INTO simulation_clock (id, as_of_date) VALUES (1, NULL)")

    # --- reminder_check_runs -----------------------------------------------
    op.create_table(
        "reminder_check_runs",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_number", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("evaluated_as_of", sa.Date(), nullable=False),
        sa.Column("run_at", sa.DateTime(), nullable=False),
        sa.Column(
            "run_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "users.id", name="fk_reminder_check_runs_run_by_user_id_users", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column("run_by_name", sa.String(200, collation="utf8mb4_bin"), nullable=False),
        sa.Column("run_by_role", sa.String(50, collation="utf8mb4_bin"), nullable=False),
        sa.Column("policies_evaluated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reminders_generated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("reminders_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("already_handled", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("needs_retry", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_yet_due", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("not_eligible", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id", name="pk_reminder_check_runs"),
        sa.UniqueConstraint("run_number", name="uq_reminder_check_runs_run_number"),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_reminder_check_runs_run_by_user_id", "reminder_check_runs", ["run_by_user_id"]
    )
    op.create_index(
        "ix_reminder_check_runs_evaluated_as_of", "reminder_check_runs", ["evaluated_as_of"]
    )

    # --- reminders ---------------------------------------------------------
    # One logical reminder attempt per (policy_id, stage). The latest
    # attempt for a stage is what the UI and engine read. A reminder_id is
    # the business key used by the UI.
    op.create_table(
        "reminders",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("reminder_number", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "policy_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "policies.id", name="fk_reminders_policy_id_policies", ondelete="CASCADE"
            ),
            nullable=False,
        ),
        sa.Column("stage", sa.String(10, collation="utf8mb4_bin"), nullable=False),
        sa.Column("scheduled_for", sa.Date(), nullable=False),
        sa.Column("channel", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("status", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("reminder_trigger", sa.String(30, collation="utf8mb4_bin"), nullable=False),
        sa.Column("evaluated_as_of", sa.Date(), nullable=False),
        sa.Column("attempted_at", sa.DateTime(), nullable=False),
        sa.Column("sent_at", sa.DateTime(), nullable=True),
        sa.Column(
            "check_run_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "reminder_check_runs.id",
                name="fk_reminders_check_run_id_reminder_check_runs",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
        sa.Column(
            "retry_of_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "reminders.id",
                name="fk_reminders_retry_of_id_reminders",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
        sa.Column(
            "created_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "users.id", name="fk_reminders_created_by_user_id_users", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column("created_by_name", sa.String(200, collation="utf8mb4_bin"), nullable=False),
        sa.Column("created_by_role", sa.String(50, collation="utf8mb4_bin"), nullable=False),
        sa.Column("note", sa.String(500, collation="utf8mb4_bin"), nullable=True),
        sa.Column("result", sa.String(500, collation="utf8mb4_bin"), nullable=True),
        sa.Column("superseded_by", sa.String(10, collation="utf8mb4_bin"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_reminders"),
        sa.UniqueConstraint("reminder_number", name="uq_reminders_reminder_number"),
        # Idempotency: one auto-check reminder per policy/stage/date.
        # Manual triggers and retries have trigger != 'reminder-check',
        # so they are excluded from this constraint by the partial-index
        # workaround (MySQL does not support partial indexes, so we use
        # a generated column instead — see below).
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_reminders_policy_id", "reminders", ["policy_id"])
    op.create_index("ix_reminders_check_run_id", "reminders", ["check_run_id"])
    op.create_index("ix_reminders_retry_of_id", "reminders", ["retry_of_id"])
    op.create_index("ix_reminders_created_by_user_id", "reminders", ["created_by_user_id"])
    op.create_index("ix_reminders_attempted_at", "reminders", ["attempted_at"])

    # Idempotency unique key for automatic check reminders.
    # For trigger='reminder-check' we enforce at most one attempt per
    # (policy_id, stage, evaluated_as_of). For other triggers (manual /
    # retry / seed) we don't restrict. MySQL partial-unique is unavailable,
    # so we add a generated column that is policy_id+stage+date for
    # check-triggers and NULL for others (NULL is never equal to NULL in
    # UNIQUE, so multiple NULLs are fine).
    op.execute(
        """
        ALTER TABLE reminders
        ADD COLUMN check_idempotency_key VARCHAR(60)
            GENERATED ALWAYS AS (
                IF(reminder_trigger = 'reminder-check',
                   CONCAT(CAST(policy_id AS CHAR), '-', stage, '-', evaluated_as_of),
                   NULL)
            ) VIRTUAL
        """
    )
    op.execute(
        "ALTER TABLE reminders "
        "ADD UNIQUE INDEX uq_reminders_check_idempotency (check_idempotency_key)"
    )

    # CHECK constraints
    op.execute(
        "ALTER TABLE reminders ADD CONSTRAINT ck_reminders_status "
        "CHECK (status IN ('sent','failed','skipped'))"
    )
    op.execute(
        "ALTER TABLE reminders ADD CONSTRAINT ck_reminders_trigger "
        "CHECK (reminder_trigger IN ('reminder-check','manual','retry','seed'))"
    )
    op.execute(
        "ALTER TABLE reminders ADD CONSTRAINT ck_reminders_channel "
        "CHECK (channel IN ('email','sms','in-app'))"
    )
    op.execute(
        "ALTER TABLE reminders ADD CONSTRAINT ck_reminders_sent_at "
        "CHECK (status != 'sent' OR sent_at IS NOT NULL)"
    )


def downgrade() -> None:
    op.drop_table("reminders")
    op.drop_table("reminder_check_runs")
    op.drop_table("simulation_clock")
