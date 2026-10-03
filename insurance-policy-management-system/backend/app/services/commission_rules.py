"""Pure commission rules: no database, no clock.

Direct translation of the frontend's commissionCalculation.js and
commissionLifecycle.js. All money is in Decimal to avoid float drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from enum import StrEnum

# ---------------------------------------------------------------------------
# Configuration (mirrors frontend COMMISSION_CONFIG)
# ---------------------------------------------------------------------------

EARNING_HOLD_DAYS = 30
MIN_RATE_PERCENT = Decimal("0")
MAX_RATE_PERCENT = Decimal("100")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class CommissionStatus(StrEnum):
    PENDING = "pending"
    EARNED = "earned"
    PAID = "paid"


class CommissionBasis(StrEnum):
    FIRST_YEAR = "first-year"
    RENEWAL = "renewal"


class CommissionEventType(StrEnum):
    GENERATED = "generated"
    STATUS_CHANGED = "status_changed"


class TransitionCode(StrEnum):
    OK = "ok"
    INVALID_STATUS = "invalid-status"
    UNAUTHORIZED = "unauthorized"
    INVALID_TRANSITION = "invalid-transition"
    EARNING_HOLD_ACTIVE = "earning-hold-active"
    INVALID_LINKAGE = "invalid-linkage"


COMMISSION_TRANSITIONS: dict[str, list[str]] = {
    CommissionStatus.PENDING: [CommissionStatus.EARNED],
    CommissionStatus.EARNED: [CommissionStatus.PAID],
    CommissionStatus.PAID: [],
}

INSTALMENTS_PER_YEAR = {
    "monthly": 12,
    "quarterly": 4,
    "half_yearly": 2,
    "annual": 1,
}

# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------

CENT = Decimal("0.01")
ZERO = Decimal("0.00")

# Basis points per 1 percent
BASIS_PER_PERCENT = Decimal("100")


def to_paise(amount: Decimal) -> int:
    """Convert rupee Decimal to integer paise."""
    return int((amount * 100).to_integral_value())


def from_paise(paise: int) -> Decimal:
    return (Decimal(paise) / 100).quantize(CENT)


# ---------------------------------------------------------------------------
# Calculation
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CommissionCalculation:
    valid: bool
    commissionable_amount: Decimal
    rate_percent: Decimal
    amount: Decimal
    message: str | None = None


def calculate_commission(
    commissionable_amount: Decimal, rate_percent: Decimal
) -> CommissionCalculation:
    """Compute commission using paise-level arithmetic with half-up rounding."""
    if rate_percent < MIN_RATE_PERCENT or rate_percent > MAX_RATE_PERCENT:
        return CommissionCalculation(
            valid=False,
            commissionable_amount=commissionable_amount,
            rate_percent=rate_percent,
            amount=ZERO,
            message=f"Rate must be between {MIN_RATE_PERCENT}% and {MAX_RATE_PERCENT}%.",
        )
    if commissionable_amount <= ZERO:
        return CommissionCalculation(
            valid=False,
            commissionable_amount=commissionable_amount,
            rate_percent=rate_percent,
            amount=ZERO,
            message="Commissionable amount must be positive.",
        )
    # Use integer arithmetic for exact money: paise * basis_points / 10000
    basis_points = int((rate_percent * BASIS_PER_PERCENT).to_integral_value())
    commission_paise = round(to_paise(commissionable_amount) * basis_points / 10000)
    return CommissionCalculation(
        valid=True,
        commissionable_amount=commissionable_amount,
        rate_percent=rate_percent,
        amount=from_paise(commission_paise),
    )


# ---------------------------------------------------------------------------
# Policy year / basis
# ---------------------------------------------------------------------------


def get_policy_year(installment_number: int, frequency: str) -> int | None:
    per_year = INSTALMENTS_PER_YEAR.get(frequency)
    if not per_year or installment_number < 1:
        return None
    import math

    return math.ceil(installment_number / per_year)


def determine_basis(policy_year: int | None) -> CommissionBasis | None:
    if policy_year is None:
        return None
    return CommissionBasis.FIRST_YEAR if policy_year == 1 else CommissionBasis.RENEWAL


# ---------------------------------------------------------------------------
# Rule resolution
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CommissionRule:
    """A resolved rule row from the DB (not the ORM model)."""

    id: int
    rule_code: str
    product_id: int
    agent_id: int | None
    first_year_rate_percent: Decimal
    renewal_rate_percent: Decimal
    effective_from: date
    effective_to: date | None
    description: str | None


def _is_effective_on(rule: CommissionRule, on_date: date) -> bool:
    if on_date < rule.effective_from:
        return False
    if rule.effective_to is not None and on_date > rule.effective_to:
        return False
    return True


def resolve_rule(
    rules: list[CommissionRule],
    *,
    product_id: int,
    agent_id: int | None,
    payment_date: date,
) -> CommissionRule | None:
    """Agent-specific beats product-wide; latest effective-from wins."""
    candidates = [
        r
        for r in rules
        if r.product_id == product_id
        and (r.agent_id is None or r.agent_id == agent_id)
        and _is_effective_on(r, payment_date)
    ]
    if not candidates:
        return None
    candidates.sort(
        key=lambda r: (
            r.agent_id is not None,  # agent-specific first (True > False desc)
            r.effective_from,
            r.rule_code,
        ),
        reverse=True,
    )
    return candidates[0]


def get_rate_for_basis(rule: CommissionRule, basis: CommissionBasis) -> Decimal:
    if basis == CommissionBasis.FIRST_YEAR:
        return rule.first_year_rate_percent
    return rule.renewal_rate_percent


# ---------------------------------------------------------------------------
# Lifecycle (PENDING → EARNED → PAID)
# ---------------------------------------------------------------------------


def can_transition(from_status: str, to_status: str) -> bool:
    return to_status in COMMISSION_TRANSITIONS.get(from_status, [])


@dataclass(frozen=True)
class LifecycleResult:
    allowed: bool
    code: TransitionCode
    message: str | None


def _allow() -> LifecycleResult:
    return LifecycleResult(True, TransitionCode.OK, None)


def _deny(code: TransitionCode, message: str) -> LifecycleResult:
    return LifecycleResult(False, code, message)


def check_transition(
    *,
    current_status: str,
    to_status: str,
    payment_date: date,
    as_of: date,
    linkage_valid: bool = True,
) -> LifecycleResult:
    if to_status not in (CommissionStatus.EARNED, CommissionStatus.PAID):
        return _deny(TransitionCode.INVALID_STATUS, f'"{to_status}" is not a commission status.')
    if not can_transition(current_status, to_status):
        hint = ""
        if current_status == CommissionStatus.PAID:
            hint = " Paid is final."
        elif current_status == CommissionStatus.PENDING and to_status == CommissionStatus.PAID:
            hint = " It must be confirmed as earned first."
        return _deny(
            TransitionCode.INVALID_TRANSITION,
            f"A commission cannot move from {current_status} to {to_status}.{hint}",
        )
    if not linkage_valid:
        return _deny(
            TransitionCode.INVALID_LINKAGE,
            "The premium payment behind this commission can no longer be verified.",
        )
    if to_status == CommissionStatus.EARNED:
        days_held = (as_of - payment_date).days
        if days_held < EARNING_HOLD_DAYS:
            earnable_from = date.fromordinal(payment_date.toordinal() + EARNING_HOLD_DAYS)
            return _deny(
                TransitionCode.EARNING_HOLD_ACTIVE,
                f"This commission can be confirmed as earned from "
                f"{earnable_from.isoformat()}, {EARNING_HOLD_DAYS} days after the premium payment.",
            )
    return _allow()


# ---------------------------------------------------------------------------
# Event state derivation
# ---------------------------------------------------------------------------


@dataclass
class CommissionState:
    status: str | None
    generated_at: object | None
    earned_at: object | None
    paid_at: object | None
    payout_reference: str | None
    ignored_events: list


def derive_commission_state(events: list) -> CommissionState:
    """Replay events in order; invalid events are skipped."""
    ordered = sorted(events, key=lambda e: (e.occurred_at, e.id))
    state = CommissionState(
        status=None,
        generated_at=None,
        earned_at=None,
        paid_at=None,
        payout_reference=None,
        ignored_events=[],
    )
    for event in ordered:
        if (
            event.event_type == CommissionEventType.GENERATED
            and state.status is None
            and event.to_status == CommissionStatus.PENDING
        ):
            state.status = CommissionStatus.PENDING
            state.generated_at = event.occurred_at
        elif (
            event.event_type == CommissionEventType.STATUS_CHANGED
            and event.from_status == state.status
            and can_transition(state.status or "", event.to_status)
        ):
            state.status = event.to_status
            if event.to_status == CommissionStatus.EARNED:
                state.earned_at = event.occurred_at
            elif event.to_status == CommissionStatus.PAID:
                state.paid_at = event.occurred_at
                state.payout_reference = getattr(event, "payout_reference", None)
        else:
            state.ignored_events.append(event.id)
    return state
