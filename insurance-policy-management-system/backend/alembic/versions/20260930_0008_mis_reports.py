"""Module 6 - MIS Reports.

Module 6 is a read-only reporting layer that reads from Modules 1–5 tables.
It requires NO new tables of its own (reports are never persisted; they are
computed on demand). This migration creates one table:

  report_access_log  Append-only log of every MIS report query. This exists
                     to show that the system tracks who generated which report
                     and when, as required for an audit trail.

Revision ID: 0008_mis_reports
Revises:     0007_agent_commission
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008_mis_reports"
down_revision: str = "0007_agent_commission"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "report_access_log",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "accessed_by_user_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "users.id",
                name="fk_report_access_log_accessed_by_user_id_users",
                ondelete="SET NULL",
            ),
            nullable=True,
        ),
        sa.Column("accessed_by_name", sa.String(200, collation="utf8mb4_bin"), nullable=False),
        sa.Column("accessed_by_role", sa.String(50, collation="utf8mb4_bin"), nullable=False),
        sa.Column("report_id", sa.String(30, collation="utf8mb4_bin"), nullable=False),
        sa.Column("period", sa.String(20, collation="utf8mb4_bin"), nullable=True),
        sa.Column("period_from", sa.Date(), nullable=True),
        sa.Column("period_to", sa.Date(), nullable=True),
        sa.Column("row_count", sa.Integer(), nullable=True),
        sa.Column("accessed_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_report_access_log"),
        sa.CheckConstraint(
            "report_id IN ('overview','policies','premiums','claims','renewals','commissions')",
            name="ck_report_access_log_report_id",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index(
        "ix_report_access_log_accessed_by_user_id", "report_access_log", ["accessed_by_user_id"]
    )
    op.create_index("ix_report_access_log_accessed_at", "report_access_log", ["accessed_at"])
    op.create_index("ix_report_access_log_report_id", "report_access_log", ["report_id"])


def downgrade() -> None:
    op.drop_table("report_access_log")
