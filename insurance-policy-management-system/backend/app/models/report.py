"""SQLAlchemy model for Module 6 — MIS Reports access log."""

from datetime import date, datetime

from sqlalchemy import BigInteger, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import BINARY_COLLATION, Base


class ReportAccessLog(Base):
    """Append-only log of every MIS report query."""

    __tablename__ = "report_access_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    accessed_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    accessed_by_name: Mapped[str] = mapped_column(
        String(200, collation=BINARY_COLLATION), nullable=False
    )
    accessed_by_role: Mapped[str] = mapped_column(
        String(50, collation=BINARY_COLLATION), nullable=False
    )
    report_id: Mapped[str] = mapped_column(
        String(30, collation=BINARY_COLLATION), nullable=False, index=True
    )
    period: Mapped[str | None] = mapped_column(
        String(20, collation=BINARY_COLLATION), nullable=True
    )
    period_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    period_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    row_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    accessed_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
