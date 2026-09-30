"""Module 3 (Claim Filing & Approval Workflow) against real MySQL.

Each test starts from the development seed (Modules 1-3). Seeded claims:

  CLM-2024-000087 rejected      POL-2023-000874 (AGT-0456)
  CLM-2024-000152 settled       POL-2024-000148 (AGT-2207, CUS-100241 = dev policyholder)
  CLM-2026-000044 approved      POL-2024-000519 (AGT-2207 = dev agent, CUS-100630)
  CLM-2026-000052 verified      POL-2024-000226 (AGT-1184)
  CLM-2026-000071 assessed      POL-2024-000519
  CLM-2026-000083 under_review  POL-2024-000519
  CLM-2026-000084 cancelled     POL-2024-000519
  CLM-2026-000097 submitted     POL-2024-000519

The core invariant is checked after every workflow call: for a success, the
claim's status equals its latest history row; for a failure, neither the
status nor the history changes.
"""

import json
import threading
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import Engine, inspect, select, text
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.core.exceptions import AppError
from app.models import ClaimEvent, User
from app.schemas.claims import ClaimCreate
from app.scripts.seed_dev_data import CLAIMS_FILE, seed_module1, seed_module2, seed_module3
from app.scripts.seed_dev_users import DEV_PASSWORD, seed_dev_users
from app.services import claims as claim_service

pytestmark = pytest.mark.mysql

TODAY = date.today()
D = Decimal
SEED = json.loads(CLAIMS_FILE.read_text(encoding="utf-8"))
AGENT_CLAIMS = {
    "CLM-2024-000152",
    "CLM-2026-000044",
    "CLM-2026-000071",
    "CLM-2026-000083",
    "CLM-2026-000084",
    "CLM-2026-000097",
}


@pytest.fixture
def seeded(mysql_api, mysql_sessions: sessionmaker[Session]):
    with mysql_sessions() as session:
        seed_dev_users(session)
    with mysql_sessions() as session:
        seed_module1(session)
    with mysql_sessions() as session:
        seed_module2(session)
    with mysql_sessions() as session:
        assert seed_module3(session) == {"claim_types": 9, "claims": 8}
    return mysql_api


def _headers(api, email: str) -> dict[str, str]:
    response = api.post("/api/v1/auth/login", json={"email": email, "password": DEV_PASSWORD})
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


def _state(sessions, claim_number: str) -> tuple[str, int, str | None]:
    """(status, number of history rows, latest history to_status)."""
    with sessions() as session:
        return (
            session.execute(
                text(
                    "SELECT c.status, COUNT(e.id), "
                    "(SELECT e2.to_status FROM claim_events e2 WHERE e2.claim_id = c.id "
                    " ORDER BY e2.sequence_no DESC LIMIT 1) "
                    "FROM claims c LEFT JOIN claim_events e ON e.claim_id = c.id "
                    "WHERE c.claim_number = :n GROUP BY c.id"
                ),
                {"n": claim_number},
            )
            .one()
            ._tuple()
        )


def _assert_consistent(sessions, claim_number: str, status: str, events: int) -> None:
    current, count, latest = _state(sessions, claim_number)
    assert (current, count) == (status, events)
    if events:
        assert latest == current, "status must equal the latest history row"


def _post(api, headers, claim_number: str, action: str, body: dict | None = None):
    return api.post(f"/api/v1/claims/{claim_number}/{action}", json=body, headers=headers)


def _documents_for(claim_type: str) -> dict[str, str]:
    kind = next(t for t in SEED["claim_types"] if t["code"] == claim_type)
    return {d["doc_type"]: f"{d['doc_type']}.pdf" for d in kind["documents"] if d["required"]}


def _claim_body(policy_number: str, claim_type: str = "temporary-disablement", **overrides) -> dict:
    body = {
        "policy_number": policy_number,
        "claim_type": claim_type,
        "incident_date": TODAY.isoformat(),
        "claimed_amount": "40000.00",
        "description": "Fractured wrist in a road accident; unable to work for six weeks.",
        "documents": _documents_for(claim_type),
    }
    body.update(overrides)
    return body


def _issue_for_dev_policyholder(api, admin_headers) -> str:
    """A health policy for CUS-100241 starting today, so it is claimable now."""
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
        "premium_frequency": "annual",
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


# --- schema ------------------------------------------------------------------------


def test_module3_schema(mysql_engine: Engine):
    inspector = inspect(mysql_engine)
    tables = set(inspector.get_table_names())
    assert {
        "claim_types",
        "claim_type_documents",
        "claims",
        "claim_documents",
        "claim_events",
        "claim_verifications",
        "claim_assessments",
        "claim_settlements",
    } <= tables
    fks = {fk["name"]: fk["referred_table"] for fk in inspector.get_foreign_keys("claims")}
    assert fks == {
        "fk_claims_policy_id_policies": "policies",
        "fk_claims_claim_type_id_claim_types": "claim_types",
    }
    assert {u["name"] for u in inspector.get_unique_constraints("claim_events")} == {
        "uq_claim_events_claim_id_sequence_no"
    }
    checks = {c["name"] for c in inspector.get_check_constraints("claim_events")}
    assert "ck_claim_events_legal_transition" in checks
    claim_checks = {c["name"] for c in inspector.get_check_constraints("claims")}
    assert {
        "ck_claims_approved_amount_for_approved",
        "ck_claims_rejection_reason_for_rejected",
        "ck_claims_incident_not_after_filing",
    } <= claim_checks
    # Every FK column has exactly one supporting index (no MySQL auto-duplicates).
    for table in ("claims", "claim_events", "claim_documents", "claim_type_documents"):
        names = [ix["name"] for ix in inspector.get_indexes(table)]
        assert not any(name.startswith("fk_") for name in names), (table, names)


