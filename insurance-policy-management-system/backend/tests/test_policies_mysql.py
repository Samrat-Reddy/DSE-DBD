"""Module 1 (Policy Catalog & Issuance) against real MySQL.

Each test starts from the development seed (the frontend's own mock data):
7 products, 4 agents, 5 customers, 5 policies, and the three dev logins with
agent@example.com linked to AGT-2207 and policyholder@example.com to CUS-100241.
"""

import json
import threading
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.models import Agent, Customer, Policy, Product, RoleName, User
from app.repositories import policies as policy_repo
from app.schemas.policies import PolicyIssueRequest
from app.scripts.seed_dev_data import SEED_FILE, seed_module1
from app.scripts.seed_dev_users import DEV_PASSWORD, seed_dev_users
from app.services import policies as policy_service
from app.services import users as user_service

pytestmark = pytest.mark.mysql

TODAY = date.today()
YEAR = TODAY.year
SEED = json.loads(SEED_FILE.read_text(encoding="utf-8"))
AGENT_2207_POLICIES = {"POL-2024-000148", "POL-2024-000519"}
ALL_SEED_POLICIES = {p["policy_number"] for p in SEED["policies"]}


@pytest.fixture
def seeded(mysql_api, mysql_sessions: sessionmaker[Session]):
    with mysql_sessions() as session:
        seed_dev_users(session)
    with mysql_sessions() as session:
        created = seed_module1(session)
    assert created == {"products": 7, "agents": 4, "customers": 5, "policies": 5, "links": 2}
    return mysql_api


def _headers(api, email: str, password: str = DEV_PASSWORD) -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture
def admin(seeded):
    return _headers(seeded, "admin@example.com")


@pytest.fixture
def agent(seeded):
    return _headers(seeded, "agent@example.com")


@pytest.fixture
def holder(seeded):
    return _headers(seeded, "policyholder@example.com")


def _count(sessions, table: str) -> int:
    with sessions() as session:
        return session.scalar(text(f"SELECT COUNT(*) FROM {table}"))  # noqa: S608


def _issue_body(**overrides) -> dict:
    body = {
        "product_code": "PRD-HLT-001",
        "policyholder": {
            "full_name": "Kavya Rao",
            "date_of_birth": "1992-03-15",
            "email": "Kavya.Rao@example.com",
            "phone": "+91 98860 11223",
            "address_line1": "22 Residency Road",
            "address_line2": "",
            "city": "Bengaluru",
            "state": "Karnataka",
            "postal_code": "560025",
        },
        "coverage_amount": "1500000",
        "start_date": (TODAY + timedelta(days=7)).isoformat(),
        "term_years": 2,
        "premium_frequency": "monthly",
        "nominee": {"name": "Arun Rao", "relationship": "Spouse", "date_of_birth": "1990-08-01"},
    }
    body.update(overrides)
    return body


# --- schema ---------------------------------------------------------------------


def test_module1_tables_and_constraints_exist(mysql_engine: Engine):
    inspector = inspect(mysql_engine)
    tables = set(inspector.get_table_names())
    assert {
        "products",
        "product_term_options",
        "product_premium_frequencies",
        "product_features",
        "agents",
        "customers",
        "policies",
        "id_sequences",
    } <= tables
    # Modules 4-6 tables also exist.
    assert {"reminders", "commissions", "report_access_log"} <= tables

    fks = {fk["name"]: fk["referred_table"] for fk in inspector.get_foreign_keys("policies")}
    assert fks == {
        "fk_policies_product_id_products": "products",
        "fk_policies_customer_id_customers": "customers",
        "fk_policies_agent_id_agents": "agents",
        "fk_policies_issued_by_user_id_users": "users",
    }
    uniques = {u["name"] for u in inspector.get_unique_constraints("policies")}
    assert uniques == {
        "uq_policies_policy_number",
        "uq_policies_customer_id_product_id_start_date",
    }
    checks = {c["name"] for c in inspector.get_check_constraints("policies")}
    assert {
        "ck_policies_status_allowed",
        "ck_policies_frequency_allowed",
        "ck_policies_issued_has_issue_date",
        "ck_policies_issue_before_start",
        "ck_policies_nominee_relationship_allowed",
    } <= checks
    assert {u["name"] for u in inspector.get_unique_constraints("agents")} == {
        "uq_agents_agent_code",
        "uq_agents_email",
        "uq_agents_user_id",
    }


