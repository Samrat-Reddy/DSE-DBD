"""Module 3 pure rules: the state machine, eligibility, filing, verification,
assessment and the rule-based decision explanation."""

from datetime import date, timedelta
from decimal import Decimal
from itertools import product

import pytest

from app.models import ClaimAction, ClaimStatus
from app.models.role import RoleName
from app.services import claim_rules as rules
from app.services.claim_transitions import (
    CLAIM_TRANSITIONS,
    HAPPY_PATH,
    LEGAL_TRANSITIONS,
    TERMINAL_STATUSES,
)

S = ClaimStatus
ADMIN, AGENT, HOLDER = RoleName.ADMINISTRATOR, RoleName.AGENT, RoleName.POLICYHOLDER
D = Decimal
TODAY = date(2026, 9, 29)

# The frontend's CLAIM_TRANSITIONS, written out independently: (from, to) -> (action, roles).
EXPECTED = {
    (S.DRAFT, S.SUBMITTED): (ClaimAction.SUBMIT, {HOLDER, AGENT}),
    (S.DRAFT, S.CANCELLED): (ClaimAction.CANCEL_DRAFT, {HOLDER, AGENT}),
    (S.SUBMITTED, S.UNDER_REVIEW): (ClaimAction.START_REVIEW, {ADMIN}),
    (S.SUBMITTED, S.CANCELLED): (ClaimAction.WITHDRAW, {HOLDER, ADMIN}),
    (S.UNDER_REVIEW, S.VERIFIED): (ClaimAction.VERIFY, {ADMIN}),
    (S.VERIFIED, S.ASSESSED): (ClaimAction.ASSESS, {ADMIN}),
    (S.ASSESSED, S.APPROVED): (ClaimAction.APPROVE, {ADMIN}),
    (S.ASSESSED, S.REJECTED): (ClaimAction.REJECT, {ADMIN}),
    (S.APPROVED, S.SETTLED): (ClaimAction.SETTLE, {ADMIN}),
}


# --- state machine ------------------------------------------------------------------


def test_transition_table_matches_the_frontend_exactly():
    actual = {
        (source, target): (rule.action, set(rule.roles))
        for source, targets in CLAIM_TRANSITIONS.items()
        for target, rule in targets.items()
    }
    assert actual == EXPECTED
    assert set(CLAIM_TRANSITIONS) == set(ClaimStatus)
    assert {(f, t) for f, t, _ in LEGAL_TRANSITIONS} == set(EXPECTED)


@pytest.mark.parametrize(("source", "target", "role"), list(product(S, S, RoleName)))
def test_every_status_pair_for_every_role(source, target, role):
    """Exhaustive: 9 x 9 x 3 = 243 cases."""
    expected = EXPECTED.get((source, target))
    if expected is None:
        with pytest.raises(rules.InvalidTransition):
            rules.assert_transition(source, target, role)
    elif role not in expected[1]:
        with pytest.raises(rules.UnauthorizedTransition):
            rules.assert_transition(source, target, role)
    else:
        assert rules.assert_transition(source, target, role).action == expected[0]


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (S.DRAFT, S.APPROVED),
        (S.DRAFT, S.SETTLED),
        (S.SUBMITTED, S.SETTLED),
        (S.SUBMITTED, S.VERIFIED),
        (S.VERIFIED, S.SETTLED),
        (S.UNDER_REVIEW, S.ASSESSED),
        (S.VERIFIED, S.APPROVED),
    ],
)
def test_skipped_stages_are_invalid_even_for_administrators(source, target):
    with pytest.raises(rules.InvalidTransition):
        rules.assert_transition(source, target, ADMIN)


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (S.SUBMITTED, S.DRAFT),
        (S.VERIFIED, S.UNDER_REVIEW),
        (S.APPROVED, S.ASSESSED),
        (S.SETTLED, S.APPROVED),
    ],
)
def test_backward_moves_are_invalid(source, target):
    with pytest.raises(rules.InvalidTransition):
        rules.assert_transition(source, target, ADMIN)


@pytest.mark.parametrize("terminal", [S.REJECTED, S.SETTLED, S.CANCELLED])
def test_terminal_statuses_have_no_way_out(terminal):
    assert terminal in TERMINAL_STATUSES
    assert rules.is_terminal(terminal)
    for target in S:
        with pytest.raises(rules.InvalidTransition, match="is a final status"):
            rules.assert_transition(terminal, target, ADMIN)


