"""Module 1 - Policy Catalog & Issuance.

Creates the product catalog (products + their term options, premium
frequencies and descriptive features), the business parties (agents,
customers, each optionally linked to a login account), issued policies, and
the `id_sequences` counter table used to number policies and customers.

No data is inserted: catalog and demo records come from the development seed
script (app/scripts/seed_dev_data.py).

Revision ID: 0003_policy_catalog
Revises: 0002_roles_users
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_policy_catalog"
down_revision: str | Sequence[str] | None = "0002_roles_users"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "id_sequences",
        sa.Column("name", sa.String(length=40, collation="utf8mb4_bin"), nullable=False),
        sa.Column("current_value", sa.BigInteger(), nullable=False),
        sa.CheckConstraint(
            "current_value >= 0", name=op.f("ck_id_sequences_current_value_non_negative")
        ),
        sa.PrimaryKeyConstraint("name", name=op.f("pk_id_sequences")),
    )
    op.create_table(
        "products",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("code", sa.String(length=20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("product_type", sa.String(length=24, collation="utf8mb4_bin"), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16, collation="utf8mb4_bin"),
            server_default=sa.text("'active'"),
            nullable=False,
        ),
        sa.Column("tagline", sa.String(length=160), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("reference_coverage_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("min_coverage_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("max_coverage_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("base_annual_premium", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("default_term_years", sa.SmallInteger(), nullable=False),
        sa.Column("min_entry_age", sa.SmallInteger(), nullable=False),
        sa.Column("max_entry_age", sa.SmallInteger(), nullable=False),
        sa.Column("eligibility_summary", sa.String(length=255), nullable=False),
        sa.Column("waiting_period", sa.String(length=120), nullable=False),
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
            "code REGEXP '^PRD-[A-Z]{3}-[0-9]{3}$'", name=op.f("ck_products_code_format")
        ),
        sa.CheckConstraint(
            "product_type IN ('health', 'life', 'motor', 'personal_accident', 'home')",
            name=op.f("ck_products_product_type_allowed"),
        ),
        sa.CheckConstraint(
            "status IN ('active', 'inactive')", name=op.f("ck_products_status_allowed")
        ),
        sa.CheckConstraint(
            "base_annual_premium > 0", name=op.f("ck_products_base_premium_positive")
        ),
        sa.CheckConstraint(
            "default_term_years BETWEEN 1 AND 50", name=op.f("ck_products_default_term_range")
        ),
        sa.CheckConstraint(
            "min_coverage_amount > 0 AND min_coverage_amount <= reference_coverage_amount "
            "AND reference_coverage_amount <= max_coverage_amount",
            name=op.f("ck_products_coverage_range"),
        ),
        sa.CheckConstraint(
            "min_entry_age >= 0 AND min_entry_age <= max_entry_age AND max_entry_age <= 120",
            name=op.f("ck_products_entry_age_range"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_products")),
        sa.UniqueConstraint("code", name=op.f("uq_products_code")),
        sa.UniqueConstraint("name", name=op.f("uq_products_name")),
    )
    op.create_index(
        "ix_products_status_product_type", "products", ["status", "product_type"], unique=False
    )
    op.create_table(
        "product_features",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=24, collation="utf8mb4_bin"), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=False),
        sa.Column("content", sa.String(length=255), nullable=False),
        sa.Column("limit_text", sa.String(length=120), nullable=True),
        sa.CheckConstraint(
            "(kind = 'coverage_item') = (limit_text IS NOT NULL)",
            name=op.f("ck_product_features_limit_for_coverage_items"),
        ),
        sa.CheckConstraint(
            "kind IN ('benefit', 'coverage_item', 'exclusion', 'eligibility_criterion')",
            name=op.f("ck_product_features_kind_allowed"),
        ),
        sa.CheckConstraint("position >= 1", name=op.f("ck_product_features_position_positive")),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_product_features_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_product_features")),
        sa.UniqueConstraint(
            "product_id",
            "kind",
            "position",
            name=op.f("uq_product_features_product_id_kind_position"),
        ),
    )
    op.create_table(
        "product_premium_frequencies",
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("frequency", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.CheckConstraint(
            "frequency IN ('monthly', 'quarterly', 'half_yearly', 'annual')",
            name=op.f("ck_product_premium_frequencies_frequency_allowed"),
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_product_premium_frequencies_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "product_id", "frequency", name=op.f("pk_product_premium_frequencies")
        ),
    )
    op.create_table(
        "product_term_options",
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("term_years", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint(
            "term_years BETWEEN 1 AND 50", name=op.f("ck_product_term_options_term_range")
        ),
        sa.ForeignKeyConstraint(
            ["product_id"],
            ["products.id"],
            name=op.f("fk_product_term_options_product_id_products"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("product_id", "term_years", name=op.f("pk_product_term_options")),
    )
    op.create_table(
        "agents",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("agent_code", sa.String(length=12, collation="utf8mb4_bin"), nullable=False),
        sa.Column("full_name", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("branch", sa.String(length=100), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
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
            "agent_code REGEXP '^AGT-[0-9]{4}$'", name=op.f("ck_agents_agent_code_format")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_agents_user_id_users"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_agents")),
        sa.UniqueConstraint("agent_code", name=op.f("uq_agents_agent_code")),
        sa.UniqueConstraint("email", name=op.f("uq_agents_email")),
        sa.UniqueConstraint("user_id", name=op.f("uq_agents_user_id")),
    )
    op.create_table(
        "customers",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("customer_code", sa.String(length=12, collation="utf8mb4_bin"), nullable=False),
        sa.Column("full_name", sa.String(length=80), nullable=False),
        sa.Column("date_of_birth", sa.Date(), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("phone", sa.String(length=10), nullable=False),
        sa.Column("address_line1", sa.String(length=120), nullable=False),
        sa.Column("address_line2", sa.String(length=120), nullable=True),
        sa.Column("city", sa.String(length=80), nullable=False),
        sa.Column("state", sa.String(length=80), nullable=False),
        sa.Column("postal_code", sa.String(length=6), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=True),
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
            "customer_code REGEXP '^CUS-[0-9]{6}$'", name=op.f("ck_customers_customer_code_format")
        ),
        sa.CheckConstraint("email LIKE '%_@_%'", name=op.f("ck_customers_email_format")),
        sa.CheckConstraint(
            "phone REGEXP '^[6-9][0-9]{9}$'", name=op.f("ck_customers_phone_format")
        ),
        sa.CheckConstraint(
            "postal_code REGEXP '^[0-9]{6}$'", name=op.f("ck_customers_postal_code_format")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name=op.f("fk_customers_user_id_users"), ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_customers")),
        sa.UniqueConstraint("customer_code", name=op.f("uq_customers_customer_code")),
        sa.UniqueConstraint("user_id", name=op.f("uq_customers_user_id")),
    )
    op.create_table(
        "policies",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("policy_number", sa.String(length=20, collation="utf8mb4_bin"), nullable=False),
        sa.Column("product_id", sa.BigInteger(), nullable=False),
        sa.Column("customer_id", sa.BigInteger(), nullable=False),
        sa.Column("agent_id", sa.BigInteger(), nullable=True),
        sa.Column("issued_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(length=16, collation="utf8mb4_bin"), nullable=False),
        sa.Column("coverage_amount", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column("annual_premium", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "premium_frequency", sa.String(length=16, collation="utf8mb4_bin"), nullable=False
        ),
        sa.Column("term_years", sa.SmallInteger(), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column(
            "end_date",
            sa.Date(),
            sa.Computed(
                "((start_date + interval term_years year) - interval 1 day)", persisted=True
            ),
            nullable=False,
        ),
        sa.Column("nominee_name", sa.String(length=80), nullable=False),
        sa.Column(
            "nominee_relationship", sa.String(length=16, collation="utf8mb4_bin"), nullable=False
        ),
        sa.Column("nominee_date_of_birth", sa.Date(), nullable=False),
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
            "nominee_relationship IN "
            "('Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Brother', 'Sister', 'Other')",
            name=op.f("ck_policies_nominee_relationship_allowed"),
        ),
        sa.CheckConstraint(
            "policy_number REGEXP '^POL-[0-9]{4}-[0-9]{6}$'",
            name=op.f("ck_policies_policy_number_format"),
        ),
        sa.CheckConstraint(
            "premium_frequency IN ('monthly', 'quarterly', 'half_yearly', 'annual')",
            name=op.f("ck_policies_frequency_allowed"),
        ),
        sa.CheckConstraint(
            "status = 'pending' OR issue_date IS NOT NULL",
            name=op.f("ck_policies_issued_has_issue_date"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'active', 'expired')", name=op.f("ck_policies_status_allowed")
        ),
        sa.CheckConstraint("annual_premium > 0", name=op.f("ck_policies_premium_positive")),
        sa.CheckConstraint("coverage_amount > 0", name=op.f("ck_policies_coverage_positive")),
        sa.CheckConstraint(
            "issue_date IS NULL OR issue_date <= start_date",
            name=op.f("ck_policies_issue_before_start"),
        ),
        sa.CheckConstraint("term_years BETWEEN 1 AND 50", name=op.f("ck_policies_term_range")),
        sa.ForeignKeyConstraint(
            ["customer_id"],
            ["customers.id"],
            name=op.f("fk_policies_customer_id_customers"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_policies")),
        sa.UniqueConstraint(
            "customer_id",
            "product_id",
            "start_date",
            name=op.f("uq_policies_customer_id_product_id_start_date"),
        ),
        sa.UniqueConstraint("policy_number", name=op.f("uq_policies_policy_number")),
    )
    op.create_index(op.f("ix_policies_agent_id"), "policies", ["agent_id"], unique=False)
    op.create_index(op.f("ix_policies_end_date"), "policies", ["end_date"], unique=False)
    op.create_index(
        op.f("ix_policies_issued_by_user_id"), "policies", ["issued_by_user_id"], unique=False
    )
    op.create_index(op.f("ix_policies_product_id"), "policies", ["product_id"], unique=False)
    op.create_index(op.f("ix_policies_status"), "policies", ["status"], unique=False)
    # FKs after their indexes, so MySQL reuses ix_* instead of adding a
    # second, auto-named index per foreign key. customer_id is covered by the
    # leading column of uq_policies_customer_id_product_id_start_date.
    op.create_foreign_key(
        op.f("fk_policies_product_id_products"),
        "policies",
        "products",
        ["product_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_policies_agent_id_agents"),
        "policies",
        "agents",
        ["agent_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        op.f("fk_policies_issued_by_user_id_users"),
        "policies",
        "users",
        ["issued_by_user_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    # Dropping a table drops its indexes and constraints; children first.
    for table in (
        "policies",
        "customers",
        "agents",
        "product_term_options",
        "product_premium_frequencies",
        "product_features",
        "products",
        "id_sequences",
    ):
        op.drop_table(table)
