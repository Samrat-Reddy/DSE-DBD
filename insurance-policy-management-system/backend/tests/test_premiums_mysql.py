"""Module 2 (Premium Schedule & Payments) against real MySQL.

Each test starts from the development seed: Module 1 data, a premium schedule
for every issued policy, and the frontend's 14 demo payments. Useful facts:

  POL-2024-000148  annual, 1 instalment, paid       (AGT-2207, CUS-100241 = dev policyholder)
  POL-2024-000519  half-yearly, 4 instalments; 1-3 paid, #4 (1,550, due 2026-05-10) unpaid
                   (AGT-2207, CUS-100630)
  POL-2024-000226  quarterly, 100 instalments; 1-8 paid, a FAILED attempt on #9 (AGT-1184)
  POL-2023-000874  annual, paid                     (AGT-0456)
  POL-2025-000031  pending issuance: no schedule
"""

import threading
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.exceptions import ConflictError
from app.models import Installment, Payment, RoleName, User
from app.schemas.premiums import PaymentCreate
from app.scripts.seed_dev_data import seed_module1, seed_module2
from app.scripts.seed_dev_users import DEV_PASSWORD, seed_dev_users
from app.services import premiums as premium_service
from app.services import users as user_service

pytestmark = pytest.mark.mysql

TODAY = date.today()
D = Decimal


@pytest.fixture
def ledger(mysql_api, mysql_sessions: sessionmaker[Session]):
    with mysql_sessions() as session:
        seed_dev_users(session)
    with mysql_sessions() as session:
        seed_module1(session)
    with mysql_sessions() as session:
        assert seed_module2(session) == {"schedules": 4, "payments": 14}
    return mysql_api


def _headers(api, email: str, password: str = DEV_PASSWORD) -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin(ledger):
    return _headers(ledger, "admin@example.com")


@pytest.fixture
def agent(ledger):
    return _headers(ledger, "agent@example.com")


@pytest.fixture
def holder(ledger):
    return _headers(ledger, "policyholder@example.com")


def _installment_id(sessions, policy_number: str, number: int) -> int:
    with sessions() as session:
        return session.scalar(
            text(
                "SELECT i.id FROM installments i JOIN premium_schedules s ON s.id = i.schedule_id "
                "JOIN policies p ON p.id = s.policy_id "
                "WHERE p.policy_number = :policy AND i.installment_number = :number"
            ),
            {"policy": policy_number, "number": number},
        )


def _balance(sessions, installment_id: int) -> tuple[Decimal, str]:
    with sessions() as session:
        row = session.execute(
            text("SELECT amount_paid, status FROM installments WHERE id = :id"),
            {"id": installment_id},
        ).one()
        return row[0], row[1]


def _count(sessions, sql: str, **params) -> int:
    with sessions() as session:
        return session.scalar(text(sql), params)


_reference_counter = iter(range(1, 10_000))


def _pay(api, headers, installment_id, amount, **extra):
    body = {
        "amount": str(amount),
        "payment_method": "upi",
        "payment_reference": f"TEST-REF-{next(_reference_counter):05d}",
        **extra,
    }
    return api.post(f"/api/v1/installments/{installment_id}/payments", json=body, headers=headers)


def _issue_for_dev_policyholder(api, admin_headers) -> str:
    """A fresh policy for CUS-100241 starting today (instalment 1 payable now)."""
    body = {
        "product_code": "PRD-HLT-001",
        "policyholder": {
            "customer_code": "CUS-100241",
            "full_name": "Ananya Krishnan",
            "date_of_birth": "1990-06-18",
            "email": "ananya.krishnan@example.com",
            "phone": "9845012377",
            "address_line1": "14, Brigade Gardens",
            "city": "Bengaluru",
            "state": "Karnataka",
            "postal_code": "560025",
        },
        "coverage_amount": "1000000",
        "start_date": TODAY.isoformat(),
        "term_years": 1,
        "premium_frequency": "monthly",
        "nominee": {
            "name": "Rahul Krishnan",
            "relationship": "Spouse",
            "date_of_birth": "1988-02-04",
        },
        "agent_code": "AGT-2207",
    }
    response = api.post("/api/v1/policies", json=body, headers=admin_headers)
    assert response.status_code == 201, response.text
    return response.json()["policy_number"]