def test_rejection_is_only_possible_from_assessed():
    # The frontend state machine: an assessed claim is approved or rejected.
    for source in (S.SUBMITTED, S.UNDER_REVIEW, S.VERIFIED):
        with pytest.raises(rules.InvalidTransition):
            rules.assert_transition(source, S.REJECTED, ADMIN)
    assert rules.assert_transition(S.ASSESSED, S.REJECTED, ADMIN).action == ClaimAction.REJECT


def test_withdrawal_and_draft_cancellation_rules():
    assert rules.assert_transition(S.SUBMITTED, S.CANCELLED, HOLDER).action == ClaimAction.WITHDRAW
    assert rules.assert_transition(S.SUBMITTED, S.CANCELLED, ADMIN).action == ClaimAction.WITHDRAW
    with pytest.raises(rules.UnauthorizedTransition):
        rules.assert_transition(S.SUBMITTED, S.CANCELLED, AGENT)  # agents cannot withdraw
    for later in (S.UNDER_REVIEW, S.VERIFIED, S.ASSESSED, S.APPROVED):
        with pytest.raises(rules.InvalidTransition):
            rules.assert_transition(later, S.CANCELLED, HOLDER)
    assert rules.assert_transition(S.DRAFT, S.CANCELLED, AGENT).action == ClaimAction.CANCEL_DRAFT
    with pytest.raises(rules.UnauthorizedTransition):
        rules.assert_transition(S.DRAFT, S.CANCELLED, ADMIN)


def test_invalid_is_reported_before_unauthorized():
    # An impossible move is invalid whoever attempts it (frontend rule).
    with pytest.raises(rules.InvalidTransition):
        rules.assert_transition(S.DRAFT, S.SETTLED, HOLDER)


def test_messages_explain_the_rule():
    with pytest.raises(rules.InvalidTransition) as invalid:
        rules.assert_transition(S.DRAFT, S.SETTLED, ADMIN)
    assert str(invalid.value) == (
        "A claim cannot move from Draft to Settled. "
        "From Draft it can only move to: Submitted, Cancelled."
    )
    with pytest.raises(rules.UnauthorizedTransition) as unauthorized:
        rules.assert_transition(S.ASSESSED, S.APPROVED, AGENT)
    assert str(unauthorized.value) == (
        "Agent cannot move a claim from Assessed to Approved. Only a Claims Officer can."
    )


@pytest.mark.parametrize(
    ("status", "role", "moves"),
    [
        (S.SUBMITTED, HOLDER, {S.CANCELLED}),
        (S.SUBMITTED, AGENT, set()),
        (S.SUBMITTED, ADMIN, {S.UNDER_REVIEW, S.CANCELLED}),
        (S.ASSESSED, ADMIN, {S.APPROVED, S.REJECTED}),
        (S.ASSESSED, HOLDER, set()),
        (S.SETTLED, ADMIN, set()),
    ],
)
def test_available_transitions_per_role(status, role, moves):
    assert {target for target, _ in rules.available_transitions(status, role)} == moves


def test_happy_path_is_a_chain_of_legal_administrator_moves():
    previous = S.SUBMITTED
    for status in HAPPY_PATH[1:]:
        rules.assert_transition(previous, status, ADMIN)
        previous = status


def test_filing_roles():
    assert rules.can_file(HOLDER) and rules.can_file(AGENT)
    assert not rules.can_file(ADMIN)


# --- eligibility --------------------------------------------------------------------

HEALTH_TYPE = rules.ClaimTypeFacts(
    code="hospitalisation",
    label="Hospitalisation",
    product_type="health",
    coverage_item="In-patient hospitalisation",
    percent_of_coverage=100,
    max_amount=None,
    limit_basis="Up to the sum insured",
    documents=(
        rules.DocumentRequirement("discharge-summary", "Hospital discharge summary", True),
        rules.DocumentRequirement("hospital-bill", "Hospital bill", True),
        rules.DocumentRequirement("other", "Other supporting document", False),
    ),
)
TERMINAL_TYPE = rules.ClaimTypeFacts(
    code="terminal-illness",
    label="Terminal illness",
    product_type="life",
    coverage_item="Terminal illness benefit",
    percent_of_coverage=100,
    max_amount=D("2000000.00"),
    limit_basis="Sum assured, capped at Rs. 20,00,000",
)
TYPES = [HEALTH_TYPE, TERMINAL_TYPE]


