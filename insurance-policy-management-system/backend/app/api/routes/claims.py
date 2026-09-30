"""Claim filing and approval workflow (Module 3).

One endpoint per domain transition; there is deliberately no generic
"set status" endpoint. The service checks scope (404), the state machine
(409 for an impossible move, 403 for a role that may not make it) and the
step's own rules (422).
"""

from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession
from app.models import ClaimStatus
from app.repositories.claims import ClaimSort
from app.schemas.claims import (
    AssessIn,
    ClaimCreate,
    ClaimDetailOut,
    ClaimListOut,
    ClaimTimelineOut,
    ClaimTypeOptionsOut,
    EligiblePolicyListOut,
    FilingContextOut,
    NoteIn,
    RejectIn,
)
from app.schemas.common import ErrorResponse
from app.services import claims as claim_service

router = APIRouter(tags=["Claims"], responses=AUTH_ERROR_RESPONSES)

NOT_FOUND = {404: {"model": ErrorResponse, "description": "Missing, or outside the caller's scope"}}
TRANSITION_ERRORS = {
    **NOT_FOUND,
    409: {"model": ErrorResponse, "description": "Not possible from the claim's current status"},
    422: {"model": ErrorResponse, "description": "The step's rules are not met"},
}


@router.get("/claims", response_model=ClaimListOut, summary="Claims in the caller's scope")
def list_claims(
    db: DbSession,
    user: CurrentUser,
    search: Annotated[
        str | None,
        Query(max_length=100, description="Claim/policy number, policyholder, claim type"),
    ] = None,
    status: ClaimStatus | None = None,
    claim_type: Annotated[str | None, Query(max_length=40)] = None,
    policy_number: Annotated[str | None, Query(max_length=20)] = None,
    sort: ClaimSort = "updated-desc",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ClaimListOut:
    return claim_service.list_claims(
        db,
        user,
        search=search,
        status=status,
        claim_type=claim_type,
        policy_number=policy_number,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/claim-types",
    response_model=ClaimTypeOptionsOut,
    summary="Claim types and their document requirements (reference data)",
)
def list_claim_types(db: DbSession, user: CurrentUser) -> ClaimTypeOptionsOut:
    return claim_service.list_claim_types(db)


@router.get(
    "/claims/eligibility",
    response_model=EligiblePolicyListOut,
    summary="Policies in scope with their claim eligibility",
)
def list_eligible_policies(db: DbSession, user: CurrentUser) -> EligiblePolicyListOut:
    return claim_service.list_eligible_policies(db, user)


@router.get(
    "/policies/{policy_number}/claim-eligibility",
    response_model=FilingContextOut,
    summary="Eligibility and claimable types for one policy",
    responses=NOT_FOUND,
)
def get_filing_context(policy_number: str, db: DbSession, user: CurrentUser) -> FilingContextOut:
    return claim_service.get_filing_context(db, user, policy_number)


@router.post(
    "/claims",
    response_model=ClaimDetailOut,
    status_code=status.HTTP_201_CREATED,
    summary="File a claim (policyholders and agents)",
    responses={
        **NOT_FOUND,
        403: {
            "model": ErrorResponse,
            "description": "Administrators review claims; they cannot file",
        },
        409: {"model": ErrorResponse, "description": "The policy is not eligible for a claim"},
        422: {"model": ErrorResponse, "description": "The claim breaks a filing rule"},
    },
)
def file_claim(payload: ClaimCreate, db: DbSession, user: CurrentUser) -> ClaimDetailOut:
    return claim_service.file_claim(db, user, payload)


@router.get(
    "/claims/{claim_number}",
    response_model=ClaimDetailOut,
    summary="One claim",
    responses=NOT_FOUND,
)
def get_claim(claim_number: str, db: DbSession, user: CurrentUser) -> ClaimDetailOut:
    return claim_service.get_claim(db, user, claim_number)


@router.get(
    "/claims/{claim_number}/timeline",
    response_model=ClaimTimelineOut,
    summary="The claim's workflow history",
    responses=NOT_FOUND,
)
def get_timeline(claim_number: str, db: DbSession, user: CurrentUser) -> ClaimTimelineOut:
    return claim_service.get_timeline(db, user, claim_number)


@router.post(
    "/claims/{claim_number}/submit",
    response_model=ClaimDetailOut,
    summary="Draft -> Submitted (policyholder, agent)",
    responses=TRANSITION_ERRORS,
)
def submit_claim(claim_number: str, db: DbSession, user: CurrentUser) -> ClaimDetailOut:
    return claim_service.submit_claim(db, user, claim_number)


@router.post(
    "/claims/{claim_number}/cancel",
    response_model=ClaimDetailOut,
    summary="Draft -> Cancelled (policyholder, agent)",
    responses=TRANSITION_ERRORS,
)
def cancel_draft(
    claim_number: str, db: DbSession, user: CurrentUser, payload: NoteIn | None = None
) -> ClaimDetailOut:
    return claim_service.cancel_draft(db, user, claim_number, payload.note if payload else None)


@router.post(
    "/claims/{claim_number}/withdraw",
    response_model=ClaimDetailOut,
    summary="Submitted -> Cancelled (policyholder for own claim, administrator)",
    responses=TRANSITION_ERRORS,
)
def withdraw_claim(
    claim_number: str, db: DbSession, user: CurrentUser, payload: NoteIn | None = None
) -> ClaimDetailOut:
    return claim_service.withdraw_claim(db, user, claim_number, payload.note if payload else None)


@router.post(
    "/claims/{claim_number}/start-review",
    response_model=ClaimDetailOut,
    summary="Submitted -> Under review (administrator)",
    responses=TRANSITION_ERRORS,
)
def start_review(
    claim_number: str, db: DbSession, user: CurrentUser, payload: NoteIn | None = None
) -> ClaimDetailOut:
    return claim_service.start_review(db, user, claim_number, payload.note if payload else None)


@router.post(
    "/claims/{claim_number}/verify",
    response_model=ClaimDetailOut,
    summary="Under review -> Verified, if the checklist passes (administrator)",
    responses=TRANSITION_ERRORS,
)
def verify_claim(
    claim_number: str, db: DbSession, user: CurrentUser, payload: NoteIn | None = None
) -> ClaimDetailOut:
    return claim_service.verify_claim(db, user, claim_number, payload.note if payload else None)


@router.post(
    "/claims/{claim_number}/assess",
    response_model=ClaimDetailOut,
    summary="Verified -> Assessed with the payable amount (administrator)",
    responses=TRANSITION_ERRORS,
)
def assess_claim(
    claim_number: str, payload: AssessIn, db: DbSession, user: CurrentUser
) -> ClaimDetailOut:
    return claim_service.assess_claim(db, user, claim_number, payload.assessed_amount, payload.note)


@router.post(
    "/claims/{claim_number}/approve",
    response_model=ClaimDetailOut,
    summary="Assessed -> Approved at the assessed amount (administrator)",
    responses=TRANSITION_ERRORS,
)
def approve_claim(
    claim_number: str, db: DbSession, user: CurrentUser, payload: NoteIn | None = None
) -> ClaimDetailOut:
    return claim_service.approve_claim(db, user, claim_number, payload.note if payload else None)


@router.post(
    "/claims/{claim_number}/reject",
    response_model=ClaimDetailOut,
    summary="Assessed -> Rejected with a reason (administrator)",
    responses=TRANSITION_ERRORS,
)
def reject_claim(
    claim_number: str, payload: RejectIn, db: DbSession, user: CurrentUser
) -> ClaimDetailOut:
    return claim_service.reject_claim(db, user, claim_number, payload.reason)


@router.post(
    "/claims/{claim_number}/settle",
    response_model=ClaimDetailOut,
    summary="Approved -> Settled for the approved amount (administrator)",
    responses=TRANSITION_ERRORS,
)
def settle_claim(claim_number: str, db: DbSession, user: CurrentUser) -> ClaimDetailOut:
    return claim_service.settle_claim(db, user, claim_number)
