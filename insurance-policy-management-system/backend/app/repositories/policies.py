"""Policy, party and business-identifier queries. Never commits."""

from typing import Literal

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.orm import Session

from app.models import Agent, Customer, IdSequence, Policy, PolicyStatus, Product

PolicySort = Literal["newest", "oldest"]


def get_policy_by_number(db: Session, policy_number: str) -> Policy | None:
    return db.scalars(select(Policy).where(Policy.policy_number == policy_number)).one_or_none()


def list_policies(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    search: str | None,
    status: PolicyStatus | None,
    product_code: str | None,
    agent_code: str | None,
    sort: PolicySort,
    limit: int,
    offset: int,
) -> tuple[list[Policy], int]:
    """Filter in MySQL. `agent_id` / `customer_id` are the caller's
    authorisation scope, already resolved by the service."""
    stmt = select(Policy).join(Policy.customer).join(Policy.product)
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    if search:
        term = search.strip()
        stmt = stmt.where(
            or_(
                # Codes are canonical upper case in binary-collated columns.
                Policy.policy_number.contains(term.upper(), autoescape=True),
                Customer.full_name.contains(term, autoescape=True),
                Customer.customer_code.contains(term.upper(), autoescape=True),
            )
        )
    if status:
        stmt = stmt.where(Policy.status == status)
    if product_code:
        stmt = stmt.where(Product.code == product_code)
    if agent_code:
        stmt = stmt.join(Policy.agent).where(Agent.agent_code == agent_code)

    total = db.scalar(
        select(func.count()).select_from(stmt.with_only_columns(Policy.id).subquery())
    )
    order = Policy.id.desc() if sort == "newest" else Policy.id.asc()
    items = db.scalars(stmt.order_by(order).limit(limit).offset(offset)).unique().all()
    return list(items), total or 0


def get_agent_by_user_id(db: Session, user_id: int) -> Agent | None:
    return db.scalars(select(Agent).where(Agent.user_id == user_id)).one_or_none()


def get_agent_by_code(db: Session, agent_code: str) -> Agent | None:
    return db.scalars(select(Agent).where(Agent.agent_code == agent_code)).one_or_none()


def get_customer_by_user_id(db: Session, user_id: int) -> Customer | None:
    return db.scalars(select(Customer).where(Customer.user_id == user_id)).one_or_none()


def get_customer_by_code(db: Session, customer_code: str) -> Customer | None:
    return db.scalars(select(Customer).where(Customer.customer_code == customer_code)).one_or_none()


# --- business identifiers ----------------------------------------------------
#
# MySQL has no SEQUENCE object, so each identifier family has a counter row in
# `id_sequences`. `_next_value`:
#   1. makes sure the counter row exists (`_ensure_counter`);
#   2. increments it with UPDATE inside the caller's transaction, which locks
#      that one existing row until COMMIT/ROLLBACK, serialising issuers;
#   3. reads the new value back under that lock.
# Only the counter row is ever locked. Two things would deadlock concurrent
# issuers under REPEATABLE READ: deriving the seed with INSERT ... SELECT
# (shared next-key locks on the scanned policies/claims/... index, into whose
# gaps each issuer then inserts), and an UPDATE or INSERT of a missing counter
# row inside the business transaction (gap locks on id_sequences).
# A rolled-back issuance rolls its increment back, so numbers stay gap-free.
# The UNIQUE constraints on the business numbers remain the final guarantee.


def _ensure_counter(db: Session, name: str, seed_max_sql: str, params: dict) -> None:
    """Create the counter row on first use of a family/year, starting from the
    highest number already in use (so seeded or imported records are never
    re-issued). It runs in its own short transaction on a separate connection:
    creating the row issues no number, so it need not roll back with the
    caller, and the caller's transaction takes no gap locks. Losing the race to
    create it is harmless (the duplicate is a no-op)."""
    # Plain read: sees the caller's snapshot and locks nothing.
    if db.scalar(select(IdSequence.name).where(IdSequence.name == name)) is not None:
        return
    with db.get_bind().connect() as connection:
        # `seed_max_sql` is one of the constant subqueries below, never user
        # input; every value (including the prefix) is a bound parameter.
        seed = connection.scalar(text(f"SELECT COALESCE(({seed_max_sql}), 0)"), params)
        connection.execute(
            text(
                "INSERT INTO id_sequences (name, current_value) VALUES (:name, :seed) "
                "ON DUPLICATE KEY UPDATE current_value = id_sequences.current_value"
            ),
            {"name": name, "seed": seed},
        )
        connection.commit()


def _next_value(db: Session, name: str, seed_max_sql: str, params: dict) -> int:
    _ensure_counter(db, name, seed_max_sql, params)
    db.execute(
        update(IdSequence)
        .where(IdSequence.name == name)
        .values(current_value=IdSequence.current_value + 1)
    )
    return db.scalar(select(IdSequence.current_value).where(IdSequence.name == name))


def next_policy_number(db: Session, year: int) -> str:
    prefix = f"POL-{year:04d}-"
    value = _next_value(
        db,
        f"policy:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(policy_number, 10) AS UNSIGNED)) "
        "FROM policies WHERE policy_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


def next_customer_code(db: Session) -> str:
    value = _next_value(
        db,
        "customer",
        "SELECT MAX(CAST(SUBSTRING(customer_code, 5) AS UNSIGNED)) FROM customers",
        {},
    )
    return f"CUS-{value:06d}"


def next_payment_number(db: Session, year: int) -> str:
    prefix = f"PAY-{year:04d}-"
    value = _next_value(
        db,
        f"payment:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(payment_number, 10) AS UNSIGNED)) "
        "FROM payments WHERE payment_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


def next_claim_number(db: Session, year: int) -> str:
    prefix = f"CLM-{year:04d}-"
    value = _next_value(
        db,
        f"claim:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(claim_number, 10) AS UNSIGNED)) "
        "FROM claims WHERE claim_number LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"


def next_settlement_reference(db: Session, year: int) -> str:
    prefix = f"SET-{year:04d}-"
    value = _next_value(
        db,
        f"settlement:{year:04d}",
        "SELECT MAX(CAST(SUBSTRING(settlement_reference, 10) AS UNSIGNED)) "
        "FROM claim_settlements WHERE settlement_reference LIKE :prefix",
        {"prefix": f"{prefix}%"},
    )
    return f"{prefix}{value:06d}"
