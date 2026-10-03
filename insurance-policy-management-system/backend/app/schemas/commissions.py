"""Pydantic schemas for Module 5 — Agent Commission."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CommissionEventOut(BaseModel):
    sequenceNo: int
    eventType: str
    fromStatus: str | None = None
    toStatus: str
    actorName: str
    actorRole: str
    payoutReference: str | None = None
    note: str | None = None
    occurredAt: str


class CommissionOut(BaseModel):
    commissionId: str
    policyId: str | None = None
    agentId: str | None = None
    agentName: str | None = None
    paymentId: str | None = None
    paymentDate: str
    generatedAt: str
    policyYear: int
    basis: str
    basisLabel: str
    ratePercent: float
    commissionableAmount: str
    amount: str
    status: str
    ruleCode: str | None = None
    generatedEventAt: str
    earnedAt: str | None = None
    paidAt: str | None = None
    payoutReference: str | None = None
    productName: str | None = None
    policyholderName: str | None = None
    earningHoldDays: int
    earnableFrom: str
    holdActive: bool
    events: list[CommissionEventOut]


class CommissionSummaryOut(BaseModel):
    total: int
    pending: int
    earned: int
    paid: int


class CommissionListOut(BaseModel):
    items: list[Any]
    total: int
    limit: int
    offset: int
    summary: CommissionSummaryOut
    asOf: str


class CommissionRuleOut(BaseModel):
    ruleCode: str
    productId: int | None = None
    productName: str | None = None
    productCode: str | None = None
    agentId: int | None = None
    agentName: str | None = None
    agentCode: str | None = None
    firstYearRatePercent: float
    renewalRatePercent: float
    effectiveFrom: str
    effectiveTo: str | None = None
    description: str | None = None


class CommissionRuleListOut(BaseModel):
    items: list[CommissionRuleOut]
    total: int


# ---------------------------------------------------------------------------
# Inbound
# ---------------------------------------------------------------------------


class ConfirmEarnedIn(BaseModel):
    note: str | None = Field(None, max_length=500)


class RecordPaidIn(BaseModel):
    payoutReference: str = Field(
        ..., min_length=3, max_length=40, description="Payout reference code"
    )
    note: str | None = Field(None, max_length=500)
