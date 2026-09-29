"""User and role queries. Repositories never commit; services own transactions."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Role, User


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email)).one_or_none()


def get_role_by_name(db: Session, name: str) -> Role | None:
    return db.scalars(select(Role).where(Role.name == name)).one_or_none()
