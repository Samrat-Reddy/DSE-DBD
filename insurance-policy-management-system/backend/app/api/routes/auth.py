"""Login, current user, and development-only RBAC check endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.deps import AUTH_ERROR_RESPONSES, AppSettings, CurrentUser, DbSession, require_role
from app.models import RoleName, User
from app.schemas.auth import AccessCheckResponse, LoginRequest, TokenResponse, UserOut
from app.schemas.common import ErrorResponse
from app.services import auth as auth_service

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Exchange email and password for an access token",
    responses={401: {"model": ErrorResponse, "description": "Invalid email or password"}},
)
def login(payload: LoginRequest, db: DbSession, settings: AppSettings) -> TokenResponse:
    token = auth_service.authenticate(
        db, payload.email, payload.password.get_secret_value(), settings
    )
    return TokenResponse(access_token=token, expires_in=settings.access_token_expire_minutes * 60)


@router.get(
    "/me",
    response_model=UserOut,
    summary="The authenticated user",
    responses={401: AUTH_ERROR_RESPONSES[401]},
)
def me(user: CurrentUser) -> User:
    return user


# Development/testing only: tiny endpoints proving RBAC end to end. They expose
# no data and are not mounted when APP_ENV=production (see app.main).
rbac_check_router = APIRouter(
    prefix="/auth/test",
    tags=["RBAC checks (development only)"],
    responses=AUTH_ERROR_RESPONSES,
)


@rbac_check_router.get(
    "/admin", response_model=AccessCheckResponse, summary="Administrator only (dev check)"
)
def administrator_check(
    user: Annotated[User, Depends(require_role(RoleName.ADMINISTRATOR))],
) -> AccessCheckResponse:
    return AccessCheckResponse(message="Administrator access granted.", role=user.role.name)


@rbac_check_router.get(
    "/agent", response_model=AccessCheckResponse, summary="Agent only (dev check)"
)
def agent_check(
    user: Annotated[User, Depends(require_role(RoleName.AGENT))],
) -> AccessCheckResponse:
    return AccessCheckResponse(message="Agent access granted.", role=user.role.name)
