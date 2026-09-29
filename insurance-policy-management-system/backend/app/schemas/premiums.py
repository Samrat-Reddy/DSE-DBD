"""Module 2 API contracts: premium schedules, instalments and payments.

Money is serialised as a decimal string (e.g. "1541.66"), as in Module 1.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.models import (
    InstallmentStatus,
    PaymentMethod,
    PaymentStatus,
    PolicyStatus,
    PremiumFrequency,
    ProductType,
)

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
Standing = Literal["overdue", "due", "up_to_date", "fully_paid"]


class PolicySnapshotOut(BaseModel):
    policy_number: str
    status: PolicyStatus
    product_code: str
    product_name: str
    product_type: ProductType
    policyholder_name: str
    customer_code: str
    start_date: date
    end_date: date
    term_years: int


class InstallmentRefOut(BaseModel):
    id: int
    installment_number: int
    due_date: date
    amount_outstanding: Money


class InstallmentCountsOut(BaseModel):
    paid: int
    overdue: int
    due: int
    upcoming: int
    partially_paid: int


class PremiumSummaryOut(BaseModel):
    installment_count: int
    counts: InstallmentCountsOut
    total_premium: Money
    total_paid: Money
    outstanding: Money
    overdue_amount: Money
    due_amount: Money
    upcoming_amount: Money
    payable_now: Money = Field(description="Outstanding on every due or overdue instalment.")
    next_due: InstallmentRefOut | None
    oldest_overdue: InstallmentRefOut | None
    oldest_overdue_days: int
    standing: Standing


class PremiumScheduleOut(BaseModel):
    policy: PolicySnapshotOut
    frequency: PremiumFrequency
    annual_premium: Money
    installment_count: int
    regular_installment_amount: Money
    total_premium: Money = Field(description="annual premium x term; instalments sum to this.")
    first_due_date: date
    last_due_date: date
    summary: PremiumSummaryOut
    as_of: date


class PortfolioOut(BaseModel):
    policies: int
    total_paid: Money
    paid_count: int
    due_amount: Money
    due_count: int
    overdue_amount: Money
    overdue_count: int
    upcoming_amount: Money
    upcoming_count: int
    payable_now: Money
    policies_overdue: int


class PremiumAccountListOut(BaseModel):
    items: list[PremiumScheduleOut]
    total: int
    limit: int
    offset: int
    portfolio: PortfolioOut = Field(description="Totals over the caller's whole scope.")
    awaiting_issuance: int = Field(description="Pending policies in scope (no schedule yet).")
    as_of: date


class InstallmentOut(BaseModel):
    id: int
    policy_number: str
    installment_number: int
    due_date: date
    amount_due: Money
    amount_paid: Money
    amount_outstanding: Money
    status: InstallmentStatus = Field(
        description="pending / partially_paid / paid, or overdue once past due and not fully paid."
    )
    payable: bool = Field(description="Whether a payment can be recorded against it today.")
    payable_from: date
    pending_payment_number: str | None
    failed_attempts: int
    last_paid_at: datetime | None
    last_payment_number: str | None = Field(description="Latest successful payment.")


class InstallmentListOut(BaseModel):
    items: list[InstallmentOut]
    as_of: date


class PaymentOut(BaseModel):
    payment_number: str
    payment_reference: str
    installment_id: int
    installment_number: int
    policy_number: str
    policyholder_name: str
    customer_code: str
    product_name: str
    amount: Money
    status: PaymentStatus
    payment_method: PaymentMethod
    paid_at: datetime
    failure_reason: str | None


class PaymentSummaryOut(BaseModel):
    total: int
    successful: int
    failed: int
    pending: int
    collected: Money


class PaymentListOut(BaseModel):
    items: list[PaymentOut]
    total: int
    limit: int
    offset: int
    summary: PaymentSummaryOut = Field(description="Over the caller's whole scope.")


class PaymentRecordedOut(BaseModel):
    payment: PaymentOut
    installment: InstallmentOut


class PaymentCreate(BaseModel):
    """A payment attempt. The instalment comes from the URL; nothing about
    the instalment's balance is accepted from the client."""

    amount: Annotated[Money, Field(gt=0)]
    payment_method: PaymentMethod
    payment_reference: Annotated[
        str, StringConstraints(pattern=r"^[A-Z0-9][A-Z0-9-]{4,38}[A-Z0-9]$")
    ] = Field(
        description=(
            "Unique per payment attempt (6-40 letters, digits, hyphens). Reuse the same "
            "reference when retrying the same attempt: a repeat is rejected with 409."
        )
    )
    outcome: PaymentStatus = Field(
        default=PaymentStatus.SUCCESSFUL,
        description=(
            "Result of the attempt. No payment gateway exists yet, so the caller "
            "states it (pending attempts are settled later by an administrator)."
        ),
    )
    failure_reason: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None
    ) = None

    @field_validator("payment_reference", mode="before")
    @classmethod
    def _normalise_reference(cls, value: object) -> object:
        # References are case-insensitive: "abc-123" and "ABC-123" are the same attempt.
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("failure_reason", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value


class PaymentResolve(BaseModel):
    status: Literal[PaymentStatus.SUCCESSFUL, PaymentStatus.FAILED]
    failure_reason: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)] | None
    ) = None
