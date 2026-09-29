"""Issued policies (Module 1). Results are always limited to the caller's scope."""

from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api.deps import AUTH_ERROR_RESPONSES, CurrentUser, DbSession, require_any_role
from app.models import PolicyStatus, RoleName, User
from app.repositories.policies import PolicySort
from app.schemas.common import ErrorResponse
from app.schemas.policies import PolicyIssueRequest, PolicyListOut, PolicyOut
from app.services import policies as policy_service

router = APIRouter(prefix="/policies", tags=["Policies"], responses=AUTH_ERROR_RESPONSES)

Issuer = Annotated[User, Depends(require_any_role(RoleName.AGENT, RoleName.ADMINISTRATOR))]


@router.get(
    "",
    response_model=PolicyListOut,
    summary="Policies visible to the caller",
    description=(
        "Administrators see every policy, agents the policies they service, and "
        "policyholders only their own. Filters narrow that scope; they never widen it."
    ),
)
def list_policies(
    db: DbSession,
    user: CurrentUser,
    search: Annotated[
        str | None,
        Query(max_length=100, description="Matches policy number, customer name or ID"),
    ] = None,
    status: PolicyStatus | None = None,
    product_code: Annotated[str | None, Query(max_length=20)] = None,
    agent_code: Annotated[
        str | None, Query(max_length=12, description="Administrators only")
    ] = None,
    sort: PolicySort = "newest",
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PolicyListOut:
    return policy_service.list_policies(
        db,
        user,
        search=search,
        status=status,
        product_code=product_code,
        agent_code=agent_code,
        sort=sort,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{policy_number}",
    response_model=PolicyOut,
    summary="One policy",
    responses={
        404: {
            "model": ErrorResponse,
            "description": "No such policy, or it is outside the caller's scope",
        }
    },
)
def get_policy(policy_number: str, db: DbSession, user: CurrentUser) -> PolicyOut:
    return policy_service.get_policy(db, user, policy_number)


@router.post(
    "",
    response_model=PolicyOut,
    status_code=status.HTTP_201_CREATED,
    summary="Issue a policy (agents and administrators)",
    responses={
        409: {"model": ErrorResponse, "description": "Duplicate proposal"},
        422: {"model": ErrorResponse, "description": "Invalid request or product rule violated"},
    },
)
def issue_policy(payload: PolicyIssueRequest, db: DbSession, user: Issuer) -> PolicyOut:
    return policy_service.issue_policy(db, user, payload)
