from enum import StrEnum

from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, IntPK, TimestampMixin


class RoleName(StrEnum):
    """Stable role identifiers, matching `ROLES` in frontend/src/utils/constants.js.

    The claims screens title the administrator "Claims Officer"
    (`DEMO_ROLE_TITLES`); that is a display label, not a separate role.
    """

    ADMINISTRATOR = "administrator"
    AGENT = "agent"
    POLICYHOLDER = "policyholder"


class Role(TimestampMixin, Base):
    """Reference data: rows are created by migrations, not by the API."""

    __tablename__ = "roles"
    __table_args__ = (CheckConstraint("name REGEXP '^[a-z][a-z_]*$'", name="name_format"),)

    id: Mapped[IntPK]
    name: Mapped[str] = mapped_column(String(32), unique=True)
    description: Mapped[str] = mapped_column(String(255))
