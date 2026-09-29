"""Declarative base and the schema conventions every model follows.

Conventions
-----------
- Table names: plural snake_case (`policies`, `premium_payments`).
- Primary keys: `id BIGINT AUTO_INCREMENT` via the `IntPK` annotation.
- Foreign keys: `<referenced_singular>_id`, same type as the referenced PK,
  with an explicit `ondelete` choice (RESTRICT unless there is a reason).
- Money: `DECIMAL(14, 2)` via `Money`, never FLOAT/DOUBLE.
- Timestamps: `TimestampMixin` (UTC, maintained by MySQL itself).
- Constraint/index names come from NAMING_CONVENTION so Alembic can
  create, compare and drop them deterministically. MySQL limits identifiers
  to 64 characters; pass an explicit `name=` if a generated one would exceed it.
- Enumerated states use `String` + a CHECK constraint (MySQL 8.0.16+ enforces
  CHECK), so adding a state is a normal migration rather than an ALTER ENUM.
- Codes and controlled values (business identifiers, statuses, types) use
  `code_string()`: binary collation, so `IN (...)` and `REGEXP` CHECKs are
  exact. Under the default case-insensitive collation 'ACTIVE' would pass
  `status IN ('active')` and 'prd-hlt-001' would pass a `^PRD-...` REGEXP.
"""

from datetime import datetime
from decimal import Decimal
from typing import Annotated

from sqlalchemy import BigInteger, DateTime, MetaData, Numeric, String, func, text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
}

IntPK = Annotated[int, mapped_column(BigInteger, primary_key=True, autoincrement=True)]
Money = Annotated[Decimal, mapped_column(Numeric(14, 2))]

BINARY_COLLATION = "utf8mb4_bin"


def code_string(length: int) -> String:
    """VARCHAR compared exactly (case-sensitive) for codes and controlled values."""
    return String(length, collation=BINARY_COLLATION)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """`created_at` / `updated_at`, set by MySQL so every writer agrees on them."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.current_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"),
    )
