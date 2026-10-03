"""Pydantic schemas for Module 4 — Renewal Reminder Engine."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Outbound (API responses)
# ---------------------------------------------------------------------------


class ClockOut(BaseModel):
    asOf: str
    today: str
    isSimulated: bool
    simulationDate: str | None = None
    setAt: str | None = None
    setByName: str | None = None


class EligibilityOut(BaseModel):
    eligible: bool
    code: str
    reason: str | None = None


class WindowOut(BaseModel):
    opensOn: str
    expiresOn: str
    closesOn: str


class PolicyBriefOut(BaseModel):
    policyNumber: str
    productName: str
    status: str
    issueDate: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    policyholderName: str | None = None
    agentName: str | None = None


class ReminderBriefOut(BaseModel):
    reminderId: str
    stage: str
    status: str
    attemptedAt: str


class NextReminderOut(BaseModel):
    stageId: str
    label: str
    scheduledFor: str
    dueNow: bool
    action: str


class RenewalAccountSummaryOut(BaseModel):
    policyId: str
    asOf: str
    daysUntilExpiry: int | None = None
    status: str
    eligibility: EligibilityOut
    window: WindowOut | None = None
    currentStageId: str | None = None
    currentStageState: str | None = None
    lastReminder: ReminderBriefOut | None = None
    nextReminder: NextReminderOut | None = None
    premiumStanding: str | None = None
    pendingAction: str | None = None
    policy: PolicyBriefOut


class RenewalSummaryCountsOut(BaseModel):
    total: int
    eligible: int
    within60: int
    within30: int
    within7: int
    expired: int
    remindersPending: int


class ReminderOut(BaseModel):
    reminderId: str
    policyNumber: str | None = None
    stage: str
    stageLabel: str
    scheduledFor: str
    attemptedAt: str
    evaluatedAsOf: str
    sentAt: str | None = None
    channel: str
    channelLabel: str
    status: str
    trigger: str
    createdByName: str
    createdByRole: str
    retryOf: str | None = None
    note: str | None = None
    result: str | None = None
    supersededBy: str | None = None


class RenewalListOut(BaseModel):
    asOf: str
    clock: dict
    items: list[Any]
    total: int
    summary: dict
    recentReminders: list[Any]


class RenewalDetailOut(BaseModel):
    clock: dict
    policy: dict
    issued: bool
    account: dict
    premium: dict | None = None
    history: list[Any]
    milestones: list[Any]
    eligibility: dict


class ReminderListOut(BaseModel):
    items: list[Any]
    total: int


class AttemptOut(BaseModel):
    id: str
    label: str
    shortLabel: str
    channel: str
    scheduledFor: str
    actionableUntil: str
    state: str
    isCurrent: bool
    handled: bool
    canTrigger: bool
    canRetry: bool
    attempts: list[Any]
    latestAttempt: Any | None = None


class ReminderPlanOut(BaseModel):
    policyId: str
    asOf: str
    eligibility: EligibilityOut
    window: WindowOut | None = None
    stages: list[Any]
    currentStage: Any | None = None
    pendingAction: str | None = None


class CheckRunSummaryOut(BaseModel):
    evaluated: int
    generated: int
    skipped: int
    alreadyHandled: int
    needsRetry: int
    notYetDue: int
    notEligible: int


class CheckRunOut(BaseModel):
    runNumber: str
    asOf: str
    runAt: str
    runBy: dict
    evaluated: int
    generated: list[Any]
    skippedSuperseded: list[Any]
    alreadyHandled: list[Any]
    needsRetry: list[Any]
    notYetDue: int
    notEligible: int
    counts: CheckRunSummaryOut


class TriggerOut(BaseModel):
    reminder: Any
    details: Any


class RenewalAccountOut(BaseModel):
    """Alias used by service."""

    pass


# ---------------------------------------------------------------------------
# Inbound (API request bodies)
# ---------------------------------------------------------------------------


class AdvanceClockIn(BaseModel):
    date: str = Field(..., description="Target simulation date (YYYY-MM-DD).")
    note: str | None = Field(None, max_length=300)


class TriggerReminderIn(BaseModel):
    stage: str = Field(..., description="Reminder stage id (d60, d30, d15, d7, d1, d0, post).")
    outcome: str = Field(..., description="Outcome: sent, failed or skipped.")
    channel: str | None = Field(None, description="Override channel (email, sms, in-app).")
    note: str | None = Field(None, max_length=500)


class RetryReminderIn(BaseModel):
    outcome: str = Field(..., description="Outcome: sent or failed.")
    channel: str | None = Field(None, description="Override channel (email, sms, in-app).")
    note: str | None = Field(None, max_length=500)
