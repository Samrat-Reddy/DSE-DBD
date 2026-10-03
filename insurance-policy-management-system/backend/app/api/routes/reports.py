"""MIS Reports API routes (Module 6).

All reports are administrator-only.

Endpoints:
  GET /reports                  overview (management summary)
  GET /reports/policies         policy report
  GET /reports/premiums         premium & payment report
  GET /reports/claims           claims report
  GET /reports/renewals         renewal report
  GET /reports/commissions      agent commission report
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession
from app.schemas.common import ErrorResponse
from app.services import reports as report_service

router = APIRouter(tags=["Reports"], responses=AUTH_ERROR_RESPONSES)

FORBIDDEN = {403: {"model": ErrorResponse, "description": "Administrator access required"}}


def _parse_query(
    period: str | None = None,
    from_date: str | None = None,
    to_date: str | None = None,
    product: str | None = None,
    status: str | None = None,
    agent_id: str | None = None,
) -> dict:
    q: dict = {}
    if period:
        q["period"] = period
    if from_date:
        q["from"] = from_date
    if to_date:
        q["to"] = to_date
    if product:
        q["product"] = product
    if status:
        q["status"] = status
    if agent_id:
        q["agentId"] = agent_id
    return q


@router.get("/reports", summary="MIS overview (admin only)", responses=FORBIDDEN)
def get_overview(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
) -> dict[str, Any]:
    return report_service.get_overview(db, user, _parse_query(period, from_date, to_date))


@router.get("/reports/policies", summary="Policy report (admin only)", responses=FORBIDDEN)
def get_policy_report(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
    product: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    return report_service.get_policy_report(
        db, user, _parse_query(period, from_date, to_date, product, status)
    )


@router.get(
    "/reports/premiums", summary="Premium & payment report (admin only)", responses=FORBIDDEN
)
def get_premium_report(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
    product: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    return report_service.get_premium_report(
        db, user, _parse_query(period, from_date, to_date, product, status)
    )


@router.get("/reports/claims", summary="Claims report (admin only)", responses=FORBIDDEN)
def get_claims_report(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
    product: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    return report_service.get_claims_report(
        db, user, _parse_query(period, from_date, to_date, product, status)
    )


@router.get("/reports/renewals", summary="Renewal report (admin only)", responses=FORBIDDEN)
def get_renewal_report(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
    product: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    return report_service.get_renewal_report(
        db, user, _parse_query(period, from_date, to_date, product, status)
    )


@router.get("/reports/commissions", summary="Commission report (admin only)", responses=FORBIDDEN)
def get_commission_report(
    db: DbSession,
    user: CurrentUser,
    period: Annotated[str | None, Query(max_length=20)] = None,
    from_date: Annotated[str | None, Query(alias="from", max_length=10)] = None,
    to_date: Annotated[str | None, Query(alias="to", max_length=10)] = None,
    product: Annotated[str | None, Query(max_length=100)] = None,
    status: Annotated[str | None, Query(max_length=20)] = None,
    agent_id: Annotated[str | None, Query(max_length=20)] = None,
) -> dict[str, Any]:
    return report_service.get_commission_report(
        db, user, _parse_query(period, from_date, to_date, product, status, agent_id)
    )
