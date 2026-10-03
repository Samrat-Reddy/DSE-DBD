"""Pure renewal-reminder rules: no database, no clock.

Every time-dependent function takes `as_of` explicitly, so the rules are
deterministic and unit-testable. These rules are direct translations of
the frontend's renewalEngine.js and reminderRules.js, using the same
thresholds from RENEWAL_CONFIG.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from enum import StrEnum

# ---------------------------------------------------------------------------
# Configuration (mirrors frontend RENEWAL_CONFIG)
# ---------------------------------------------------------------------------

STAGES = [
    {
        "id": "d60",
        "label": "60 days before expiry",
        "short_label": "60 days",
        "offset_days": -60,
        "channel": "email",
    },
    {
        "id": "d30",
        "label": "30 days before expiry",
        "short_label": "30 days",
        "offset_days": -30,
        "channel": "email",
    },
    {
        "id": "d15",
        "label": "15 days before expiry",
        "short_label": "15 days",
        "offset_days": -15,
        "channel": "sms",
    },
    {
        "id": "d7",
        "label": "7 days before expiry",
        "short_label": "7 days",
        "offset_days": -7,
        "channel": "sms",
    },
    {
        "id": "d1",
        "label": "1 day before expiry",
        "short_label": "1 day",
        "offset_days": -1,
        "channel": "in-app",
    },
    {
        "id": "d0",
        "label": "On expiry day",
        "short_label": "Expiry day",
        "offset_days": 0,
        "channel": "email",
    },
    {
        "id": "post",
        "label": "Post-expiry follow-up",
        "short_label": "Follow-up",
        "offset_days": 7,
        "channel": "email",
    },
]
STAGES_BY_ID: dict[str, dict] = {s["id"]: s for s in STAGES}

STATUS_WINDOWS = {"upcoming_days": 60, "due_soon_days": 30, "due_days": 7}
FOLLOW_UP_WINDOW_DAYS = 30

VALID_CHANNELS = {"email", "sms", "in-app"}
VALID_STATUSES = {"sent", "failed", "skipped"}
TRIGGER_OUTCOMES = {"sent", "failed", "skipped"}
RETRY_OUTCOMES = {"sent", "failed"}


# ---------------------------------------------------------------------------
# Enums / codes
# ---------------------------------------------------------------------------


class RenewalStatus(StrEnum):
    NOT_DUE = "not-due"
    UPCOMING = "upcoming"
    DUE_SOON = "due-soon"
    DUE = "due"
    EXPIRING_TODAY = "expiring-today"
    EXPIRED = "expired"
    UNKNOWN = "expiry-unknown"


class ReminderStageState(StrEnum):
    SCHEDULED = "scheduled"
    DUE = "due"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"
    MISSED = "missed"


class EligibilityCode(StrEnum):
    ELIGIBLE = "eligible"
    NOT_ISSUED = "policy-not-issued"
    NO_EXPIRY = "no-expiry-date"
    LAPSED = "policy-lapsed"
    WINDOW_CLOSED = "window-closed"


class RuleCode(StrEnum):
    OK = "ok"
    INVALID_STAGE = "invalid-stage"
    INVALID_OUTCOME = "invalid-outcome"
    INVALID_CHANNEL = "invalid-channel"
    NOT_ELIGIBLE = "not-eligible"
    ALREADY_SENT = "already-sent"
    ALREADY_HANDLED = "already-handled"
    RETRY_REQUIRED = "retry-required"
    NOT_DUE = "reminder-not-due"
    STAGE_CLOSED = "stage-closed"
    REMINDER_NOT_FOUND = "reminder-not-found"
    INVALID_RETRY = "invalid-retry"


# ---------------------------------------------------------------------------
# Date helpers
# ---------------------------------------------------------------------------


def add_days(d: date, days: int) -> date:
    return d + timedelta(days=days)


def days_between(a: date, b: date) -> int:
    """Positive when b is after a (how many days from a to b)."""
    return (b - a).days


# ---------------------------------------------------------------------------
# Stage helpers
# ---------------------------------------------------------------------------


def get_ordered_stages() -> list[dict]:
    return sorted(STAGES, key=lambda s: s["offset_days"])


def get_stage_definition(stage_id: str) -> dict | None:
    return STAGES_BY_ID.get(stage_id)


def is_valid_stage(stage_id: str) -> bool:
    return stage_id in STAGES_BY_ID


# ---------------------------------------------------------------------------
# Renewal status
# ---------------------------------------------------------------------------


def get_days_until_expiry(end_date: date | None, as_of: date) -> int | None:
    if end_date is None:
        return None
    return days_between(as_of, end_date)


def get_renewal_status(end_date: date | None, as_of: date) -> RenewalStatus:
    days = get_days_until_expiry(end_date, as_of)
    if days is None:
        return RenewalStatus.UNKNOWN
    if days < 0:
        return RenewalStatus.EXPIRED
    if days == 0:
        return RenewalStatus.EXPIRING_TODAY
    if days <= STATUS_WINDOWS["due_days"]:
        return RenewalStatus.DUE
    if days <= STATUS_WINDOWS["due_soon_days"]:
        return RenewalStatus.DUE_SOON
    if days <= STATUS_WINDOWS["upcoming_days"]:
        return RenewalStatus.UPCOMING
    return RenewalStatus.NOT_DUE


# ---------------------------------------------------------------------------
# Stage schedule
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class StageScheduleItem:
    id: str
    label: str
    short_label: str
    offset_days: int
    channel: str
    scheduled_for: date
    actionable_until: date


def build_stage_schedule(end_date: date) -> list[StageScheduleItem]:
    ordered = get_ordered_stages()
    window_close = add_days(end_date, FOLLOW_UP_WINDOW_DAYS)
    result = []
    for i, stage in enumerate(ordered):
        scheduled = add_days(end_date, stage["offset_days"])
        next_stage = ordered[i + 1] if i + 1 < len(ordered) else None
        actionable_until = (
            add_days(end_date, next_stage["offset_days"] - 1) if next_stage else window_close
        )
        result.append(
            StageScheduleItem(
                id=stage["id"],
                label=stage["label"],
                short_label=stage["short_label"],
                offset_days=stage["offset_days"],
                channel=stage["channel"],
                scheduled_for=scheduled,
                actionable_until=actionable_until,
            )
        )
    return result


def get_current_reminder_stage(end_date: date, as_of: date) -> StageScheduleItem | None:
    for stage in build_stage_schedule(end_date):
        if stage.scheduled_for <= as_of <= stage.actionable_until:
            return stage
    return None


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EligibilityResult:
    eligible: bool
    code: EligibilityCode
    reason: str | None


def evaluate_renewal_eligibility(
    *,
    issued: bool,
    end_date: date | None,
    lapsed: bool,
    as_of: date,
) -> EligibilityResult:
    if not issued:
        return EligibilityResult(
            False, EligibilityCode.NOT_ISSUED, "The policy has not been issued."
        )
    if end_date is None:
        return EligibilityResult(
            False, EligibilityCode.NO_EXPIRY, "The policy has no valid expiry date."
        )
    if lapsed:
        return EligibilityResult(False, EligibilityCode.LAPSED, "The policy has lapsed.")
    window_close = add_days(end_date, FOLLOW_UP_WINDOW_DAYS)
    if days_between(window_close, as_of) > 0:
        return EligibilityResult(
            False,
            EligibilityCode.WINDOW_CLOSED,
            f"The renewal reminder window closed on {window_close.isoformat()}, "
            f"{FOLLOW_UP_WINDOW_DAYS} days after expiry.",
        )
    return EligibilityResult(True, EligibilityCode.ELIGIBLE, None)


# ---------------------------------------------------------------------------
# Reminder history summarisation (mirrors summariseStageAttempts)
# ---------------------------------------------------------------------------


@dataclass
class StageSummary:
    attempts: list  # list of Reminder ORM rows, sorted by attempted_at
    latest: object | None
    sent: object | None
    skipped: object | None
    state: str | None  # 'sent' | 'failed' | 'skipped' | None
    handled: bool


def summarise_stage_attempts(events: list) -> StageSummary:
    attempts = sorted(events, key=lambda e: (e.attempted_at, e.id))
    sent = next((e for e in attempts if e.status == "sent"), None)
    skipped = next((e for e in attempts if e.status == "skipped"), None)
    latest = attempts[-1] if attempts else None
    if sent:
        state = "sent"
    elif skipped:
        state = "skipped"
    elif latest and latest.status == "failed":
        state = "failed"
    else:
        state = None
    return StageSummary(
        attempts=attempts,
        latest=latest,
        sent=sent,
        skipped=skipped,
        state=state,
        handled=bool(sent or skipped),
    )


# ---------------------------------------------------------------------------
# Full plan for one policy
# ---------------------------------------------------------------------------


@dataclass
class StagePlanItem:
    id: str
    label: str
    short_label: str
    channel: str
    scheduled_for: date
    actionable_until: date
    state: ReminderStageState
    is_current: bool
    attempts: list
    latest_attempt: object | None
    handled: bool
    can_trigger: bool
    can_retry: bool


@dataclass
class ReminderPlan:
    policy_id: int
    as_of: date
    eligibility: EligibilityResult
    stages: list[StagePlanItem]
    current_stage: StagePlanItem | None
    last_reminder: object | None
    pending_action: str | None  # 'send' | 'retry' | None


def build_reminder_plan(
    *,
    policy_id: int,
    end_date: date | None,
    issued: bool,
    lapsed: bool,
    history: list,  # list of Reminder ORM rows for this policy
    as_of: date,
) -> ReminderPlan:
    eligibility = evaluate_renewal_eligibility(
        issued=issued, end_date=end_date, lapsed=lapsed, as_of=as_of
    )

    if end_date is None:
        return ReminderPlan(
            policy_id=policy_id,
            as_of=as_of,
            eligibility=eligibility,
            stages=[],
            current_stage=None,
            last_reminder=None,
            pending_action=None,
        )

    schedule = build_stage_schedule(end_date)
    current_item = get_current_reminder_stage(end_date, as_of)

    stage_items: list[StagePlanItem] = []
    for sched in schedule:
        stage_events = [e for e in history if e.stage == sched.id]
        summary = summarise_stage_attempts(stage_events)
        is_current = current_item is not None and current_item.id == sched.id
        is_future = days_between(as_of, sched.scheduled_for) > 0

        if summary.state == "sent":
            state = ReminderStageState.SENT
        elif summary.state == "skipped":
            state = ReminderStageState.SKIPPED
        elif summary.state == "failed":
            state = ReminderStageState.FAILED
        elif is_future:
            state = ReminderStageState.SCHEDULED
        elif is_current:
            state = ReminderStageState.DUE
        else:
            state = ReminderStageState.MISSED

        actionable = eligibility.eligible and is_current
        stage_items.append(
            StagePlanItem(
                id=sched.id,
                label=sched.label,
                short_label=sched.short_label,
                channel=sched.channel,
                scheduled_for=sched.scheduled_for,
                actionable_until=sched.actionable_until,
                state=state,
                is_current=is_current,
                attempts=summary.attempts,
                latest_attempt=summary.latest,
                handled=summary.handled,
                can_trigger=actionable and state == ReminderStageState.DUE,
                can_retry=actionable and state == ReminderStageState.FAILED,
            )
        )

    current_stage = next((s for s in stage_items if s.is_current), None)
    last_reminder = sorted(history, key=lambda e: (e.attempted_at, e.id))[-1] if history else None
    if current_stage:
        if current_stage.can_trigger:
            pending_action = "send"
        elif current_stage.can_retry:
            pending_action = "retry"
        else:
            pending_action = None
    else:
        pending_action = None

    return ReminderPlan(
        policy_id=policy_id,
        as_of=as_of,
        eligibility=eligibility,
        stages=stage_items,
        current_stage=current_stage,
        last_reminder=last_reminder,
        pending_action=pending_action,
    )


# ---------------------------------------------------------------------------
# Reminder-check plan (what the engine should do for a batch)
# ---------------------------------------------------------------------------


@dataclass
class CheckPlanEntry:
    policy_id: int
    stage_id: str
    scheduled_for: date
    channel: str
    superseded_by: str | None = None
    state: str | None = None
    latest_reminder_id: int | None = None
    latest_reminder_number: str | None = None


@dataclass
class CheckPlan:
    as_of: date
    evaluated: int
    generate: list[CheckPlanEntry]
    supersede: list[CheckPlanEntry]  # missed stages to mark as skipped
    already_handled: list[CheckPlanEntry]
    needs_retry: list[CheckPlanEntry]
    not_yet_due: list  # {"policy_id": int, "opens_on": date}
    not_eligible: list  # {"policy_id": int, "code": str, "reason": str}


def plan_reminder_check(
    *,
    policies: list,  # list of dicts with policy data
    history_by_policy: dict[int, list],  # {policy_id: [Reminder rows]}
    as_of: date,
) -> CheckPlan:
    """Decide what a reminder check should do without doing it.

    policies is a list of dicts with keys:
      id, issued, end_date, lapsed
    """
    plan = CheckPlan(
        as_of=as_of,
        evaluated=len(policies),
        generate=[],
        supersede=[],
        already_handled=[],
        needs_retry=[],
        not_yet_due=[],
        not_eligible=[],
    )

    for policy in policies:
        pid = policy["id"]
        hist = history_by_policy.get(pid, [])
        rplan = build_reminder_plan(
            policy_id=pid,
            end_date=policy["end_date"],
            issued=policy["issued"],
            lapsed=policy["lapsed"],
            history=hist,
            as_of=as_of,
        )
        if not rplan.eligibility.eligible:
            plan.not_eligible.append(
                {
                    "policy_id": pid,
                    "code": rplan.eligibility.code,
                    "reason": rplan.eligibility.reason,
                }
            )
            continue

        current = rplan.current_stage
        if not current:
            end_date = policy["end_date"]
            opens_on = add_days(end_date, STAGES[0]["offset_days"]) if end_date else None
            plan.not_yet_due.append({"policy_id": pid, "opens_on": opens_on})
            continue

        # Mark missed stages as superseded
        for stage in rplan.stages:
            if stage.state == ReminderStageState.MISSED:
                plan.supersede.append(
                    CheckPlanEntry(
                        policy_id=pid,
                        stage_id=stage.id,
                        scheduled_for=stage.scheduled_for,
                        channel=stage.channel,
                        superseded_by=current.id,
                    )
                )

        entry = CheckPlanEntry(
            policy_id=pid,
            stage_id=current.id,
            scheduled_for=current.scheduled_for,
            channel=current.channel,
            state=current.state.value,
            latest_reminder_id=current.latest_attempt.id if current.latest_attempt else None,
            latest_reminder_number=current.latest_attempt.reminder_number
            if current.latest_attempt
            else None,
        )
        if current.state in (ReminderStageState.SENT, ReminderStageState.SKIPPED):
            plan.already_handled.append(entry)
        elif current.state == ReminderStageState.FAILED:
            plan.needs_retry.append(entry)
        else:
            plan.generate.append(entry)

    return plan


# ---------------------------------------------------------------------------
# Manual trigger / retry validation (mirrors checkReminderTrigger / Retry)
# ---------------------------------------------------------------------------


@dataclass
class RuleResult:
    allowed: bool
    code: RuleCode
    message: str | None


def _allow() -> RuleResult:
    return RuleResult(True, RuleCode.OK, None)


def _deny(code: RuleCode, message: str) -> RuleResult:
    return RuleResult(False, code, message)


def check_reminder_trigger(
    *,
    plan: ReminderPlan,
    stage_id: str,
    outcome: str,
    channel: str | None,
) -> RuleResult:
    definition = get_stage_definition(stage_id)
    if not definition:
        return _deny(RuleCode.INVALID_STAGE, f'"{stage_id}" is not a reminder stage.')
    if outcome not in TRIGGER_OUTCOMES:
        return _deny(RuleCode.INVALID_OUTCOME, "Choose sent, failed or skipped as the outcome.")
    if channel is not None and channel not in VALID_CHANNELS:
        return _deny(RuleCode.INVALID_CHANNEL, "Choose email, sms or in-app as the channel.")
    if not plan.eligibility.eligible:
        return _deny(RuleCode.NOT_ELIGIBLE, plan.eligibility.reason or "Policy is not eligible.")

    stage = next((s for s in plan.stages if s.id == stage_id), None)
    if stage is None:
        return _deny(RuleCode.INVALID_STAGE, f'"{stage_id}" is not in the plan.')

    if stage.state == ReminderStageState.SENT:
        return _deny(
            RuleCode.ALREADY_SENT, f"The {definition['label']} reminder has already been sent."
        )
    if stage.state == ReminderStageState.SKIPPED:
        return _deny(
            RuleCode.ALREADY_HANDLED,
            f"The {definition['label']} reminder was already handled (skipped).",
        )
    if stage.state == ReminderStageState.FAILED:
        return _deny(
            RuleCode.RETRY_REQUIRED,
            f"The {definition['label']} reminder failed. Retry the failed attempt.",
        )
    if stage.state == ReminderStageState.SCHEDULED:
        return _deny(
            RuleCode.NOT_DUE,
            f"The {definition['label']} reminder is not due until "
            f"{stage.scheduled_for.isoformat()}.",
        )
    if stage.state == ReminderStageState.MISSED:
        return _deny(RuleCode.STAGE_CLOSED, f"The {definition['label']} stage has passed.")
    return _allow()


def check_reminder_retry(
    *,
    reminder,  # Reminder ORM row or None
    plan: ReminderPlan | None,
    outcome: str,
    channel: str | None,
) -> RuleResult:
    if reminder is None:
        return _deny(RuleCode.REMINDER_NOT_FOUND, "The reminder could not be found.")
    if reminder.status != "failed":
        return _deny(
            RuleCode.INVALID_RETRY,
            f"Only failed reminders can be retried; {reminder.reminder_number} "
            f"was {reminder.status}.",
        )
    if outcome not in RETRY_OUTCOMES:
        return _deny(RuleCode.INVALID_OUTCOME, "Choose sent or failed as the retry outcome.")
    if channel is not None and channel not in VALID_CHANNELS:
        return _deny(RuleCode.INVALID_CHANNEL, "Choose email, sms or in-app as the channel.")

    if plan is None:
        return _deny(RuleCode.NOT_ELIGIBLE, "Could not build the reminder plan.")

    stage = next((s for s in plan.stages if s.id == reminder.stage), None)
    definition = get_stage_definition(reminder.stage)

    if stage and stage.state == ReminderStageState.SENT:
        lbl = definition["label"] if definition else reminder.stage
        return _deny(
            RuleCode.ALREADY_SENT,
            f"The {lbl} reminder has since been sent.",
        )
    if stage and stage.latest_attempt and stage.latest_attempt.id != reminder.id:
        return _deny(
            RuleCode.INVALID_RETRY,
            f"{reminder.reminder_number} is not the latest attempt; "
            f"retry {stage.latest_attempt.reminder_number}.",
        )
    if not plan.eligibility.eligible:
        return _deny(RuleCode.NOT_ELIGIBLE, plan.eligibility.reason or "Policy is not eligible.")
    if stage is None or not stage.can_retry:
        label = definition["label"] if definition else reminder.stage
        return _deny(RuleCode.STAGE_CLOSED, f"The {label} stage is no longer current.")
    return _allow()


# ---------------------------------------------------------------------------
# Premium standing for renewals (mirrors premiumSummaryFor)
# ---------------------------------------------------------------------------


def premium_standing_from_summary(summary: dict | None) -> str | None:
    """Return the standing string from a premium_rules.summarise result."""
    if summary is None:
        return None
    return summary.get("standing")
