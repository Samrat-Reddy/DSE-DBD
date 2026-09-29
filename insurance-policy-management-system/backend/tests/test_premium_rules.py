"""Module 2 pure rules: schedule generation, money split, statuses, payment checks."""

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.models import InstallmentStatus, PaymentStatus, PremiumFrequency
from app.services import premium_rules as rules

D = Decimal
TODAY = date(2026, 9, 29)


# --- dates ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "months", "expected"),
    [
        (date(2024, 1, 15), 1, date(2024, 2, 15)),
        (date(2024, 1, 31), 1, date(2024, 2, 29)),  # clamped, leap year
        (date(2025, 1, 31), 1, date(2025, 2, 28)),  # clamped, common year
        (date(2024, 8, 31), 6, date(2025, 2, 28)),
        (date(2024, 11, 10), 12, date(2025, 11, 10)),
        (date(2024, 2, 29), 12, date(2025, 2, 28)),
        (date(2024, 12, 5), 1, date(2025, 1, 5)),  # year rollover
        (date(2024, 7, 5), 297, date(2049, 4, 5)),
    ],
)
def test_add_months(start, months, expected):
    assert rules.add_months(start, months) == expected


def test_due_dates_are_computed_from_the_start_so_clamping_never_drifts():
    plan = rules.plan_schedule(
        start_date=date(2025, 1, 31),
        term_years=1,
        frequency=PremiumFrequency.MONTHLY,
        annual_premium=D("12000.00"),
    )
    days = [p.due_date.day for p in plan]
    # Feb clamps to 28, March is back to 31 (not stuck at 28).
    assert days[:3] == [31, 28, 31]
    assert [p.due_date.month for p in plan] == list(range(1, 13))


# --- generation per frequency -----------------------------------------------------


@pytest.mark.parametrize(
    ("frequency", "term", "count", "step_months"),
    [
        (PremiumFrequency.MONTHLY, 1, 12, 1),
        (PremiumFrequency.MONTHLY, 2, 24, 1),
        (PremiumFrequency.QUARTERLY, 25, 100, 3),
        (PremiumFrequency.HALF_YEARLY, 2, 4, 6),
        (PremiumFrequency.ANNUAL, 1, 1, 12),
        (PremiumFrequency.ANNUAL, 30, 30, 12),
    ],
)
def test_plan_counts_numbers_and_dates(frequency, term, count, step_months):
    start = date(2024, 7, 5)
    plan = rules.plan_schedule(
        start_date=start, term_years=term, frequency=frequency, annual_premium=D("18600.00")
    )
    assert len(plan) == count
    assert [p.number for p in plan] == list(range(1, count + 1))
    assert plan[0].due_date == start
    for n, item in enumerate(plan):
        assert item.due_date == rules.add_months(start, n * step_months)
    # Every instalment falls inside the policy period (end = start + term - 1 day).
    end = rules.add_months(start, 12 * term) - timedelta(days=1)
    assert plan[-1].due_date <= end
    assert all(a.due_date < b.due_date for a, b in zip(plan, plan[1:], strict=False))


def test_plan_matches_the_seeded_frontend_schedules():
    # POL-2024-000226: 18,600 a year, quarterly, 25 years -> 100 x 4,650.
    plan = rules.plan_schedule(
        start_date=date(2024, 7, 5),
        term_years=25,
        frequency=PremiumFrequency.QUARTERLY,
        annual_premium=D("18600.00"),
    )
    assert {p.amount for p in plan} == {D("4650.00")}
    assert plan[8].due_date == date(2026, 7, 5)  # instalment 9


# --- money split ------------------------------------------------------------------


@pytest.mark.parametrize(
    ("total", "count", "regular", "final"),
    [
        (D("27750.00"), 12, D("2312.50"), D("2312.50")),  # divides exactly
        (D("18500.00"), 12, D("1541.66"), D("1541.74")),  # 8 paise remainder on the last
        (D("1000.00"), 3, D("333.33"), D("333.34")),
        (D("100.00"), 7, D("14.28"), D("14.32")),
        (D("0.10"), 3, D("0.03"), D("0.04")),
        (D("555000.00"), 600, D("925.00"), D("925.00")),
    ],
)
def test_split_amount_puts_the_remainder_on_the_final_instalment(total, count, regular, final):
    parts = rules.split_amount(total, count)
    assert len(parts) == count
    assert parts[:-1] == [regular] * (count - 1)
    assert parts[-1] == final
    assert sum(parts) == total  # no money lost or created
    assert all(p == p.quantize(rules.CENT) for p in parts)
    assert D("0") <= parts[-1] - parts[0] < count * rules.CENT


