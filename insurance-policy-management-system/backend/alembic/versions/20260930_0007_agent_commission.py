"""Module 5 - Agent Commission.

Creates:
  commission_rules    product/agent commission rates with effective periods
  commissions         one record per successful premium payment that earns commission
  commission_events   append-only status history (PENDING → EARNED → PAID)

Business rules:
  - PENDING  generated automatically when a premium payment becomes SUCCESSFUL
  - EARNED   administrator confirms after earningHoldDays (30) have passed
  - PAID     administrator records simulated payout with a payout_reference

  Status is derived from events (like the frontend). The stored `status`
  column is kept in sync by the service as a query optimisation; the events
  remain the source of truth.

Revision ID: 0007_agent_commission
Revises:     0006_renewal_reminders
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_agent_commission"
down_revision: str = "0006_renewal_reminders"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    # --- commission_rules -----------------------------------------------
    op.create_table(
        "commission_rules",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("rule_code", sa.String(30, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "product_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "products.id", name="fk_commission_rules_product_id_products", ondelete="RESTRICT"
            ),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "agents.id", name="fk_commission_rules_agent_id_agents", ondelete="RESTRICT"
            ),
            nullable=True,
        ),
        sa.Column("first_year_rate_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("renewal_rate_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("description", sa.String(300, collation="utf8mb4_bin"), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_commission_rules"),
        sa.UniqueConstraint("rule_code", name="uq_commission_rules_rule_code"),
        sa.CheckConstraint(
            "first_year_rate_percent >= 0 AND first_year_rate_percent <= 100",
            name="ck_commission_rules_first_year_rate",
        ),
        sa.CheckConstraint(
            "renewal_rate_percent >= 0 AND renewal_rate_percent <= 100",
            name="ck_commission_rules_renewal_rate",
        ),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_commission_rules_period",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_commission_rules_product_id", "commission_rules", ["product_id"])
    op.create_index("ix_commission_rules_agent_id", "commission_rules", ["agent_id"])

    # --- commissions -------------------------------------------------------
    op.create_table(
        "commissions",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("commission_number", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "payment_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "payments.id", name="fk_commissions_payment_id_payments", ondelete="RESTRICT"
            ),
            nullable=False,
        ),
        sa.Column(
            "policy_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "policies.id", name="fk_commissions_policy_id_policies", ondelete="RESTRICT"
            ),
            nullable=False,
        ),
        sa.Column(
            "agent_id",
            sa.BigInteger(),
            sa.ForeignKey("agents.id", name="fk_commissions_agent_id_agents", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "rule_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "commission_rules.id",
                name="fk_commissions_rule_id_commission_rules",
                ondelete="RESTRICT",
            ),
            nullable=True,
        ),
        sa.Column(
            "installment_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "installments.id",
                name="fk_commissions_installment_id_installments",
                ondelete="RESTRICT",
            ),
            nullable=False,
        ),
        sa.Column("policy_year", sa.Integer(), nullable=False),
        sa.Column("basis", sa.String(15, collation="utf8mb4_bin"), nullable=False),
        sa.Column("rate_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("commissionable_amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("status", sa.String(15, collation="utf8mb4_bin"), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("generated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_commissions"),
        sa.UniqueConstraint("commission_number", name="uq_commissions_commission_number"),
        sa.UniqueConstraint("payment_id", name="uq_commissions_payment_id"),  # one per payment
        sa.CheckConstraint("amount > 0", name="ck_commissions_positive_amount"),
        sa.CheckConstraint(
            "commissionable_amount > 0", name="ck_commissions_positive_commissionable"
        ),
        sa.CheckConstraint("rate_percent > 0 AND rate_percent <= 100", name="ck_commissions_rate"),
        sa.CheckConstraint("policy_year >= 1", name="ck_commissions_policy_year"),
        sa.CheckConstraint(
            "status IN ('pending', 'earned', 'paid')",
            name="ck_commissions_status",
        ),
        sa.CheckConstraint(
            "basis IN ('first-year', 'renewal')",
            name="ck_commissions_basis",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_commissions_policy_id", "commissions", ["policy_id"])
    op.create_index("ix_commissions_agent_id", "commissions", ["agent_id"])
    op.create_index("ix_commissions_generated_at", "commissions", ["generated_at"])

    # --- commission_events --------------------------------------------------
    op.create_table(
        "commission_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "commission_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "commissions.id",
                name="fk_commission_events_commission_id_commissions",
                ondelete="CASCADE",
            ),
            nullable=False,
        ),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("from_status", sa.String(15, collation="utf8mb4_bin"), nullable=True),
        sa.Column("to_status", sa.String(15, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "actor_user_id",
            sa.BigInteger(),
            sa.ForeignKey(
                "users.id", name="fk_commission_events_actor_user_id_users", ondelete="SET NULL"
            ),
            nullable=True,
        ),
        sa.Column("actor_name", sa.String(200, collation="utf8mb4_bin"), nullable=False),
        sa.Column("actor_role", sa.String(50, collation="utf8mb4_bin"), nullable=False),
        sa.Column("payout_reference", sa.String(40, collation="utf8mb4_bin"), nullable=True),
        sa.Column("note", sa.String(500, collation="utf8mb4_bin"), nullable=True),
        sa.Column("occurred_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_commission_events"),
        sa.UniqueConstraint(
            "commission_id", "sequence_no", name="uq_commission_events_commission_id_sequence_no"
        ),
        sa.CheckConstraint(
            "event_type IN ('generated', 'status_changed')",
            name="ck_commission_events_event_type",
        ),
        sa.CheckConstraint(
            "to_status IN ('pending', 'earned', 'paid')",
            name="ck_commission_events_to_status",
        ),
        sa.CheckConstraint(
            "payout_reference IS NULL OR to_status = 'paid'",
            name="ck_commission_events_payout_ref_only_paid",
        ),
        mysql_engine="InnoDB",
        mysql_charset="utf8mb4",
    )
    op.create_index("ix_commission_events_commission_id", "commission_events", ["commission_id"])
    op.create_index("ix_commission_events_actor_user_id", "commission_events", ["actor_user_id"])


def downgrade() -> None:
    op.drop_table("commission_events")
    op.drop_table("commissions")
    op.drop_table("commission_rules")
