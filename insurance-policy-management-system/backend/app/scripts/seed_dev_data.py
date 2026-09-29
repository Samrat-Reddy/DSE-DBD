"""Seed everything a local demo needs.

    python -m app.scripts.seed_dev_data

1. the development login accounts (app.scripts.seed_dev_users);
2. Module 1 data from seed_data/module1.json, which is generated from the
   frontend's own mock data (products, agents, customers, policies), so the
   existing screens and the not-yet-migrated modules see the same records
   and policy numbers;
3. links the dev logins to business records: agent@example.com -> AGT-2207
   (the frontend's DEMO_AGENT_ID) and policyholder@example.com -> CUS-100241;
4. Module 2: creates the premium schedule of every issued policy that lacks
   one, then records the frontend's demo payments (seed_data/module2.json)
   through the same balance rules the API uses.

Development/test only (refuses when APP_ENV=production). Deterministic and
idempotent: records are matched on their business codes and never
overwritten. Module 1 data is inserted in a single transaction.
"""

import json
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import SessionLocal
from app.models import (
    Agent,
    Customer,
    Installment,
    Payment,
    PaymentStatus,
    Policy,
    PremiumSchedule,
    Product,
    ProductFeature,
    ProductFeatureKind,
    ProductPremiumFrequency,
    ProductTermOption,
    RoleName,
    User,
)
from app.repositories import premiums as premium_repo
from app.scripts.seed_dev_users import seed_dev_users
from app.services import premium_rules
from app.services.premiums import create_schedule

SEED_FILE = Path(__file__).parent / "seed_data" / "module1.json"
PAYMENTS_FILE = Path(__file__).parent / "seed_data" / "module2.json"

# Dev login -> business record it represents.
USER_LINKS = {
    "agent@example.com": ("agent", "AGT-2207", RoleName.AGENT),
    "policyholder@example.com": ("customer", "CUS-100241", RoleName.POLICYHOLDER),
}


def _load() -> dict:
    return json.loads(SEED_FILE.read_text(encoding="utf-8"))


def _features(raw: dict) -> list[ProductFeature]:
    rows: list[ProductFeature] = []
    lists = [
        (ProductFeatureKind.BENEFIT, raw["benefits"]),
        (ProductFeatureKind.EXCLUSION, raw["exclusions"]),
        (ProductFeatureKind.ELIGIBILITY_CRITERION, raw["eligibility_criteria"]),
    ]
    for kind, texts in lists:
        rows += [
            ProductFeature(kind=kind, position=i, content=value) for i, value in enumerate(texts, 1)
        ]
    rows += [
        ProductFeature(
            kind=ProductFeatureKind.COVERAGE_ITEM,
            position=i,
            content=item["name"],
            limit_text=item["limit"],
        )
        for i, item in enumerate(raw["coverage_items"], 1)
    ]
    return rows