@pytest.mark.parametrize("annual", ["18500.00", "12400.00", "4800.00", "27750.00", "3333.33"])
@pytest.mark.parametrize("frequency", list(PremiumFrequency))
@pytest.mark.parametrize("term", [1, 2, 3, 25])
def test_schedule_total_always_equals_annual_premium_times_term(annual, frequency, term):
    plan = rules.plan_schedule(
        start_date=date(2025, 3, 31), term_years=term, frequency=frequency, annual_premium=D(annual)
    )
    assert sum(p.amount for p in plan) == D(annual) * term
    assert all(p.amount > 0 for p in plan)


def test_regular_installment_amount_matches_the_plan():
    plan = rules.plan_schedule(
        start_date=date(2025, 1, 1),
        term_years=2,
        frequency=PremiumFrequency.MONTHLY,
        annual_premium=D("18500.00"),
    )
    regular = rules.regular_installment_amount(D("18500.00"), PremiumFrequency.MONTHLY)
    assert regular == D("1541.66")
    assert all(p.amount == regular for p in plan[:-1])


@pytest.mark.parametrize(
    "kwargs",
    [
        {"term_years": 0},
        {"term_years": 51},
        {"annual_premium": D("0.00")},
        {"annual_premium": D("-10.00")},
        {"annual_premium": D("100.001")},
        {"annual_premium": 100},  # not a Decimal
        {"frequency": "weekly"},
    ],
)
def test_plan_rejects_invalid_inputs(kwargs):
    arguments = {
        "start_date": date(2025, 1, 1),
        "term_years": 1,
        "frequency": PremiumFrequency.MONTHLY,
        "annual_premium": D("1200.00"),
        **kwargs,
    }
    with pytest.raises(ValueError):
        rules.plan_schedule(**arguments)


def test_split_rejects_amounts_too_small_to_split():
    with pytest.raises(rules.ScheduleError):
        rules.split_amount(D("0.05"), 12)


# --- instalment status --------------------------------------------------------------


@pytest.mark.parametrize(
    ("paid", "due", "status"),
    [
        (D("0.00"), D("100.00"), InstallmentStatus.PENDING),
        (D("0.01"), D("100.00"), InstallmentStatus.PARTIALLY_PAID),
        (D("99.99"), D("100.00"), InstallmentStatus.PARTIALLY_PAID),
        (D("100.00"), D("100.00"), InstallmentStatus.PAID),
    ],
)
def test_stored_status_follows_the_money(paid, due, status):
    assert rules.stored_status(paid, due) == status


@pytest.mark.parametrize("paid", [D("-0.01"), D("100.01")])
def test_stored_status_rejects_impossible_balances(paid):
    with pytest.raises(ValueError):
        rules.stored_status(paid, D("100.00"))


@pytest.mark.parametrize(
    ("status", "due_date", "expected"),
    [
        ("pending", TODAY, InstallmentStatus.PENDING),  # due today is not overdue yet
        ("pending", TODAY - timedelta(days=1), InstallmentStatus.OVERDUE),
        ("partially_paid", TODAY - timedelta(days=1), InstallmentStatus.OVERDUE),
        ("partially_paid", TODAY + timedelta(days=5), InstallmentStatus.PARTIALLY_PAID),
        ("paid", TODAY - timedelta(days=400), InstallmentStatus.PAID),
    ],
)
def test_effective_status_adds_overdue(status, due_date, expected):
    assert rules.effective_status(status, due_date, TODAY) == expected


@pytest.mark.parametrize(
    ("outstanding", "days_until_due", "bucket"),
    [
        (D("0.00"), -10, "paid"),
        (D("5.00"), -1, "overdue"),
        (D("5.00"), 0, "due"),
        (D("5.00"), 30, "due"),
        (D("5.00"), 31, "upcoming"),
    ],
)
def test_timing_buckets(outstanding, days_until_due, bucket):
    assert rules.timing(outstanding, TODAY + timedelta(days=days_until_due), TODAY) == bucket


# --- payment checks -----------------------------------------------------------------