_CLAIM_ID = "(SELECT id FROM (SELECT id FROM claims WHERE claim_number = '{n}') t)"
SUBMITTED_ID = _CLAIM_ID.format(n="CLM-2026-000097")


@pytest.mark.parametrize(
    ("sql", "errno"),
    [
        # history rows can only encode legal moves of the state machine
        (
            "INSERT INTO claim_events (claim_id, sequence_no, action, from_status, to_status, "
            f"actor_name, actor_role, occurred_at) VALUES ({SUBMITTED_ID}, "
            "2, 'approve', 'submitted', 'approved', 'X', 'administrator', NOW())",
            3819,
        ),
        (
            "INSERT INTO claim_events (claim_id, sequence_no, action, from_status, to_status, "
            f"actor_name, actor_role, occurred_at) VALUES ({SUBMITTED_ID}, "
            "2, 'settle', 'submitted', 'under_review', 'X', 'administrator', NOW())",
            3819,  # right pair, wrong action
        ),
        (
            "INSERT INTO claim_events (claim_id, sequence_no, action, from_status, to_status, "
            f"actor_name, actor_role, occurred_at) VALUES ({SUBMITTED_ID}, "
            "1, 'start_review', 'submitted', 'under_review', 'X', 'administrator', NOW())",
            1062,  # duplicate sequence number
        ),
        # claim-level integrity
        ("UPDATE claims SET approved_amount = 1 WHERE claim_number = 'CLM-2026-000097'", 3819),
        ("UPDATE claims SET approved_amount = NULL WHERE claim_number = 'CLM-2026-000044'", 3819),
        (
            "UPDATE claims SET approved_amount = claimed_amount + 1 "
            "WHERE claim_number = 'CLM-2026-000044'",
            3819,
        ),
        ("UPDATE claims SET status = 'rejected' WHERE claim_number = 'CLM-2026-000071'", 3819),
        (
            "UPDATE claims SET rejection_reason = 'short' WHERE claim_number = 'CLM-2024-000087'",
            3819,
        ),
        ("UPDATE claims SET status = 'SETTLED' WHERE claim_number = 'CLM-2024-000152'", 3819),
        ("UPDATE claims SET status = 'reopened' WHERE claim_number = 'CLM-2024-000152'", 3819),
        ("UPDATE claims SET claimed_amount = 0 WHERE claim_number = 'CLM-2026-000097'", 3819),
        (
            "UPDATE claims SET incident_date = filing_date + INTERVAL 1 DAY "
            "WHERE claim_number = 'CLM-2026-000097'",
            3819,
        ),
        (
            "UPDATE claims SET description = 'too short' WHERE claim_number = 'CLM-2026-000097'",
            3819,
        ),
        (
            "UPDATE claims SET claim_number = 'CLM-2024-000087' "
            "WHERE claim_number = 'CLM-2026-000097'",
            1062,
        ),
        ("UPDATE claims SET policy_id = 999999999 WHERE claim_number = 'CLM-2026-000097'", 1452),
        ("DELETE FROM policies WHERE policy_number = 'POL-2024-000519'", 1451),
        ("DELETE FROM claim_types WHERE code = 'hospitalisation'", 1451),
        # stage records
        (
            "INSERT INTO claim_settlements (claim_id, settlement_reference, amount, settled_on) "
            f"VALUES ({_CLAIM_ID.format(n='CLM-2024-000152')}, 'SET-2030-000001', 1, CURDATE())",
            1062,  # a claim is settled at most once
        ),
        ("UPDATE claim_assessments SET assessed_amount = illustrative_limit + 1 LIMIT 1", 3819),
        ("UPDATE claim_documents SET status = 'lost' LIMIT 1", 3819),
    ],
)
def test_workflow_integrity_enforced_by_mysql(seeded, mysql_sessions, sql, errno):
    with mysql_sessions() as session, pytest.raises((IntegrityError, OperationalError)) as excinfo:
        session.execute(text(sql))
        session.commit()
    assert excinfo.value.orig.args[0] == errno


def test_history_rows_are_append_only_in_the_orm(seeded, mysql_sessions):
    with mysql_sessions() as session:
        event = session.scalars(select(ClaimEvent).order_by(ClaimEvent.id)).first()
        with pytest.raises(ValueError, match="append-only"):
            event.to_status = "settled"
        with pytest.raises(ValueError, match="append-only"):
            event.note = "rewritten"


# --- seed ----------------------------------------------------------------------------


