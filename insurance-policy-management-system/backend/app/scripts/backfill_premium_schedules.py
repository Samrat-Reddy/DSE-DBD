"""Create the premium schedule of every issued policy that does not have one.

    python -m app.scripts.backfill_premium_schedules

Needed once after migration 0004 for policies issued before Module 2
existed; new policies get their schedule in the issuance transaction.
Safe in every environment: idempotent, and all schedules are created in one
transaction (all or nothing).
"""

import sys

from app.db.session import SessionLocal
from app.services.premiums import backfill_schedules


def main() -> int:
    with SessionLocal() as db:
        created = backfill_schedules(db)
    print(f"premium schedules created: {created}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
