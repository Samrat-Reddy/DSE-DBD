"""Product catalog: listing and detail. Readable by every signed-in role."""

from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundError
from app.models import PremiumFrequency, Product, ProductFeatureKind, ProductStatus, ProductType
from app.repositories import catalog as catalog_repo
from app.repositories.catalog import ProductSort
from app.schemas.policies import CoverageItemOut, ProductListOut, ProductOut, ProductStatusSummary

# Display order of frequencies, most frequent first (as the frontend lists them).
_FREQUENCY_ORDER = list(PremiumFrequency)


def to_product_out(product: Product) -> ProductOut:
    def texts(kind: ProductFeatureKind) -> list[str]:
        return [f.content for f in product.features if f.kind == kind]

    return ProductOut(
        code=product.code,
        name=product.name,
        type=ProductType(product.product_type),
        status=ProductStatus(product.status),
        tagline=product.tagline,
        description=product.description,
        reference_coverage_amount=product.reference_coverage_amount,
        min_coverage_amount=product.min_coverage_amount,
        max_coverage_amount=product.max_coverage_amount,
        base_annual_premium=product.base_annual_premium,
        default_term_years=product.default_term_years,
        term_options=[option.term_years for option in product.term_options],
        premium_frequencies=sorted(
            (PremiumFrequency(f.frequency) for f in product.premium_frequencies),
            key=_FREQUENCY_ORDER.index,
        ),
        min_entry_age=product.min_entry_age,
        max_entry_age=product.max_entry_age,
        eligibility_summary=product.eligibility_summary,
        eligibility_criteria=texts(ProductFeatureKind.ELIGIBILITY_CRITERION),
        waiting_period=product.waiting_period,
        benefits=texts(ProductFeatureKind.BENEFIT),
        coverage_items=[
            CoverageItemOut(name=f.content, limit=f.limit_text or "")
            for f in product.features
            if f.kind == ProductFeatureKind.COVERAGE_ITEM
        ],
        exclusions=texts(ProductFeatureKind.EXCLUSION),
    )


def list_products(
    db: Session,
    *,
    search: str | None,
    product_type: ProductType | None,
    status: ProductStatus | None,
    sort: ProductSort,
    limit: int,
    offset: int,
) -> ProductListOut:
    items, total = catalog_repo.list_products(
        db,
        search=search,
        product_type=product_type,
        status=status,
        sort=sort,
        limit=limit,
        offset=offset,
    )
    counts = catalog_repo.count_products_by_status(db)
    return ProductListOut(
        items=[to_product_out(product) for product in items],
        total=total,
        summary=ProductStatusSummary(
            total=sum(counts.values()),
            active=counts.get(ProductStatus.ACTIVE, 0),
            inactive=counts.get(ProductStatus.INACTIVE, 0),
        ),
    )


def get_product(db: Session, code: str) -> ProductOut:
    product = catalog_repo.get_product_by_code(db, code)
    if product is None:
        raise NotFoundError(f'No policy product found for code "{code}".')
    return to_product_out(product)