def test_seeded_histories_are_consistent(seeded, mysql_sessions):
    """Every claim's status equals its last event; histories are continuous chains."""
    with mysql_sessions() as session:
        mismatched = session.scalar(
            text(
                "SELECT COUNT(*) FROM claims c WHERE c.status <> 'draft' AND c.status <> "
                "(SELECT e.to_status FROM claim_events e WHERE e.claim_id = c.id "
                " ORDER BY e.sequence_no DESC LIMIT 1)"
            )
        )
        broken_chain = session.scalar(
            text(
                "SELECT COUNT(*) FROM claim_events e JOIN claim_events prev "
                "ON prev.claim_id = e.claim_id AND prev.sequence_no = e.sequence_no - 1 "
                "WHERE prev.to_status <> e.from_status"
            )
        )
        bad_start = session.scalar(
            text(
                "SELECT COUNT(*) FROM claim_events WHERE sequence_no = 1 AND from_status <> 'draft'"
            )
        )
        statuses = dict(session.execute(text("SELECT claim_number, status FROM claims")).all())
    assert (mismatched, broken_chain, bad_start) == (0, 0, 0)
    assert set(statuses.values()) == {
        "rejected", "settled", "approved", "verified",
        "assessed", "under_review", "cancelled", "submitted",
    }  # fmt: skip


def test_seed_is_idempotent(seeded, mysql_sessions):
    with mysql_sessions() as session:
        assert seed_module3(session) == {"claim_types": 0, "claims": 0}


# --- reads and scope ------------------------------------------------------------------


def _claim_numbers(api, headers, **params) -> set[str]:
    response = api.get("/api/v1/claims", params=params, headers=headers)
    assert response.status_code == 200, response.text
    return {c["claim_number"] for c in response.json()["items"]}


def test_claims_are_scoped_by_role(seeded, admin, agent, holder):
    assert len(_claim_numbers(seeded, admin)) == 8
    assert _claim_numbers(seeded, agent) == AGENT_CLAIMS
    assert _claim_numbers(seeded, holder) == {"CLM-2024-000152"}
    assert seeded.get("/api/v1/claims").status_code == 401


def test_list_filters_sort_and_summary(seeded, admin, agent):
    assert _claim_numbers(seeded, admin, status="assessed") == {"CLM-2026-000071"}
    assert _claim_numbers(seeded, admin, claim_type="hospitalisation") == {"CLM-2024-000152"}
    assert _claim_numbers(seeded, admin, search="ananya") == {"CLM-2024-000152"}
    assert _claim_numbers(seeded, admin, search="clm-2024") == {
        "CLM-2024-000087",
        "CLM-2024-000152",
    }
    assert len(_claim_numbers(seeded, admin, policy_number="POL-2024-000519")) == 5
    body = seeded.get(
        "/api/v1/claims", params={"sort": "claimed-desc", "limit": 2}, headers=admin
    ).json()
    assert [c["claim_number"] for c in body["items"]] == ["CLM-2026-000052", "CLM-2026-000071"]
    assert body["total"] == 8
    summary = seeded.get("/api/v1/claims", headers=agent).json()["summary"]
    assert summary["total"] == 6 and summary["open"] == 4 and summary["settled"] == 1


def test_detail_is_scoped_and_explains_itself(seeded, admin, agent, holder):
    for headers in (agent, holder):
        response = seeded.get("/api/v1/claims/CLM-2026-000052", headers=headers)
        assert response.status_code == 404  # another agent's / customer's claim
    assert seeded.get("/api/v1/claims/CLM-2099-000001", headers=admin).status_code == 404

    body = seeded.get("/api/v1/claims/CLM-2024-000152", headers=holder).json()
    assert body["claim"]["status"] == "settled"
    assert body["claim"]["filed_by"] == {"name": "Meera Iyer", "role": "agent"}
    assert body["settlement"]["settlement_reference"] == "SET-2024-000118"
    assert body["decision"]["decision"] == "settled"
    assert body["decision"]["reasons"][0].startswith("Assessed ₹3,500 below the claimed amount")
    assert [e["to_status"] for e in body["events"]] == [
        "submitted", "under_review", "verified", "assessed", "approved", "settled",
    ]  # fmt: skip
    assert body["allowed_actions"] == []  # final status
    timeline = seeded.get("/api/v1/claims/CLM-2024-000152/timeline", headers=holder).json()
    assert [e["sequence_no"] for e in timeline["events"]] == [1, 2, 3, 4, 5, 6]


def test_allowed_actions_follow_role(seeded, admin, holder, agent):
    def actions(headers, claim):
        return {
            a["action"]
            for a in seeded.get(f"/api/v1/claims/{claim}", headers=headers).json()[
                "allowed_actions"
            ]
        }

    assert actions(admin, "CLM-2026-000097") == {"start_review", "withdraw"}
    assert actions(agent, "CLM-2026-000097") == set()
    assert actions(admin, "CLM-2026-000071") == {"approve", "reject"}


# --- eligibility and filing -----------------------------------------------------------


