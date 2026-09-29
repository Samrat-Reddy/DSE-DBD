"""Business parties: agents and customers (policyholders).

Both are business records, separate from login accounts. Each may be linked
to at most one `users` row (nullable, unique FK): an agent or customer can
exist without ever signing in, and a login account's role says which kind of
record it may be linked to (enforced by the service/seed layer, since a CHECK
cannot look at another table).
"""

from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPK, TimestampMixin, code_string


class Agent(TimestampMixin, Base):
    __tablename__ = "agents"
    __table_args__ = (
        CheckConstraint("agent_code REGEXP '^AGT-[0-9]{4}$'", name="agent_code_format"),
    )

    id: Mapped[IntPK]
    agent_code: Mapped[str] = mapped_column(code_string(12), unique=True)
    full_name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    branch: Mapped[str] = mapped_column(String(100))
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )


class Customer(TimestampMixin, Base):
    """A policyholder. Email and phone are contact details, not identity:
    family members may share them, so they are deliberately not unique."""

    __tablename__ = "customers"
    __table_args__ = (
        CheckConstraint("customer_code REGEXP '^CUS-[0-9]{6}$'", name="customer_code_format"),
        CheckConstraint("phone REGEXP '^[6-9][0-9]{9}$'", name="phone_format"),
        CheckConstraint("postal_code REGEXP '^[0-9]{6}$'", name="postal_code_format"),
        CheckConstraint("email LIKE '%_@_%'", name="email_format"),
    )

    id: Mapped[IntPK]
    customer_code: Mapped[str] = mapped_column(code_string(12), unique=True)
    full_name: Mapped[str] = mapped_column(String(80))
    date_of_birth: Mapped[date] = mapped_column(Date)
    email: Mapped[str] = mapped_column(String(254))
    # Stored normalised: 10 digits, no country code or separators.
    phone: Mapped[str] = mapped_column(String(10))
    address_line1: Mapped[str] = mapped_column(String(120))
    address_line2: Mapped[str | None] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(80))
    postal_code: Mapped[str] = mapped_column(String(6))
    user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="RESTRICT"), unique=True
    )
