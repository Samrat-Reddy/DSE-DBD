"""Login and access-token resolution."""

import logging

from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.exceptions import UnauthorizedError
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    InvalidTokenError,
    create_access_token,
    decode_access_token,
    verify_password,
)
from app.models import User
from app.repositories import users as user_repo

logger = logging.getLogger(__name__)

# One message for every login failure, so responses never reveal whether an
# email is registered or an account is deactivated.
INVALID_CREDENTIALS = "Invalid email or password."
INVALID_TOKEN = "Could not validate credentials."  # noqa: S105 (error message)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def authenticate(db: Session, email: str, password: str, settings: Settings) -> str:
    """Verify credentials and return a signed access token. Read-only."""
    user = user_repo.get_user_by_email(db, normalize_email(email))

    if user is None:
        verify_password(password, DUMMY_PASSWORD_HASH)  # equalise timing
        logger.info("Login failed", extra={"reason": "unknown_email"})
        raise UnauthorizedError(INVALID_CREDENTIALS)
    if not verify_password(password, user.password_hash):
        logger.info("Login failed", extra={"reason": "wrong_password", "user_id": user.id})
        raise UnauthorizedError(INVALID_CREDENTIALS)
    if not user.is_active:
        logger.info("Login failed", extra={"reason": "inactive", "user_id": user.id})
        raise UnauthorizedError(INVALID_CREDENTIALS)

    logger.info("Login succeeded", extra={"user_id": user.id, "role": user.role.name})
    return create_access_token(user.id, settings)


def resolve_user_from_token(db: Session, token: str, settings: Settings) -> User:
    """Return the active user a token belongs to.

    The token only proves identity. Existence and active status are always
    re-checked in MySQL, so deactivation takes effect on the next request.
    """
    try:
        user_id = decode_access_token(token, settings)
    except InvalidTokenError as exc:
        logger.info("Rejected access token", extra={"reason": str(exc)})
        raise UnauthorizedError(INVALID_TOKEN) from None

    user = user_repo.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        logger.info(
            "Rejected access token",
            extra={"reason": "unknown_user" if user is None else "inactive", "user_id": user_id},
        )
        raise UnauthorizedError(INVALID_TOKEN)
    return user
