"""User administration (administrators only). There is no public registration."""

from typing import Annotated

from fastapi import APIRouter, Depends, status

from app.api.deps import AUTH_ERROR_RESPONSES, DbSession, require_role
from app.models import RoleName, User
from app.schemas.auth import UserCreate, UserOut, UserStatusUpdate
from app.schemas.common import ErrorResponse
from app.services import users as user_service

router = APIRouter(prefix="/users", tags=["Users"], responses=AUTH_ERROR_RESPONSES)

Administrator = Annotated[User, Depends(require_role(RoleName.ADMINISTRATOR))]


@router.post(
    "",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a user",
    responses={409: {"model": ErrorResponse, "description": "Email already registered"}},
)
def create_user(payload: UserCreate, db: DbSession, _admin: Administrator) -> User:
    return user_service.create_user(
        db,
        email=payload.email,
        password=payload.password.get_secret_value(),
        first_name=payload.first_name,
        last_name=payload.last_name,
        role=payload.role,
        is_active=payload.is_active,
    )


@router.patch(
    "/{user_id}/status",
    response_model=UserOut,
    summary="Activate or deactivate a user (takes effect on their next request)",
    responses={
        404: {"model": ErrorResponse, "description": "User not found"},
        409: {"model": ErrorResponse, "description": "Cannot deactivate yourself"},
    },
)
def update_user_status(
    user_id: int, payload: UserStatusUpdate, db: DbSession, admin: Administrator
) -> User:
    return user_service.set_user_active(
        db, actor=admin, user_id=user_id, is_active=payload.is_active
    )