def test_eligibility_uses_real_policy_and_premium_data(seeded, agent, holder):
    items = {
        i["policy"]["policy_number"]: i["eligibility"]
        for i in seeded.get("/api/v1/claims/eligibility", headers=agent).json()["items"]
    }
    assert set(items) == {"POL-2024-000148", "POL-2024-000519"}
    assert items["POL-2024-000519"]["eligible"] is True
    # Module 2: instalment 4 of POL-2024-000519 is unpaid and overdue -> a warning, not a block.
    premium = next(c for c in items["POL-2024-000519"]["checks"] if c["id"] == "premium-standing")
    assert premium["outcome"] == "warning"
    assert items["POL-2024-000148"]["eligible"] is False  # cover ended > 90 days ago

    context = seeded.get("/api/v1/policies/POL-2024-000519/claim-eligibility", headers=agent).json()
    assert {t["code"] for t in context["claim_types"]} == {
        "temporary-disablement",
        "permanent-disability",
    }
    assert (
        seeded.get("/api/v1/policies/POL-2024-000226/claim-eligibility", headers=agent).status_code
        == 404
    )


def test_agent_files_on_a_serviced_policy(seeded, agent, mysql_sessions):
    response = seeded.post("/api/v1/claims", json=_claim_body("POL-2024-000519"), headers=agent)
    assert response.status_code == 201, response.text
    body = response.json()
    number = body["claim"]["claim_number"]
    assert number == f"CLM-{TODAY.year}-000098" if TODAY.year == 2026 else number.endswith("000001")
    assert body["claim"]["status"] == "submitted"
    assert body["events"][0]["action"] == "submit"
    assert body["events"][0]["note"] == "Filed by the agent on behalf of the policyholder."
    assert body["claim"]["filed_by"] == {"name": "Meera Iyer", "role": "agent"}
    _assert_consistent(mysql_sessions, number, "submitted", 1)


def test_policyholder_files_own_claim_but_not_for_others(seeded, admin, holder, mysql_sessions):
    own = _issue_for_dev_policyholder(seeded, admin)
    body = _claim_body(own, "hospitalisation", claimed_amount="25000.00")
    response = seeded.post("/api/v1/claims", json=body, headers=holder)
    assert response.status_code == 201, response.text
    assert response.json()["claim"]["filed_by"] == {
        "name": "Ananya Krishnan",
        "role": "policyholder",
    }

    # Another customer's policy looks like it does not exist.
    other = seeded.post("/api/v1/claims", json=_claim_body("POL-2024-000519"), headers=holder)
    assert other.status_code == 404
    # Own policy whose filing window closed.
    closed = seeded.post(
        "/api/v1/claims", json=_claim_body("POL-2024-000148", "hospitalisation"), headers=holder
    )
    assert closed.status_code == 409
    assert "window" in closed.json()["detail"]


def test_administrators_cannot_file(seeded, admin, mysql_sessions):
    with mysql_sessions() as session:
        before = session.scalar(text("SELECT COUNT(*) FROM claims"))
    response = seeded.post("/api/v1/claims", json=_claim_body("POL-2024-000519"), headers=admin)
    assert response.status_code == 403
    with mysql_sessions() as session:
        assert session.scalar(text("SELECT COUNT(*) FROM claims")) == before


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"incident_date": "2099-01-01"}, "body.incident_date"),
        ({"incident_date": "2020-01-01"}, "body.incident_date"),  # before cover
        ({"claim_type": "vehicle-damage"}, "body.claim_type"),  # a motor claim on a PA policy
        ({"description": "Too short"}, "body.description"),
        ({"documents": {}}, "body.documents.incident-report"),
    ],
)
def test_filing_rules_enforced_server_side(seeded, agent, mysql_sessions, overrides, field):
    with mysql_sessions() as session:
        before = session.scalar(text("SELECT COUNT(*) FROM claims"))
    response = seeded.post(
        "/api/v1/claims", json=_claim_body("POL-2024-000519", **overrides), headers=agent
    )
    assert response.status_code == 422
    assert field in {e["field"] for e in response.json()["errors"]}
    with mysql_sessions() as session:
        assert session.scalar(text("SELECT COUNT(*) FROM claims")) == before


def test_draft_submit_and_cancel(seeded, agent, mysql_sessions):
    draft = seeded.post(
        "/api/v1/claims", json={**_claim_body("POL-2024-000519"), "submit": False}, headers=agent
    )
    assert draft.status_code == 201
    number = draft.json()["claim"]["claim_number"]
    _assert_consistent(mysql_sessions, number, "draft", 0)
    assert (
        _post(seeded, agent, number, "withdraw").status_code == 409
    )  # a draft is cancelled, not withdrawn
    assert _post(seeded, agent, number, "submit").status_code == 200
    _assert_consistent(mysql_sessions, number, "submitted", 1)

    second = seeded.post(
        "/api/v1/claims",
        json={**_claim_body("POL-2024-000519", incident_date="2026-09-01"), "submit": False},
        headers=agent,
    ).json()["claim"]["claim_number"]
    assert _post(seeded, agent, second, "cancel").status_code == 200
    _assert_consistent(mysql_sessions, second, "cancelled", 1)


# --- the workflow ----------------------------------------------------------------------


