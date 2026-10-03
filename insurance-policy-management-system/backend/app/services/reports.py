"""MIS Reports service (Module 6).

Administrator-only. Queries Modules 1–5 tables and returns structured
management information reports.

All reports are computed on demand (not cached). The access is logged
to report_access_log for the audit trail.

Report IDs:
  overview      Management summary across all 5 modules
  policies      Policy report (issued in period)
  premiums      Premium and payment report
  claims        Claims report
  renewals      Renewal pipeline report
  commissions   Agent commission report
"""

from __future__ import annotations

import logging
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenError, UnprocessableError
from app.models import (
    Claim,
    Commission,
    Payment,
    Policy,
    PolicyStatus,
    PremiumSchedule,
    Reminder,
    User,
)
from app.models.report import ReportAccessLog
from app.models.role import RoleName
from app.repositories import renewals as renewal_repo
from app.services import premium_rules, renewal_rules

logger = logging.getLogger(__name__)

REPORT_IDS = {"overview", "policies", "premiums", "claims", "renewals", "commissions"}
ZERO = Decimal("0.00")


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _today() -> date:
    return date.today()


def _actor_name(user: User) -> str:
    return f"{user.first_name} {user.last_name}"


def _require_admin(user: User) -> None:
    if user.role.name != RoleName.ADMINISTRATOR:
        raise ForbiddenError("MIS Reports are available to administrators only.")


def _log_access(
    db: Session,
    user: User,
    *,
    report_id: str,
    period: str | None = None,
    period_from: date | None = None,
    period_to: date | None = None,
    row_count: int | None = None,
) -> None:
    db.add(
        ReportAccessLog(
            accessed_by_user_id=user.id,
            accessed_by_name=_actor_name(user),
            accessed_by_role=user.role.name,
            report_id=report_id,
            period=period,
            period_from=period_from,
            period_to=period_to,
            row_count=row_count,
            accessed_at=_now(),
        )
    )
    # We flush but DO NOT commit here; the caller's existing transaction covers it.
    db.flush()


def _resolve_period(
    query: dict,
    available_dates: list[date],
) -> tuple[date, date, str]:
    """Resolve a reporting period. Returns (from_date, to_date, description)."""
    today = _today()
    period = query.get("period", "ytd")

    if period == "custom":
        try:
            from_d = date.fromisoformat(query["from"])
            to_d = date.fromisoformat(query["to"])
        except (KeyError, ValueError, TypeError):
            raise UnprocessableError(
                "Custom period requires valid 'from' and 'to' dates (YYYY-MM-DD)."
            ) from None
        if from_d > to_d:
            raise UnprocessableError("'from' must not be after 'to'.")
        return from_d, to_d, f"{from_d.isoformat()} to {to_d.isoformat()}"

    if period == "all":
        if available_dates:
            from_d = min(available_dates)
        else:
            from_d = date(today.year, 1, 1)
        return from_d, today, f"All time (from {from_d.isoformat()})"

    if period == "ytd":
        return date(today.year, 1, 1), today, f"Year to date ({today.year})"

    if period.startswith("last_"):
        # last_30, last_60, last_90, last_180, last_365
        try:
            days = int(period.split("_")[1])
        except (IndexError, ValueError):
            raise UnprocessableError(f"Unknown period '{period}'.") from None
        from datetime import timedelta

        from_d = today - timedelta(days=days)
        return from_d, today, f"Last {days} days"

    # year periods like "2025"
    try:
        yr = int(period)
        return date(yr, 1, 1), date(yr, 12, 31), str(yr)
    except (ValueError, TypeError):
        pass

    raise UnprocessableError(f"Unknown period '{period}'.")


def _in_period(d: date | None, from_d: date, to_d: date) -> bool:
    if d is None:
        return False
    return from_d <= d <= to_d


# ---------------------------------------------------------------------------
# Data loaders (query MySQL once per report)
# ---------------------------------------------------------------------------


