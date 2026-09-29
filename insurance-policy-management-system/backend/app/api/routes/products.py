"""Policy catalog (Module 1). Any signed-in user may browse it."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.deps import AUTH_ERROR_RESPONSES, DbSession, get_current_user
from app.models import ProductStatus, ProductType
from app.repositories.catalog import ProductSort
from app.schemas.common import ErrorResponse
from app.schemas.policies import ProductListOut, ProductOut
from app.services import catalog as catalog_service

router = APIRouter(
    prefix="/products",
    tags=["Policy catalog"],
    dependencies=[Depends(get_current_user)],
    responses={401: AUTH_ERROR_RESPONSES[401]},
)


@router.get("", response_model=ProductListOut, summary="Search, filter and sort the catalog")
def list_products(
    db: DbSession,
    search: Annotated[
        str | None, Query(max_length=100, description="Matches code, name or type")
    ] = None,
    type: Annotated[ProductType | None, Query()] = None,  # noqa: A002 (public query name)
    status: ProductStatus | None = None,
    sort: ProductSort = "name-asc",
    limit: Annotated[int, Query(ge=1, le=100)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ProductListOut:
    return catalog_service.list_products(
        db,
        search=search,
        product_type=type,
        status=status,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{product_code}",
    response_model=ProductOut,
    summary="One catalog product",
    responses={404: {"model": ErrorResponse, "description": "Unknown product code"}},
)
def get_product(product_code: str, db: DbSession) -> ProductOut:
    return catalog_service.get_product(db, product_code)
