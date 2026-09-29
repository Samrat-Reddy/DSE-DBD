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
# `id_sequences`. `_next_value` runs inside the caller's transaction:
#   1. create the row if missing, starting from the highest number already in
#      use (so seeded or imported records are never re-issued);
#   2. increment it with UPDATE, which takes an exclusive row lock held until
#      COMMIT/ROLLBACK, serialising concurrent issuers;
#   3. read the new value back under that lock.
# A rolled-back issuance rolls the counter back too. The UNIQUE constraints on
# policy_number / customer_code remain the final guarantee.


def _next_value(db: Session, name: str, seed_max_sql: str, params: dict) -> int:
    # `seed_max_sql` is one of the constant subqueries below, never user input;
    # every value (including the prefix) is a bound parameter.
    db.execute(
        text(
            "INSERT INTO id_sequences (name, current_value) "
            f"SELECT :name, COALESCE(({seed_max_sql}), 0) "
            "ON DUPLICATE KEY UPDATE current_value = id_sequences.current_value"
        ),
        {"name": name, **params},
    )
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