def test_seed_is_idempotent_and_end_dates_are_generated(seeded, mysql_sessions):
    with mysql_sessions() as session:
        assert seed_module1(session) == {
            k: 0 for k in ("products", "agents", "customers", "policies", "links")
        }
        end_dates = dict(session.execute(select(Policy.policy_number, Policy.end_date)).all())
    # MySQL's generated end_date matches the frontend's calculateEndDate for every seed policy.
    assert end_dates == {
        p["policy_number"]: date.fromisoformat(p["expected_end_date"]) for p in SEED["policies"]
    }


def test_dev_logins_are_linked_to_business_records(seeded, mysql_sessions):
    with mysql_sessions() as session:
        agent = session.scalars(select(Agent).where(Agent.agent_code == "AGT-2207")).one()
        customer = session.scalars(
            select(Customer).where(Customer.customer_code == "CUS-100241")
        ).one()
        assert agent.user_id is not None and customer.user_id is not None
        assert session.scalar(select(Agent).where(Agent.agent_code == "AGT-1184")).user_id is None


# --- database constraints -----------------------------------------------------


def _errno(excinfo) -> int:
    return excinfo.value.orig.args[0]


def _insert_policy(session: Session, **overrides) -> None:
    values = {
        "policy_number": f"POL-{YEAR}-900001",
        "product_id": session.scalar(select(Product.id).where(Product.code == "PRD-HLT-001")),
        "customer_id": session.scalar(
            select(Customer.id).where(Customer.customer_code == "CUS-100241")
        ),
        "status": "active",
        "coverage_amount": 1000000,
        "annual_premium": 18500,
        "premium_frequency": "annual",
        "term_years": 1,
        "issue_date": TODAY,
        "start_date": TODAY + timedelta(days=400),
        "nominee_name": "Nominee",
        "nominee_relationship": "Spouse",
        "nominee_date_of_birth": date(1990, 1, 1),
    }
    values.update(overrides)
    columns = ", ".join(values)
    params = ", ".join(f":{name}" for name in values)
    session.execute(text(f"INSERT INTO policies ({columns}) VALUES ({params})"), values)  # noqa: S608
    session.commit()


@pytest.mark.parametrize(
    ("overrides", "errno"),
    [
        ({"status": "lapsed"}, 3819),  # later-module status not allowed yet
        ({"status": "ACTIVE"}, 3819),
        ({"premium_frequency": "weekly"}, 3819),
        ({"nominee_relationship": "Cousin"}, 3819),
        ({"coverage_amount": 0}, 3819),
        ({"term_years": 0}, 3819),
        ({"issue_date": None}, 3819),  # active policy without an issue date
        ({"policy_number": "POL-26-1"}, 3819),
        ({"product_id": 999_999}, 1452),  # FK
        ({"customer_id": 999_999}, 1452),  # FK
        ({"policy_number": "POL-2024-000148"}, 1062),  # unique policy number
    ],
    ids=lambda v: str(v),
)
def test_policy_constraints_enforced_by_mysql(seeded, mysql_sessions, overrides, errno):
    with mysql_sessions() as session, pytest.raises((IntegrityError, OperationalError)) as excinfo:
        _insert_policy(session, **overrides)
    assert _errno(excinfo) == errno


def test_pending_policy_may_lack_issue_date(seeded, mysql_sessions):
    with mysql_sessions() as session:
        _insert_policy(session, status="pending", issue_date=None)


