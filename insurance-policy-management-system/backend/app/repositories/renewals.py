"""Renewal reminder repository — all SQL, never commits."""

from datetime import date, datetime

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models import Policy, PolicyStatus
from app.models.renewal import Reminder, ReminderCheckRun, SimulationClock
from app.repositories.policies import _next_value

# ---------------------------------------------------------------------------
# Business identifiers
# ---------------------------------------------------------------------------


def next_reminder_number(db: Session, year: int) -> str:
    prefix = f"RMD-{year:04d}-"
    value = _next_value(
        db,
        f"reminder:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(reminder_number, 10) AS UNSIGNED)) "
        "FROM reminders WHERE reminder_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


def next_check_run_number(db: Session, year: int) -> str:
    prefix = f"CHK-{year:04d}-"
    value = _next_value(
        db,
        f"reminder_check:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(run_number, 10) AS UNSIGNED)) "
        "FROM reminder_check_runs WHERE run_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


# ---------------------------------------------------------------------------
# Simulation clock
# ---------------------------------------------------------------------------


def get_simulation_clock(db: Session) -> SimulationClock:
    row = db.get(SimulationClock, 1)
    if row is None:
        # Safety: should exist from migration seed.
        row = SimulationClock(id=1, as_of_date=None)
        db.add(row)
        db.flush()
    return row


def resolve_as_of(db: Session) -> date:
    """Return the as-of date: simulation date if set and ≥ today, else today."""
    today = date.today()
    clock = get_simulation_clock(db)
    if clock.as_of_date and clock.as_of_date >= today:
        return clock.as_of_date
    return today


def set_simulation_date(
    db: Session,
    *,
    as_of_date: date | None,
    user_id: int | None,
    note: str | None,
) -> SimulationClock:
    """Lock the singleton, update it, return the new row (does not commit)."""
    db.execute(text("SELECT id FROM simulation_clock WHERE id = 1 FOR UPDATE"))
    clock = db.get(SimulationClock, 1)
    clock.as_of_date = as_of_date
    clock.set_by_user_id = user_id
    clock.set_at = datetime.utcnow()
    clock.note = note
    db.flush()
    return clock


# ---------------------------------------------------------------------------
# Policy queries for the renewal engine
# ---------------------------------------------------------------------------


def list_policies_for_renewal(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    limit: int = 500,
) -> list[Policy]:
    """All issued policies in scope, for the reminder engine."""
    stmt = (
        select(Policy)
        .where(Policy.status != PolicyStatus.PENDING)
        .where(Policy.issue_date.is_not(None))
    )
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    return list(db.scalars(stmt.limit(limit)).unique().all())


def get_policy_for_renewal(db: Session, policy_number: str) -> Policy | None:
    return db.scalars(
        select(Policy)
        .where(Policy.policy_number == policy_number)
        .where(Policy.issue_date.is_not(None))
    ).one_or_none()


# ---------------------------------------------------------------------------
# Reminder queries
# ---------------------------------------------------------------------------


def get_reminder_by_number(db: Session, reminder_number: str) -> Reminder | None:
    return db.scalars(
        select(Reminder).where(Reminder.reminder_number == reminder_number)
    ).one_or_none()


def get_reminders_by_policy_id(db: Session, policy_id: int) -> list[Reminder]:
    return list(
        db.scalars(
            select(Reminder)
            .where(Reminder.policy_id == policy_id)
            .order_by(Reminder.attempted_at, Reminder.id)
        ).all()
    )


def get_all_reminders_in_scope(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    limit: int = 1000,
) -> list[Reminder]:
    stmt = select(Reminder).join(Policy, Reminder.policy_id == Policy.id)
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    return list(db.scalars(stmt.order_by(Reminder.attempted_at.desc()).limit(limit)).all())


def reminders_by_policy_id_bulk(db: Session, policy_ids: list[int]) -> dict[int, list[Reminder]]:
    """Fetch all reminders for a set of policies in one query."""
    if not policy_ids:
        return {}
    rows = db.scalars(select(Reminder).where(Reminder.policy_id.in_(policy_ids))).all()
    result: dict[int, list[Reminder]] = {pid: [] for pid in policy_ids}
    for row in rows:
        result[row.policy_id].append(row)
    return result


def lock_reminder(db: Session, reminder_number: str) -> Reminder | None:
    """SELECT ... FOR UPDATE on the reminder row."""
    return db.scalars(
        select(Reminder).where(Reminder.reminder_number == reminder_number).with_for_update()
    ).one_or_none()


def list_reminders(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    policy_number: str | None,
    limit: int = 200,
    offset: int = 0,
) -> tuple[list[Reminder], int]:
    stmt = select(Reminder).join(Policy, Reminder.policy_id == Policy.id)
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    if policy_number:
        stmt = stmt.where(Policy.policy_number == policy_number)

    total = db.scalar(
        select(func.count()).select_from(stmt.with_only_columns(Reminder.id).subquery())
    )
    items = list(
        db.scalars(stmt.order_by(Reminder.attempted_at.desc()).limit(limit).offset(offset)).all()
    )
    return items, total or 0


# ---------------------------------------------------------------------------
# Check run queries
# ---------------------------------------------------------------------------


def create_check_run(db: Session, run: ReminderCheckRun) -> ReminderCheckRun:
    db.add(run)
    db.flush()
    return run


def get_check_run_by_number(db: Session, run_number: str) -> ReminderCheckRun | None:
    return db.scalars(
        select(ReminderCheckRun).where(ReminderCheckRun.run_number == run_number)
    ).one_or_none()


def list_check_runs(db: Session, *, limit: int = 50) -> list[ReminderCheckRun]:
    return list(
        db.scalars(
            select(ReminderCheckRun).order_by(ReminderCheckRun.run_at.desc()).limit(limit)
        ).all()
    )
