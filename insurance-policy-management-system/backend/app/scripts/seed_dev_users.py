"""Create one development user per role.

    python -m app.scripts.seed_dev_users

Development/test only: refuses to run when APP_ENV=production. Idempotent,
so existing emails are left untouched (including their password and status).
All inserts happen in one transaction; on any error nothing is written.
Roles themselves are created by the Alembic migration, not here.
"""

import sys

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import RoleName, User
from app.repositories import users as user_repo

# Deliberately fake, publicly documented credentials. Never reuse them anywhere real.
DEV_PASSWORD = "DevOnly-Password-1"  # noqa: S105 (documented fake dev credential)

DEV_USERS = [
    ("admin@example.com", "Dev", "Administrator", RoleName.ADMINISTRATOR),
    ("agent@example.com", "Dev", "Agent", RoleName.AGENT),
    ("policyholder@example.com", "Dev", "Policyholder", RoleName.POLICYHOLDER),
]


def seed_dev_users(db: Session) -> list[str]:
    """Insert missing development users; return the emails that were created."""
    created: list[str] = []
    for email, first_name, last_name, role_name in DEV_USERS:
        if user_repo.get_user_by_email(db, email) is not None:
            continue
        role = user_repo.get_role_by_name(db, role_name)
        if role is None:
            raise RuntimeError(f"Role '{role_name}' is missing; run `alembic upgrade head` first.")
        db.add(
            User(
                email=email,
                password_hash=hash_password(DEV_PASSWORD),
                first_name=first_name,
                last_name=last_name,
                role=role,
            )
        )
        created.append(email)
    db.commit()
    return created


def main() -> int:
    settings = get_settings()
    if settings.app_env == "production":
        print("Refusing to seed development users when APP_ENV=production.", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        created = seed_dev_users(db)

    for email in created:
        print(f"created  {email}")
    skipped = len(DEV_USERS) - len(created)
    if skipped:
        print(f"skipped  {skipped} existing user(s)")
    print("Password for new dev users is documented in backend/README.md (development only).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