def test_duplicate_proposal_rejected_by_unique_key(seeded, mysql_sessions):
    with mysql_sessions() as session:
        _insert_policy(session)
        with pytest.raises(IntegrityError) as excinfo:
            _insert_policy(session, policy_number=f"POL-{YEAR}-900002")
    assert _errno(excinfo) == 1062
    assert "uq_policies_customer_id_product_id_start_date" in str(excinfo.value.orig)


@pytest.mark.parametrize(
    ("sql", "errno"),
    [
        ("UPDATE products SET code = 'PRD-LIF-002' WHERE code = 'PRD-HLT-001'", 1062),
        ("UPDATE products SET product_type = 'travel' WHERE code = 'PRD-HLT-001'", 3819),
        ("UPDATE products SET status = 'retired' WHERE code = 'PRD-HLT-001'", 3819),
        # Binary collation: case variants of codes and controlled values are rejected.
        ("UPDATE products SET code = 'prd-hlt-001' WHERE code = 'PRD-HLT-001'", 3819),
        ("UPDATE products SET status = 'ACTIVE' WHERE code = 'PRD-HLT-001'", 3819),
        ("UPDATE products SET min_coverage_amount = 99999999 WHERE code = 'PRD-HLT-001'", 3819),
        ("DELETE FROM products WHERE code = 'PRD-HLT-001'", 1451),  # policies depend on it
        ("DELETE FROM customers WHERE customer_code = 'CUS-100241'", 1451),
        ("UPDATE customers SET phone = '12345' WHERE customer_code = 'CUS-100241'", 3819),
        (
            "INSERT INTO product_term_options VALUES "
            "((SELECT id FROM products WHERE code='PRD-HLT-001'), 1)",
            1062,
        ),
        (
            "INSERT INTO product_features (product_id, kind, position, content) "
            "VALUES ((SELECT id FROM products WHERE code='PRD-HLT-001'), 'coverage_item', 99, 'x')",
            3819,  # coverage items must carry a limit
        ),
    ],
)
def test_catalog_and_party_constraints(seeded, mysql_sessions, sql, errno):
    with mysql_sessions() as session, pytest.raises((IntegrityError, OperationalError)) as excinfo:
        session.execute(text(sql))
        session.commit()
    assert _errno(excinfo) == errno


def test_a_login_can_link_to_only_one_agent(seeded, mysql_sessions):
    with mysql_sessions() as session, pytest.raises(IntegrityError) as excinfo:
        session.execute(
            text(
                "UPDATE agents SET user_id = (SELECT user_id FROM (SELECT user_id FROM agents "
                "WHERE agent_code = 'AGT-2207') AS linked) WHERE agent_code = 'AGT-1184'"
            )
        )
        session.commit()
    assert _errno(excinfo) == 1062


# --- identifier generation ------------------------------------------------------


def test_numbers_continue_after_existing_records_and_roll_back(seeded, mysql_sessions):
    with mysql_sessions() as session:
        assert policy_repo.next_policy_number(session, 2024) == "POL-2024-000520"
        assert policy_repo.next_customer_code(session) == "CUS-100631"
        session.rollback()  # the increments are undone with the transaction
    with mysql_sessions() as session:
        assert policy_repo.next_policy_number(session, 2024) == "POL-2024-000520"
        assert policy_repo.next_policy_number(session, 2024) == "POL-2024-000521"
        assert policy_repo.next_policy_number(session, 2031) == "POL-2031-000001"
        session.commit()