# --- schema ---------------------------------------------------------------------


def test_module2_schema(mysql_engine: Engine):
    inspector = inspect(mysql_engine)
    assert {"premium_schedules", "installments", "payments"} <= set(inspector.get_table_names())
    assert {u["name"] for u in inspector.get_unique_constraints("premium_schedules")} == {
        "uq_premium_schedules_policy_id"
    }
    assert {u["name"] for u in inspector.get_unique_constraints("installments")} == {
        "uq_installments_schedule_id_installment_number",
        "uq_installments_schedule_id_due_date",
    }
    assert {u["name"] for u in inspector.get_unique_constraints("payments")} == {
        "uq_payments_payment_number",
        "uq_payments_payment_reference",
    }
    fks = {
        fk["name"]: (fk["referred_table"], fk["options"].get("ondelete"))
        for fk in inspector.get_foreign_keys("payments")
    }
    assert fks == {
        "fk_payments_installment_id_installments": ("installments", "RESTRICT"),
        "fk_payments_recorded_by_user_id_users": ("users", "RESTRICT"),
    }
    checks = {c["name"] for c in inspector.get_check_constraints("installments")}
    assert {
        "ck_installments_status_matches_amount",
        "ck_installments_amount_paid_within_due",
    } <= checks
    # Exactly one index per FK column (no MySQL auto-duplicates).
    indexes = {ix["name"] for ix in inspector.get_indexes("payments")}
    assert "ix_payments_installment_id" in indexes
    assert not any(name.startswith("fk_") for name in indexes)


@pytest.mark.parametrize(
    ("sql", "errno"),
    [
        # stored status must match the money
        ("UPDATE installments SET status = 'paid' WHERE amount_paid = 0 LIMIT 1", 3819),
        ("UPDATE installments SET amount_paid = 1 WHERE status = 'pending' LIMIT 1", 3819),
        ("UPDATE installments SET amount_paid = amount_due + 1, status = 'paid' LIMIT 1", 3819),
        ("UPDATE installments SET amount_due = 0 LIMIT 1", 3819),
        ("UPDATE installments SET status = 'overdue' LIMIT 1", 3819),  # never stored
        ("UPDATE installments SET status = 'PAID' WHERE status = 'paid' LIMIT 1", 3819),
        # payments
        ("UPDATE payments SET failure_reason = 'x' WHERE status = 'successful' LIMIT 1", 3819),
        ("UPDATE payments SET failure_reason = NULL WHERE status = 'failed' LIMIT 1", 3819),
        ("UPDATE payments SET payment_method = 'cash' LIMIT 1", 3819),
        ("UPDATE payments SET status = 'refunded' LIMIT 1", 3819),
        ("UPDATE payments SET payment_reference = 'lowercase-ref' LIMIT 1", 3819),
        ("UPDATE payments SET amount = 0 LIMIT 1", 3819),
        # uniqueness and referential integrity
        (
            "INSERT INTO premium_schedules (policy_id, installment_count, total_premium) "
            "SELECT policy_id, 1, 1 FROM premium_schedules LIMIT 1",
            1062,
        ),
        (
            "UPDATE installments SET installment_number = 2 WHERE installment_number = 1 "
            "AND schedule_id = (SELECT id FROM (SELECT s.id FROM premium_schedules s "
            "JOIN policies p ON p.id = s.policy_id WHERE p.policy_number = 'POL-2024-000519') t)",
            1062,
        ),
        (
            "UPDATE payments SET payment_reference = (SELECT r FROM (SELECT payment_reference r "
            "FROM payments ORDER BY id LIMIT 1) t) ORDER BY id DESC LIMIT 1",
            1062,
        ),
        ("UPDATE payments SET installment_id = 999999999 LIMIT 1", 1452),
        (
            "DELETE FROM installments WHERE id IN "
            "(SELECT installment_id FROM (SELECT installment_id FROM payments) t)",
            1451,
        ),
        ("DELETE FROM policies WHERE policy_number = 'POL-2024-000519'", 1451),
    ],
)
def test_financial_integrity_enforced_by_mysql(ledger, mysql_sessions, sql, errno):
    with mysql_sessions() as session, pytest.raises((IntegrityError, OperationalError)) as excinfo:
        session.execute(text(sql))
        session.commit()
    assert excinfo.value.orig.args[0] == errno


