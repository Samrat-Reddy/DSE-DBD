"""Pure premium-schedule and payment rules: no database, no clock.

Every time-dependent function takes `today` explicitly, so the rules are
deterministic and unit-testable.

Money rule (the single source of truth for splitting a premium):
    total   = annual premium x term (years)
    count   = instalments per year x term
    regular = total / count, rounded DOWN to the paisa
    final   = total - regular x (count - 1)
The final instalment absorbs the remainder (0 to count-1 paise), so the
instalments always add up to the total exactly: no money is lost or created.
"""

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_DOWN, Decimal

from app.models.enums import InstallmentStatus, PaymentStatus, PremiumFrequency

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MAX_TERM_YEARS = 50

# An unpaid instalment becomes payable (and "due") this many days before its
# due date. Same rule as DUE_WINDOW_DAYS in the frontend.
DUE_WINDOW_DAYS = 30

MONTHS_BETWEEN = {
    PremiumFrequency.MONTHLY: 1,
    PremiumFrequency.QUARTERLY: 3,
    PremiumFrequency.HALF_YEARLY: 6,
    PremiumFrequency.ANNUAL: 12,
}


class ScheduleError(ValueError):
    """The inputs cannot produce a valid premium schedule."""


@dataclass(frozen=True)
class PlannedInstallment:
    number: int
    due_date: date
    amount: Decimal


# --- schedule generation --------------------------------------------------------


def add_months(start: date, months: int) -> date:
    """`start` plus whole months, clamped to the last day of a shorter month
    (31 Jan + 1 month = 28/29 Feb)."""
    month_index = start.month - 1 + months
    year, month = start.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(start.day, monthrange(year, month)[1]))


def _require_money(value: Decimal, name: str) -> None:
    if not isinstance(value, Decimal) or value <= 0 or value != value.quantize(CENT):
        raise ScheduleError(f"{name} must be a positive amount with at most 2 decimal places")


def split_amount(total: Decimal, count: int) -> list[Decimal]:
    """Split `total` into `count` amounts at paisa precision (see module docstring)."""
    _require_money(total, "total")
    if count < 1:
        raise ScheduleError("count must be at least 1")
    regular = (total / count).quantize(CENT, rounding=ROUND_DOWN)
    if regular <= 0:
        raise ScheduleError("total is too small to split into this many instalments")
    final = total - regular * (count - 1)
    return [regular] * (count - 1) + [final]


def regular_installment_amount(annual_premium: Decimal, frequency: PremiumFrequency) -> Decimal:
    """The amount of every instalment except (possibly) the final one."""
    return split_amount(annual_premium, frequency.instalments_per_year)[0]


def plan_schedule(
    *,
    start_date: date,
    term_years: int,
    frequency: PremiumFrequency,
    annual_premium: Decimal,
) -> list[PlannedInstallment]:
    """The instalments of a policy: numbered 1..n, due every `12/per-year`
    months from the start date, summing exactly to annual premium x term.

    Each due date is computed from the start date (not the previous due date),
    so month-end clamping never accumulates drift. The last due date is always
    before the policy's end date.
    """
    if not 1 <= term_years <= MAX_TERM_YEARS:
        raise ScheduleError(f"term_years must be between 1 and {MAX_TERM_YEARS}")
    frequency = PremiumFrequency(frequency)
    _require_money(annual_premium, "annual_premium")

    count = frequency.instalments_per_year * term_years
    amounts = split_amount(annual_premium * term_years, count)
    step = MONTHS_BETWEEN[frequency]
    return [
        PlannedInstallment(number=n, due_date=add_months(start_date, (n - 1) * step), amount=amount)
        for n, amount in enumerate(amounts, 1)
    ]


# --- instalment state -----------------------------------------------------------


def stored_status(amount_paid: Decimal, amount_due: Decimal) -> InstallmentStatus:
    """The persisted status implied by the money paid (mirrors the DB CHECK)."""
    if amount_paid < 0 or amount_paid > amount_due:
        raise ValueError("amount_paid must be between 0 and amount_due")
    if amount_paid == 0:
        return InstallmentStatus.PENDING
    if amount_paid < amount_due:
        return InstallmentStatus.PARTIALLY_PAID
    return InstallmentStatus.PAID


def effective_status(
    status: InstallmentStatus | str, due_date: date, today: date
) -> InstallmentStatus:
    """Stored status plus time: anything not fully paid after its due date is OVERDUE."""
    status = InstallmentStatus(status)
    if status != InstallmentStatus.PAID and due_date < today:
        return InstallmentStatus.OVERDUE
    return status


def payable_from(due_date: date) -> date:
    return due_date - timedelta(days=DUE_WINDOW_DAYS)


