"""Agent Commission API routes (Module 5).

Endpoints:
  GET  /commissions            list commissions in caller's scope
  GET  /commissions/{number}   detail for one commission
  GET  /commission-rules       list all commission rules (admin / agent)
  POST /commissions/{number}/confirm-earned   PENDING → EARNED (admin only)
  POST /commissions/{number}/record-paid      EARNED → PAID (admin only)
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, status

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession
from app.schemas.commissions import (
    ConfirmEarnedIn,
    RecordPaidIn,
)
from app.schemas.common import ErrorResponse
from app.services import commissions as commission_service

router = APIRouter(tags=["Commissions"], responses=AUTH_ERROR_RESPONSES)

NOT_FOUND = {404: {"model": ErrorResponse, "description": "Missing or outside scope"}}
TRANSITION_ERRORS = {
    **NOT_FOUND,
    409: {"model": ErrorResponse, "description": "Transition not allowed from current state"},
    422: {"model": ErrorResponse, "description": "Rule validation failed"},
}


@router.get(
    "/commission-rules",
    summary="Commission rules (product and agent-specific rates)",
)
def list_commission_rules(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    return commission_service.list_commission_rules(db)


@router.get("/commissions", summary="Commissions in the caller's scope")
def list_commissions(
    db: DbSession,
    user: CurrentUser,
    status_filter: Annotated[str | None, Query(alias="status", max_length=15)] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    return commission_service.list_commissions(
        db, user, status_filter=status_filter, limit=limit, offset=offset
    )


@router.get("/commissions/{commission_number}", summary="Commission detail", responses=NOT_FOUND)
def get_commission(db: DbSession, user: CurrentUser, commission_number: str) -> dict[str, Any]:
    return commission_service.get_commission(db, user, commission_number)


@router.post(
    "/commissions/{commission_number}/confirm-earned",
    summary="Confirm a commission as earned (admin only)",
    status_code=status.HTTP_200_OK,
    responses=TRANSITION_ERRORS,
)
def confirm_earned(
    db: DbSession,
    user: CurrentUser,
    commission_number: str,
    body: ConfirmEarnedIn,
) -> dict[str, Any]:
    return commission_service.confirm_earned(db, user, commission_number, note=body.note)


@router.post(
    "/commissions/{commission_number}/record-paid",
    summary="Record commission payout (admin only)",
    status_code=status.HTTP_200_OK,
    responses=TRANSITION_ERRORS,
)
def record_paid(
    db: DbSession,
    user: CurrentUser,
    commission_number: str,
    body: RecordPaidIn,
) -> dict[str, Any]:
    return commission_service.record_paid(
        db, user, commission_number, payout_reference=body.payoutReference, note=body.note
    )