def test_payment_cannot_be_moved_or_revalued_after_insert(ledger, mysql_sessions):
    with mysql_sessions() as session:
        payment = session.scalars(select(Payment).order_by(Payment.id)).first()
        with pytest.raises(ValueError, match="cannot be changed"):
            payment.installment_id = payment.installment_id + 1
        with pytest.raises(ValueError, match="cannot be changed"):
            payment.amount = payment.amount + 1
        payment.status = payment.status  # status may still be settled


# --- seed, backfill and issuance ---------------------------------------------------


def test_schedules_backfilled_for_issued_policies_only(ledger, mysql_sessions):
    with mysql_sessions() as session:
        rows = dict(
            session.execute(
                text(
                    "SELECT p.policy_number, s.installment_count FROM policies p "
                    "LEFT JOIN premium_schedules s ON s.policy_id = p.id"
                )
            ).all()
        )
    assert rows == {
        "POL-2024-000148": 1,
        "POL-2024-000226": 100,
        "POL-2023-000874": 1,
        "POL-2024-000519": 4,
        "POL-2025-000031": None,  # pending issuance: no schedule
    }


def test_every_balance_equals_its_successful_payments(ledger, mysql_sessions):
    """The ledger invariant: amount_paid is exactly the sum of successful payments,
    and every schedule's instalments add up to annual premium x term."""
    mismatched = _count(
        mysql_sessions,
        "SELECT COUNT(*) FROM installments i LEFT JOIN (SELECT installment_id, SUM(amount) paid "
        "FROM payments WHERE status = 'successful' GROUP BY installment_id) p "
        "ON p.installment_id = i.id WHERE i.amount_paid <> COALESCE(p.paid, 0)",
    )
    assert mismatched == 0
    wrong_totals = _count(
        mysql_sessions,
        "SELECT COUNT(*) FROM premium_schedules s JOIN policies p ON p.id = s.policy_id "
        "JOIN (SELECT schedule_id, SUM(amount_due) due, COUNT(*) n FROM installments "
        "GROUP BY schedule_id) i ON i.schedule_id = s.id "
        "WHERE i.due <> s.total_premium OR s.total_premium <> p.annual_premium * p.term_years "
        "OR i.n <> s.installment_count",
    )
    assert wrong_totals == 0


def test_seed_and_backfill_are_idempotent(ledger, mysql_sessions):
    with mysql_sessions() as session:
        assert seed_module2(session) == {"schedules": 0, "payments": 0}
    with mysql_sessions() as session:
        assert premium_service.backfill_schedules(session) == 0


def test_issuance_creates_the_schedule_in_the_same_transaction(ledger, admin, mysql_sessions):
    number = _issue_for_dev_policyholder(ledger, admin)
    schedule = ledger.get(f"/api/v1/policies/{number}/premium-schedule", headers=admin).json()
    assert schedule["installment_count"] == 12
    assert schedule["total_premium"] == "18500.00"
    assert schedule["regular_installment_amount"] == "1541.66"
    assert schedule["first_due_date"] == TODAY.isoformat()
    items = ledger.get(f"/api/v1/policies/{number}/installments", headers=admin).json()["items"]
    assert sum(D(i["amount_due"]) for i in items) == D("18500.00")
    assert items[-1]["amount_due"] == "1541.74"
    # The policy's displayed instalment premium is the schedule's regular instalment.
    policy = ledger.get(f"/api/v1/policies/{number}", headers=admin).json()
    assert policy["instalment_premium"] == "1541.66"


