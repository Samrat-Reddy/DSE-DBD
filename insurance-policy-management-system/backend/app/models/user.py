from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPK, TimestampMixin
from app.models.role import Role


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("is_active IN (0, 1)", name="is_active_boolean"),
        CheckConstraint("email LIKE '%_@_%'", name="email_format"),
    )

    id: Mapped[IntPK]
    role_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("roles.id", ondelete="RESTRICT"), index=True
    )
    # Stored lower-cased by the service; the column's case-insensitive utf8mb4
    # collation makes the unique constraint case-insensitive as well.
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("1"))

    # Every authenticated request needs the role, so load it in the same query.
    role: Mapped[Role] = relationship(lazy="joined")

    def __repr__(self) -> str:  # never include the password hash
        return f"User(id={self.id!r}, email={self.email!r}, role_id={self.role_id!r})"
