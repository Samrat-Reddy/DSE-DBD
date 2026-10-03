"""SQLAlchemy models for Module 4 — Renewal Reminder Engine."""

from datetime import date, datetime

from sqlalchemy import BigInteger, Computed, Date, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import BINARY_COLLATION, Base, code_string


class SimulationClock(Base):
    """Singleton row (id=1) holding the administrator's 'as-of' date override.

    When as_of_date IS NULL, the engine uses the real calendar date.
    """

    __tablename__ = "simulation_clock"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    as_of_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    set_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    set_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    note: Mapped[str | None] = mapped_column(String(300, collation=BINARY_COLLATION), nullable=True)


class ReminderCheckRun(Base):
    """Append-only log of each bulk reminder-check run."""

    __tablename__ = "reminder_check_runs"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_number: Mapped[str] = mapped_column(code_string(20), nullable=False, unique=True)
    evaluated_as_of: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    run_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    run_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    run_by_name: Mapped[str] = mapped_column(
        String(200, collation=BINARY_COLLATION), nullable=False
    )
    run_by_role: Mapped[str] = mapped_column(String(50, collation=BINARY_COLLATION), nullable=False)
    policies_evaluated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reminders_generated: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reminders_skipped: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    already_handled: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    needs_retry: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    not_yet_due: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    not_eligible: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    reminders: Mapped[list["Reminder"]] = relationship(
        "Reminder", back_populates="check_run", foreign_keys="Reminder.check_run_id"
    )


class Reminder(Base):
    """One reminder attempt for a policy stage.

    The business key is reminder_number (RMD-YYYY-NNNNNN). The
    check_idempotency_key generated column in MySQL prevents duplicate
    auto-check reminders for the same (policy_id, stage, evaluated_as_of).
    """

    __tablename__ = "reminders"
    __table_args__ = (
        Index("uq_reminders_check_idempotency", "check_idempotency_key", unique=True),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    reminder_number: Mapped[str] = mapped_column(code_string(20), nullable=False, unique=True)
    policy_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("policies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    stage: Mapped[str] = mapped_column(code_string(10), nullable=False)
    scheduled_for: Mapped[date] = mapped_column(Date, nullable=False)
    channel: Mapped[str] = mapped_column(code_string(20), nullable=False)
    status: Mapped[str] = mapped_column(code_string(20), nullable=False)
    reminder_trigger: Mapped[str] = mapped_column(code_string(30), nullable=False)
    evaluated_as_of: Mapped[date] = mapped_column(Date, nullable=False)
    attempted_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    check_run_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("reminder_check_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    retry_of_id: Mapped[int | None] = mapped_column(
        BigInteger,
        ForeignKey("reminders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        BigInteger, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_by_name: Mapped[str] = mapped_column(
        String(200, collation=BINARY_COLLATION), nullable=False
    )
    created_by_role: Mapped[str] = mapped_column(
        String(50, collation=BINARY_COLLATION), nullable=False
    )
    note: Mapped[str | None] = mapped_column(String(500, collation=BINARY_COLLATION), nullable=True)
    result: Mapped[str | None] = mapped_column(
        String(500, collation=BINARY_COLLATION), nullable=True
    )
    superseded_by: Mapped[str | None] = mapped_column(code_string(10), nullable=True)
    check_idempotency_key: Mapped[str | None] = mapped_column(
        String(60),
        Computed(
            "IF(reminder_trigger = 'reminder-check', "
            "CONCAT(CAST(policy_id AS CHAR), '-', stage, '-', evaluated_as_of), "
            "NULL)"
        ),
        nullable=True,
    )

    # Relationships
    check_run: Mapped[ReminderCheckRun | None] = relationship(
        "ReminderCheckRun", back_populates="reminders", foreign_keys=[check_run_id]
    )
    retry_of: Mapped["Reminder | None"] = relationship(
        "Reminder", remote_side="Reminder.id", foreign_keys=[retry_of_id]
    )