def timing(outstanding: Decimal, due_date: date, today: date) -> str:
    """Bucket used for summaries: paid | overdue | due | upcoming."""
    if outstanding <= 0:
        return "paid"
    if due_date < today:
        return "overdue"
    if today >= payable_from(due_date):
        return "due"
    return "upcoming"


class PaymentRejected(Exception):
    """A payment request breaks a rule. `conflict` separates state conflicts
    (409: already paid, pending payment, not yet payable) from invalid input
    (422: amount above the remaining balance)."""

    def __init__(self, message: str, *, conflict: bool) -> None:
        super().__init__(message)
        self.conflict = conflict


def check_payment(
    *,
    amount: Decimal,
    amount_due: Decimal,
    amount_paid: Decimal,
    due_date: date,
    has_pending_payment: bool,
    today: date,
) -> None:
    """Raise PaymentRejected unless a payment of `amount` may be recorded now."""
    if amount <= 0 or amount != amount.quantize(CENT):
        raise PaymentRejected(
            "Payment amount must be greater than zero with at most 2 decimal places.",
            conflict=False,
        )
    remaining = amount_due - amount_paid
    if remaining <= 0:
        raise PaymentRejected("This instalment is already fully paid.", conflict=True)
    if has_pending_payment:
        raise PaymentRejected(
            "A payment for this instalment is still pending; resolve it first.", conflict=True
        )
    if today < payable_from(due_date):
        raise PaymentRejected(
            f"This instalment is not due yet. It becomes payable on "
            f"{payable_from(due_date).isoformat()}.",
            conflict=True,
        )
    if amount > remaining:
        raise PaymentRejected(
            f"Payment amount exceeds the remaining balance of {remaining}.", conflict=False
        )


def apply_successful_payment(
    amount_paid: Decimal, amount_due: Decimal, amount: Decimal
) -> tuple[Decimal, InstallmentStatus]:
    """New (amount_paid, status) after a successful payment of `amount`."""
    new_paid = amount_paid + amount
    return new_paid, stored_status(new_paid, amount_due)


# PENDING can settle either way; SUCCESSFUL and FAILED are final.
_PAYMENT_TRANSITIONS = {
    PaymentStatus.PENDING: {PaymentStatus.SUCCESSFUL, PaymentStatus.FAILED},
    PaymentStatus.SUCCESSFUL: set(),
    PaymentStatus.FAILED: set(),
}


def can_transition(current: PaymentStatus | str, target: PaymentStatus | str) -> bool:
    return PaymentStatus(target) in _PAYMENT_TRANSITIONS[PaymentStatus(current)]


# --- account summary ------------------------------------------------------------


@dataclass(frozen=True)
class InstallmentView:
    """The facts a summary needs about one instalment."""

    id: int
    number: int
    due_date: date
    amount_due: Decimal
    amount_paid: Decimal

    @property
    def outstanding(self) -> Decimal:
        return self.amount_due - self.amount_paid


def standing(counts: dict[str, int]) -> str:
    """Policy-level premium standing, worst first."""
    if counts["overdue"]:
        return "overdue"
    if counts["due"]:
        return "due"
    if counts["upcoming"]:
        return "up_to_date"
    return "fully_paid"


def summarise(installments: list[InstallmentView], total_premium: Decimal, today: date) -> dict:
    counts = {"paid": 0, "overdue": 0, "due": 0, "upcoming": 0}
    amounts = {"overdue": ZERO, "due": ZERO, "upcoming": ZERO}
    partially_paid = 0
    next_due: InstallmentView | None = None
    oldest_overdue: InstallmentView | None = None

    for item in sorted(installments, key=lambda i: i.due_date):
        bucket = timing(item.outstanding, item.due_date, today)
        counts[bucket] += 1
        if bucket == "paid":
            continue
        amounts[bucket] += item.outstanding
        if item.amount_paid > 0:
            partially_paid += 1
        next_due = next_due or item
        if bucket == "overdue" and oldest_overdue is None:
            oldest_overdue = item

    total_paid = sum((i.amount_paid for i in installments), ZERO)
    return {
        "installment_count": len(installments),
        "counts": {**counts, "partially_paid": partially_paid},
        "total_premium": total_premium,
        "total_paid": total_paid,
        "outstanding": total_premium - total_paid,
        "overdue_amount": amounts["overdue"],
        "due_amount": amounts["due"],
        "upcoming_amount": amounts["upcoming"],
        "payable_now": amounts["overdue"] + amounts["due"],
        "next_due": next_due,
        "oldest_overdue": oldest_overdue,
        "oldest_overdue_days": (today - oldest_overdue.due_date).days if oldest_overdue else 0,
        "standing": standing(counts),
    }