def _policy(**overrides) -> rules.PolicyFacts:
    values = {
        "policy_number": "POL-2026-000001",
        "product_name": "Secure Health Shield",
        "product_type": "health",
        "status": "active",
        "issue_date": date(2026, 1, 1),
        "start_date": date(2026, 1, 1),
        "end_date": date(2026, 12, 31),
        "coverage_amount": D("1000000.00"),
        "coverage_items": frozenset({"In-patient hospitalisation", "Day-care procedures"}),
        **overrides,
    }
    return rules.PolicyFacts(**values)


def _outcomes(result: rules.Eligibility) -> dict[str, str]:
    return {c.id: c.outcome for c in result.checks}


def test_eligible_policy():
    result = rules.evaluate_eligibility(_policy(), TYPES, rules.PremiumFacts("up_to_date"), TODAY)
    assert result.eligible
    assert result.compatible_types == ["hospitalisation"]
    assert result.incident_earliest == date(2026, 1, 1)
    assert result.incident_latest == TODAY  # cannot be in the future
    assert result.filing_deadline == date(2026, 12, 31) + timedelta(days=90)


def test_missing_policy_skips_other_checks():
    result = rules.evaluate_eligibility(None, TYPES, None, TODAY)
    assert not result.eligible
    assert _outcomes(result) == {
        "policy-found": "fail",
        "policy-issued": "skipped",
        "policy-active": "skipped",
        "coverage": "skipped",
        "premium-standing": "skipped",
    }


@pytest.mark.parametrize(
    ("overrides", "check", "outcome", "eligible"),
    [
        ({"status": "pending", "issue_date": None}, "policy-issued", "fail", False),
        ({"status": "lapsed"}, "policy-active", "fail", False),
        ({"start_date": TODAY + timedelta(days=1)}, "policy-active", "fail", False),
        (
            {"end_date": TODAY - timedelta(days=10)},
            "policy-active",
            "warning",
            True,
        ),  # grace window
        ({"end_date": TODAY - timedelta(days=90)}, "policy-active", "warning", True),  # last day
        ({"end_date": TODAY - timedelta(days=91)}, "policy-active", "fail", False),  # window closed
        ({"coverage_items": frozenset({"Room rent"})}, "coverage", "fail", False),
        ({"product_type": "motor"}, "coverage", "fail", False),
    ],
)
def test_eligibility_rules(overrides, check, outcome, eligible):
    result = rules.evaluate_eligibility(
        _policy(**overrides), TYPES, rules.PremiumFacts("up_to_date"), TODAY
    )
    assert _outcomes(result)[check] == outcome
    assert result.eligible is eligible


def test_overdue_premium_warns_but_never_blocks():
    premium = rules.PremiumFacts("overdue", 2, D("3100.00"), date(2026, 5, 10))
    result = rules.evaluate_eligibility(_policy(), TYPES, premium, TODAY)
    assert result.eligible
    assert _outcomes(result)["premium-standing"] == "warning"
    assert "2 instalments overdue (₹3,100) since 10 May 2026" in result.warnings[0]


def test_missing_premium_schedule_is_a_warning():
    assert (
        _outcomes(rules.evaluate_eligibility(_policy(), TYPES, None, TODAY))["premium-standing"]
        == "warning"
    )


# --- limits -------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("claim_type", "coverage", "limit", "capped"),
    [
        (HEALTH_TYPE, "1000000.00", "1000000.00", False),
        (TERMINAL_TYPE, "7500000.00", "2000000.00", True),  # capped at the maximum
        (TERMINAL_TYPE, "1500000.00", "1500000.00", False),
        (
            rules.ClaimTypeFacts("x", "X", "home", "Household contents", 20, None, "20%"),
            "2800000.00",
            "560000.00",
            False,
        ),
        (rules.ClaimTypeFacts("y", "Y", "home", "c", 33, None, "33%"), "1000.50", "330.00", False),
    ],
)
def test_illustrative_limit(claim_type, coverage, limit, capped):
    result = rules.illustrative_limit(claim_type, D(coverage))
    assert result.limit == D(limit)
    assert result.capped_by_maximum is capped


# --- filing form ----------------------------------------------------------------------


def _validate(**overrides) -> dict[str, str]:
    values = {
        "policy": _policy(),
        "claim_type": HEALTH_TYPE,
        "compatible_codes": ["hospitalisation"],
        "incident_date": date(2026, 9, 1),
        "claimed_amount": D("50000.00"),
        "description": "Admitted for three days with a fracture after a fall at home.",
        "documents": {"discharge-summary": "discharge.pdf", "hospital-bill": "bill.pdf"},
        "today": TODAY,
        **overrides,
    }
    return rules.validate_claim(**values)