def test_concurrent_issuance_gets_unique_numbers_without_deadlock(seeded, mysql_sessions):
    """Numbering locks only the counter row, so concurrent issuers queue on it
    instead of deadlocking over the policies/customers indexes they scan."""
    barrier = threading.Barrier(4)
    outcomes: list[str] = []

    def issue(n: int) -> None:
        holder = {
            **_issue_body()["policyholder"],
            "full_name": f"Concurrent Holder {chr(65 + n)}",
            "email": f"concurrent.{n}@example.com",
            "phone": f"98860 1100{n}",
        }
        payload = PolicyIssueRequest(**_issue_body(policyholder=holder))
        with mysql_sessions() as session:
            user = session.scalars(select(User).where(User.email == "agent@example.com")).one()
            barrier.wait()
            try:
                result = policy_service.issue_policy(session, user, payload)
                outcomes.append(result.policy_number)
            except Exception as error:
                outcomes.append(f"failed {type(error).__name__}: {error}")

    threads = [threading.Thread(target=issue, args=(n,)) for n in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)
    assert all(o.startswith("POL-") for o in outcomes), outcomes
    assert len(set(outcomes)) == 4


# --- catalog API --------------------------------------------------------------


def test_catalog_requires_authentication(seeded):
    assert seeded.get("/api/v1/products").status_code == 401
    assert seeded.get("/api/v1/products/PRD-HLT-001").status_code == 401


def test_catalog_list_with_summary(seeded, holder):
    body = seeded.get("/api/v1/products", headers=holder).json()
    assert body["total"] == 7
    assert body["summary"] == {"total": 7, "active": 5, "inactive": 2}
    names = [p["name"] for p in body["items"]]
    assert names == sorted(names)


@pytest.mark.parametrize(
    ("params", "codes"),
    [
        ({"search": "health"}, ["PRD-HLT-001", "PRD-HLT-006"]),
        ({"search": "accident"}, ["PRD-ACC-004"]),  # matches the type label
        ({"search": "prd-mot"}, ["PRD-MOT-003"]),
        ({"search": "%"}, []),  # wildcards are escaped
        ({"type": "life", "status": "active"}, ["PRD-LIF-002"]),
        ({"status": "inactive", "sort": "premium-desc"}, ["PRD-LIF-007", "PRD-HLT-006"]),
        ({"sort": "premium-asc", "limit": 2}, ["PRD-ACC-004", "PRD-HOM-005"]),
        ({"sort": "premium-asc", "limit": 2, "offset": 2}, ["PRD-LIF-002", "PRD-MOT-003"]),
        ({"sort": "coverage-desc", "limit": 1}, ["PRD-LIF-002"]),
    ],
)
def test_catalog_search_filter_sort(seeded, admin, params, codes):
    body = seeded.get("/api/v1/products", params=params, headers=admin).json()
    assert [p["code"] for p in body["items"]] == codes


def test_catalog_rejects_unknown_filter_values(seeded, admin):
    for params in ({"type": "travel"}, {"sort": "random"}, {"limit": 1000}):
        assert seeded.get("/api/v1/products", params=params, headers=admin).status_code == 422


def test_product_detail(seeded, agent):
    body = seeded.get("/api/v1/products/PRD-LIF-002", headers=agent).json()
    assert body["type"] == "life"
    assert body["base_annual_premium"] == "12400.00"
    assert body["term_options"] == [10, 15, 20, 25, 30]
    assert body["premium_frequencies"] == ["monthly", "quarterly", "half_yearly", "annual"]
    source = next(p for p in SEED["products"] if p["code"] == "PRD-LIF-002")
    assert body["benefits"] == source["benefits"]
    assert body["coverage_items"] == source["coverage_items"]
    assert body["eligibility_criteria"] == source["eligibility_criteria"]
    assert seeded.get("/api/v1/products/PRD-XXX-999", headers=agent).status_code == 404


# --- policy scope ----------------------------------------------------------------