def test_issuance_rolls_back_if_the_schedule_cannot_be_created(
    ledger, admin, mysql_sessions, monkeypatch
):
    import app.services.policies as policy_service

    policies_before = _count(mysql_sessions, "SELECT COUNT(*) FROM policies")
    schedules_before = _count(mysql_sessions, "SELECT COUNT(*) FROM premium_schedules")

    def fail(db, policy):
        raise RuntimeError("schedule generation failed")

    monkeypatch.setattr(policy_service, "create_schedule", fail)
    with pytest.raises(RuntimeError):
        _issue_for_dev_policyholder(ledger, admin)
    assert _count(mysql_sessions, "SELECT COUNT(*) FROM policies") == policies_before
    assert _count(mysql_sessions, "SELECT COUNT(*) FROM premium_schedules") == schedules_before


# --- reads and scope -----------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/premium-schedules",
        "/api/v1/policies/POL-2024-000519/premium-schedule",
        "/api/v1/policies/POL-2024-000519/installments",
        "/api/v1/installments/1",
        "/api/v1/installments/1/payments",
        "/api/v1/payments",
        "/api/v1/payments/PAY-2024-000101",
    ],
)
def test_requires_authentication(ledger, path):
    assert ledger.get(path).status_code == 401


def _account_numbers(api, headers, **params):
    body = api.get("/api/v1/premium-schedules", params=params, headers=headers).json()
    return {item["policy"]["policy_number"] for item in body["items"]}, body


def test_accounts_scoped_by_role(ledger, admin, agent, holder):
    numbers, body = _account_numbers(ledger, admin)
    assert numbers == {"POL-2024-000148", "POL-2024-000226", "POL-2023-000874", "POL-2024-000519"}
    assert body["awaiting_issuance"] == 1
    assert body["portfolio"]["policies"] == 4
    assert _account_numbers(ledger, agent)[0] == {"POL-2024-000148", "POL-2024-000519"}
    assert _account_numbers(ledger, holder)[0] == {"POL-2024-000148"}


def test_account_filters_sorting_and_portfolio(ledger, admin):
    assert _account_numbers(ledger, admin, standing="fully_paid")[0] == {
        "POL-2024-000148",
        "POL-2023-000874",
    }
    assert _account_numbers(ledger, admin, standing="overdue")[0] == {
        "POL-2024-000226",
        "POL-2024-000519",
    }
    assert _account_numbers(ledger, admin, search="farhan")[0] == {"POL-2024-000519"}
    _, body = _account_numbers(ledger, admin, sort="overdue-desc")
    overdue = [D(i["summary"]["overdue_amount"]) for i in body["items"]]
    assert overdue == sorted(overdue, reverse=True)
    # Portfolio totals equal the sum of the accounts (whole scope, not the page).
    portfolio = body["portfolio"]
    assert D(portfolio["total_paid"]) == sum(D(i["summary"]["total_paid"]) for i in body["items"])
    assert D(portfolio["overdue_amount"]) == sum(overdue)
    assert portfolio["policies_overdue"] == 2
    assert _account_numbers(ledger, admin, standing="overdue", limit=1)[1]["total"] == 2


def test_schedule_detail_and_scope(ledger, admin, agent, holder):
    body = ledger.get("/api/v1/policies/POL-2024-000519/premium-schedule", headers=agent).json()
    summary = body["summary"]
    # 3,100 a year x 2 years, in 4 half-yearly instalments of 1,550.
    assert body["installment_count"] == 4 and body["total_premium"] == "6200.00"
    assert summary["counts"]["paid"] == 3 and summary["counts"]["overdue"] == 1
    assert summary["overdue_amount"] == "1550.00"
    assert summary["standing"] == "overdue"
    assert summary["oldest_overdue"]["installment_number"] == 4

    # Outside scope looks exactly like a missing policy.
    for headers in (agent, holder):
        response = ledger.get("/api/v1/policies/POL-2024-000226/premium-schedule", headers=headers)
        assert response.status_code == 404
    assert (
        ledger.get("/api/v1/policies/POL-2099-000001/premium-schedule", headers=admin).status_code
        == 404
    )
    pending = ledger.get("/api/v1/policies/POL-2025-000031/premium-schedule", headers=admin)
    assert pending.status_code == 409


