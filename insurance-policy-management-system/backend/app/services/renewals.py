"""Renewal Reminder Engine service (Module 4).

Authorisation:
  administrators  see all policies; may run checks, trigger, retry, advance/reset clock
  agents          see policies they service; may run checks
  policyholders   see their own policies; read-only

Every workflow action uses _transition pattern:
  1. commit the read snapshot
  2. lock the row(s)
  3. re-read + scope check
  4. validate rules
  5. write + append history
  6. commit

Idempotency: a duplicate check run on the same date for the same policy/stage
is blocked at the DB level by the check_idempotency_key generated column.
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, UnprocessableError
from app.models import Policy, PolicyStatus, User
from app.models.renewal import Reminder, ReminderCheckRun
from app.models.role import RoleName
from app.repositories import premiums as premium_repo
from app.repositories import renewals as renewal_repo
from app.repositories.policies import get_policy_by_number
from app.services import premium_rules
from app.services import renewal_rules as rules
from app.services.access import PolicyScope, resolve_scope

logger = logging.getLogger(__name__)

POLICY_NOT_FOUND = 'No issued policy found for "{number}".'
REMINDER_NOT_FOUND = 'No reminder found for "{number}".'

# Roles (mirrors frontend constants)
ROLES_ALLOWED_TO_RUN_CHECK = {RoleName.AGENT, RoleName.ADMINISTRATOR}
ROLES_ALLOWED_TO_MANAGE = {RoleName.ADMINISTRATOR}


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _today() -> date:
    return date.today()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _actor_name(user: User, policy: Policy | None, db: Session) -> str:
    role = RoleName(user.role.name)
    if role == RoleName.ADMINISTRATOR:
        return f"{user.first_name} {user.last_name}"
    if role == RoleName.AGENT:
        from app.repositories.policies import get_agent_by_user_id

        agent = get_agent_by_user_id(db, user.id)
        return agent.full_name if agent else f"{user.first_name} {user.last_name}"
    # policyholder — use customer name if available
    if policy:
        return policy.customer.full_name
    return f"{user.first_name} {user.last_name}"


def _policy_issued(policy: Policy) -> bool:
    return policy.issue_date is not None and policy.status != PolicyStatus.PENDING


def _policy_lapsed(policy: Policy) -> bool:
    return policy.status == "lapsed"


def _premium_standing_for(db: Session, policy: Policy, as_of: date) -> str | None:
    schedule = premium_repo.get_schedule_by_policy_id(db, policy.id)
    if schedule is None:
        return None
    views = [
        premium_rules.InstallmentView(
            id=i.id,
            number=i.installment_number,
            due_date=i.due_date,
            amount_due=i.amount_due,
            amount_paid=i.amount_paid,
        )
        for i in schedule.installments
    ]
    summary = premium_rules.summarise(views, schedule.total_premium, as_of)
    return summary.get("standing")


def _policy_to_renewal_dict(policy: Policy) -> dict:
    return {
        "id": policy.id,
        "issued": _policy_issued(policy),
        "end_date": policy.end_date,
        "lapsed": _policy_lapsed(policy),
    }


def _build_account_out(
    db: Session,
    policy: Policy,
    history: list[Reminder],
    as_of: date,
) -> dict:
    plan = rules.build_reminder_plan(
        policy_id=policy.id,
        end_date=policy.end_date,
        issued=_policy_issued(policy),
        lapsed=_policy_lapsed(policy),
        history=history,
        as_of=as_of,
    )
    premium_standing = _premium_standing_for(db, policy, as_of)
    status = rules.get_renewal_status(policy.end_date, as_of)
    days_until = rules.get_days_until_expiry(policy.end_date, as_of)

    return {
        "policyId": policy.policy_number,
        "asOf": as_of.isoformat(),
        "daysUntilExpiry": days_until,
        "status": status.value,
        "eligibility": {
            "eligible": plan.eligibility.eligible,
            "code": plan.eligibility.code.value,
            "reason": plan.eligibility.reason,
        },
        "window": _window_dict(policy.end_date) if policy.end_date else None,
        "currentStageId": plan.current_stage.id if plan.current_stage else None,
        "currentStageState": plan.current_stage.state.value if plan.current_stage else None,
        "lastReminder": _reminder_brief(plan.last_reminder),
        "nextReminder": _next_reminder_dict(plan),
        "premiumStanding": premium_standing,
        "pendingAction": plan.pending_action,
        "policy": {
            "policyNumber": policy.policy_number,
            "productName": policy.product.name,
            "status": policy.status,
            "issueDate": policy.issue_date.isoformat() if policy.issue_date else None,
            "startDate": policy.start_date.isoformat() if policy.start_date else None,
            "endDate": policy.end_date.isoformat() if policy.end_date else None,
            "policyholderName": policy.customer.full_name if policy.customer else None,
            "agentName": policy.agent.full_name if policy.agent else None,
        },
    }


def _window_dict(end_date: date) -> dict:
    ordered = rules.get_ordered_stages()
    first_stage = ordered[0]
    window_close = rules.add_days(end_date, rules.FOLLOW_UP_WINDOW_DAYS)
    window_open = rules.add_days(end_date, first_stage["offset_days"])
    return {
        "opensOn": window_open.isoformat(),
        "expiresOn": end_date.isoformat(),
        "closesOn": window_close.isoformat(),
    }


def _reminder_brief(reminder: Reminder | None) -> dict | None:
    if reminder is None:
        return None
    return {
        "reminderId": reminder.reminder_number,
        "stage": reminder.stage,
        "status": reminder.status,
        "attemptedAt": reminder.attempted_at.isoformat(),
    }


def _next_reminder_dict(plan: rules.ReminderPlan) -> dict | None:
    if not plan.eligibility.eligible:
        return None
    current = plan.current_stage
    if current and (current.can_trigger or current.can_retry):
        return {
            "stageId": current.id,
            "label": current.label,
            "scheduledFor": current.scheduled_for.isoformat(),
            "dueNow": True,
            "action": "retry" if current.can_retry else "send",
        }
    upcoming = next((s for s in plan.stages if s.state == rules.ReminderStageState.SCHEDULED), None)
    if upcoming:
        return {
            "stageId": upcoming.id,
            "label": upcoming.label,
            "scheduledFor": upcoming.scheduled_for.isoformat(),
            "dueNow": False,
            "action": "send",
        }
    return None


def _reminder_out(reminder: Reminder, policy_number: str | None = None) -> dict:
    return {
        "reminderId": reminder.reminder_number,
        "policyNumber": policy_number,
        "stage": reminder.stage,
        "stageLabel": rules.STAGES_BY_ID.get(reminder.stage, {}).get("label", reminder.stage),
        "scheduledFor": reminder.scheduled_for.isoformat(),
        "attemptedAt": reminder.attempted_at.isoformat(),
        "evaluatedAsOf": reminder.evaluated_as_of.isoformat(),
        "sentAt": reminder.sent_at.isoformat() if reminder.sent_at else None,
        "channel": reminder.channel,
        "channelLabel": {"email": "Email", "sms": "SMS", "in-app": "In-app"}.get(
            reminder.channel, reminder.channel
        ),
        "status": reminder.status,
        "trigger": reminder.reminder_trigger,
        "createdByName": reminder.created_by_name,
        "createdByRole": reminder.created_by_role,
        "retryOf": None,  # will be enriched by service
        "note": reminder.note,
        "result": reminder.result,
        "supersededBy": reminder.superseded_by,
    }


def _result_text(
    status: str, channel: str, note: str | None, superseded_by: str | None, actor_name: str
) -> str:
    channel_label = {"email": "email", "sms": "SMS", "in-app": "in-app"}.get(channel, channel)
    if status == "sent":
        return f"Delivered to the simulated {channel_label} channel. No real message was sent."
    if status == "failed":
        return (
            f"Simulated delivery failure selected by {actor_name}. No real provider was contacted."
        )
    if superseded_by:
        sup_def = rules.get_stage_definition(superseded_by)
        sup_label = sup_def["label"] if sup_def else superseded_by
        return (
            "Skipped automatically: the policy had already reached the "
            f"{sup_label} stage when the check ran."
        )
    return f"Skipped: {note}" if note else "Skipped by an administrator (simulated)."


def _policy_in_scope(db: Session, scope: PolicyScope, policy_number: str) -> Policy:
    policy = get_policy_by_number(db, policy_number)
    if policy is None or not scope.allows(policy):
        raise NotFoundError(POLICY_NOT_FOUND.format(number=policy_number))
    if not _policy_issued(policy):
        raise NotFoundError(POLICY_NOT_FOUND.format(number=policy_number))
    return policy


def _summarise_renewals(accounts: list[dict]) -> dict:
    total = len(accounts)
    eligible = sum(1 for a in accounts if a["eligibility"]["eligible"])
    within60 = sum(
        1
        for a in accounts
        if a["eligibility"]["eligible"]
        and a["daysUntilExpiry"] is not None
        and 0 <= a["daysUntilExpiry"] <= 60
    )
    within30 = sum(
        1
        for a in accounts
        if a["eligibility"]["eligible"]
        and a["daysUntilExpiry"] is not None
        and 0 <= a["daysUntilExpiry"] <= 30
    )
    within7 = sum(
        1
        for a in accounts
        if a["eligibility"]["eligible"]
        and a["daysUntilExpiry"] is not None
        and 0 <= a["daysUntilExpiry"] <= 7
    )
    expired = sum(1 for a in accounts if a["status"] == rules.RenewalStatus.EXPIRED.value)
    reminders_pending = sum(1 for a in accounts if a["pendingAction"] is not None)
    return {
        "total": total,
        "eligible": eligible,
        "within60": within60,
        "within30": within30,
        "within7": within7,
        "expired": expired,
        "remindersPending": reminders_pending,
    }


# ---------------------------------------------------------------------------
# Clock
# ---------------------------------------------------------------------------


def get_clock(db: Session) -> dict:
    clock = renewal_repo.get_simulation_clock(db)
    today = _today()
    as_of = clock.as_of_date if clock.as_of_date and clock.as_of_date >= today else today
    is_simulated = as_of != today
    return {
        "asOf": as_of.isoformat(),
        "today": today.isoformat(),
        "isSimulated": is_simulated,
        "simulationDate": clock.as_of_date.isoformat() if clock.as_of_date else None,
        "setAt": clock.set_at.isoformat() if clock.set_at else None,
        "setByName": None,  # could join users if needed
    }


def advance_clock(db: Session, user: User, new_date: str, note: str | None) -> dict:
    if user.role.name not in ROLES_ALLOWED_TO_MANAGE:
        raise ForbiddenError("Only an Administrator can change the simulation date.")
    try:
        target = date.fromisoformat(new_date)
    except (ValueError, TypeError):
        raise UnprocessableError("Enter a valid simulation date (YYYY-MM-DD).") from None

    # Lock and advance
    db.commit()  # end read snapshot
    try:
        clock = renewal_repo.get_simulation_clock(db)
        today = _today()
        current_as_of = (
            clock.as_of_date if clock.as_of_date and clock.as_of_date >= today else today
        )
        if target < current_as_of:
            raise UnprocessableError(
                "The simulation date can only move forward. "
                "Reset the simulation to return to today."
            )
        renewal_repo.set_simulation_date(db, as_of_date=target, user_id=user.id, note=note)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return get_clock(db)


def reset_clock(db: Session, user: User) -> dict:
    if user.role.name not in ROLES_ALLOWED_TO_MANAGE:
        raise ForbiddenError("Only an Administrator can reset the simulation.")
    db.commit()
    try:
        renewal_repo.set_simulation_date(
            db, as_of_date=None, user_id=user.id, note="Simulation reset."
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    return get_clock(db)


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


def list_renewals(
    db: Session,
    user: User,
    *,
    search: str | None = None,
    status: str | None = None,
    limit: int = 200,
    offset: int = 0,
) -> dict:
    scope = resolve_scope(db, user)
    as_of = renewal_repo.resolve_as_of(db)
    policies = renewal_repo.list_policies_for_renewal(
        db, agent_id=scope.agent_id, customer_id=scope.customer_id
    )
    policy_ids = [p.id for p in policies]
    history_map = renewal_repo.reminders_by_policy_id_bulk(db, policy_ids)

    accounts = [
        _build_account_out(db, policy, history_map.get(policy.id, []), as_of) for policy in policies
    ]

    # Apply filters
    if search:
        s = search.lower()
        accounts = [
            a
            for a in accounts
            if s in a["policyId"].lower()
            or s in (a["policy"]["policyholderName"] or "").lower()
            or s in (a["policy"]["productName"] or "").lower()
        ]
    if status and status != "all":
        accounts = [a for a in accounts if a["status"] == status]

    summary = _summarise_renewals(
        [_build_account_out(db, p, history_map.get(p.id, []), as_of) for p in policies]
    )

    # Sort: expiry ascending by default
    accounts.sort(key=lambda a: (a["daysUntilExpiry"] is None, a["daysUntilExpiry"] or 9999))

    total = len(accounts)
    paged = accounts[offset : offset + limit]
    recent_all = []
    for rems in history_map.values():
        recent_all.extend(rems)
    recent_all.sort(key=lambda r: r.attempted_at, reverse=True)
    recent_reminders = [_reminder_out(r) for r in recent_all[:6]]

    # Retrieve policy numbers for recent reminders
    policy_map = {p.id: p.policy_number for p in policies}
    for rout in recent_reminders:
        rout["policyNumber"] = None  # will be filled below
    for r, rout in zip(recent_all[:6], recent_reminders, strict=False):
        rout["policyNumber"] = policy_map.get(r.policy_id)

    return {
        "asOf": as_of.isoformat(),
        "clock": get_clock(db),
        "items": paged,
        "total": total,
        "summary": summary,
        "recentReminders": recent_reminders,
    }


def get_renewal_by_policy(db: Session, user: User, policy_number: str) -> dict:
    scope = resolve_scope(db, user)
    as_of = renewal_repo.resolve_as_of(db)
    policy = _policy_in_scope(db, scope, policy_number)
    history = renewal_repo.get_reminders_by_policy_id(db, policy.id)
    account = _build_account_out(db, policy, history, as_of)
    plan = rules.build_reminder_plan(
        policy_id=policy.id,
        end_date=policy.end_date,
        issued=_policy_issued(policy),
        lapsed=_policy_lapsed(policy),
        history=history,
        as_of=as_of,
    )

    # Build premium context
    premium_ctx = None
    schedule = premium_repo.get_schedule_by_policy_id(db, policy.id)
    if schedule:
        views = [
            premium_rules.InstallmentView(
                id=i.id,
                number=i.installment_number,
                due_date=i.due_date,
                amount_due=i.amount_due,
                amount_paid=i.amount_paid,
            )
            for i in schedule.installments
        ]
        summary = premium_rules.summarise(views, schedule.total_premium, as_of)
        overdue = summary.get("oldest_overdue")
        next_due_item = summary.get("next_due")
        premium_ctx = {
            "standing": summary["standing"],
            "outstanding": str(summary["outstanding"]),
            "overdueAmount": str(summary["overdue_amount"]),
            "overdueCount": summary["counts"]["overdue"],
            "oldestOverdueDate": overdue.due_date.isoformat() if overdue else None,
            "nextDueDate": next_due_item.due_date.isoformat() if next_due_item else None,
            "nextDueAmount": str(next_due_item.outstanding) if next_due_item else None,
        }

    # Milestones
    milestones = _build_milestones(policy, as_of)

    # Stage plan for response
    stages_out = []
    for stage in plan.stages:
        attempts_out = [_reminder_out(r, policy.policy_number) for r in stage.attempts]
        # enrich retryOf
        number_map = {r.id: r.reminder_number for r in history}
        for rem, aout in zip(stage.attempts, attempts_out, strict=False):
            aout["retryOf"] = number_map.get(rem.retry_of_id) if rem.retry_of_id else None
        stages_out.append(
            {
                "id": stage.id,
                "label": stage.label,
                "shortLabel": stage.short_label,
                "channel": stage.channel,
                "scheduledFor": stage.scheduled_for.isoformat(),
                "actionableUntil": stage.actionable_until.isoformat(),
                "state": stage.state.value,
                "isCurrent": stage.is_current,
                "handled": stage.handled,
                "canTrigger": stage.can_trigger,
                "canRetry": stage.can_retry,
                "attempts": attempts_out,
                "latestAttempt": attempts_out[-1] if attempts_out else None,
            }
        )

    history_out = [
        _reminder_out(r, policy.policy_number)
        for r in sorted(history, key=lambda r: r.attempted_at, reverse=True)
    ]
    number_map = {r.id: r.reminder_number for r in history}
    for rem, hout in zip(
        sorted(history, key=lambda r: r.attempted_at, reverse=True), history_out, strict=False
    ):
        hout["retryOf"] = number_map.get(rem.retry_of_id) if rem.retry_of_id else None

    return {
        "clock": get_clock(db),
        "policy": account["policy"],
        "issued": _policy_issued(policy),
        "account": {
            **account,
            "plan": {
                "stages": stages_out,
                "currentStage": next((s for s in stages_out if s["isCurrent"]), None),
                "lastReminder": _reminder_brief(plan.last_reminder),
                "pendingAction": plan.pending_action,
            },
        },
        "premium": premium_ctx,
        "history": history_out,
        "milestones": milestones,
        "eligibility": account["eligibility"],
    }


def _build_milestones(policy: Policy, as_of: date) -> list[dict]:
    if not policy.end_date:
        return []
    ordered = rules.get_ordered_stages()
    window_open = rules.add_days(policy.end_date, ordered[0]["offset_days"])
    window_close = rules.add_days(policy.end_date, rules.FOLLOW_UP_WINDOW_DAYS)
    milestones = [
        {
            "stage": "Cover started",
            "date": policy.start_date.isoformat() if policy.start_date else None,
            "note": "Policy cover began.",
        },
        {
            "stage": "Renewal window opens",
            "date": window_open.isoformat(),
            "note": "First renewal reminder becomes due.",
        },
        {
            "stage": "Policy expires",
            "date": policy.end_date.isoformat(),
            "note": "Cover ends unless renewed.",
        },
        {
            "stage": "Follow-up window closes",
            "date": window_close.isoformat(),
            "note": "No further renewal reminders after this date.",
        },
    ]
    current_assigned = False
    result = []
    for m in milestones:
        mdate = date.fromisoformat(m["date"]) if m["date"] else None
        if mdate and mdate <= as_of:
            result.append({**m, "status": "completed"})
        elif not current_assigned:
            current_assigned = True
            result.append({**m, "status": "current", "stateLabel": "Next"})
        else:
            result.append({**m, "status": "upcoming", "stateLabel": "Scheduled"})
    return result


def get_reminder_history(db: Session, user: User, policy_number: str) -> dict:
    scope = resolve_scope(db, user)
    policy = _policy_in_scope(db, scope, policy_number)
    history = renewal_repo.get_reminders_by_policy_id(db, policy.id)
    number_map = {r.id: r.reminder_number for r in history}
    items = []
    for r in sorted(history, key=lambda x: x.attempted_at, reverse=True):
        out = _reminder_out(r, policy.policy_number)
        out["retryOf"] = number_map.get(r.retry_of_id) if r.retry_of_id else None
        items.append(out)
    return {"items": items, "total": len(items)}


def get_reminder_plan(db: Session, user: User, policy_number: str, as_of_param: str | None) -> dict:
    scope = resolve_scope(db, user)
    policy = _policy_in_scope(db, scope, policy_number)
    if as_of_param:
        try:
            as_of = date.fromisoformat(as_of_param)
        except (ValueError, TypeError):
            raise UnprocessableError(
                "Enter a valid date (YYYY-MM-DD) for the reminder plan."
            ) from None
    else:
        as_of = renewal_repo.resolve_as_of(db)
    history = renewal_repo.get_reminders_by_policy_id(db, policy.id)
    plan = rules.build_reminder_plan(
        policy_id=policy.id,
        end_date=policy.end_date,
        issued=_policy_issued(policy),
        lapsed=_policy_lapsed(policy),
        history=history,
        as_of=as_of,
    )
    stages_out = []
    number_map = {r.id: r.reminder_number for r in history}
    for stage in plan.stages:
        attempts_out = [_reminder_out(r, policy.policy_number) for r in stage.attempts]
        for rem, aout in zip(stage.attempts, attempts_out, strict=False):
            aout["retryOf"] = number_map.get(rem.retry_of_id) if rem.retry_of_id else None
        stages_out.append(
            {
                "id": stage.id,
                "label": stage.label,
                "shortLabel": stage.short_label,
                "channel": stage.channel,
                "scheduledFor": stage.scheduled_for.isoformat(),
                "actionableUntil": stage.actionable_until.isoformat(),
                "state": stage.state.value,
                "isCurrent": stage.is_current,
                "handled": stage.handled,
                "canTrigger": stage.can_trigger,
                "canRetry": stage.can_retry,
                "attempts": attempts_out,
            }
        )
    return {
        "policyId": policy.policy_number,
        "asOf": as_of.isoformat(),
        "eligibility": {
            "eligible": plan.eligibility.eligible,
            "code": plan.eligibility.code.value,
            "reason": plan.eligibility.reason,
        },
        "window": _window_dict(policy.end_date) if policy.end_date else None,
        "stages": stages_out,
        "currentStage": next((s for s in stages_out if s["isCurrent"]), None),
        "pendingAction": plan.pending_action,
    }


# ---------------------------------------------------------------------------
# Reminder check (bulk run)
# ---------------------------------------------------------------------------


def run_reminder_check(db: Session, user: User) -> dict:
    if user.role.name not in ROLES_ALLOWED_TO_RUN_CHECK:
        raise ForbiddenError("Only an Agent or Administrator can run the reminder check.")
    actor_name = _actor_name(user, None, db)
    now = _now()
    as_of = renewal_repo.resolve_as_of(db)

    # Commit the read snapshot so we see the latest committed data.
    db.commit()
    try:
        policies = renewal_repo.list_policies_for_renewal(db, agent_id=None, customer_id=None)
        policy_ids = [p.id for p in policies]
        history_map = renewal_repo.reminders_by_policy_id_bulk(db, policy_ids)

        policy_dicts = [_policy_to_renewal_dict(p) for p in policies]
        plan = rules.plan_reminder_check(
            policies=policy_dicts,
            history_by_policy=history_map,
            as_of=as_of,
        )

        year = now.year
        run_number = renewal_repo.next_check_run_number(db, year)

        # Create check run record
        check_run = ReminderCheckRun(
            run_number=run_number,
            evaluated_as_of=as_of,
            run_at=now,
            run_by_user_id=user.id,
            run_by_name=actor_name,
            run_by_role=user.role.name,
            policies_evaluated=plan.evaluated,
        )
        db.add(check_run)
        db.flush()

        policy_number_map = {p.id: p.policy_number for p in policies}

        generated_out = []
        skipped_out = []

        # Generate reminders for due stages
        for entry in plan.generate:
            reminder_number = renewal_repo.next_reminder_number(db, year)
            result = _result_text("sent", entry.channel, None, None, actor_name)
            r = Reminder(
                reminder_number=reminder_number,
                policy_id=entry.policy_id,
                stage=entry.stage_id,
                scheduled_for=entry.scheduled_for,
                channel=entry.channel,
                status="sent",
                reminder_trigger="reminder-check",
                evaluated_as_of=as_of,
                attempted_at=now,
                sent_at=now,
                check_run_id=check_run.id,
                created_by_user_id=user.id,
                created_by_name=actor_name,
                created_by_role=user.role.name,
                result=result,
            )
            db.add(r)
            db.flush()
            generated_out.append(
                {**_reminder_out(r, policy_number_map.get(entry.policy_id)), "retryOf": None}
            )

        # Skipped (superseded) stages
        for entry in plan.supersede:
            reminder_number = renewal_repo.next_reminder_number(db, year)
            result = _result_text("skipped", entry.channel, None, entry.superseded_by, actor_name)
            r = Reminder(
                reminder_number=reminder_number,
                policy_id=entry.policy_id,
                stage=entry.stage_id,
                scheduled_for=entry.scheduled_for,
                channel=entry.channel,
                status="skipped",
                reminder_trigger="reminder-check",
                evaluated_as_of=as_of,
                attempted_at=now,
                sent_at=None,
                check_run_id=check_run.id,
                created_by_user_id=user.id,
                created_by_name=actor_name,
                created_by_role=user.role.name,
                superseded_by=entry.superseded_by,
                result=result,
            )
            db.add(r)
            db.flush()
            skipped_out.append(
                {**_reminder_out(r, policy_number_map.get(entry.policy_id)), "retryOf": None}
            )

        # Update check run counts
        check_run.reminders_generated = len(plan.generate)
        check_run.reminders_skipped = len(plan.supersede)
        check_run.already_handled = len(plan.already_handled)
        check_run.needs_retry = len(plan.needs_retry)
        check_run.not_yet_due = len(plan.not_yet_due)
        check_run.not_eligible = len(plan.not_eligible)
        db.commit()

    except Exception:
        db.rollback()
        raise

    logger.info(
        "Reminder check run",
        extra={
            "run_number": run_number,
            "as_of": as_of.isoformat(),
            "generated": len(plan.generate),
        },
    )

    return {
        "runNumber": run_number,
        "asOf": as_of.isoformat(),
        "runAt": now.isoformat(),
        "runBy": {"name": actor_name, "role": user.role.name},
        "evaluated": plan.evaluated,
        "generated": generated_out,
        "skippedSuperseded": skipped_out,
        "alreadyHandled": [
            {
                "policyId": policy_number_map.get(e.policy_id),
                "stageId": e.stage_id,
                "state": e.state,
            }
            for e in plan.already_handled
        ],
        "needsRetry": [
            {
                "policyId": policy_number_map.get(e.policy_id),
                "stageId": e.stage_id,
                "reminderId": e.latest_reminder_number,
            }
            for e in plan.needs_retry
        ],
        "notYetDue": len(plan.not_yet_due),
        "notEligible": len(plan.not_eligible),
        "counts": {
            "evaluated": plan.evaluated,
            "generated": len(plan.generate),
            "skipped": len(plan.supersede),
            "alreadyHandled": len(plan.already_handled),
            "needsRetry": len(plan.needs_retry),
            "notYetDue": len(plan.not_yet_due),
            "notEligible": len(plan.not_eligible),
        },
    }


# ---------------------------------------------------------------------------
# Manual trigger
# ---------------------------------------------------------------------------


def trigger_reminder(
    db: Session,
    user: User,
    policy_number: str,
    *,
    stage_id: str,
    outcome: str,
    channel: str | None,
    note: str | None,
) -> dict:
    if user.role.name not in ROLES_ALLOWED_TO_MANAGE:
        raise ForbiddenError("Only an Administrator can trigger reminders manually.")

    scope = resolve_scope(db, user)
    now = _now()
    as_of = renewal_repo.resolve_as_of(db)
    actor_name = _actor_name(user, None, db)

    db.commit()
    try:
        policy = _policy_in_scope(db, scope, policy_number)
        history = renewal_repo.get_reminders_by_policy_id(db, policy.id)
        plan = rules.build_reminder_plan(
            policy_id=policy.id,
            end_date=policy.end_date,
            issued=_policy_issued(policy),
            lapsed=_policy_lapsed(policy),
            history=history,
            as_of=as_of,
        )
        check = rules.check_reminder_trigger(
            plan=plan, stage_id=stage_id, outcome=outcome, channel=channel
        )
        if not check.allowed:
            _raise_rule_error(check)

        stage_def = rules.get_stage_definition(stage_id)
        effective_channel = channel or (stage_def["channel"] if stage_def else "email")
        stage_item = next((s for s in plan.stages if s.id == stage_id), None)
        scheduled_for = stage_item.scheduled_for if stage_item else as_of

        reminder_number = renewal_repo.next_reminder_number(db, now.year)
        result = _result_text(outcome, effective_channel, note, None, actor_name)
        r = Reminder(
            reminder_number=reminder_number,
            policy_id=policy.id,
            stage=stage_id,
            scheduled_for=scheduled_for,
            channel=effective_channel,
            status=outcome,
            reminder_trigger="manual",
            evaluated_as_of=as_of,
            attempted_at=now,
            sent_at=now if outcome == "sent" else None,
            created_by_user_id=user.id,
            created_by_name=actor_name,
            created_by_role=user.role.name,
            note=note.strip() if note else None,
            result=result,
        )
        db.add(r)
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.expire_all()
    r = renewal_repo.get_reminder_by_number(db, reminder_number)
    detail = get_renewal_by_policy(db, user, policy_number)
    return {"reminder": _reminder_out(r, policy_number), "details": detail}


# ---------------------------------------------------------------------------
# Retry
# ---------------------------------------------------------------------------


def retry_reminder(
    db: Session,
    user: User,
    reminder_number: str,
    *,
    outcome: str,
    channel: str | None,
    note: str | None,
) -> dict:
    if user.role.name not in ROLES_ALLOWED_TO_MANAGE:
        raise ForbiddenError("Only an Administrator can retry reminders.")

    scope = resolve_scope(db, user)
    now = _now()
    as_of = renewal_repo.resolve_as_of(db)
    actor_name = _actor_name(user, None, db)

    db.commit()
    try:
        original = renewal_repo.lock_reminder(db, reminder_number)
        if original is None:
            raise NotFoundError(REMINDER_NOT_FOUND.format(number=reminder_number))
        policy = _policy_in_scope(db, scope, db.get(Policy, original.policy_id).policy_number)
        history = renewal_repo.get_reminders_by_policy_id(db, policy.id)
        plan = rules.build_reminder_plan(
            policy_id=policy.id,
            end_date=policy.end_date,
            issued=_policy_issued(policy),
            lapsed=_policy_lapsed(policy),
            history=history,
            as_of=as_of,
        )
        check = rules.check_reminder_retry(
            reminder=original, plan=plan, outcome=outcome, channel=channel
        )
        if not check.allowed:
            _raise_rule_error(check)

        effective_channel = channel or original.channel
        new_number = renewal_repo.next_reminder_number(db, now.year)
        result = _result_text(outcome, effective_channel, note, None, actor_name)
        retry = Reminder(
            reminder_number=new_number,
            policy_id=policy.id,
            stage=original.stage,
            scheduled_for=original.scheduled_for,
            channel=effective_channel,
            status=outcome,
            reminder_trigger="retry",
            evaluated_as_of=as_of,
            attempted_at=now,
            sent_at=now if outcome == "sent" else None,
            retry_of_id=original.id,
            created_by_user_id=user.id,
            created_by_name=actor_name,
            created_by_role=user.role.name,
            note=note.strip() if note else None,
            result=result,
        )
        db.add(retry)
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.expire_all()
    retry_row = renewal_repo.get_reminder_by_number(db, new_number)
    retry_out = _reminder_out(retry_row, policy.policy_number)
    retry_out["retryOf"] = reminder_number
    detail = get_renewal_by_policy(db, user, policy.policy_number)
    return {"reminder": retry_out, "details": detail}


def _raise_rule_error(check: rules.RuleResult) -> None:
    STATUS_MAP = {
        rules.RuleCode.INVALID_STAGE: 422,
        rules.RuleCode.INVALID_OUTCOME: 422,
        rules.RuleCode.INVALID_CHANNEL: 422,
        rules.RuleCode.REMINDER_NOT_FOUND: 404,
    }
    status = STATUS_MAP.get(check.code, 409)
    if status == 404:
        raise NotFoundError(check.message)
    if status == 422:
        raise UnprocessableError(check.message)
    raise ConflictError(check.message)


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def seed_reminder_history(db: Session, records: list[dict]) -> int:
    """Insert seed reminder records idempotently (skip existing reminder_numbers)."""
    inserted = 0
    for rec in records:
        existing = renewal_repo.get_reminder_by_number(db, rec["reminder_number"])
        if existing:
            continue
        r = Reminder(
            reminder_number=rec["reminder_number"],
            policy_id=rec["policy_id"],
            stage=rec["stage"],
            scheduled_for=date.fromisoformat(rec["scheduled_for"]),
            channel=rec["channel"],
            status=rec["status"],
            reminder_trigger=rec.get("trigger", "seed"),
            evaluated_as_of=date.fromisoformat(rec.get("evaluated_as_of", rec["scheduled_for"])),
            attempted_at=datetime.fromisoformat(rec["attempted_at"]),
            sent_at=datetime.fromisoformat(rec["attempted_at"])
            if rec["status"] == "sent"
            else None,
            created_by_name=rec.get("created_by_name", "Seed"),
            created_by_role=rec.get("created_by_role", "system"),
            note=rec.get("note"),
            result=rec.get("result"),
            retry_of_id=None,
            superseded_by=None,
        )
        db.add(r)
        inserted += 1
    db.flush()
    return inserted
