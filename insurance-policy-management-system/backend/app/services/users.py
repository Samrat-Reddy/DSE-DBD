"""User administration. Each public function is one transaction and commits once."""

import logging

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, NotFoundError, UnprocessableError
from app.core.security import hash_password
from app.models import RoleName, User
from app.repositories import users as user_repo
from app.services.auth import normalize_email

logger = logging.getLogger(__name__)

MYSQL_DUPLICATE_ENTRY = 1062
DUPLICATE_EMAIL = "A user with this email already exists."


def create_user(
    db: Session,
    *,
    email: str,
    password: str,
    first_name: str,
    last_name: str,
    role: RoleName,
    is_active: bool = True,
) -> User:
    role_row = user_repo.get_role_by_name(db, role)
    if role_row is None:
        # Roles come from migrations; a missing one means the schema is not migrated.
        raise UnprocessableError(f"Role '{role}' does not exist.")

    user = User(
        email=normalize_email(email),
        password_hash=hash_password(password),
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        is_active=is_active,
        role=role_row,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # The unique constraint is the source of truth: it also catches two
        # concurrent requests registering the same email.
        if exc.orig is not None and exc.orig.args and exc.orig.args[0] == MYSQL_DUPLICATE_ENTRY:
            raise ConflictError(DUPLICATE_EMAIL) from None
        raise

    logger.info("User created", extra={"user_id": user.id, "role": role_row.name})
    return user


def set_user_active(db: Session, *, actor: User, user_id: int, is_active: bool) -> User:
    user = user_repo.get_user_by_id(db, user_id)
    if user is None:
        raise NotFoundError(f"User {user_id} was not found.")
    if user.id == actor.id and not is_active:
        raise ConflictError("You cannot deactivate your own account.")

    user.is_active = is_active
    db.commit()
    logger.info(
        "User activation changed",
        extra={"user_id": user.id, "is_active": is_active, "actor_id": actor.id},
    )
    return user