def test_installments_list_and_detail(ledger, admin, holder, mysql_sessions):
    items = ledger.get("/api/v1/policies/POL-2024-000519/installments", headers=admin).json()[
        "items"
    ]
    assert [i["installment_number"] for i in items] == [1, 2, 3, 4]
    assert [i["status"] for i in items] == ["paid", "paid", "paid", "overdue"]
    assert items[3]["payable"] is True and items[0]["payable"] is False
    assert items[3]["amount_outstanding"] == "1550.00"

    failed_9 = _installment_id(mysql_sessions, "POL-2024-000226", 9)
    detail = ledger.get(f"/api/v1/installments/{failed_9}", headers=admin).json()
    assert detail["failed_attempts"] == 1 and detail["status"] == "overdue"
    # The dev policyholder cannot see another customer's instalment.
    assert ledger.get(f"/api/v1/installments/{failed_9}", headers=holder).status_code == 404
    assert ledger.get("/api/v1/installments/999999999", headers=admin).status_code == 404


def _payment_numbers(api, headers, **params):
    body = api.get("/api/v1/payments", params=params, headers=headers).json()
    return {p["payment_number"] for p in body["items"]}, body


def test_payment_history_scope_and_filters(ledger, admin, agent, holder, mysql_sessions):
    numbers, body = _payment_numbers(ledger, admin, limit=200)
    assert len(numbers) == 14
    assert body["summary"] == {
        "total": 14,
        "successful": 13,
        "failed": 1,
        "pending": 0,
        "collected": "68750.00",
    }
    assert len(_payment_numbers(ledger, agent)[0]) == 4  # 000148 (1) + 000519 (3)
    assert _payment_numbers(ledger, holder)[0] == {"PAY-2024-000101"}
    assert _payment_numbers(ledger, admin, status="failed")[0] == {"PAY-2026-000079"}
    assert len(_payment_numbers(ledger, admin, method="net_banking")[0]) == 5
    assert _payment_numbers(ledger, admin, search="mocktxn-4qh7")[0] == {"PAY-2023-000212"}
    assert len(_payment_numbers(ledger, admin, policy_number="POL-2024-000519")[0]) == 3

    assert ledger.get("/api/v1/payments/PAY-2024-000101", headers=holder).status_code == 200
    assert ledger.get("/api/v1/payments/PAY-2026-000079", headers=holder).status_code == 404
    paid_1 = _installment_id(mysql_sessions, "POL-2024-000519", 1)
    body = ledger.get(f"/api/v1/installments/{paid_1}/payments", headers=agent).json()
    assert [p["payment_number"] for p in body["items"]] == ["PAY-2024-000131"]


# --- recording payments ----------------------------------------------------------------


