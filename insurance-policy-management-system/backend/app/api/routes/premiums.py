"""Premium schedules, instalments and payments (Module 2).

Every route requires a signed-in user; the service decides scope (404 outside
it) and who may write (403 for roles that never may).
"""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession
from app.models import PaymentMethod, PaymentStatus
from app.repositories.premiums import AccountSort, PaymentSort, Standing
from app.schemas.common import ErrorResponse
from app.schemas.premiums import (
    InstallmentListOut,
    InstallmentOut,
    PaymentCreate,
    PaymentListOut,
    PaymentOut,
    PaymentRecordedOut,
    PaymentResolve,
    PremiumAccountListOut,
    PremiumScheduleOut,
)
from app.services import premiums as premium_service

router = APIRouter(tags=["Premiums & payments"], responses=AUTH_ERROR_RESPONSES)

NOT_FOUND = {404: {"model": ErrorResponse, "description": "Missing, or outside the caller's scope"}}
Limit = Annotated[int, Query(ge=1, le=200)]
Offset = Annotated[int, Query(ge=0)]


@router.get(
    "/premium-schedules",
    response_model=PremiumAccountListOut,
    summary="Premium accounts in scope, with portfolio totals",
)
def list_premium_schedules(
    db: DbSession,
    user: CurrentUser,
    search: Annotated[
        str | None,
        Query(max_length=100, description="Policy number, customer name/ID or product"),
    ] = None,
    standing: Standing | None = None,
    sort: AccountSort = "next-due-asc",
    limit: Limit = 50,
    offset: Offset = 0,
) -> PremiumAccountListOut:
    return premium_service.list_accounts(
        db, user, search=search, standing=standing, sort=sort, limit=limit, offset=offset
    )


@router.get(
    "/policies/{policy_number}/premium-schedule",
    response_model=PremiumScheduleOut,
    summary="A policy's premium schedule and financial summary",
    responses={
        **NOT_FOUND,
        409: {"model": ErrorResponse, "description": "Policy not issued yet"},
    },
)
def get_premium_schedule(
    policy_number: str, db: DbSession, user: CurrentUser
) -> PremiumScheduleOut:
    return premium_service.get_schedule(db, user, policy_number)


@router.get(
    "/policies/{policy_number}/installments",
    response_model=InstallmentListOut,
    summary="A policy's instalments, in order",
    responses=NOT_FOUND,
)
def list_policy_installments(
    policy_number: str, db: DbSession, user: CurrentUser
) -> InstallmentListOut:
    return premium_service.list_installments(db, user, policy_number)


@router.get(
    "/installments/{installment_id}",
    response_model=InstallmentOut,
    summary="One instalment",
    responses=NOT_FOUND,
)
def get_installment(installment_id: int, db: DbSession, user: CurrentUser) -> InstallmentOut:
    return premium_service.get_installment(db, user, installment_id)


@router.get(
    "/installments/{installment_id}/payments",
    response_model=PaymentListOut,
    summary="Payment attempts on one instalment",
    responses=NOT_FOUND,
)
def list_installment_payments(
    installment_id: int, db: DbSession, user: CurrentUser, limit: Limit = 50, offset: Offset = 0
) -> PaymentListOut:
    return premium_service.list_installment_payments(
        db, user, installment_id, limit=limit, offset=offset
    )


@router.post(
    "/installments/{installment_id}/payments",
    response_model=PaymentRecordedOut,
    status_code=status.HTTP_201_CREATED,
    summary="Record a payment (administrators; policyholders for their own policies)",
    responses={
        **NOT_FOUND,
        409: {
            "model": ErrorResponse,
            "description": "Duplicate reference, already paid, pending payment, or not due yet",
        },
        422: {
            "model": ErrorResponse,
            "description": "Invalid amount or above the remaining balance",
        },
    },
)
def record_payment(
    installment_id: int, payload: PaymentCreate, db: DbSession, user: CurrentUser
) -> PaymentRecordedOut:
    return premium_service.record_payment(db, user, installment_id, payload)


@router.get("/payments", response_model=PaymentListOut, summary="Payment history in scope")
def list_payments(
    db: DbSession,
    user: CurrentUser,
    search: Annotated[
        str | None,
        Query(max_length=100, description="Payment number/reference, policy, customer or product"),
    ] = None,
    status: PaymentStatus | None = None,
    method: PaymentMethod | None = None,
    policy_number: Annotated[str | None, Query(max_length=20)] = None,
    sort: PaymentSort = "date-desc",
    limit: Limit = 50,
    offset: Offset = 0,
) -> PaymentListOut:
    return premium_service.list_payments(
        db,
        user,
        policy_number=policy_number,
        search=search,
        status=status,
        method=method,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/payments/{payment_number}",
    response_model=PaymentOut,
    summary="One payment",
    responses=NOT_FOUND,
)
def get_payment(payment_number: str, db: DbSession, user: CurrentUser) -> PaymentOut:
    return premium_service.get_payment(db, user, payment_number)


@router.patch(
    "/payments/{payment_number}",
    response_model=PaymentRecordedOut,
    summary="Settle a pending payment (administrators)",
    responses={
        **NOT_FOUND,
        409: {"model": ErrorResponse, "description": "Payment is not pending"},
    },
)
def resolve_payment(
    payment_number: str, payload: PaymentResolve, db: DbSession, user: CurrentUser
) -> PaymentRecordedOut:
    return premium_service.resolve_payment(db, user, payment_number, payload)
