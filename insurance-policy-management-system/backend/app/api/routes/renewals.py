"""Renewal Reminder Engine API routes (Module 4).

Endpoints:
  GET  /renewals                    list renewal accounts in scope
  GET  /renewals/{policy_number}    detail for one policy
  GET  /renewals/{policy_number}/plan  reminder plan (optionally at a custom date)
  GET  /renewals/{policy_number}/history  reminder history
  POST /renewals/check              run the bulk reminder check
  POST /renewals/{policy_number}/trigger  manually trigger one stage
  POST /reminders/{reminder_number}/retry  retry a failed reminder

  GET  /renewal/clock               read the simulation clock
  POST /renewal/clock/advance       advance the simulation date (admin only)
  POST /renewal/clock/reset         reset to real today (admin only)
"""

from typing import Annotated, Any

from fastapi import APIRouter, Query, status

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession
from app.schemas.common import ErrorResponse
from app.schemas.renewals import AdvanceClockIn, RetryReminderIn, TriggerReminderIn
from app.services import renewals as renewal_service

router = APIRouter(tags=["Renewals"], responses=AUTH_ERROR_RESPONSES)

NOT_FOUND = {404: {"model": ErrorResponse, "description": "Missing or outside the caller's scope"}}
TRANSITION_ERRORS = {
    **NOT_FOUND,
    409: {"model": ErrorResponse, "description": "Action not permitted in the current state"},
    422: {"model": ErrorResponse, "description": "Rule validation failed"},
}


# ---------------------------------------------------------------------------
# Simulation clock
# ---------------------------------------------------------------------------


@router.get("/renewal/clock", summary="Simulation clock")
def get_clock(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    return renewal_service.get_clock(db)


@router.post(
    "/renewal/clock/advance",
    summary="Advance simulation date (admin only)",
    status_code=status.HTTP_200_OK,
    responses=TRANSITION_ERRORS,
)
def advance_clock(db: DbSession, user: CurrentUser, body: AdvanceClockIn) -> dict[str, Any]:
    return renewal_service.advance_clock(db, user, body.date, body.note)


@router.post(
    "/renewal/clock/reset",
    summary="Reset simulation date to real today (admin only)",
    status_code=status.HTTP_200_OK,
)
def reset_clock(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    return renewal_service.reset_clock(db, user)


# ---------------------------------------------------------------------------
# Renewal accounts
# ---------------------------------------------------------------------------


@router.get("/renewals", summary="Renewal pipeline in caller's scope")
def list_renewals(
    db: DbSession,
    user: CurrentUser,
    search: Annotated[str | None, Query(max_length=100)] = None,
    status_filter: Annotated[str | None, Query(alias="status", max_length=30)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict[str, Any]:
    return renewal_service.list_renewals(
        db, user, search=search, status=status_filter, limit=limit, offset=offset
    )


@router.get(
    "/renewals/{policy_number}", summary="Renewal detail for one policy", responses=NOT_FOUND
)
def get_renewal(db: DbSession, user: CurrentUser, policy_number: str) -> dict[str, Any]:
    return renewal_service.get_renewal_by_policy(db, user, policy_number)


@router.get(
    "/renewals/{policy_number}/plan",
    summary="Reminder stage plan",
    responses=NOT_FOUND,
)
def get_reminder_plan(
    db: DbSession,
    user: CurrentUser,
    policy_number: str,
    as_of: Annotated[
        str | None, Query(max_length=10, description="Custom as-of date (YYYY-MM-DD)")
    ] = None,
) -> dict[str, Any]:
    return renewal_service.get_reminder_plan(db, user, policy_number, as_of)


@router.get(
    "/renewals/{policy_number}/history",
    summary="Reminder history for one policy",
    responses=NOT_FOUND,
)
def get_reminder_history(db: DbSession, user: CurrentUser, policy_number: str) -> dict[str, Any]:
    return renewal_service.get_reminder_history(db, user, policy_number)


# ---------------------------------------------------------------------------
# Reminder check run
# ---------------------------------------------------------------------------


@router.post(
    "/renewals/check",
    summary="Run the bulk reminder check",
    status_code=status.HTTP_200_OK,
    responses={403: {"model": ErrorResponse, "description": "Not permitted"}},
)
def run_reminder_check(db: DbSession, user: CurrentUser) -> dict[str, Any]:
    return renewal_service.run_reminder_check(db, user)


# ---------------------------------------------------------------------------
# Manual trigger / retry
# ---------------------------------------------------------------------------


@router.post(
    "/renewals/{policy_number}/trigger",
    summary="Manually trigger a reminder (admin only)",
    status_code=status.HTTP_200_OK,
    responses=TRANSITION_ERRORS,
)
def trigger_reminder(
    db: DbSession,
    user: CurrentUser,
    policy_number: str,
    body: TriggerReminderIn,
) -> dict[str, Any]:
    return renewal_service.trigger_reminder(
        db,
        user,
        policy_number,
        stage_id=body.stage,
        outcome=body.outcome,
        channel=body.channel,
        note=body.note,
    )


@router.post(
    "/reminders/{reminder_number}/retry",
    summary="Retry a failed reminder (admin only)",
    status_code=status.HTTP_200_OK,
    responses=TRANSITION_ERRORS,
)
def retry_reminder(
    db: DbSession,
    user: CurrentUser,
    reminder_number: str,
    body: RetryReminderIn,
) -> dict[str, Any]:
    return renewal_service.retry_reminder(
        db,
        user,
        reminder_number,
        outcome=body.outcome,
        channel=body.channel,
        note=body.note,
    )
