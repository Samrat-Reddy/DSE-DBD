"""Claim queries. Never commits; filtering, sorting and counting run in MySQL.

`agent_id` / `customer_id` are the caller's authorisation scope, resolved by
the service (None = no restriction for that dimension). `lock_claim` is a
locking read (SELECT ... FOR UPDATE): it always sees the latest committed row
and holds it until COMMIT/ROLLBACK, so workflow transitions on one claim are
serialised.
"""

from typing import Literal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Claim,
    ClaimEvent,
    ClaimStatus,
    ClaimType,
    Customer,
    Policy,
    ProductFeature,
    ProductFeatureKind,
)

ClaimSort = Literal["updated-desc", "filed-desc", "incident-desc", "claimed-desc", "claim-asc"]


def _scoped(stmt: Select, agent_id: int | None, customer_id: int | None) -> Select:
    if agent_id is not None:
        stmt = stmt.where(Policy.agent_id == agent_id)
    if customer_id is not None:
        stmt = stmt.where(Policy.customer_id == customer_id)
    return stmt


def get_claim_by_number(db: Session, claim_number: str) -> Claim | None:
    return db.scalars(select(Claim).where(Claim.claim_number == claim_number)).one_or_none()


def lock_claim(db: Session, claim_number: str) -> Claim | None:
    """SELECT ... FOR UPDATE OF claims: the current row, held until commit."""
    return db.scalars(
        select(Claim)
        .where(Claim.claim_number == claim_number)
        .with_for_update(of=Claim)
        .execution_options(populate_existing=True)
    ).one_or_none()


def next_event_sequence(db: Session, claim_id: int) -> int:
    """Next history sequence number, by a locking read of the claim's history.
    Call only while holding the claim lock; UNIQUE (claim_id, sequence_no) is
    the final guarantee."""
    rows = db.scalars(
        select(ClaimEvent.sequence_no).where(ClaimEvent.claim_id == claim_id).with_for_update()
    ).all()
    return max(rows, default=0) + 1


def list_claims(
    db: Session,
    *,
    agent_id: int | None,
    customer_id: int | None,
    search: str | None,
    status: ClaimStatus | None,
    claim_type: str | None,
    policy_number: str | None,
    sort: ClaimSort,
    limit: int,
    offset: int,
) -> tuple[list[Claim], int]:
    stmt = _scoped(
        select(Claim)
        .join(Policy, Policy.id == Claim.policy_id)
        .join(Customer, Customer.id == Policy.customer_id)
        .join(ClaimType, ClaimType.id == Claim.claim_type_id),
        agent_id,
        customer_id,
    )
    if search:
        term = search.strip()
        stmt = stmt.where(
            or_(
                Claim.claim_number.contains(term.upper(), autoescape=True),
                Policy.policy_number.contains(term.upper(), autoescape=True),
                Customer.full_name.contains(term, autoescape=True),
                ClaimType.label.contains(term, autoescape=True),
                ClaimType.code.contains(term.lower(), autoescape=True),
            )
        )
    if status:
        stmt = stmt.where(Claim.status == status)
    if claim_type:
        stmt = stmt.where(ClaimType.code == claim_type)
    if policy_number:
        stmt = stmt.where(Policy.policy_number == policy_number)

    total = db.scalar(select(func.count()).select_from(stmt.with_only_columns(Claim.id).subquery()))
    order = {
        "updated-desc": (Claim.updated_at.desc(), Claim.id.desc()),
        "filed-desc": (Claim.filing_date.desc(), Claim.claim_number.desc()),
        "incident-desc": (Claim.incident_date.desc(), Claim.claim_number.desc()),
        "claimed-desc": (Claim.claimed_amount.desc(), Claim.claim_number.asc()),
        "claim-asc": (Claim.claim_number.asc(),),
    }[sort]
    items = db.scalars(stmt.order_by(*order).limit(limit).offset(offset)).unique().all()
    return list(items), total or 0


def status_counts(db: Session, *, agent_id: int | None, customer_id: int | None) -> dict[str, int]:
    """Claims per status over the caller's whole scope (unaffected by filters)."""
    stmt = _scoped(
        select(Claim.status, func.count())
        .join(Policy, Policy.id == Claim.policy_id)
        .group_by(Claim.status),
        agent_id,
        customer_id,
    )
    return {status: count for status, count in db.execute(stmt).all()}


def list_claim_types(db: Session) -> list[ClaimType]:
    return list(db.scalars(select(ClaimType).order_by(ClaimType.id)))


def get_claim_type_by_code(db: Session, code: str) -> ClaimType | None:
    return db.scalars(select(ClaimType).where(ClaimType.code == code)).one_or_none()


def coverage_item_limit(db: Session, product_id: int, name: str) -> str | None:
    """The product's own limit text for a coverage item (e.g. "Up to sum insured")."""
    return db.scalar(
        select(ProductFeature.limit_text).where(
            ProductFeature.product_id == product_id,
            ProductFeature.kind == ProductFeatureKind.COVERAGE_ITEM,
            ProductFeature.content == name,
        )
    )


def coverage_item_names(db: Session, product_id: int) -> frozenset[str]:
    return frozenset(
        db.scalars(
            select(ProductFeature.content).where(
                ProductFeature.product_id == product_id,
                ProductFeature.kind == ProductFeatureKind.COVERAGE_ITEM,
            )
        )
    )