def test_full_happy_path(seeded, admin, agent, mysql_sessions):
    number = seeded.post(
        "/api/v1/claims", json=_claim_body("POL-2024-000519"), headers=agent
    ).json()["claim"]["claim_number"]
    steps = [
        ("start-review", None, "under_review"),
        ("verify", {"note": "Documents complete."}, "verified"),
        (
            "assess",
            {"assessed_amount": "36000.00", "note": "Six weeks at the weekly benefit."},
            "assessed",
        ),
        ("approve", None, "approved"),
        ("settle", None, "settled"),
    ]
    for count, (action, payload, status) in enumerate(steps, start=2):
        response = _post(seeded, admin, number, action, payload)
        assert response.status_code == 200, (action, response.text)
        _assert_consistent(mysql_sessions, number, status, count)

    body = response.json()
    assert body["claim"]["approved_amount"] == "36000.00"
    assert body["settlement"]["amount"] == "36000.00"
    assert body["settlement"]["settlement_reference"].startswith(f"SET-{TODAY.year}-")
    assert body["verification"]["checks_total"] == 6
    assert {d["status"] for d in body["documents"]} == {"verified"}
    assert body["decision"]["decision_label"] == "Approved and settled"
    assert body["claim"]["assigned_to"]["role"] == "administrator"

    again = _post(seeded, admin, number, "settle")
    assert again.status_code == 409
    assert "already settled" in again.json()["detail"]
    _assert_consistent(mysql_sessions, number, "settled", 6)


@pytest.mark.parametrize(
    ("who", "claim", "action", "status_code"),
    [
        ("admin", "CLM-2026-000097", "approve", 409),  # skipped stages
        ("admin", "CLM-2026-000097", "settle", 409),
        ("admin", "CLM-2026-000097", "verify", 409),
        ("admin", "CLM-2026-000052", "settle", 409),  # verified -> settled skips stages
        ("admin", "CLM-2026-000052", "approve", 409),
        ("admin", "CLM-2026-000083", "approve", 409),
        ("admin", "CLM-2026-000071", "settle", 409),
        ("admin", "CLM-2024-000152", "approve", 409),  # settled is final
        ("admin", "CLM-2024-000152", "reject", 409),
        ("admin", "CLM-2024-000152", "withdraw", 409),
        ("admin", "CLM-2024-000152", "start-review", 409),
        ("admin", "CLM-2026-000084", "start-review", 409),  # cancelled is final
        ("admin", "CLM-2026-000084", "submit", 409),
        ("admin", "CLM-2024-000087", "settle", 409),
        ("admin", "CLM-2026-000083", "reject", 409),  # rejection only from assessed
        ("admin", "CLM-2026-000052", "withdraw", 409),  # too late to withdraw
        ("admin", "CLM-2024-000087", "approve", 409),  # rejected is final
        ("agent", "CLM-2026-000097", "start-review", 403),
        ("agent", "CLM-2026-000097", "withdraw", 403),  # agents cannot withdraw
        ("agent", "CLM-2026-000071", "approve", 403),
        ("agent", "CLM-2026-000044", "settle", 403),
        ("holder", "CLM-2024-000152", "settle", 409),  # already settled
        ("agent", "CLM-2026-000052", "verify", 404),  # outside the agent's scope
    ],
)
def test_forbidden_moves_change_nothing(
    seeded, admin, agent, holder, mysql_sessions, who, claim, action, status_code
):
    headers = {"admin": admin, "agent": agent, "holder": holder}[who]
    before = _state(mysql_sessions, claim)
    response = _post(
        seeded, headers, claim, action, {"reason": "Not covered under the policy terms."}
    )
    assert response.status_code == status_code, response.text
    assert _state(mysql_sessions, claim) == before


def test_policyholder_withdraws_only_own_submitted_claim(seeded, admin, holder, mysql_sessions):
    own = _issue_for_dev_policyholder(seeded, admin)
    number = seeded.post(
        "/api/v1/claims", json=_claim_body(own, "hospitalisation"), headers=holder
    ).json()["claim"]["claim_number"]
    # A legal move the policyholder may not make -> 403; an impossible one -> 409.
    assert _post(seeded, holder, number, "start-review").status_code == 403
    assert _post(seeded, holder, number, "verify").status_code == 409
    assert (
        _post(
            seeded, holder, number, "withdraw", {"note": "Settled with the hospital directly."}
        ).status_code
        == 200
    )
    _assert_consistent(mysql_sessions, number, "cancelled", 2)
    assert _post(seeded, holder, "CLM-2026-000097", "withdraw").status_code == 404  # not theirs


def test_draft_cannot_jump_ahead(seeded, admin, agent, mysql_sessions):
    number = seeded.post(
        "/api/v1/claims", json={**_claim_body("POL-2024-000519"), "submit": False}, headers=agent
    ).json()["claim"]["claim_number"]
    for action, body in (
        ("start-review", None),
        ("verify", None),
        ("assess", {"assessed_amount": "100.00"}),
        ("approve", None),
        ("reject", {"reason": "Not covered under the policy terms."}),
        ("settle", None),
    ):
        response = _post(seeded, admin, number, action, body)
        assert response.status_code == 409, (action, response.text)
        assert response.json()["code"] == "conflict"
        _assert_consistent(mysql_sessions, number, "draft", 0)