def test_valid_claim_has_no_errors():
    assert _validate() == {}
    assert (
        _validate(
            documents={"discharge-summary": "d.pdf", "hospital-bill": "b.pdf", "other": "x.pdf"}
        )
        == {}
    )


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"claim_type": None}, "claim_type"),
        ({"claim_type": TERMINAL_TYPE}, "claim_type"),  # a life benefit on a health policy
        ({"compatible_codes": []}, "claim_type"),
        ({"incident_date": TODAY + timedelta(days=1)}, "incident_date"),
        ({"incident_date": date(2025, 12, 31)}, "incident_date"),  # before cover
        ({"claimed_amount": D("0")}, "claimed_amount"),
        ({"claimed_amount": D("10.005")}, "claimed_amount"),
        ({"description": "Too short."}, "description"),
        ({"description": "x" * 1001}, "description"),
        ({"documents": {"discharge-summary": "d.pdf"}}, "documents.hospital-bill"),
        (
            {"documents": {"discharge-summary": "d.pdf", "hospital-bill": "b"}},
            "documents.hospital-bill",
        ),
        (
            {
                "documents": {
                    "discharge-summary": "d.pdf",
                    "hospital-bill": "b.pdf",
                    "passport": "p.pdf",
                }
            },
            "documents.passport",
        ),
    ],
)
def test_filing_rules(overrides, field):
    assert field in _validate(**overrides)


# --- verification ---------------------------------------------------------------------


def _checklist(**overrides) -> rules.Checklist:
    values = {
        "incident_date": date(2026, 9, 1),
        "filing_date": date(2026, 9, 5),
        "claimed_amount": D("50000.00"),
        "policy": _policy(),
        "claim_type": HEALTH_TYPE,
        "document_types": {"discharge-summary", "hospital-bill"},
        "premium": rules.PremiumFacts("up_to_date"),
        "limit": rules.illustrative_limit(HEALTH_TYPE, D("1000000.00")),
        **overrides,
    }
    return rules.verification_checklist(**values)


def test_clean_checklist_passes_all_six_checks():
    checklist = _checklist()
    assert [c.id for c in checklist.checks] == [
        "cover-on-incident",
        "coverage-applies",
        "incident-date",
        "claimed-amount",
        "documents",
        "premium-standing",
    ]
    assert (checklist.passed, checklist.warnings, checklist.failures, checklist.blocking) == (
        6,
        0,
        0,
        False,
    )


@pytest.mark.parametrize(
    ("overrides", "check", "outcome"),
    [
        ({"incident_date": date(2025, 6, 1)}, "cover-on-incident", "fail"),
        ({"policy": None}, "cover-on-incident", "fail"),
        ({"claim_type": TERMINAL_TYPE}, "coverage-applies", "fail"),
        ({"incident_date": date(2026, 9, 10)}, "incident-date", "fail"),
        (
            {"claimed_amount": D("2000000.00")},
            "claimed-amount",
            "warning",
        ),  # above limit: capped later
        ({"document_types": {"discharge-summary"}}, "documents", "fail"),
        (
            {"premium": rules.PremiumFacts("overdue", 1, D("1550.00"), date(2026, 5, 10))},
            "premium-standing",
            "warning",
        ),
        ({"premium": None}, "premium-standing", "warning"),
    ],
)
def test_checklist_rules(overrides, check, outcome):
    checklist = _checklist(**overrides)
    assert {c.id: c.outcome for c in checklist.checks}[check] == outcome
    assert checklist.blocking is (outcome == "fail")


# --- assessment, rejection, approval --------------------------------------------------


@pytest.mark.parametrize(
    ("assessed", "note", "field"),
    [
        ("0", None, "assessed_amount"),
        ("-5", None, "assessed_amount"),
        ("100.001", None, "assessed_amount"),
        ("50000.01", None, "assessed_amount"),  # above claimed
        ("45000", None, "note"),  # a reduction must be explained
        ("45000", "too short", "note"),
    ],
)
def test_invalid_assessments(assessed, note, field):
    errors = rules.validate_assessment(
        assessed_amount=D(assessed), claimed_amount=D("50000"), limit=D("1000000"), note=note
    )
    assert field in errors