def _numbers(api, headers, **params) -> set[str]:
    response = api.get("/api/v1/policies", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return {p["policy_number"] for p in response.json()["items"]}


def test_policy_list_is_scoped_by_role(seeded, admin, agent, holder):
    assert _numbers(seeded, admin) == ALL_SEED_POLICIES
    assert _numbers(seeded, agent) == AGENT_2207_POLICIES
    assert _numbers(seeded, holder) == {"POL-2024-000148"}
    assert seeded.get("/api/v1/policies").status_code == 401


def test_filters_narrow_but_never_widen_scope(seeded, admin, agent, holder):
    assert _numbers(seeded, admin, status="pending") == {"POL-2025-000031"}
    assert _numbers(seeded, admin, product_code="PRD-HLT-001") == {"POL-2024-000148"}
    assert _numbers(seeded, admin, search="vikram") == {"POL-2024-000226"}
    assert _numbers(seeded, admin, agent_code="AGT-2207") == AGENT_2207_POLICIES
    # An agent searching for another agent's customer finds nothing.
    assert _numbers(seeded, agent, search="vikram") == set()
    assert _numbers(seeded, holder, product_code="PRD-LIF-002") == set()
    # Only administrators may filter by agent.
    for headers in (agent, holder):
        response = seeded.get(
            "/api/v1/policies", params={"agent_code": "AGT-1184"}, headers=headers
        )
        assert response.status_code == 403


def test_policy_list_pagination(seeded, admin):
    body = seeded.get(
        "/api/v1/policies", params={"limit": 2, "sort": "oldest"}, headers=admin
    ).json()
    assert body["total"] == 5 and body["limit"] == 2 and len(body["items"]) == 2
    rest = seeded.get(
        "/api/v1/policies", params={"limit": 2, "offset": 2, "sort": "oldest"}, headers=admin
    ).json()
    assert not {p["policy_number"] for p in body["items"]} & {
        p["policy_number"] for p in rest["items"]
    }
    assert seeded.get("/api/v1/policies", params={"limit": 500}, headers=admin).status_code == 422


def test_policy_detail_respects_ownership(seeded, admin, agent, holder):
    detail = seeded.get("/api/v1/policies/POL-2024-000148", headers=holder)
    assert detail.status_code == 200
    body = detail.json()
    assert body["policyholder"]["customer_code"] == "CUS-100241"
    assert body["agent"]["agent_code"] == "AGT-2207"
    assert body["instalment_premium"] == "18500.00"
    assert body["end_date"] == "2025-04-14"
    assert [e["stage"] for e in body["lifecycle"]] == [
        "Policy issued",
        "Cover starts",
        "Cover ends",
    ]

    # Another agent's / customer's policy is indistinguishable from a missing one.
    missing = seeded.get("/api/v1/policies/POL-2099-999999", headers=agent).json()
    for headers in (agent, holder):
        response = seeded.get("/api/v1/policies/POL-2024-000226", headers=headers)
        assert response.status_code == 404
        assert response.json()["code"] == missing["code"] == "not_found"
    assert seeded.get("/api/v1/policies/POL-2024-000226", headers=admin).status_code == 200


def test_login_without_linked_record_sees_nothing_and_cannot_issue(seeded, mysql_sessions):
    with mysql_sessions() as session:
        user_service.create_user(
            session,
            email="unlinked.agent@example.com",
            password="Unlinked-Pass-1",
            first_name="No",
            last_name="Record",
            role=RoleName.AGENT,
        )
    headers = _headers(seeded, "unlinked.agent@example.com", "Unlinked-Pass-1")
    assert _numbers(seeded, headers) == set()
    assert seeded.get("/api/v1/policies/POL-2024-000148", headers=headers).status_code == 404
    response = seeded.post("/api/v1/policies", json=_issue_body(), headers=headers)
    assert response.status_code == 403


# --- issuance ---------------------------------------------------------------------


def test_agent_issues_policy_for_new_customer(seeded, agent, holder, mysql_sessions):
    response = seeded.post("/api/v1/policies", json=_issue_body(), headers=agent)
    assert response.status_code == 201, response.text
    body = response.json()

    assert body["policy_number"] == f"POL-{YEAR}-000001"
    assert body["status"] == "active"
    assert body["issue_date"] == TODAY.isoformat()
    assert body["agent"]["agent_code"] == "AGT-2207"
    assert body["policyholder"]["customer_code"] == "CUS-100631"
    assert body["policyholder"]["phone"] == "9886011223"
    assert body["policyholder"]["email"] == "kavya.rao@example.com"
    assert body["policyholder"]["address"]["line2"] is None
    # Rated by the backend: 18,500 x 1.5 = 27,750 a year.
    assert body["annual_premium"] == "27750.00"
    # 27,750 / 12 = 2,312.50 exactly: the regular instalment of the schedule.
    assert body["instalment_premium"] == "2312.50"
    start = TODAY + timedelta(days=7)
    assert body["end_date"] == (start.replace(year=start.year + 2) - timedelta(days=1)).isoformat()

    # Now visible to the issuing agent and the administrator, not to the dev policyholder.
    assert body["policy_number"] in _numbers(seeded, agent)
    assert body["policy_number"] not in _numbers(seeded, holder)
    with mysql_sessions() as session:
        policy = policy_repo.get_policy_by_number(session, body["policy_number"])
        assert policy.issued_by_user_id is not None


def test_agent_cannot_issue_on_behalf_of_another_agent(seeded, agent):
    response = seeded.post(
        "/api/v1/policies", json=_issue_body(agent_code="AGT-1184"), headers=agent
    )
    assert response.status_code == 403


def test_administrator_assigns_agent_or_none(seeded, admin):
    with_agent = seeded.post(
        "/api/v1/policies", json=_issue_body(agent_code="AGT-1184"), headers=admin
    )
    assert with_agent.status_code == 201
    assert with_agent.json()["agent"]["agent_code"] == "AGT-1184"

    body = _issue_body()
    body["policyholder"] = {**body["policyholder"], "full_name": "Second Customer"}
    without = seeded.post("/api/v1/policies", json=body, headers=admin)
    assert without.status_code == 201
    assert without.json()["agent"] is None
    assert without.json()["policy_number"] == f"POL-{YEAR}-000002"

    unknown = seeded.post(
        "/api/v1/policies", json=_issue_body(agent_code="AGT-9999"), headers=admin
    )
    assert unknown.status_code == 422


def test_policyholder_cannot_issue(seeded, holder):
    response = seeded.post("/api/v1/policies", json=_issue_body(), headers=holder)
    assert response.status_code == 403
    assert seeded.post("/api/v1/policies", json=_issue_body()).status_code == 401


def _existing_customer_body(**overrides) -> dict:
    body = _issue_body(**overrides)
    body["policyholder"] = {
        **body["policyholder"],
        "customer_code": "CUS-100241",
        "date_of_birth": "1990-06-18",
    }
    return body


def test_issue_for_existing_customer_and_reject_duplicate(seeded, agent, holder, mysql_sessions):
    customers_before = _count(mysql_sessions, "customers")
    first = seeded.post("/api/v1/policies", json=_existing_customer_body(), headers=agent)
    assert first.status_code == 201
    assert first.json()["policyholder"]["full_name"] == "Ananya Krishnan"  # existing record used
    assert _count(mysql_sessions, "customers") == customers_before
    # The policyholder now sees the new policy as well.
    assert first.json()["policy_number"] in _numbers(seeded, holder)

    duplicate = seeded.post("/api/v1/policies", json=_existing_customer_body(), headers=agent)
    assert duplicate.status_code == 409
    assert "already has a policy" in duplicate.json()["detail"]
    assert _count(mysql_sessions, "policies") == 6

    # The failed attempt consumed no policy number.
    other = _existing_customer_body(start_date=(TODAY + timedelta(days=30)).isoformat())
    assert seeded.post("/api/v1/policies", json=other, headers=agent).json()["policy_number"] == (
        f"POL-{YEAR}-000002"
    )


def test_existing_customer_requires_matching_date_of_birth(seeded, agent):
    wrong_dob = _existing_customer_body()
    wrong_dob["policyholder"]["date_of_birth"] = "1991-01-01"
    unknown = _existing_customer_body()
    unknown["policyholder"]["customer_code"] = "CUS-999999"

    first = seeded.post("/api/v1/policies", json=wrong_dob, headers=agent)
    second = seeded.post("/api/v1/policies", json=unknown, headers=agent)
    assert first.status_code == second.status_code == 422
    # Same answer either way (apart from echoing the submitted ID), so a
    # customer ID cannot be used to probe for someone's date of birth.
    assert first.json()["detail"].replace("CUS-100241", "X") == second.json()["detail"].replace(
        "CUS-999999", "X"
    )


def test_failure_after_customer_insert_rolls_everything_back(
    seeded, agent, mysql_sessions, monkeypatch
):
    """A new customer is inserted, then the policy insert fails: nothing may remain."""
    customers_before = _count(mysql_sessions, "customers")
    monkeypatch.setattr(policy_repo, "next_policy_number", lambda db, year: "POL-2024-000148")

    response = seeded.post("/api/v1/policies", json=_issue_body(), headers=agent)
    assert response.status_code == 409
    assert _count(mysql_sessions, "customers") == customers_before
    assert _count(mysql_sessions, "policies") == 5
    with mysql_sessions() as session:
        # The customer counter was rolled back as well.
        assert policy_repo.next_customer_code(session) == "CUS-100631"
        session.rollback()


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"product_code": "PRD-HLT-006"}, "body.product_code"),  # inactive product
        ({"product_code": "PRD-XXX-001"}, "body.product_code"),  # unknown product
        ({"coverage_amount": "100000"}, "body.coverage_amount"),  # below the product minimum
        ({"coverage_amount": "9000000"}, "body.coverage_amount"),  # above the maximum
        ({"term_years": 5}, "body.term_years"),  # not offered (1, 2, 3)
        ({"premium_frequency": "half_yearly"}, "body.premium_frequency"),  # not offered
    ],
)
def test_product_rules_enforced_server_side(seeded, admin, mysql_sessions, overrides, field):
    response = seeded.post("/api/v1/policies", json=_issue_body(**overrides), headers=admin)
    assert response.status_code == 422
    body = response.json()
    assert body["code"] in {"unprocessable", "validation_error"}
    assert field in {e["field"] for e in body.get("errors", [])}
    assert _count(mysql_sessions, "policies") == 5