def _check(**overrides):
    arguments = {
        "amount": D("100.00"),
        "amount_due": D("100.00"),
        "amount_paid": D("0.00"),
        "due_date": TODAY,
        "has_pending_payment": False,
        "today": TODAY,
        **overrides,
    }
    rules.check_payment(**arguments)


def test_full_and_partial_payments_are_accepted():
    _check()
    _check(amount=D("40.00"))
    _check(amount=D("60.00"), amount_paid=D("40.00"))
    _check(due_date=TODAY - timedelta(days=90))  # overdue is payable
    _check(due_date=TODAY + timedelta(days=30))  # payable window opens 30 days before


@pytest.mark.parametrize(
    ("overrides", "conflict"),
    [
        ({"amount": D("0.00")}, False),
        ({"amount": D("-5.00")}, False),
        ({"amount": D("10.005")}, False),
        ({"amount": D("100.01")}, False),  # overpayment
        ({"amount": D("60.01"), "amount_paid": D("40.00")}, False),  # above remaining
        ({"amount_paid": D("100.00")}, True),  # already paid
        ({"has_pending_payment": True}, True),
        ({"due_date": TODAY + timedelta(days=31)}, True),  # not due yet
    ],
)
def test_invalid_payments_are_rejected(overrides, conflict):
    with pytest.raises(rules.PaymentRejected) as excinfo:
        _check(**overrides)
    assert excinfo.value.conflict is conflict


def test_apply_successful_payment():
    assert rules.apply_successful_payment(D("0.00"), D("100.00"), D("40.00")) == (
        D("40.00"),
        InstallmentStatus.PARTIALLY_PAID,
    )
    assert rules.apply_successful_payment(D("40.00"), D("100.00"), D("60.00")) == (
        D("100.00"),
        InstallmentStatus.PAID,
    )
    with pytest.raises(ValueError):
        rules.apply_successful_payment(D("40.00"), D("100.00"), D("60.01"))


@pytest.mark.parametrize(
    ("current", "target", "allowed"),
    [
        (PaymentStatus.PENDING, PaymentStatus.SUCCESSFUL, True),
        (PaymentStatus.PENDING, PaymentStatus.FAILED, True),
        (PaymentStatus.PENDING, PaymentStatus.PENDING, False),
        (PaymentStatus.SUCCESSFUL, PaymentStatus.FAILED, False),
        (PaymentStatus.SUCCESSFUL, PaymentStatus.PENDING, False),
        (PaymentStatus.FAILED, PaymentStatus.SUCCESSFUL, False),
        (PaymentStatus.FAILED, PaymentStatus.PENDING, False),
    ],
)
def test_payment_status_transitions(current, target, allowed):
    assert rules.can_transition(current, target) is allowed


# --- summary ------------------------------------------------------------------------


def _view(number, days_until_due, due, paid="0.00"):
    return rules.InstallmentView(
        id=number,
        number=number,
        due_date=TODAY + timedelta(days=days_until_due),
        amount_due=D(due),
        amount_paid=D(paid),
    )


def test_summary_buckets_money_and_standing():
    views = [
        _view(1, -200, "100.00", "100.00"),  # paid
        _view(2, -20, "100.00", "30.00"),  # overdue, partially paid
        _view(3, 10, "100.00"),  # due
        _view(4, 100, "100.00"),  # upcoming
    ]
    summary = rules.summarise(views, D("400.00"), TODAY)
    assert summary["counts"] == {
        "paid": 1,
        "overdue": 1,
        "due": 1,
        "upcoming": 1,
        "partially_paid": 1,
    }
    assert summary["total_paid"] == D("130.00")
    assert summary["outstanding"] == D("270.00")
    assert summary["overdue_amount"] == D("70.00")
    assert summary["due_amount"] == D("100.00")
    assert summary["upcoming_amount"] == D("100.00")
    assert summary["payable_now"] == D("170.00")
    assert summary["next_due"].number == 2
    assert summary["oldest_overdue"].number == 2
    assert summary["oldest_overdue_days"] == 20
    assert summary["standing"] == "overdue"


@pytest.mark.parametrize(
    ("views", "standing"),
    [
        ([_view(1, 10, "100.00")], "due"),
        ([_view(1, 100, "100.00")], "up_to_date"),
        ([_view(1, -5, "100.00", "100.00")], "fully_paid"),
    ],
)
def test_standing(views, standing):
    assert rules.summarise(views, D("100.00"), TODAY)["standing"] == standing