def test_assessment_cannot_exceed_the_limit():
    errors = rules.validate_assessment(
        assessed_amount=D("600000"),
        claimed_amount=D("700000"),
        limit=D("560000"),
        note="Capped at limit.",
    )
    assert "illustrative coverage limit" in errors["assessed_amount"]


def test_valid_assessments():
    assert (
        rules.validate_assessment(
            assessed_amount=D("50000"), claimed_amount=D("50000"), limit=D("1000000"), note=None
        )
        == {}
    )
    assert (
        rules.validate_assessment(
            assessed_amount=D("45000"),
            claimed_amount=D("50000"),
            limit=D("1000000"),
            note="Consumables excluded.",
        )
        == {}
    )


@pytest.mark.parametrize(
    ("reason", "valid"),
    [
        ("", False),
        ("   ", False),
        ("Too short", False),
        ("Excluded peril under policy terms.", True),
    ],
)
def test_rejection_reason(reason, valid):
    assert (rules.validate_rejection_reason(reason) is None) is valid


def test_approval_readiness():
    ready = dict(
        assessed_amount=D("45000"),
        illustrative_limit=D("1000000"),
        claimed_amount=D("50000"),
        note="Consumables excluded.",
    )
    assert rules.approval_readiness(status="assessed", **ready) is None
    assert (
        rules.approval_readiness(status="verified", **ready)
        == "Only an assessed claim can be approved."
    )
    assert "no valid assessment" in rules.approval_readiness(
        status="assessed",
        assessed_amount=None,
        illustrative_limit=None,
        claimed_amount=D("1"),
        note=None,
    )
    stale = {**ready, "illustrative_limit": D("40000")}
    assert "no longer valid" in rules.approval_readiness(status="assessed", **stale)


# --- decision explanation -------------------------------------------------------------


def _decision(**overrides):
    values = {
        "status": "assessed",
        "claimed_amount": D("50000"),
        "assessed_amount": D("50000"),
        "illustrative_limit": D("1000000"),
        "limit_basis": "Up to the sum insured",
        "assessment_note": None,
        "approved_amount": None,
        "rejection_reason": None,
        "settlement_reference": None,
        **overrides,
    }
    return rules.decision_summary(**values)


def test_no_decision_before_assessment():
    assert _decision(assessed_amount=None, illustrative_limit=None) is None


def test_decision_reasons_come_from_explicit_rules():
    assert _decision().reasons == [
        "The claimed amount is within the illustrative coverage limit.",
        "Awaiting an approval or rejection decision by a claims officer.",
    ]
    capped = _decision(
        claimed_amount=D("3000000"), assessed_amount=D("2000000"), illustrative_limit=D("2000000")
    )
    assert capped.reasons[0] == (
        "The claimed amount exceeds the illustrative limit, "
        "so the assessment is capped at ₹20,00,000."
    )
    reduced = _decision(assessed_amount=D("46500"), assessment_note="Consumables excluded.")
    assert reduced.reasons[0] == "Assessed ₹3,500 below the claimed amount: Consumables excluded."


@pytest.mark.parametrize(
    ("overrides", "decision", "label", "last_reason"),
    [
        (
            {},
            "pending",
            "Awaiting decision",
            "Awaiting an approval or rejection decision by a claims officer.",
        ),
        (
            {"status": "approved", "approved_amount": D("50000")},
            "approved",
            "Approved",
            "Approved for the assessed amount of ₹50,000.",
        ),
        (
            {"status": "rejected", "rejection_reason": "Excluded peril under policy terms."},
            "rejected",
            "Rejected",
            "Rejected: Excluded peril under policy terms.",
        ),
        (
            {
                "status": "settled",
                "approved_amount": D("50000"),
                "settlement_reference": "SET-2026-000001",
            },
            "settled",
            "Approved and settled",
            "Approved for ₹50,000 and settled under reference SET-2026-000001.",
        ),
    ],
)
def test_decision_outcomes(overrides, decision, label, last_reason):
    summary = _decision(**overrides)
    assert (summary.decision, summary.decision_label, summary.reasons[-1]) == (
        decision,
        label,
        last_reason,
    )


def test_approval_reason():
    assert (
        rules.approval_reason(D("5"), D("5"))
        == "Assessed amount is within the illustrative coverage limit."
    )
    assert rules.approval_reason(D("4"), D("5")) == "Approved at the assessed amount."


def test_indian_currency_format():
    assert rules.format_inr(D("1234567.50")) == "₹12,34,567.50"
    assert rules.format_inr(D("64900")) == "₹64,900"
    assert rules.format_inr(D("999")) == "₹999"