def _load_policies(db: Session) -> list[Policy]:
    return list(
        db.scalars(select(Policy).where(Policy.status != PolicyStatus.PENDING)).unique().all()
    )


def _load_all_policies(db: Session) -> list[Policy]:
    return list(db.scalars(select(Policy)).unique().all())


def _load_payments(db: Session) -> list[Payment]:
    return list(db.scalars(select(Payment)).all())


def _load_schedules(db: Session) -> list[PremiumSchedule]:
    return list(db.scalars(select(PremiumSchedule)).unique().all())


def _load_claims(db: Session) -> list[Claim]:
    return list(db.scalars(select(Claim)).unique().all())


def _load_commissions(db: Session) -> list[Commission]:
    return list(db.scalars(select(Commission)).all())


def _load_reminders(db: Session) -> list[Reminder]:
    return list(db.scalars(select(Reminder)).all())


# ---------------------------------------------------------------------------
# Period-aware aggregation helpers
# ---------------------------------------------------------------------------


def _sum_decimal(values: list[Decimal | None]) -> Decimal:
    return sum((v for v in values if v is not None), ZERO)


def _safe_decimal(val: Any) -> Decimal:
    if val is None:
        return ZERO
    return Decimal(str(val))


def _share(count: int, total: int) -> float:
    return round(count / total * 100, 1) if total > 0 else 0.0


def _distribution(rows: list, key_fn, label_fn=None) -> list[dict]:
    groups: dict[Any, int] = {}
    for r in rows:
        k = key_fn(r)
        groups[k] = groups.get(k, 0) + 1
    total = len(rows)
    result = [
        {
            "key": k,
            "label": label_fn(k) if label_fn else str(k),
            "count": n,
            "share": _share(n, total),
        }
        for k, n in groups.items()
    ]
    result.sort(key=lambda x: (-x["count"], x["label"]))
    return result


def _title_case(s: str) -> str:
    return s.replace("_", " ").replace("-", " ").title()


# ---------------------------------------------------------------------------
# Module-level summaries for overview
# ---------------------------------------------------------------------------


def _policy_summary(policies: list[Policy], from_d: date, to_d: date) -> dict:
    issued_in_period = [
        p for p in policies if p.issue_date and _in_period(p.issue_date, from_d, to_d)
    ]
    active = [p for p in policies if p.status == "active"]
    expired = [p for p in policies if p.status == "expired"]
    return {
        "issuedInPeriod": len(issued_in_period),
        "totalOnBook": len(policies),
        "active": len(active),
        "expired": len(expired),
    }


def _premium_summary(
    schedules: list[PremiumSchedule],
    payments: list[Payment],
    from_d: date,
    to_d: date,
    today: date,
) -> dict:
    total_outstanding = ZERO
    total_overdue = ZERO
    total_due = ZERO
    total_paid = ZERO
    for schedule in schedules:
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
        s = premium_rules.summarise(views, schedule.total_premium, today)
        total_outstanding += s["outstanding"]
        total_overdue += s["overdue_amount"]
        total_due += s["due_amount"]
        total_paid += s["total_paid"]

    period_payments = [
        p
        for p in payments
        if p.paid_at and _in_period(p.paid_at.date(), from_d, to_d) and p.status == "successful"
    ]
    collected_in_period = _sum_decimal(p.amount for p in period_payments)

    return {
        "collectedInPeriod": str(collected_in_period),
        "paymentsInPeriod": len(period_payments),
        "overdueAmount": str(total_overdue),
        "dueAmount": str(total_due),
        "outstandingAmount": str(total_outstanding),
        "totalPaid": str(total_paid),
    }


def _claims_summary(claims: list[Claim], from_d: date, to_d: date) -> dict:
    in_period = [c for c in claims if c.filing_date and _in_period(c.filing_date, from_d, to_d)]
    closed_statuses = {"settled", "rejected", "cancelled"}
    open_claims = [c for c in claims if c.status not in closed_statuses]
    settled = [c for c in claims if c.status == "settled"]
    approved = [c for c in claims if c.status == "approved"]
    return {
        "filedInPeriod": len(in_period),
        "totalClaims": len(claims),
        "open": len(open_claims),
        "approved": len(approved),
        "settled": len(settled),
        "claimedAmount": str(_sum_decimal(c.claimed_amount for c in in_period)),
        "approvedAmount": str(
            _sum_decimal(c.approved_amount for c in in_period if c.approved_amount)
        ),
    }


