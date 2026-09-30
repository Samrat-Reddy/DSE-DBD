"""Module 3 API contracts: claims, eligibility, workflow actions and history.

Money is serialised as a decimal string, as in Modules 1 and 2. Every request
schema carries only what the user decides; statuses, amounts derived by the
workflow, numbers and actors are set by the server.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

from app.models import ClaimAction, ClaimDocumentStatus, ClaimStatus, PolicyStatus, ProductType
from app.models.role import RoleName

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
Note = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
Outcome = Literal["pass", "fail", "warning", "skipped"]


# --- reference and context ---------------------------------------------------------


class CheckOut(BaseModel):
    id: str
    label: str
    outcome: Outcome
    detail: str


class EligibilityOut(BaseModel):
    eligible: bool
    checks: list[CheckOut]
    reasons: list[str]
    warnings: list[str]
    compatible_claim_types: list[str]
    incident_earliest: date | None
    incident_latest: date | None
    filing_deadline: date | None


class DocumentRequirementOut(BaseModel):
    doc_type: str
    label: str
    suggested_name: str
    required: bool


class LimitOut(BaseModel):
    limit: Money
    coverage_amount: Money
    percent_of_coverage: int
    max_amount: Money | None
    basis: str
    capped_by_maximum: bool


class ClaimTypeOut(BaseModel):
    code: str
    label: str
    product_type: ProductType
    coverage_item: str
    percent_of_coverage: int
    max_amount: Money | None
    limit_basis: str
    description: str
    documents: list[DocumentRequirementOut]


class ClaimTypeOptionOut(ClaimTypeOut):
    illustrative_limit: LimitOut


class CoverageItemOut(BaseModel):
    name: str
    limit: str


class ClaimTypeOptionsOut(BaseModel):
    items: list[ClaimTypeOut]


class ClaimPolicyOut(BaseModel):
    policy_number: str
    product_code: str
    product_name: str
    product_type: ProductType
    status: PolicyStatus
    coverage_amount: Money
    issue_date: date | None
    start_date: date
    end_date: date
    policyholder_name: str
    customer_code: str
    agent_name: str | None


class EligiblePolicyOut(BaseModel):
    policy: ClaimPolicyOut
    eligibility: EligibilityOut


class EligiblePolicyListOut(BaseModel):
    items: list[EligiblePolicyOut]
    eligible_count: int
    as_of: date


class FilingContextOut(BaseModel):
    policy: ClaimPolicyOut
    eligibility: EligibilityOut
    claim_types: list[ClaimTypeOptionOut]
    as_of: date


class PremiumStandingOut(BaseModel):
    standing: Literal["overdue", "due", "up_to_date", "fully_paid"]
    overdue_count: int
    overdue_amount: Money
    oldest_overdue_date: date | None


# --- claims ------------------------------------------------------------------------


class ActorOut(BaseModel):
    name: str
    role: RoleName


class ClaimEventOut(BaseModel):
    sequence_no: int
    action: ClaimAction
    label: str
    from_status: ClaimStatus
    to_status: ClaimStatus
    actor: ActorOut
    note: str | None
    occurred_at: datetime


class ClaimDocumentOut(BaseModel):
    doc_type: str
    label: str
    file_name: str
    required: bool
    status: ClaimDocumentStatus
    submitted_at: datetime


class VerificationOut(BaseModel):
    checks_passed: int
    checks_total: int
    warnings: int
    note: str | None
    verified_at: datetime
    verified_by: ActorOut


class AssessmentOut(BaseModel):
    assessed_amount: Money
    illustrative_limit: Money
    limit_basis: str
    note: str | None
    assessed_at: datetime
    assessed_by: ActorOut


class SettlementOut(BaseModel):
    settlement_reference: str
    amount: Money
    settled_on: date
    settled_at: datetime
    settled_by: ActorOut


class DecisionOut(BaseModel):
    """Rule-based explanation built from stored facts (no scoring or AI)."""

    claimed_amount: Money
    illustrative_limit: Money
    limit_basis: str
    assessed_amount: Money
    approved_amount: Money | None
    decision: Literal["pending", "approved", "rejected", "settled"]
    decision_label: str
    reasons: list[str]
    decided_at: datetime | None
    decided_by: ActorOut | None


class ChecklistOut(BaseModel):
    checks: list[CheckOut]
    passed: int
    warnings: int
    failures: int
    blocking: bool


class AllowedActionOut(BaseModel):
    action: ClaimAction
    to_status: ClaimStatus
    label: str
    dedicated: str | None


class ClaimSummaryOut(BaseModel):
    claim_number: str
    policy_number: str
    policyholder_name: str
    customer_code: str
    product_name: str
    claim_type: str
    claim_type_label: str
    incident_date: date
    filing_date: date
    claimed_amount: Money
    approved_amount: Money | None
    status: ClaimStatus
    filed_by: ActorOut | None
    assigned_to: ActorOut | None
    created_at: datetime
    updated_at: datetime


class ClaimDetailOut(BaseModel):
    claim: ClaimSummaryOut
    description: str
    rejection_reason: str | None
    claim_type: ClaimTypeOut
    policy: ClaimPolicyOut
    limit: LimitOut
    coverage_item: CoverageItemOut | None = Field(
        description="The product's coverage item this claim type draws on."
    )
    premium: PremiumStandingOut | None
    documents: list[ClaimDocumentOut]
    verification_checklist: ChecklistOut = Field(
        description="Evaluated now; blocking checks prevent verification."
    )
    verification: VerificationOut | None
    assessment: AssessmentOut | None
    decision: DecisionOut | None
    settlement: SettlementOut | None
    events: list[ClaimEventOut] = Field(description="The workflow history, oldest first.")
    allowed_actions: list[AllowedActionOut] = Field(
        description="Workflow actions the caller's role may take now (the server re-checks)."
    )
    as_of: date


class ClaimCountsOut(BaseModel):
    total: int
    draft: int
    submitted: int
    under_review: int
    verified: int
    assessed: int
    approved: int
    rejected: int
    settled: int
    cancelled: int
    open: int


class ClaimListOut(BaseModel):
    items: list[ClaimSummaryOut]
    total: int
    limit: int
    offset: int
    summary: ClaimCountsOut = Field(description="Counts over the caller's whole scope.")


class ClaimTimelineOut(BaseModel):
    claim_number: str
    status: ClaimStatus
    events: list[ClaimEventOut]


# --- requests ------------------------------------------------------------------------


class ClaimCreate(BaseModel):
    policy_number: Annotated[str, StringConstraints(pattern=r"^POL-[0-9]{4}-[0-9]{6}$")]
    claim_type: Annotated[str, StringConstraints(max_length=40)]
    incident_date: date
    claimed_amount: Annotated[Money, Field(gt=0)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
    documents: dict[
        Annotated[str, StringConstraints(max_length=40)],
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)],
    ] = Field(default_factory=dict, max_length=20, description="Document type -> file name.")
    submit: bool = Field(
        default=True,
        description="File and submit in one step (as the UI does), or keep it as a draft.",
    )


class NoteIn(BaseModel):
    note: Note | None = None


class AssessIn(BaseModel):
    assessed_amount: Annotated[Decimal, Field(max_digits=16)]
    note: Note | None = None


class RejectIn(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]
