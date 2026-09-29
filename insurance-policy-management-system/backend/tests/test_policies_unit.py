"""Module 1 logic that needs no database: pricing, request validation, lifecycle."""

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.models import PremiumFrequency
from app.schemas.policies import PolicyholderIn, PolicyIssueRequest
from app.services.policies import build_lifecycle
from app.services.pricing import instalment_premium, rate_annual_premium

TODAY = date.today()
PRODUCT = SimpleNamespace(
    base_annual_premium=Decimal("18500.00"), reference_coverage_amount=Decimal("1000000.00")
)


# --- pricing (must match frontend/src/utils/policyPricing.js) ----------------


@pytest.mark.parametrize(
    ("coverage", "annual"),
    [("1000000", "18500"), ("1500000", "27750"), ("300000", "5550"), ("333333", "6167")],
)
def test_annual_premium_scales_with_coverage(coverage, annual):
    result = rate_annual_premium(PRODUCT, Decimal(coverage))
    assert result == Decimal(annual)
    assert str(result).endswith(".00")


@pytest.mark.parametrize(
    ("annual", "frequency", "instalment"),
    [
        ("27750", PremiumFrequency.MONTHLY, "2313"),  # 2312.5 rounds half-up, like Math.round
        ("18600", PremiumFrequency.QUARTERLY, "4650"),
        ("3100", PremiumFrequency.HALF_YEARLY, "1550"),
        ("18500", PremiumFrequency.ANNUAL, "18500"),
    ],
)
def test_instalment_premium_rounds_half_up(annual, frequency, instalment):
    assert instalment_premium(Decimal(annual), frequency) == Decimal(instalment)


# --- request validation -------------------------------------------------------


def _holder(**overrides) -> dict:
    values = {
        "full_name": "  Test Holder ",
        "date_of_birth": "1990-01-01",
        "email": "holder@example.com",
        "phone": "98450 12377",
        "address_line1": "1 Main Road",
        "city": "Bengaluru",
        "state": "Karnataka",
        "postal_code": "560001",
    }
    values.update(overrides)
    return values


def _request(**overrides) -> dict:
    values = {
        "product_code": "PRD-HLT-001",
        "policyholder": _holder(),
        "coverage_amount": "1000000",
        "start_date": (TODAY + timedelta(days=1)).isoformat(),
        "term_years": 1,
        "premium_frequency": "annual",
        "nominee": {
            "name": "Nominee Name",
            "relationship": "Spouse",
            "date_of_birth": "1991-02-03",
        },
    }
    values.update(overrides)
    return values


@pytest.mark.parametrize("raw", ["9845012377", "+91 98450 12377", "91-9845012377", "98450-12377"])
def test_phone_is_normalised_to_ten_digits(raw):
    assert PolicyholderIn(**_holder(phone=raw)).phone == "9845012377"


@pytest.mark.parametrize("raw", ["12345", "5845012377", "98450123777", "abcdefghij"])
def test_invalid_phone_rejected(raw):
    with pytest.raises(ValidationError):
        PolicyholderIn(**_holder(phone=raw))


def test_blank_optional_fields_become_none_and_text_is_trimmed():
    holder = PolicyholderIn(**_holder(customer_code="  ", address_line2=""))
    assert holder.customer_code is None
    assert holder.address_line2 is None
    assert holder.full_name == "Test Holder"


@pytest.mark.parametrize(
    "overrides",
    [
        {"product_code": "HLT-001"},
        {"coverage_amount": "0"},
        {"coverage_amount": "-5"},
        {"coverage_amount": "100.123"},
        {"term_years": 0},
        {"premium_frequency": "Weekly"},
        {"start_date": (TODAY - timedelta(days=1)).isoformat()},
        {"start_date": "2026-02-30"},
        {"agent_code": "AGT-22"},
        {"policyholder": _holder(customer_code="CUS-12")},
        {"policyholder": _holder(postal_code="56001")},
        {"policyholder": _holder(email="not-an-email")},
        {"policyholder": _holder(full_name="Al")},
        {"policyholder": _holder(date_of_birth=(TODAY + timedelta(days=1)).isoformat())},
        {"nominee": {"name": "Nominee", "relationship": "Cousin", "date_of_birth": "1990-01-01"}},
    ],
)
def test_issue_request_rejects_invalid_values(overrides):
    with pytest.raises(ValidationError):
        PolicyIssueRequest(**_request(**overrides))


def test_issue_request_does_not_accept_a_client_premium():
    request = PolicyIssueRequest(**_request(annual_premium="1"))
    assert not hasattr(request, "annual_premium")


# --- lifecycle ------------------------------------------------------------------


def _policy(issue, start, end):
    return SimpleNamespace(issue_date=issue, start_date=start, end_date=end)


def test_lifecycle_for_policy_in_force():
    events = build_lifecycle(
        _policy(TODAY - timedelta(days=10), TODAY - timedelta(days=5), TODAY + timedelta(days=300)),
        TODAY,
    )
    assert [(e.stage, e.status) for e in events] == [
        ("Policy issued", "completed"),
        ("Cover starts", "completed"),
        ("Cover ends", "upcoming"),
    ]


def test_lifecycle_for_pending_and_expired_policies():
    pending = build_lifecycle(
        _policy(None, TODAY + timedelta(days=5), TODAY + timedelta(days=370)), TODAY
    )
    assert [(e.stage, e.status, e.date) for e in pending][0] == (
        "Awaiting issuance",
        "upcoming",
        None,
    )
    assert pending[1].status == "upcoming"

    expired = build_lifecycle(
        _policy(date(2023, 9, 14), date(2023, 9, 20), date(2024, 9, 19)), TODAY
    )
    assert all(e.status == "completed" for e in expired)