def _renewals_summary(
    policies: list[Policy],
    reminders: list[Reminder],
    from_d: date,
    to_d: date,
    today: date,
) -> dict:
    issued = [p for p in policies if p.issue_date and p.status != "pending"]
    within60 = within30 = within7 = expiring_today = expired = 0
    for p in issued:
        if p.end_date:
            days = (p.end_date - today).days
            if days < 0:
                expired += 1
            elif days == 0:
                expiring_today += 1
                within7 += 1
                within30 += 1
                within60 += 1
            elif days <= 7:
                within7 += 1
                within30 += 1
                within60 += 1
            elif days <= 30:
                within30 += 1
                within60 += 1
            elif days <= 60:
                within60 += 1

    period_reminders = [r for r in reminders if _in_period(r.evaluated_as_of, from_d, to_d)]
    return {
        "eligible": len(issued),
        "within60": within60,
        "within30": within30,
        "within7": within7,
        "expiringToday": expiring_today,
        "expired": expired,
        "remindersInPeriod": len(period_reminders),
        "remindersTotal": len(reminders),
    }


def _commissions_summary(commissions: list[Commission], from_d: date, to_d: date) -> dict:
    in_period = [c for c in commissions if _in_period(c.generated_at.date(), from_d, to_d)]
    return {
        "generatedInPeriod": len(in_period),
        "amountInPeriod": str(_sum_decimal(c.amount for c in in_period)),
        "records": len(commissions),
        "pending": sum(1 for c in commissions if c.status == "pending"),
        "earned": sum(1 for c in commissions if c.status == "earned"),
        "paid": sum(1 for c in commissions if c.status == "paid"),
        "totalAmount": str(_sum_decimal(c.amount for c in commissions)),
        "paidAmount": str(_sum_decimal(c.amount for c in commissions if c.status == "paid")),
    }


# ---------------------------------------------------------------------------
# Overview
# ---------------------------------------------------------------------------


