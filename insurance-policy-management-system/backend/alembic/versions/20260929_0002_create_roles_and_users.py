"""Create roles and users; seed the three application roles.

The roles are reference data the application cannot run without, so they are
inserted here rather than by the development seed script. Their names match
`ROLES` in frontend/src/utils/constants.js.

Revision ID: 0002_roles_users
Revises: 0001_baseline
Create Date: 2026-09-29

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_roles_users"
down_revision: str | Sequence[str] | None = "0001_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ROLES = [
    {
        "name": "administrator",
        "description": (
            "Internal staff: issues policies, adjudicates claims (titled 'Claims Officer' "
            "on claim screens), manages renewals and commissions, views MIS reports."
        ),
    },
    {
        "name": "agent",
        "description": (
            "Sells and services policies, files claims on a policyholder's behalf "
            "and sees only their own commission."
        ),
    },
    {
        "name": "policyholder",
        "description": "Customer who holds policies, pays premiums and files their own claims.",
    },
]


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column(
            "created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
        ),
    ]


def upgrade() -> None:
    roles = op.create_table(
        "roles",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(32), nullable=False),
        sa.Column("description", sa.String(255), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_roles")),
        sa.UniqueConstraint("name", name=op.f("uq_roles_name")),
        sa.CheckConstraint("name REGEXP '^[a-z][a-z_]*$'", name=op.f("ck_roles_name_format")),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("role_id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("last_name", sa.String(100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("1")),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
        sa.CheckConstraint("is_active IN (0, 1)", name=op.f("ck_users_is_active_boolean")),
        sa.CheckConstraint("email LIKE '%_@_%'", name=op.f("ck_users_email_format")),
    )
    # Index first, then the FK: MySQL reuses an existing index for a foreign key
    # instead of creating a second, auto-named one.
    op.create_index(op.f("ix_users_role_id"), "users", ["role_id"])
    op.create_foreign_key(
        op.f("fk_users_role_id_roles"), "users", "roles", ["role_id"], ["id"], ondelete="RESTRICT"
    )

    op.bulk_insert(roles, ROLES)


def downgrade() -> None:
    op.drop_table("users")
    op.drop_table("roles")