def test_only_administrators_make_officer_decisions(seeded, admin, agent, holder, mysql_sessions):
    """At every officer stage, the policyholder (own claim) and the agent
    (serviced policy) get 403 for the valid next move, and nothing changes."""
    own = _issue_for_dev_policyholder(seeded, admin)
    number = seeded.post(
        "/api/v1/claims", json=_claim_body(own, "hospitalisation"), headers=holder
    ).json()["claim"]["claim_number"]
    stages = [
        ("start-review", None, "under_review"),
        ("verify", None, "verified"),
        ("assess", {"assessed_amount": "40000.00"}, "assessed"),
        ("approve", None, "approved"),
        ("settle", None, "settled"),
    ]
    for events, (action, body, status) in enumerate(stages, start=2):
        for outsider in (holder, agent):
            before = _state(mysql_sessions, number)
            denied = _post(seeded, outsider, number, action, body)
            assert denied.status_code == 403, (action, denied.text)
            assert denied.json()["code"] == "forbidden"
            assert _state(mysql_sessions, number) == before
        if action == "approve":  # rejection is also officer-only
            for outsider in (holder, agent):
                reason = {"reason": "Not covered under the policy terms."}
                assert _post(seeded, outsider, number, "reject", reason).status_code == 403
        assert _post(seeded, admin, number, action, body).status_code == 200
        _assert_consistent(mysql_sessions, number, status, events)
    # The policyholder still reads the outcome of their own claim.
    assert seeded.get(f"/api/v1/claims/{number}", headers=holder).status_code == 200


def test_administrator_may_withdraw_a_submitted_claim(seeded, admin, mysql_sessions):
    response = _post(seeded, admin, "CLM-2026-000097", "withdraw", {"note": "Duplicate filing."})
    assert response.status_code == 200, response.text
    last = response.json()["events"][-1]
    assert (last["action"], last["actor"]["role"]) == ("withdraw", "administrator")
    _assert_consistent(mysql_sessions, "CLM-2026-000097", "cancelled", 2)


def test_client_cannot_choose_numbers_statuses_or_amounts(seeded, admin, agent, mysql_sessions):
    """Fields the server owns are ignored if a client sends them."""
    body = {
        **_claim_body("POL-2024-000519"),
        "claim_number": "CLM-2026-999999",
        "status": "approved",
        "approved_amount": "40000.00",
        "filing_date": "2020-01-01",
    }
    created = seeded.post("/api/v1/claims", json=body, headers=agent).json()
    number = created["claim"]["claim_number"]
    assert number != "CLM-2026-999999"
    assert created["claim"]["status"] == "submitted"
    assert created["claim"]["approved_amount"] is None
    assert created["claim"]["filing_date"] == TODAY.isoformat()

    for action, extra in (
        ("start-review", {"status": "settled"}),
        ("verify", {"status": "settled"}),
        ("assess", {"assessed_amount": "30000.00", "note": "Partial benefit period only."}),
        ("approve", {"approved_amount": "39999.00", "status": "settled"}),
    ):
        assert _post(seeded, admin, number, action, extra).status_code == 200, action
    _assert_consistent(mysql_sessions, number, "approved", 5)
    settled = _post(seeded, admin, number, "settle", {"amount": "1.00"}).json()
    assert settled["claim"]["approved_amount"] == "30000.00"  # the assessment, not the client
    assert settled["settlement"]["amount"] == "30000.00"


@pytest.mark.parametrize("method", ["put", "patch", "delete"])
@pytest.mark.parametrize("path", ["/claims/CLM-2026-000097", "/claims/CLM-2026-000097/timeline"])
def test_no_generic_status_or_history_edits(seeded, admin, mysql_sessions, method, path):
    before = _state(mysql_sessions, "CLM-2026-000097")
    response = seeded.request(
        method.upper(), f"/api/v1{path}", json={"status": "settled"}, headers=admin
    )
    assert response.status_code == 405
    assert _state(mysql_sessions, "CLM-2026-000097") == before


def test_verification_is_blocked_by_a_failing_check(seeded, admin, mysql_sessions):
    with mysql_sessions() as session:  # a required document goes missing
        session.execute(
            text(
                "DELETE FROM claim_documents WHERE doc_type = 'medical-certificate' AND claim_id = "
                "(SELECT id FROM claims WHERE claim_number = 'CLM-2026-000083')"
            )
        )
        session.commit()
    before = _state(mysql_sessions, "CLM-2026-000083")
    response = _post(seeded, admin, "CLM-2026-000083", "verify")
    assert response.status_code == 422
    assert "Missing" in response.json()["detail"]
    assert _state(mysql_sessions, "CLM-2026-000083") == before
    with mysql_sessions() as session:
        assert (
            session.scalar(
                text(
                    "SELECT COUNT(*) FROM claim_verifications WHERE claim_id = "
                    "(SELECT id FROM claims WHERE claim_number = 'CLM-2026-000083')"
                )
            )
            == 0
        )


@pytest.mark.parametrize(
    ("payload", "detail"),
    [
        ({"assessed_amount": "0"}, "greater than zero"),
        ({"assessed_amount": "2000000.01", "note": "Maximum benefit applies."}, "exceed"),
        ({"assessed_amount": "1000000", "note": None}, "Explain why"),
    ],
)
def test_assessment_rules(seeded, admin, mysql_sessions, payload, detail):
    before = _state(mysql_sessions, "CLM-2026-000052")
    response = _post(seeded, admin, "CLM-2026-000052", "assess", payload)
    assert response.status_code == 422
    assert detail in response.json()["detail"]
    assert _state(mysql_sessions, "CLM-2026-000052") == before


