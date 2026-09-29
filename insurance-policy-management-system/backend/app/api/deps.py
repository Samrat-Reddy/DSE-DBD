"""Authentication and role-based authorisation dependencies.

Protect a route with one of:

    user: CurrentUser                                             # any signed-in user
    user: Annotated[User, Depends(require_role(RoleName.AGENT))]  # exactly one role
    dependencies=[Depends(require_any_role(RoleName.AGENT, RoleName.ADMINISTRATOR))]
"""

from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.db.session import get_db
from app.models import RoleName, User
from app.schemas.common import ErrorResponse
from app.services.auth import resolve_user_from_token

# auto_error=False: missing/malformed headers go through our own 401 response
# rather than FastAPI's default error shape.
bearer_scheme = HTTPBearer(auto_error=False, description="JWT from POST /auth/login")

DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]

AUTH_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorResponse, "description": "Missing, invalid or expired token"},
    403: {"model": ErrorResponse, "description": "Authenticated but not permitted"},
}


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    db: DbSession,
    settings: AppSettings,
) -> User:
    if credentials is None:
        raise UnauthorizedError("Not authenticated.")
    return resolve_user_from_token(db, credentials.credentials, settings)


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_any_role(*roles: RoleName) -> Callable[[User], User]:
    """Dependency admitting users whose role is one of `roles` (403 otherwise)."""
    if not roles:
        raise ValueError("require_any_role() needs at least one role")
    allowed = frozenset(roles)

    def dependency(user: CurrentUser) -> User:
        if user.role.name not in allowed:
            raise ForbiddenError()
        return user

    return dependency


def require_role(role: RoleName) -> Callable[[User], User]:
    """Dependency admitting only users with exactly this role."""
    return require_any_role(role)
