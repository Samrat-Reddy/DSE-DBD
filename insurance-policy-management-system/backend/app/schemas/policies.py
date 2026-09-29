"""Module 1 API contracts: products, policies and the issuance request.

These are deliberately separate from the ORM models. Money is serialised as a
decimal string (e.g. "18500.00") so no precision is lost in JSON.
"""

import re
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, StringConstraints, field_validator

from app.models import (
    NomineeRelationship,
    PolicyStatus,
    PremiumFrequency,
    ProductStatus,
    ProductType,
)

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=80)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
ProductCode = Annotated[str, StringConstraints(pattern=r"^PRD-[A-Z]{3}-[0-9]{3}$")]
CustomerCode = Annotated[str, StringConstraints(pattern=r"^CUS-[0-9]{6}$")]
AgentCode = Annotated[str, StringConstraints(pattern=r"^AGT-[0-9]{4}$")]

# Same rule as the frontend: optional +91/91 prefix, then a 10-digit mobile
# number starting 6-9. Stored without prefix or separators.
_PHONE = re.compile(r"^(?:\+?91)?([6-9]\d{9})$")


# --- products -----------------------------------------------------------------


class CoverageItemOut(BaseModel):
    name: str
    limit: str


class ProductOut(BaseModel):
    code: str
    name: str
    type: ProductType
    status: ProductStatus
    tagline: str
    description: str
    reference_coverage_amount: Money
    min_coverage_amount: Money
    max_coverage_amount: Money
    base_annual_premium: Money = Field(
        description="Annual premium at the reference coverage amount."
    )
    default_term_years: int
    term_options: list[int]
    premium_frequencies: list[PremiumFrequency]
    min_entry_age: int
    max_entry_age: int
    eligibility_summary: str
    eligibility_criteria: list[str]
    waiting_period: str
    benefits: list[str]
    coverage_items: list[CoverageItemOut]
    exclusions: list[str]


class ProductStatusSummary(BaseModel):
    total: int
    active: int
    inactive: int


class ProductListOut(BaseModel):
    items: list[ProductOut]
    total: int = Field(description="Products matching the filters.")
    summary: ProductStatusSummary = Field(description="Counts over the whole catalog.")


# --- policies -----------------------------------------------------------------


class ProductRefOut(BaseModel):
    code: str
    name: str
    type: ProductType


class AddressOut(BaseModel):
    line1: str
    line2: str | None
    city: str
    state: str
    postal_code: str


class PolicyholderOut(BaseModel):
    customer_code: str
    full_name: str
    date_of_birth: date
    email: str
    phone: str
    address: AddressOut


class NomineeOut(BaseModel):
    name: str
    relationship: NomineeRelationship
    date_of_birth: date


class AgentOut(BaseModel):
    agent_code: str
    full_name: str
    branch: str
    email: str


class LifecycleEventOut(BaseModel):
    stage: str
    date: date | None
    status: Literal["completed", "upcoming"]
    note: str


class PolicyOut(BaseModel):
    policy_number: str
    status: PolicyStatus
    product: ProductRefOut
    policyholder: PolicyholderOut
    nominee: NomineeOut
    agent: AgentOut | None
    coverage_amount: Money
    annual_premium: Money
    instalment_premium: Money = Field(description="Premium due per instalment.")
    premium_frequency: PremiumFrequency
    term_years: int
    issue_date: date | None
    start_date: date
    end_date: date
    lifecycle: list[LifecycleEventOut] = Field(
        description="Milestones derived from the policy's own dates and status."
    )


class PolicyListOut(BaseModel):
    items: list[PolicyOut]
    total: int
    limit: int
    offset: int


# --- issuance -----------------------------------------------------------------


class PolicyholderIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    customer_code: CustomerCode | None = Field(
        default=None,
        description="Existing customer to issue for. Omit to register a new customer.",
    )
    full_name: Name
    date_of_birth: date
    email: EmailStr = Field(max_length=254)
    phone: str
    address_line1: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    address_line2: Annotated[str, StringConstraints(max_length=120)] | None = None
    city: ShortText
    state: ShortText
    postal_code: Annotated[str, StringConstraints(pattern=r"^[0-9]{6}$")]

    @field_validator("customer_code", "address_line2", mode="before")
    @classmethod
    def _blank_is_none(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @field_validator("phone")
    @classmethod
    def _normalise_phone(cls, value: str) -> str:
        match = _PHONE.match(re.sub(r"[\s-]", "", value))
        if not match:
            raise ValueError("must be a valid 10-digit mobile number")
        return match.group(1)

    @field_validator("date_of_birth")
    @classmethod
    def _not_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("cannot be in the future")
        return value


class NomineeIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: Name
    relationship: NomineeRelationship
    date_of_birth: date

    @field_validator("date_of_birth")
    @classmethod
    def _not_in_future(cls, value: date) -> date:
        if value > date.today():
            raise ValueError("cannot be in the future")
        return value


class PolicyIssueRequest(BaseModel):
    """Everything the issuance wizard collects. The premium is NOT accepted
    from the client: the backend rates it from the product."""

    product_code: ProductCode
    policyholder: PolicyholderIn
    coverage_amount: Annotated[Money, Field(gt=0)]
    start_date: date
    term_years: int = Field(ge=1, le=50)
    premium_frequency: PremiumFrequency
    nominee: NomineeIn
    agent_code: AgentCode | None = Field(
        default=None,
        description=(
            "Servicing agent. Administrators may set it; agents always issue as themselves."
        ),
    )

    @field_validator("start_date")
    @classmethod
    def _not_in_past(cls, value: date) -> date:
        if value < date.today():
            raise ValueError("cannot be in the past")
        return value
