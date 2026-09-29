"""Product catalog queries. Filtering, sorting and counting happen in MySQL."""

from typing import Literal

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.models import Product, ProductStatus, ProductType

ProductSort = Literal[
    "name-asc", "name-desc", "premium-asc", "premium-desc", "coverage-desc", "type-asc"
]

# Every ordering ends with the unique code, so pages are deterministic.
_PRODUCT_ORDER = {
    "name-asc": (Product.name.asc(),),
    "name-desc": (Product.name.desc(),),
    "premium-asc": (Product.base_annual_premium.asc(),),
    "premium-desc": (Product.base_annual_premium.desc(),),
    "coverage-desc": (Product.reference_coverage_amount.desc(),),
    "type-asc": (Product.product_type.asc(), Product.name.asc()),
}


def _filtered(
    search: str | None, product_type: ProductType | None, status: ProductStatus | None
) -> Select:
    stmt = select(Product)
    if search:
        term = search.strip()
        # The type is stored as a code, so match the search against its label.
        matching_types = [t.value for t in ProductType if term.lower() in t.label.lower()]
        stmt = stmt.where(
            or_(
                # Codes are canonical upper case in a binary-collated column.
                Product.code.contains(term.upper(), autoescape=True),
                Product.name.contains(term, autoescape=True),
                Product.product_type.in_(matching_types),
            )
        )
    if product_type:
        stmt = stmt.where(Product.product_type == product_type)
    if status:
        stmt = stmt.where(Product.status == status)
    return stmt


def list_products(
    db: Session,
    *,
    search: str | None,
    product_type: ProductType | None,
    status: ProductStatus | None,
    sort: ProductSort,
    limit: int,
    offset: int,
) -> tuple[list[Product], int]:
    stmt = _filtered(search, product_type, status)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(
        stmt.order_by(*_PRODUCT_ORDER[sort], Product.code.asc()).limit(limit).offset(offset)
    ).all()
    return list(items), total or 0


def count_products_by_status(db: Session) -> dict[str, int]:
    rows = db.execute(select(Product.status, func.count()).group_by(Product.status)).all()
    return {status: count for status, count in rows}


def get_product_by_code(db: Session, code: str) -> Product | None:
    return db.scalars(select(Product).where(Product.code == code)).one_or_none()