def seed_module1(db: Session, data: dict | None = None) -> dict[str, int]:
    """Insert missing Module 1 records; returns how many of each were created."""
    data = data or _load()
    created = {"products": 0, "agents": 0, "customers": 0, "policies": 0, "links": 0}

    existing = set(db.scalars(select(Product.code)))
    for raw in data["products"]:
        if raw["code"] in existing:
            continue
        product = Product(
            code=raw["code"],
            name=raw["name"],
            product_type=raw["product_type"],
            status=raw["status"],
            tagline=raw["tagline"],
            description=raw["description"],
            reference_coverage_amount=Decimal(raw["reference_coverage_amount"]),
            min_coverage_amount=Decimal(raw["min_coverage_amount"]),
            max_coverage_amount=Decimal(raw["max_coverage_amount"]),
            base_annual_premium=Decimal(raw["base_annual_premium"]),
            default_term_years=raw["default_term_years"],
            min_entry_age=raw["min_entry_age"],
            max_entry_age=raw["max_entry_age"],
            eligibility_summary=raw["eligibility_summary"],
            waiting_period=raw["waiting_period"],
            term_options=[ProductTermOption(term_years=t) for t in raw["term_options"]],
            premium_frequencies=[
                ProductPremiumFrequency(frequency=f) for f in raw["premium_frequencies"]
            ],
            features=_features(raw),
        )
        db.add(product)
        created["products"] += 1

    existing = set(db.scalars(select(Agent.agent_code)))
    for raw in data["agents"]:
        if raw["code"] not in existing:
            db.add(
                Agent(
                    agent_code=raw["code"],
                    full_name=raw["full_name"],
                    branch=raw["branch"],
                    email=raw["email"],
                )
            )
            created["agents"] += 1

    existing = set(db.scalars(select(Customer.customer_code)))
    for raw in data["customers"]:
        if raw["code"] not in existing:
            db.add(
                Customer(
                    customer_code=raw["code"],
                    full_name=raw["full_name"],
                    date_of_birth=date.fromisoformat(raw["date_of_birth"]),
                    email=raw["email"],
                    phone=raw["phone"],
                    address_line1=raw["address_line1"],
                    address_line2=raw["address_line2"],
                    city=raw["city"],
                    state=raw["state"],
                    postal_code=raw["postal_code"],
                )
            )
            created["customers"] += 1
    db.flush()

    products = {p.code: p for p in db.scalars(select(Product))}
    agents = {a.agent_code: a for a in db.scalars(select(Agent))}
    customers = {c.customer_code: c for c in db.scalars(select(Customer))}

    existing = set(db.scalars(select(Policy.policy_number)))
    for raw in data["policies"]:
        if raw["policy_number"] in existing:
            continue
        db.add(
            Policy(
                policy_number=raw["policy_number"],
                product=products[raw["product_code"]],
                customer=customers[raw["customer_code"]],
                agent=agents.get(raw["agent_code"]) if raw["agent_code"] else None,
                status=raw["status"],
                coverage_amount=Decimal(raw["coverage_amount"]),
                annual_premium=Decimal(raw["annual_premium"]),
                premium_frequency=raw["premium_frequency"],
                term_years=raw["term_years"],
                issue_date=date.fromisoformat(raw["issue_date"]) if raw["issue_date"] else None,
                start_date=date.fromisoformat(raw["start_date"]),
                nominee_name=raw["nominee_name"],
                nominee_relationship=raw["nominee_relationship"],
                nominee_date_of_birth=date.fromisoformat(raw["nominee_date_of_birth"]),
            )
        )
        created["policies"] += 1

    for email, (kind, code, role) in USER_LINKS.items():
        user = db.scalars(select(User).where(User.email == email)).one_or_none()
        record = agents.get(code) if kind == "agent" else customers.get(code)
        # Only link a login whose role matches the kind of record, and never
        # re-point a record that is already linked.
        if user is None or record is None or user.role.name != role or record.user_id:
            continue
        record.user_id = user.id
        created["links"] += 1

    db.commit()
    return created


def seed_module2(db: Session, data: dict | None = None) -> dict[str, int]:
    """Backfill schedules, then add missing demo payments; one transaction.

    Payments are applied with premium_rules, so seeded balances obey exactly
    the rules the API enforces (a seeded payment can never overpay).
    """
    data = data or json.loads(PAYMENTS_FILE.read_text(encoding="utf-8"))
    created = {"schedules": 0, "payments": 0}
    for policy in premium_repo.policies_without_schedule(db):
        create_schedule(db, policy)
        created["schedules"] += 1
    db.flush()

    existing = set(db.scalars(select(Payment.payment_number)))
    for raw in data["payments"]:
        if raw["payment_number"] in existing:
            continue
        installment = db.scalars(
            select(Installment)
            .join(PremiumSchedule, PremiumSchedule.id == Installment.schedule_id)
            .join(Policy, Policy.id == PremiumSchedule.policy_id)
            .where(
                Policy.policy_number == raw["policy_number"],
                Installment.installment_number == raw["installment_number"],
            )
        ).one()
        amount = Decimal(str(raw["amount"])).quantize(premium_rules.CENT)
        if raw["status"] == PaymentStatus.SUCCESSFUL:
            installment.amount_paid, installment.status = premium_rules.apply_successful_payment(
                installment.amount_paid, installment.amount_due, amount
            )
        db.add(
            Payment(
                payment_number=raw["payment_number"],
                payment_reference=raw["payment_reference"],
                installment=installment,
                amount=amount,
                status=raw["status"],
                payment_method=raw["payment_method"],
                paid_at=datetime.fromisoformat(raw["paid_at"]),
                failure_reason=raw["failure_reason"],
            )
        )
        created["payments"] += 1

    db.commit()
    return created


def main() -> int:
    if get_settings().app_env == "production":
        print("Refusing to seed development data when APP_ENV=production.", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        users = seed_dev_users(db)
    with SessionLocal() as db:
        created = seed_module1(db)
    with SessionLocal() as db:
        created |= seed_module2(db)

    print(f"users     created {len(users)}")
    for key, count in created.items():
        print(f"{key:<9} created {count}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