def test_assessment_capped_by_the_limit_then_rejection(seeded, admin, mysql_sessions):
    # Terminal illness: claimed 20,00,000, the cap is 20,00,000 (sum assured capped).
    ok = _post(seeded, admin, "CLM-2026-000052", "assess", {"assessed_amount": "2000000.00"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["decision"]["decision"] == "pending"
    short = _post(seeded, admin, "CLM-2026-000052", "reject", {"reason": "Too short"})
    assert short.status_code == 422
    rejected = _post(
        seeded,
        admin,
        "CLM-2026-000052",
        "reject",
        {"reason": "Condition diagnosed before cover began."},
    )
    assert rejected.status_code == 200
    body = rejected.json()
    assert body["rejection_reason"] == "Condition diagnosed before cover began."
    assert body["decision"]["reasons"][-1] == "Rejected: Condition diagnosed before cover began."
    _assert_consistent(mysql_sessions, "CLM-2026-000052", "rejected", 5)


def test_approval_uses_the_assessed_amount(seeded, admin, mysql_sessions):
    body = _post(seeded, admin, "CLM-2026-000071", "approve").json()
    assert body["claim"]["approved_amount"] == "375000.00"  # the recorded assessment
    assert body["events"][-1]["note"] == "Approved at the assessed amount."


def test_settlement_rolls_back_completely_on_failure(seeded, admin, mysql_sessions, monkeypatch):
    import app.repositories.policies as policy_repo

    before = _state(mysql_sessions, "CLM-2026-000044")
    monkeypatch.setattr(
        policy_repo, "next_settlement_reference", lambda db, year: "SET-2024-000118"
    )
    response = _post(seeded, admin, "CLM-2026-000044", "settle")
    assert response.status_code == 409  # the reference already exists
    assert _state(mysql_sessions, "CLM-2026-000044") == before
    with mysql_sessions() as session:
        assert (
            session.scalar(
                text(
                    "SELECT COUNT(*) FROM claim_settlements "
                    "WHERE settlement_reference = 'SET-2024-000118'"
                )
            )
            == 1
        )


# --- concurrency -----------------------------------------------------------------------


def _race(mysql_sessions, calls, email: str = "admin@example.com"):
    """Run each (callable) in its own session and thread at the same moment."""
    barrier = threading.Barrier(len(calls))
    outcomes: list[str] = []

    def run(call):
        with mysql_sessions() as session:
            user = session.scalars(select(User).where(User.email == email)).one()
            barrier.wait()
            try:
                call(session, user)
                outcomes.append("ok")
            except AppError as error:
                outcomes.append(type(error).__name__)
            except Exception as error:  # surfaced by the outcome assertion
                outcomes.append(f"unexpected {type(error).__name__}: {error}")

    threads = [threading.Thread(target=run, args=(c,)) for c in calls]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    return sorted(outcomes)


def test_concurrent_approve_and_reject_only_one_wins(seeded, mysql_sessions):
    number = "CLM-2026-000071"
    outcomes = _race(
        mysql_sessions,
        [
            lambda db, user: claim_service.approve_claim(db, user, number, None),
            lambda db, user: claim_service.reject_claim(
                db, user, number, "Benefit table does not apply here."
            ),
        ],
    )
    assert outcomes == ["ConflictError", "ok"]
    status, events, latest = _state(mysql_sessions, number)
    assert status in {"approved", "rejected"} and latest == status
    assert events == 5, "exactly one new history row"


def test_concurrent_settlements_only_one_succeeds(seeded, mysql_sessions):
    number = "CLM-2026-000044"
    outcomes = _race(
        mysql_sessions,
        [lambda db, user: claim_service.settle_claim(db, user, number)] * 2,
    )
    assert outcomes == ["ConflictError", "ok"]
    _assert_consistent(mysql_sessions, number, "settled", 6)
    with mysql_sessions() as session:
        assert (
            session.scalar(
                text(
                    "SELECT COUNT(*) FROM claim_settlements s JOIN claims c ON c.id = s.claim_id "
                    "WHERE c.claim_number = :n"
                ),
                {"n": number},
            )
            == 1
        )


def test_concurrent_start_review_leaves_no_orphan_history(seeded, mysql_sessions):
    number = "CLM-2026-000097"
    outcomes = _race(
        mysql_sessions,
        [lambda db, user: claim_service.start_review(db, user, number, None)] * 3,
    )
    assert outcomes == ["ConflictError", "ConflictError", "ok"]
    _assert_consistent(mysql_sessions, number, "under_review", 2)


def test_mandatory_under_review_verify_vs_reject(seeded, mysql_sessions):
    """Mandatory test 1. Under review: A verifies, B rejects, at once.

    The frontend's state machine only allows rejection from Assessed, so B
    fails whichever order the lock grants (409 from Under review, or from
    Verified if A committed first). Exactly one move succeeds.
    """
    number = "CLM-2026-000083"
    outcomes = _race(
        mysql_sessions,
        [
            lambda db, user: claim_service.verify_claim(db, user, number, None),
            lambda db, user: claim_service.reject_claim(
                db, user, number, "Benefit table does not apply here."
            ),
        ],
    )
    assert outcomes == ["ConflictError", "ok"]
    _assert_consistent(mysql_sessions, number, "verified", 3)
    with mysql_sessions() as session:
        verifications = session.scalar(
            text(
                "SELECT COUNT(*) FROM claim_verifications v JOIN claims c ON c.id = v.claim_id "
                "WHERE c.claim_number = :n"
            ),
            {"n": number},
        )
        rejection = session.scalar(
            text("SELECT rejection_reason FROM claims WHERE claim_number = :n"), {"n": number}
        )
    assert (verifications, rejection) == (1, None)


def test_concurrent_verifications_only_one_wins(seeded, mysql_sessions):
    """Two officers verify the same under-review claim: both moves are legal
    from the state each read, so only the row lock separates them."""
    number = "CLM-2026-000083"
    outcomes = _race(
        mysql_sessions,
        [lambda db, user: claim_service.verify_claim(db, user, number, None)] * 2,
    )
    assert outcomes == ["ConflictError", "ok"]
    _assert_consistent(mysql_sessions, number, "verified", 3)


def test_blocked_transition_rereads_state_and_leaves_no_history(seeded, mysql_sessions):
    """Mandatory test 3, deterministic. Transaction A holds the claim's row
    lock and rejects it; B tries to approve meanwhile. B must wait on the
    lock, then re-read Rejected and fail, writing nothing."""
    number = "CLM-2026-000071"  # assessed, 4 history rows
    outcome: dict[str, object] = {}

    with mysql_sessions() as holder:
        claim_id, admin_id = holder.execute(
            text(
                "SELECT c.id, (SELECT id FROM users WHERE email = 'admin@example.com') "
                "FROM claims c WHERE c.claim_number = :n FOR UPDATE"
            ),
            {"n": number},
        ).one()

        def approve():
            with mysql_sessions() as session:
                admin = session.get(User, admin_id)
                try:
                    claim_service.approve_claim(session, admin, number, None)
                    outcome["result"] = "ok"
                except AppError as error:
                    outcome["result"] = type(error).__name__
                    outcome["detail"] = error.message

        waiter = threading.Thread(target=approve)
        waiter.start()
        waiter.join(timeout=2)
        assert waiter.is_alive(), "B must be blocked on A's row lock"

        holder.execute(
            text(
                "UPDATE claims SET status = 'rejected', "
                "rejection_reason = 'Condition diagnosed before cover began.' WHERE id = :id"
            ),
            {"id": claim_id},
        )
        holder.execute(
            text(
                "INSERT INTO claim_events (claim_id, sequence_no, action, from_status, to_status, "
                "actor_user_id, actor_name, actor_role, note, occurred_at) VALUES (:id, 5, "
                "'reject', 'assessed', 'rejected', :actor, 'Officer A', 'administrator', "
                "'Condition diagnosed before cover began.', UTC_TIMESTAMP())"
            ),
            {"id": claim_id, "actor": admin_id},
        )
        holder.commit()

    waiter.join(timeout=30)
    assert not waiter.is_alive()
    assert outcome["result"] == "ConflictError"
    assert "from Rejected to Approved" in outcome["detail"]
    _assert_consistent(mysql_sessions, number, "rejected", 5)
    with mysql_sessions() as session:
        approved = session.scalar(
            text("SELECT approved_amount FROM claims WHERE claim_number = :n"), {"n": number}
        )
        approvals = session.scalar(
            text(
                "SELECT COUNT(*) FROM claim_events WHERE action = 'approve' AND claim_id = "
                "(SELECT id FROM claims WHERE claim_number = :n)"
            ),
            {"n": number},
        )
    assert (approved, approvals) == (None, 0)


def test_concurrent_filings_get_unique_claim_numbers(seeded, mysql_sessions):
    """Claim numbers come from the server's locked sequence, never collide."""
    created: list[str] = []

    def file(db, user):
        detail = claim_service.file_claim(db, user, ClaimCreate(**_claim_body("POL-2024-000519")))
        created.append(detail.claim.claim_number)

    outcomes = _race(mysql_sessions, [file] * 4, email="agent@example.com")
    assert outcomes == ["ok"] * 4
    assert len(set(created)) == 4
    for number in created:
        _assert_consistent(mysql_sessions, number, "submitted", 1)


def test_claim_types_reference_and_coverage_item(seeded, holder):
    types = seeded.get("/api/v1/claim-types", headers=holder).json()["items"]
    assert len(types) == 9
    hospital = next(t for t in types if t["code"] == "hospitalisation")
    assert [d["doc_type"] for d in hospital["documents"] if d["required"]] == [
        "discharge-summary",
        "hospital-bill",
        "identity",
    ]
    body = seeded.get("/api/v1/claims/CLM-2024-000152", headers=holder).json()
    assert body["coverage_item"] == {
        "name": "In-patient hospitalisation",
        "limit": "Up to sum insured",
    }
    assert seeded.get("/api/v1/claim-types").status_code == 401