def test_entry_age_enforced_server_side(seeded, admin):
    body = _issue_body()
    body["policyholder"]["date_of_birth"] = (TODAY.replace(year=TODAY.year - 70)).isoformat()
    response = seeded.post("/api/v1/policies", json=body, headers=admin)
    assert response.status_code == 422
    assert response.json()["errors"][0]["field"] == "body.policyholder.date_of_birth"


def test_invalid_request_is_422_before_touching_the_database(seeded, admin):
    body = _issue_body(start_date=(TODAY - timedelta(days=1)).isoformat())
    body["policyholder"]["phone"] = "12345"
    response = seeded.post("/api/v1/policies", json=body, headers=admin)
    assert response.status_code == 422
    fields = {e["field"] for e in response.json()["errors"]}
    assert fields == {"body.start_date", "body.policyholder.phone"}


def test_issued_policy_round_trips_through_detail(seeded, admin):
    issued = seeded.post("/api/v1/policies", json=_issue_body(), headers=admin).json()
    detail = seeded.get(f"/api/v1/policies/{issued['policy_number']}", headers=admin).json()
    assert detail == issued
    assert Decimal(detail["coverage_amount"]) == Decimal("1500000")


def test_column_collations_match_models(mysql_engine: Engine):
    """`alembic check` does not compare collations, so guard them here."""
    from app.models import Base

    expected = {
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if getattr(column.type, "collation", None) == "utf8mb4_bin"
    }
    with mysql_engine.connect() as connection:
        actual = set(
            connection.execute(
                text(
                    "SELECT table_name, column_name FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND collation_name = 'utf8mb4_bin'"
                )
            ).all()
        )
    assert actual == expected
    assert (
        len(expected) == 59
    )  # 12 from Module 1, 5 from Module 2, 12 from Module 3, 30 from Modules 4-6