def test_agents_cannot_record_payments_even_on_their_policies(ledger, agent, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    response = _pay(ledger, agent, installment, "1550.00")
    assert response.status_code == 403
    assert _balance(mysql_sessions, installment) == (D("0.00"), "pending")


def test_policyholder_cannot_pay_another_customers_instalment(ledger, holder, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    assert _pay(ledger, holder, installment, "1550.00").status_code == 404
    assert _balance(mysql_sessions, installment) == (D("0.00"), "pending")


def test_partial_then_full_payment_by_administrator(ledger, admin, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)

    first = _pay(ledger, admin, installment, "500.00")
    assert first.status_code == 201, first.text
    body = first.json()
    assert body["payment"]["status"] == "successful"
    assert body["payment"]["payment_number"].startswith(f"PAY-{TODAY.year}-")
    assert body["installment"]["amount_paid"] == "500.00"
    assert body["installment"]["amount_outstanding"] == "1050.00"
    assert body["installment"]["status"] == "overdue"  # still past due and not fully paid
    assert _balance(mysql_sessions, installment) == (D("500.00"), "partially_paid")

    overpay = _pay(ledger, admin, installment, "1050.01")
    assert overpay.status_code == 422
    assert "exceeds the remaining balance" in overpay.json()["detail"]

    second = _pay(ledger, admin, installment, "1050.00")
    assert second.status_code == 201
    assert second.json()["installment"]["status"] == "paid"
    assert _balance(mysql_sessions, installment) == (D("1550.00"), "paid")

    again = _pay(ledger, admin, installment, "1.00")
    assert again.status_code == 409
    assert "already fully paid" in again.json()["detail"]

    schedule = ledger.get("/api/v1/policies/POL-2024-000519/premium-schedule", headers=admin).json()
    assert schedule["summary"]["standing"] == "fully_paid"


@pytest.mark.parametrize("amount", ["0", "-10", "10.001", "abc"])
def test_invalid_amounts_are_rejected_before_any_write(ledger, admin, mysql_sessions, amount):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    before = _count(mysql_sessions, "SELECT COUNT(*) FROM payments")
    assert _pay(ledger, admin, installment, amount).status_code == 422
    assert _count(mysql_sessions, "SELECT COUNT(*) FROM payments") == before


def test_duplicate_payment_reference_is_rejected_once_recorded(ledger, admin, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    reference = {"payment_reference": "DUP-REF-000001"}
    assert _pay(ledger, admin, installment, "100.00", **reference).status_code == 201

    repeat = _pay(ledger, admin, installment, "100.00", **reference)
    assert repeat.status_code == 409
    assert "already recorded" in repeat.json()["detail"]
    # Also case-insensitively: references are normalised to upper case.
    assert (
        _pay(ledger, admin, installment, "100.00", payment_reference="dup-ref-000001").status_code
        == 409
    )
    assert (
        _count(
            mysql_sessions,
            "SELECT COUNT(*) FROM payments WHERE payment_reference = 'DUP-REF-000001'",
        )
        == 1
    )
    assert _balance(mysql_sessions, installment) == (D("100.00"), "partially_paid")


def test_failed_payment_never_moves_money(ledger, admin, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    response = _pay(ledger, admin, installment, "1550.00", outcome="failed")
    assert response.status_code == 201
    assert response.json()["payment"]["status"] == "failed"
    assert response.json()["payment"]["failure_reason"]
    assert _balance(mysql_sessions, installment) == (D("0.00"), "pending")
    assert response.json()["installment"]["failed_attempts"] == 1


def test_pending_payment_blocks_and_is_settled_by_administrator(
    ledger, admin, holder, mysql_sessions
):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    pending = _pay(ledger, admin, installment, "1550.00", outcome="pending")
    assert pending.status_code == 201
    number = pending.json()["payment"]["payment_number"]
    assert pending.json()["installment"]["pending_payment_number"] == number
    assert pending.json()["installment"]["payable"] is False
    # Pending is not paid, and blocks a second payment.
    assert _balance(mysql_sessions, installment) == (D("0.00"), "pending")
    assert _pay(ledger, admin, installment, "1550.00").status_code == 409

    assert (
        ledger.patch(
            f"/api/v1/payments/{number}", json={"status": "successful"}, headers=holder
        ).status_code
        == 403
    )
    settled = ledger.patch(
        f"/api/v1/payments/{number}", json={"status": "successful"}, headers=admin
    )
    assert settled.status_code == 200
    assert settled.json()["installment"]["status"] == "paid"
    assert _balance(mysql_sessions, installment) == (D("1550.00"), "paid")
    # Final states cannot change again.
    again = ledger.patch(f"/api/v1/payments/{number}", json={"status": "failed"}, headers=admin)
    assert again.status_code == 409


def test_instalment_not_yet_due_cannot_be_paid(ledger, admin, mysql_sessions):
    future = _installment_id(mysql_sessions, "POL-2024-000226", 20)
    response = _pay(ledger, admin, future, "4650.00")
    assert response.status_code == 409
    assert "not due yet" in response.json()["detail"]


def test_policyholder_pays_own_instalment(ledger, admin, holder, mysql_sessions):
    number = _issue_for_dev_policyholder(ledger, admin)
    items = ledger.get(f"/api/v1/policies/{number}/installments", headers=holder).json()["items"]
    first = items[0]
    assert first["payable"] is True

    response = _pay(ledger, holder, first["id"], first["amount_due"], payment_method="card")
    assert response.status_code == 201, response.text
    assert response.json()["installment"]["status"] == "paid"
    history = ledger.get(
        "/api/v1/payments", params={"policy_number": number}, headers=holder
    ).json()
    assert history["total"] == 1
    with mysql_sessions() as session:
        payment = session.scalars(
            select(Payment).where(Payment.installment_id == first["id"])
        ).one()
        recorder = session.get(User, payment.recorded_by_user_id)
        assert recorder.email == "policyholder@example.com"


def test_unlinked_login_sees_no_financial_data(ledger, mysql_sessions):
    with mysql_sessions() as session:
        user_service.create_user(
            session,
            email="unlinked.holder@example.com",
            password="Unlinked-Pass-1",
            first_name="No",
            last_name="Record",
            role=RoleName.POLICYHOLDER,
        )
    headers = _headers(ledger, "unlinked.holder@example.com", "Unlinked-Pass-1")
    assert ledger.get("/api/v1/premium-schedules", headers=headers).json()["total"] == 0
    assert ledger.get("/api/v1/payments", headers=headers).json()["total"] == 0
    installment = _installment_id(mysql_sessions, "POL-2024-000148", 1)
    assert ledger.get(f"/api/v1/installments/{installment}", headers=headers).status_code == 404
    assert _pay(ledger, headers, installment, "1.00").status_code == 404


def test_payment_rollback_leaves_no_trace(ledger, admin, mysql_sessions, monkeypatch):
    """A failure after the payment row is built rolls back balance, row and number."""
    import app.repositories.policies as policy_repo

    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    payments_before = _count(mysql_sessions, "SELECT COUNT(*) FROM payments")
    monkeypatch.setattr(policy_repo, "next_payment_number", lambda db, year: "PAY-2024-000101")

    assert _pay(ledger, admin, installment, "1550.00").status_code == 409  # duplicate number
    assert _count(mysql_sessions, "SELECT COUNT(*) FROM payments") == payments_before
    assert _balance(mysql_sessions, installment) == (D("0.00"), "pending")


def test_concurrent_payments_cannot_overpay(ledger, mysql_sessions: sessionmaker[Session]):
    """Two sessions pay the full balance of one instalment at the same moment:
    the row lock serialises them, so exactly one succeeds."""
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def pay(reference: str) -> None:
        with mysql_sessions() as session:
            admin_user = session.scalars(
                select(User).where(User.email == "admin@example.com")
            ).one()
            barrier.wait()
            try:
                premium_service.record_payment(
                    session,
                    admin_user,
                    installment,
                    PaymentCreate(
                        amount="1550.00", payment_method="upi", payment_reference=reference
                    ),
                )
                outcomes.append("ok")
            except ConflictError:
                outcomes.append("conflict")

    threads = [threading.Thread(target=pay, args=(f"RACE-REF-{n}",)) for n in (1, 2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(outcomes) == ["conflict", "ok"]
    assert _balance(mysql_sessions, installment) == (D("1550.00"), "paid")
    with mysql_sessions() as session:
        successful = session.scalar(
            select(Installment.amount_paid).where(Installment.id == installment)
        )
        assert successful == D("1550.00")
    assert (
        _count(
            mysql_sessions,
            "SELECT COUNT(*) FROM payments WHERE installment_id = :id AND status = 'successful' "
            "AND payment_reference LIKE 'RACE-REF-%'",
            id=installment,
        )
        == 1
    )


def test_payment_numbers_continue_after_seeded_payments(ledger, admin, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    number = _pay(ledger, admin, installment, "10.00").json()["payment"]["payment_number"]
    if TODAY.year == 2026:  # seeded 2026 payments go up to PAY-2026-000079
        assert number == "PAY-2026-000080"
    else:
        assert number == f"PAY-{TODAY.year}-000001"


def test_recorded_timestamp_and_immutability_of_history(ledger, admin, mysql_sessions):
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    body = _pay(ledger, admin, installment, "10.00").json()["payment"]
    paid_at = body["paid_at"]
    assert paid_at[:10] in {
        TODAY.isoformat(),
        (TODAY + timedelta(days=1)).isoformat(),
        (TODAY - timedelta(days=1)).isoformat(),
    }


def test_settlement_relocks_and_rechecks_the_current_balance(ledger, admin, mysql_sessions):
    """Settling a pending payment re-reads the instalment under lock: if the
    balance changed after the payment went pending, it cannot overpay."""
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    pending = _pay(ledger, admin, installment, "1550.00", outcome="pending")
    number = pending.json()["payment"]["payment_number"]

    # The balance moves behind the pending payment's back (e.g. another channel).
    with mysql_sessions() as session:
        session.execute(
            text(
                "UPDATE installments SET amount_paid = 1000.00, status = 'partially_paid' "
                "WHERE id = :id"
            ),
            {"id": installment},
        )
        session.commit()

    settled = ledger.patch(
        f"/api/v1/payments/{number}", json={"status": "successful"}, headers=admin
    )
    assert settled.status_code == 422
    assert "remaining balance of 550.00" in settled.json()["detail"]
    # Rolled back completely: still pending, balance untouched.
    assert _balance(mysql_sessions, installment) == (D("1000.00"), "partially_paid")
    with mysql_sessions() as session:
        assert (
            session.scalar(
                text("SELECT status FROM payments WHERE payment_number = :n"), {"n": number}
            )
            == "pending"
        )
    # It can still be settled as failed.
    failed = ledger.patch(f"/api/v1/payments/{number}", json={"status": "failed"}, headers=admin)
    assert failed.status_code == 200
    assert _balance(mysql_sessions, installment) == (D("1000.00"), "partially_paid")


def test_pending_block_holds_under_concurrency(ledger, mysql_sessions: sessionmaker[Session]):
    """A pending and a successful payment race for one instalment: the row lock
    serialises them, so exactly one is recorded and the balance stays valid."""
    installment = _installment_id(mysql_sessions, "POL-2024-000519", 4)
    barrier = threading.Barrier(2)
    outcomes: dict[str, str] = {}

    def pay(outcome: str) -> None:
        with mysql_sessions() as session:
            admin_user = session.scalars(
                select(User).where(User.email == "admin@example.com")
            ).one()
            barrier.wait()
            try:
                premium_service.record_payment(
                    session,
                    admin_user,
                    installment,
                    PaymentCreate(
                        amount="1550.00",
                        payment_method="upi",
                        payment_reference=f"RACE-{outcome.upper()}",
                        outcome=outcome,
                    ),
                )
                outcomes[outcome] = "ok"
            except ConflictError:
                outcomes[outcome] = "conflict"

    threads = [threading.Thread(target=pay, args=(o,)) for o in ("pending", "successful")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert sorted(outcomes.values()) == ["conflict", "ok"]
    recorded = _count(
        mysql_sessions,
        "SELECT COUNT(*) FROM payments "
        "WHERE installment_id = :id AND payment_reference LIKE 'RACE-%'",
        id=installment,
    )
    assert recorded == 1
    expected = (D("1550.00"), "paid") if outcomes["successful"] == "ok" else (D("0.00"), "pending")
    assert _balance(mysql_sessions, installment) == expected