def get_overview(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    today = _today()

    all_dates: list[date] = []
    policies = _load_all_policies(db)
    payments = _load_payments(db)
    claims = _load_claims(db)
    commissions = _load_commissions(db)
    reminders = _load_reminders(db)
    schedules = _load_schedules(db)

    for p in policies:
        if p.issue_date:
            all_dates.append(p.issue_date)
    for pay in payments:
        if pay.paid_at:
            all_dates.append(pay.paid_at.date())
    for c in claims:
        if c.filing_date:
            all_dates.append(c.filing_date)

    from_d, to_d, period_desc = _resolve_period(query, all_dates)

    result = {
        "reportId": "overview",
        "title": "MIS Reports",
        "description": "Management information derived from Modules 1 to 5.",
        "asOf": today.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "summary": {
            "policies": _policy_summary(policies, from_d, to_d),
            "premiums": _premium_summary(schedules, payments, from_d, to_d, today),
            "claims": _claims_summary(claims, from_d, to_d),
            "renewals": _renewals_summary(policies, reminders, from_d, to_d, today),
            "commissions": _commissions_summary(commissions, from_d, to_d),
        },
        "coverage": {
            "policies": len(policies),
            "premiumSchedules": len(schedules),
            "payments": len(payments),
            "claims": len(claims),
            "reminders": len(reminders),
            "commissions": len(commissions),
        },
    }
    _log_access(
        db,
        user,
        report_id="overview",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Policy report
# ---------------------------------------------------------------------------


def get_policy_report(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    today = _today()
    policies = _load_all_policies(db)
    schedules = _load_schedules(db)
    schedule_map = {s.policy_id: s for s in schedules}

    dates = [p.issue_date for p in policies if p.issue_date]
    from_d, to_d, period_desc = _resolve_period(query, dates)

    product_filter = query.get("product")
    status_filter = query.get("status")

    rows = []
    for p in policies:
        if not p.issue_date:
            continue
        if not _in_period(p.issue_date, from_d, to_d):
            continue
        if product_filter and product_filter != "all" and p.product.name != product_filter:
            continue
        if status_filter and status_filter != "all" and p.status != status_filter:
            continue

        schedule = schedule_map.get(p.id)
        paid = ZERO
        outstanding = ZERO
        if schedule:
            for inst in schedule.installments:
                paid += inst.amount_paid
                outstanding += inst.amount_due - inst.amount_paid

        rows.append(
            {
                "policyId": p.policy_number,
                "productName": p.product.name if p.product else None,
                "type": p.product.product_type if p.product else None,
                "status": p.status,
                "policyholderName": p.customer.full_name if p.customer else None,
                "agentName": p.agent.full_name if p.agent else None,
                "issueDate": p.issue_date.isoformat(),
                "startDate": p.start_date.isoformat() if p.start_date else None,
                "endDate": p.end_date.isoformat() if p.end_date else None,
                "coverageAmount": str(p.coverage_amount) if p.coverage_amount else None,
                "annualPremium": str(p.annual_premium)
                if hasattr(p, "annual_premium") and p.annual_premium
                else None,
                "scheduleTotal": str(schedule.total_premium) if schedule else None,
                "paidAmount": str(paid),
                "outstandingAmount": str(outstanding),
            }
        )

    metrics = {
        "total": len(rows),
        "active": sum(1 for r in rows if r["status"] == "active"),
        "expired": sum(1 for r in rows if r["status"] == "expired"),
        "pending": sum(1 for r in rows if r["status"] == "pending"),
    }
    distributions = {
        "byProduct": _distribution(rows, lambda r: r["productName"] or "Unknown"),
        "byStatus": _distribution(rows, lambda r: r["status"], label_fn=_title_case),
        "byType": _distribution(rows, lambda r: r["type"] or "Unknown", label_fn=_title_case),
    }
    product_options = sorted({r["productName"] for r in rows if r["productName"]})
    status_options = sorted({r["status"] for r in rows})

    result = {
        "reportId": "policies",
        "title": "Policy report",
        "asOf": today.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "metrics": metrics,
        "distributions": distributions,
        "filterOptions": {"products": product_options, "statuses": status_options},
        "rows": rows,
        "total": len(rows),
    }
    _log_access(
        db,
        user,
        report_id="policies",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
        row_count=len(rows),
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Premium report
# ---------------------------------------------------------------------------


def get_premium_report(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    today = _today()
    payments = _load_payments(db)
    schedules = _load_schedules(db)
    policies = _load_all_policies(db)

    policy_map = {p.id: p for p in policies}

    dates = [p.paid_at.date() for p in payments if p.paid_at]
    from_d, to_d, period_desc = _resolve_period(query, dates)

    product_filter = query.get("product")
    status_filter = query.get("status")

    rows = []
    for pmt in payments:
        if not pmt.paid_at:
            continue
        pmt_date = pmt.paid_at.date()
        if not _in_period(pmt_date, from_d, to_d):
            continue

        installment = pmt.installment
        schedule = db.get(PremiumSchedule, installment.schedule_id) if installment else None
        policy = policy_map.get(schedule.policy_id) if schedule else None

        product_name = policy.product.name if policy and policy.product else None
        if product_filter and product_filter != "all" and product_name != product_filter:
            continue
        if status_filter and status_filter != "all" and pmt.status != status_filter:
            continue

        rows.append(
            {
                "paymentId": pmt.payment_number,
                "paymentDate": pmt_date.isoformat(),
                "policyId": policy.policy_number if policy else None,
                "policyholderName": policy.customer.full_name
                if policy and policy.customer
                else None,
                "productName": product_name,
                "installmentNumber": installment.installment_number if installment else None,
                "method": pmt.payment_method,
                "methodLabel": _title_case(pmt.payment_method),
                "status": pmt.status,
                "amount": str(pmt.amount),
                "paymentReference": pmt.payment_reference,
            }
        )

    # Portfolio position (book as of today)
    total_outstanding = ZERO
    total_overdue = ZERO
    total_due = ZERO
    total_paid = ZERO
    for schedule in schedules:
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
        s = premium_rules.summarise(views, schedule.total_premium, today)
        total_outstanding += s["outstanding"]
        total_overdue += s["overdue_amount"]
        total_due += s["due_amount"]
        total_paid += s["total_paid"]

    successful = [r for r in rows if r["status"] == "successful"]
    result = {
        "reportId": "premiums",
        "title": "Premium & payment report",
        "asOf": today.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "position": {
            "totalPaid": str(total_paid),
            "outstanding": str(total_outstanding),
            "overdueAmount": str(total_overdue),
            "dueAmount": str(total_due),
            "notes": (
                "Premium position is the book as of today; "
                "the reporting period scopes payment activity."
            ),
        },
        "activity": {
            "total": len(rows),
            "successful": len(successful),
            "collected": str(_sum_decimal(Decimal(r["amount"]) for r in successful)),
        },
        "distributions": {
            "byStatus": _distribution(rows, lambda r: r["status"], label_fn=_title_case),
            "byProduct": _distribution(rows, lambda r: r["productName"] or "Unknown"),
            "byMethod": _distribution(rows, lambda r: r["methodLabel"]),
        },
        "rows": rows,
        "total": len(rows),
    }
    _log_access(
        db,
        user,
        report_id="premiums",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
        row_count=len(rows),
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Claims report
# ---------------------------------------------------------------------------


def get_claims_report(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    today = _today()
    claims = _load_claims(db)

    dates = [c.filing_date for c in claims if c.filing_date]
    from_d, to_d, period_desc = _resolve_period(query, dates)

    product_filter = query.get("product")
    status_filter = query.get("status")

    rows = []
    for c in claims:
        if not c.filing_date or not _in_period(c.filing_date, from_d, to_d):
            continue
        policy = c.policy
        product_name = policy.product.name if policy and policy.product else None
        if product_filter and product_filter != "all" and product_name != product_filter:
            continue
        if status_filter and status_filter != "all" and c.status != status_filter:
            continue

        rows.append(
            {
                "claimId": c.claim_number,
                "filingDate": c.filing_date.isoformat(),
                "incidentDate": c.incident_date.isoformat() if c.incident_date else None,
                "policyId": policy.policy_number if policy else None,
                "policyholderName": policy.customer.full_name
                if policy and policy.customer
                else None,
                "productName": product_name,
                "claimTypeLabel": c.claim_type.label if c.claim_type else None,
                "status": c.status,
                "claimedAmount": str(c.claimed_amount),
                "approvedAmount": str(c.approved_amount) if c.approved_amount else None,
            }
        )

    closed = {"settled", "rejected", "cancelled"}
    metrics = {
        "total": len(rows),
        "open": sum(1 for r in rows if r["status"] not in closed),
        "settled": sum(1 for r in rows if r["status"] == "settled"),
        "approved": sum(1 for r in rows if r["status"] == "approved"),
        "rejected": sum(1 for r in rows if r["status"] == "rejected"),
        "claimedAmount": str(_sum_decimal(Decimal(r["claimedAmount"]) for r in rows)),
        "approvedAmount": str(
            _sum_decimal(Decimal(r["approvedAmount"]) for r in rows if r["approvedAmount"])
        ),
    }
    result = {
        "reportId": "claims",
        "title": "Claims report",
        "asOf": today.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "metrics": metrics,
        "distributions": {
            "byStatus": _distribution(rows, lambda r: r["status"], label_fn=_title_case),
            "byProduct": _distribution(rows, lambda r: r["productName"] or "Unknown"),
            "byClaimType": _distribution(rows, lambda r: r["claimTypeLabel"] or "Unknown"),
        },
        "rows": rows,
        "total": len(rows),
    }
    _log_access(
        db,
        user,
        report_id="claims",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
        row_count=len(rows),
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Renewal report
# ---------------------------------------------------------------------------


def get_renewal_report(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    as_of = renewal_repo.resolve_as_of(db)
    policies = _load_all_policies(db)
    reminders = _load_reminders(db)

    dates = [r.evaluated_as_of for r in reminders]
    from_d, to_d, period_desc = _resolve_period(query, dates)

    product_filter = query.get("product")
    status_filter = query.get("status")

    reminder_map: dict[int, list] = {}
    for r in reminders:
        reminder_map.setdefault(r.policy_id, []).append(r)

    rows = []
    for p in policies:
        if not p.issue_date or p.status == "pending":
            continue
        status = renewal_rules.get_renewal_status(p.end_date, as_of)
        product_name = p.product.name if p.product else None

        if product_filter and product_filter != "all" and product_name != product_filter:
            continue
        if status_filter and status_filter != "all" and status.value != status_filter:
            continue

        days = renewal_rules.get_days_until_expiry(p.end_date, as_of)
        history = reminder_map.get(p.id, [])
        period_reminders = [r for r in history if _in_period(r.evaluated_as_of, from_d, to_d)]
        last = sorted(history, key=lambda r: r.attempted_at)[-1] if history else None
        plan = renewal_rules.build_reminder_plan(
            policy_id=p.id,
            end_date=p.end_date,
            issued=bool(p.issue_date),
            lapsed=p.status == "lapsed",
            history=history,
            as_of=as_of,
        )
        current = plan.current_stage

        rows.append(
            {
                "policyId": p.policy_number,
                "productName": product_name,
                "policyholderName": p.customer.full_name if p.customer else None,
                "agentName": p.agent.full_name if p.agent else None,
                "endDate": p.end_date.isoformat() if p.end_date else None,
                "daysUntilExpiry": days,
                "status": status.value,
                "currentStage": current.id if current else None,
                "lastReminderOn": last.evaluated_as_of.isoformat() if last else None,
                "lastReminderStatus": last.status if last else None,
                "remindersInPeriod": len(period_reminders),
                "eligible": plan.eligibility.eligible,
            }
        )

    pipeline_within60 = sum(
        1 for r in rows if r["daysUntilExpiry"] is not None and 0 <= r["daysUntilExpiry"] <= 60
    )
    pipeline_within30 = sum(
        1 for r in rows if r["daysUntilExpiry"] is not None and 0 <= r["daysUntilExpiry"] <= 30
    )
    pipeline_within7 = sum(
        1 for r in rows if r["daysUntilExpiry"] is not None and 0 <= r["daysUntilExpiry"] <= 7
    )
    expired_count = sum(1 for r in rows if r["status"] == "expired")
    period_reminders = [r for r in reminders if _in_period(r.evaluated_as_of, from_d, to_d)]

    result = {
        "reportId": "renewals",
        "title": "Renewal report",
        "asOf": as_of.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "positionNote": (
            "The renewal pipeline is as of today; "
            "the reporting period scopes reminder activity only."
        ),
        "pipeline": {
            "total": len(rows),
            "eligible": sum(1 for r in rows if r["eligible"]),
            "within60": pipeline_within60,
            "within30": pipeline_within30,
            "within7": pipeline_within7,
            "expired": expired_count,
        },
        "reminderActivity": {
            "inPeriod": len(period_reminders),
            "sent": sum(1 for r in period_reminders if r.status == "sent"),
            "failed": sum(1 for r in period_reminders if r.status == "failed"),
            "skipped": sum(1 for r in period_reminders if r.status == "skipped"),
        },
        "distributions": {
            "byStatus": _distribution(rows, lambda r: r["status"], label_fn=_title_case),
            "byProduct": _distribution(rows, lambda r: r["productName"] or "Unknown"),
        },
        "rows": rows,
        "total": len(rows),
    }
    _log_access(
        db,
        user,
        report_id="renewals",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
        row_count=len(rows),
    )
    db.commit()
    return result


# ---------------------------------------------------------------------------
# Commission report
# ---------------------------------------------------------------------------


def get_commission_report(db: Session, user: User, query: dict) -> dict:
    _require_admin(user)
    today = _today()
    commissions = _load_commissions(db)

    dates = [c.generated_at.date() for c in commissions]
    from_d, to_d, period_desc = _resolve_period(query, dates)

    product_filter = query.get("product")
    status_filter = query.get("status")
    agent_filter = query.get("agentId")

    rows = []
    for c in commissions:
        gen_date = c.generated_at.date()
        if not _in_period(gen_date, from_d, to_d):
            continue
        policy = c.policy
        product_name = policy.product.name if policy and policy.product else None
        if product_filter and product_filter != "all" and product_name != product_filter:
            continue
        if status_filter and status_filter != "all" and c.status != status_filter:
            continue
        agent = c.agent
        agent_code = agent.agent_code if agent else None
        if agent_filter and agent_filter != "all" and agent_code != agent_filter:
            continue

        rows.append(
            {
                "commissionId": c.commission_number,
                "generatedOn": gen_date.isoformat(),
                "agentName": agent.full_name if agent else None,
                "agentCode": agent_code,
                "policyId": policy.policy_number if policy else None,
                "productName": product_name,
                "paymentId": c.payment.payment_number if c.payment else None,
                "paymentDate": c.payment_date.isoformat(),
                "basis": c.basis,
                "basisLabel": "First year" if c.basis == "first-year" else "Renewal",
                "commissionableAmount": str(c.commissionable_amount),
                "ratePercent": float(c.rate_percent),
                "amount": str(c.amount),
                "status": c.status,
                "policyholderName": policy.customer.full_name
                if policy and policy.customer
                else None,
            }
        )

    # By agent aggregation
    by_agent: dict[str, dict] = {}
    for r in rows:
        key = r["agentCode"] or "unknown"
        if key not in by_agent:
            by_agent[key] = {
                "agentCode": key,
                "agentName": r["agentName"],
                "count": 0,
                "amount": ZERO,
                "paid": ZERO,
            }
        by_agent[key]["count"] += 1
        by_agent[key]["amount"] += Decimal(r["amount"])
        if r["status"] == "paid":
            by_agent[key]["paid"] += Decimal(r["amount"])
    by_agent_out = [
        {**v, "amount": str(v["amount"]), "paid": str(v["paid"])}
        for v in sorted(by_agent.values(), key=lambda x: -x["count"])
    ]

    metrics = {
        "total": len(rows),
        "amount": str(_sum_decimal(Decimal(r["amount"]) for r in rows)),
        "pending": sum(1 for r in rows if r["status"] == "pending"),
        "earned": sum(1 for r in rows if r["status"] == "earned"),
        "paid": sum(1 for r in rows if r["status"] == "paid"),
        "paidAmount": str(
            _sum_decimal(Decimal(r["amount"]) for r in rows if r["status"] == "paid")
        ),
    }
    result = {
        "reportId": "commissions",
        "title": "Agent commission report",
        "asOf": today.isoformat(),
        "generatedAt": _now().isoformat(),
        "range": {
            "from": from_d.isoformat(),
            "to": to_d.isoformat(),
            "description": period_desc,
            "period": query.get("period", "ytd"),
        },
        "metrics": metrics,
        "byAgent": by_agent_out,
        "distributions": {
            "byStatus": _distribution(rows, lambda r: r["status"], label_fn=_title_case),
            "byProduct": _distribution(rows, lambda r: r["productName"] or "Unknown"),
            "byAgent": _distribution(rows, lambda r: r["agentName"] or "Unknown"),
        },
        "rows": rows,
        "total": len(rows),
    }
    _log_access(
        db,
        user,
        report_id="commissions",
        period=query.get("period"),
        period_from=from_d,
        period_to=to_d,
        row_count=len(rows),
    )
    db.commit()
    return result
