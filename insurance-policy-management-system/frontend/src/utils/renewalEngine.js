/**
 * Renewal Reminder Engine — pure rule logic.
 *
 * Determines, for an issued policy and an explicit "as of" date:
 *   - how many days remain until expiry and the derived renewal status,
 *   - whether the policy is eligible for renewal reminders,
 *   - which reminder stage applies and whether it has already been handled,
 *   - what the next reminder action is, and a renewal readiness summary.
 *
 * It never renews a policy, never changes a policy's status, and never sends
 * anything. Nothing here reads the clock, storage or React state: every
 * date-dependent function takes `asOf`, so results are deterministic.
 *
 * All thresholds come from `RENEWAL_CONFIG` (illustrative rules). Date
 * comparisons use whole-day differences from `dateUtils`, not string order.
 */

import {
  PAYMENT_STANDING,
  POLICY_STATUS,
  REMINDER_EVENT_STATUS,
  REMINDER_STAGE_STATE,
  RENEWAL_CONFIG,
  RENEWAL_READINESS,
  RENEWAL_STATUS,
} from './constants'
import { addDaysIso, daysBetween, isValidIsoDate } from './dateUtils'
import { formatCurrency, formatDate } from './formatters'

const { SENT, FAILED, SKIPPED } = REMINDER_EVENT_STATUS

/** True when `a` is on or before `b` (both valid ISO dates). */
const onOrBefore = (a, b) => daysBetween(a, b) >= 0

/* ------------------------------------------------------------------ */
/* Stages and dates                                                    */
/* ------------------------------------------------------------------ */

/** Stages in chronological order (earliest offset first). */
export const getOrderedStages = (config = RENEWAL_CONFIG) =>
  [...config.stages].sort((a, b) => a.offsetDays - b.offsetDays)

export const getStageDefinition = (stageId, config = RENEWAL_CONFIG) =>
  config.stages.find((stage) => stage.id === stageId) ?? null

export const isValidStage = (stageId, config = RENEWAL_CONFIG) =>
  Boolean(getStageDefinition(stageId, config))

export const isPolicyIssued = (policy) =>
  Boolean(policy?.issueDate) && policy.status !== POLICY_STATUS.PENDING

export const hasValidExpiry = (policy) => Boolean(policy) && isValidIsoDate(policy.endDate)

/** Whole days from `asOf` to expiry; negative once expired; `null` if unknown. */
export const getDaysUntilExpiry = (policy, asOf) => {
  if (!hasValidExpiry(policy) || !isValidIsoDate(asOf)) return null
  return daysBetween(asOf, policy.endDate)
}

/** Derived renewal status. Never stored — always computed from dates. */
export const getRenewalStatus = (policy, asOf, config = RENEWAL_CONFIG) => {
  const days = getDaysUntilExpiry(policy, asOf)
  const { upcomingDays, dueSoonDays, dueDays } = config.statusWindows

  if (days === null) return RENEWAL_STATUS.UNKNOWN
  if (days < 0) return RENEWAL_STATUS.EXPIRED
  if (days === 0) return RENEWAL_STATUS.EXPIRING_TODAY
  if (days <= dueDays) return RENEWAL_STATUS.DUE
  if (days <= dueSoonDays) return RENEWAL_STATUS.DUE_SOON
  if (days <= upcomingDays) return RENEWAL_STATUS.UPCOMING
  return RENEWAL_STATUS.NOT_DUE
}

/** When reminders start, when the policy expires, and when follow-up ends. */
export const getRenewalWindow = (policy, config = RENEWAL_CONFIG) => {
  if (!hasValidExpiry(policy)) return null
  const [first] = getOrderedStages(config)
  return {
    opensOn: addDaysIso(policy.endDate, first.offsetDays),
    expiresOn: policy.endDate,
    closesOn: addDaysIso(policy.endDate, config.followUpWindowDays),
  }
}

/**
 * Every stage with its scheduled date and the last day it can still be acted
 * on (the day before the next stage falls due; for the last stage, the day
 * the follow-up window closes).
 */
export const buildStageSchedule = (policy, config = RENEWAL_CONFIG) => {
  if (!hasValidExpiry(policy)) return []
  const window = getRenewalWindow(policy, config)
  const ordered = getOrderedStages(config)

  return ordered.map((stage, index) => {
    const next = ordered[index + 1]
    return {
      ...stage,
      scheduledFor: addDaysIso(policy.endDate, stage.offsetDays),
      actionableUntil: next ? addDaysIso(policy.endDate, next.offsetDays - 1) : window.closesOn,
    }
  })
}

/** The stage whose actionable period contains `asOf`, or `null`. */
export const getCurrentReminderStage = (policy, asOf, config = RENEWAL_CONFIG) => {
  if (!isValidIsoDate(asOf)) return null
  return (
    buildStageSchedule(policy, config).find(
      (stage) => onOrBefore(stage.scheduledFor, asOf) && onOrBefore(asOf, stage.actionableUntil),
    ) ?? null
  )
}

/**
 * Renewal milestones in the shape `LifecycleTimeline` renders: reached
 * milestones are completed, the next is current, later ones upcoming.
 */
export const getRenewalMilestones = (policy, asOf, config = RENEWAL_CONFIG) => {
  const window = getRenewalWindow(policy, config)
  if (!window) return []

  const milestones = [
    { stage: 'Cover started', date: policy.startDate, note: 'Policy cover began.' },
    { stage: 'Renewal window opens', date: window.opensOn, note: 'First renewal reminder becomes due.' },
    { stage: 'Policy expires', date: window.expiresOn, note: 'Cover ends unless renewed. This module does not renew policies.' },
    { stage: 'Follow-up window closes', date: window.closesOn, note: 'No further renewal reminders after this date.' },
  ]

  let currentAssigned = false
  return milestones.map((milestone) => {
    if (onOrBefore(milestone.date, asOf)) return { ...milestone, status: 'completed' }
    if (!currentAssigned) {
      currentAssigned = true
      return { ...milestone, status: 'current', stateLabel: 'Next' }
    }
    return { ...milestone, status: 'upcoming', stateLabel: 'Scheduled' }
  })
}

/* ------------------------------------------------------------------ */
/* Eligibility                                                         */
/* ------------------------------------------------------------------ */

export const RENEWAL_ELIGIBILITY_CODES = {
  ELIGIBLE: 'eligible',
  NOT_FOUND: 'policy-not-found',
  NOT_ISSUED: 'policy-not-issued',
  NO_EXPIRY: 'no-expiry-date',
  LAPSED: 'policy-lapsed',
  WINDOW_CLOSED: 'window-closed',
}

/**
 * Whether a policy should receive renewal reminders as of a date.
 * A policy well before its window is still eligible — it simply has nothing
 * due yet. It stops being eligible once the follow-up window has closed.
 */
export const evaluateRenewalEligibility = (policy, asOf, config = RENEWAL_CONFIG) => {
  const codes = RENEWAL_ELIGIBILITY_CODES
  const result = (eligible, code, reason) => ({ eligible, code, reason })

  if (!policy) return result(false, codes.NOT_FOUND, 'The policy could not be found.')
  if (!isPolicyIssued(policy)) return result(false, codes.NOT_ISSUED, 'The policy has not been issued.')
  if (!hasValidExpiry(policy)) return result(false, codes.NO_EXPIRY, 'The policy has no valid expiry date.')
  if (policy.status === POLICY_STATUS.LAPSED) return result(false, codes.LAPSED, 'The policy has lapsed.')

  const window = getRenewalWindow(policy, config)
  if (daysBetween(window.closesOn, asOf) > 0) {
    return result(
      false,
      codes.WINDOW_CLOSED,
      `The renewal reminder window closed on ${formatDate(window.closesOn)}, ${config.followUpWindowDays} days after expiry.`,
    )
  }
  return result(true, codes.ELIGIBLE, null)
}

/* ------------------------------------------------------------------ */
/* Reminder history and plan                                           */
/* ------------------------------------------------------------------ */

const byAttemptTime = (a, b) => String(a.attemptedAt).localeCompare(String(b.attemptedAt))

/**
 * Outcome of all attempts for one policy stage. A stage is handled once any
 * attempt was SENT or SKIPPED; a FAILED latest attempt needs a retry.
 */
export const summariseStageAttempts = (events) => {
  const attempts = [...events].sort(byAttemptTime)
  const sent = attempts.find((event) => event.status === SENT) ?? null
  const skipped = attempts.find((event) => event.status === SKIPPED) ?? null
  const latest = attempts.at(-1) ?? null

  let state = null
  if (sent) state = SENT
  else if (skipped) state = SKIPPED
  else if (latest?.status === FAILED) state = FAILED

  return { attempts, latest, sent, skipped, state, handled: Boolean(sent || skipped) }
}

/**
 * Full reminder plan for a policy: every stage with its derived state.
 *
 *   sent / skipped  an attempt handled the stage
 *   failed          the latest attempt failed and nothing succeeded
 *   due             current stage, nothing attempted yet
 *   scheduled       stage date is still in the future
 *   missed          stage passed with no attempt (a later stage took over)
 */
export const buildReminderPlan = (policy, history, asOf, config = RENEWAL_CONFIG) => {
  const eligibility = evaluateRenewalEligibility(policy, asOf, config)
  const policyEvents = policy ? history.filter((event) => event.policyId === policy.id) : []
  const current = getCurrentReminderStage(policy, asOf, config)

  const stages = buildStageSchedule(policy, config).map((stage) => {
    const summary = summariseStageAttempts(policyEvents.filter((event) => event.stage === stage.id))
    const isCurrent = current?.id === stage.id
    const isFuture = daysBetween(asOf, stage.scheduledFor) > 0

    let state
    if (summary.state === SENT) state = REMINDER_STAGE_STATE.SENT
    else if (summary.state === SKIPPED) state = REMINDER_STAGE_STATE.SKIPPED
    else if (summary.state === FAILED) state = REMINDER_STAGE_STATE.FAILED
    else if (isFuture) state = REMINDER_STAGE_STATE.SCHEDULED
    else if (isCurrent) state = REMINDER_STAGE_STATE.DUE
    else state = REMINDER_STAGE_STATE.MISSED

    const actionable = eligibility.eligible && isCurrent
    return {
      ...stage,
      state,
      isCurrent,
      attempts: summary.attempts,
      latestAttempt: summary.latest,
      handled: summary.handled,
      canTrigger: actionable && state === REMINDER_STAGE_STATE.DUE,
      canRetry: actionable && state === REMINDER_STAGE_STATE.FAILED,
    }
  })

  const currentStage = stages.find((stage) => stage.isCurrent) ?? null
  const lastReminder = [...policyEvents].sort(byAttemptTime).at(-1) ?? null

  const plan = {
    policyId: policy?.id ?? null,
    asOf,
    eligibility,
    window: getRenewalWindow(policy, config),
    stages,
    currentStage,
    lastReminder,
    pendingAction: currentStage?.canTrigger ? 'send' : currentStage?.canRetry ? 'retry' : null,
  }
  return { ...plan, nextReminder: getNextReminder(plan) }
}

/**
 * The next reminder action: the current stage if it still needs sending or
 * retrying, otherwise the next scheduled stage while the policy is eligible.
 */
export const getNextReminder = (plan) => {
  if (!plan?.eligibility?.eligible) return null
  if (plan.currentStage && (plan.currentStage.canTrigger || plan.currentStage.canRetry)) {
    return {
      stageId: plan.currentStage.id,
      label: plan.currentStage.label,
      date: plan.asOf,
      scheduledFor: plan.currentStage.scheduledFor,
      dueNow: true,
      action: plan.currentStage.canRetry ? 'retry' : 'send',
    }
  }
  const upcoming = plan.stages.find((stage) => stage.state === REMINDER_STAGE_STATE.SCHEDULED)
  return upcoming
    ? { stageId: upcoming.id, label: upcoming.label, date: upcoming.scheduledFor, scheduledFor: upcoming.scheduledFor, dueNow: false, action: 'send' }
    : null
}

/* ------------------------------------------------------------------ */
/* Readiness                                                           */
/* ------------------------------------------------------------------ */

const readinessCheck = (id, label, outcome, detail) => ({ id, label, outcome, detail })

/**
 * Renewal readiness. Outcomes are `pass`, `warning` (informational) and
 * `blocked`. Overdue premium is a warning, never a block, under these
 * illustrative rules. No underwriting judgement is made.
 */
export const evaluateRenewalReadiness = ({ policy, premiumSummary, asOf, config = RENEWAL_CONFIG }) => {
  const checks = []
  const skipRest = (reason) => {
    for (const [id, label] of [
      ['policy-issued', 'Policy issued'],
      ['expiry-identified', 'Coverage period identified'],
      ['renewal-window', 'Within renewal window'],
      ['premium-standing', 'Premium standing checked'],
      ['policy-condition', 'No blocking policy condition'],
    ]) {
      if (!checks.some((item) => item.id === id)) checks.push(readinessCheck(id, label, 'skipped', reason))
    }
  }

  if (!policy) {
    checks.push(readinessCheck('policy-exists', 'Policy exists', 'blocked', 'No issued policy exists with this number.'))
    skipRest('Not checked because the policy was not found.')
    return finaliseReadiness(checks)
  }
  checks.push(readinessCheck('policy-exists', 'Policy exists', 'pass', `${policy.id} · ${policy.productName}`))

  if (!isPolicyIssued(policy)) {
    checks.push(readinessCheck('policy-issued', 'Policy issued', 'blocked', 'The policy is still pending issuance.'))
    skipRest('Not checked because the policy is not issued.')
    return finaliseReadiness(checks)
  }
  checks.push(readinessCheck('policy-issued', 'Policy issued', 'pass', `Issued on ${formatDate(policy.issueDate)}.`))

  if (!hasValidExpiry(policy)) {
    checks.push(readinessCheck('expiry-identified', 'Coverage period identified', 'blocked', 'The policy has no valid expiry date, so no reminders can be scheduled.'))
    skipRest('Not checked because the expiry date is unknown.')
    return finaliseReadiness(checks)
  }
  checks.push(
    readinessCheck('expiry-identified', 'Coverage period identified', 'pass', `Cover runs from ${formatDate(policy.startDate)} to ${formatDate(policy.endDate)}.`),
  )

  const window = getRenewalWindow(policy, config)
  if (daysBetween(asOf, window.opensOn) > 0) {
    checks.push(readinessCheck('renewal-window', 'Within renewal window', 'warning', `Not yet. The renewal window opens on ${formatDate(window.opensOn)}.`))
  } else if (daysBetween(window.closesOn, asOf) > 0) {
    checks.push(readinessCheck('renewal-window', 'Within renewal window', 'blocked', `The renewal window closed on ${formatDate(window.closesOn)}.`))
  } else {
    checks.push(
      readinessCheck('renewal-window', 'Within renewal window', 'pass', `Window runs from ${formatDate(window.opensOn)} to ${formatDate(window.closesOn)}.`),
    )
  }

  if (!premiumSummary) {
    checks.push(readinessCheck('premium-standing', 'Premium standing checked', 'warning', 'No premium schedule was found, so premium standing could not be checked.'))
  } else if (premiumSummary.standing === PAYMENT_STANDING.OVERDUE) {
    checks.push(
      readinessCheck(
        'premium-standing',
        'Premium standing checked',
        'warning',
        `Outstanding premium exists: ${formatCurrency(premiumSummary.overdueAmount)} overdue since ${formatDate(
          premiumSummary.oldestOverdueDate,
        )}. Informational only: it does not block renewal reminders under these illustrative rules.`,
      ),
    )
  } else {
    checks.push(readinessCheck('premium-standing', 'Premium standing checked', 'pass', 'No premium is overdue.'))
  }

  checks.push(
    policy.status === POLICY_STATUS.LAPSED
      ? readinessCheck('policy-condition', 'No blocking policy condition', 'blocked', 'The policy has lapsed.')
      : readinessCheck(
          'policy-condition',
          'No blocking policy condition',
          'pass',
          'No blocking condition and no renewal already in progress. Renewal processing itself is outside this module.',
        ),
  )

  return finaliseReadiness(checks)
}

const finaliseReadiness = (checks) => {
  const blocked = checks.filter((item) => item.outcome === 'blocked')
  const warnings = checks.filter((item) => item.outcome === 'warning')
  const windowNotOpen = checks.some((item) => item.id === 'renewal-window' && item.outcome === 'warning')

  let verdict = RENEWAL_READINESS.READY
  if (blocked.length) verdict = RENEWAL_READINESS.NOT_ELIGIBLE
  else if (windowNotOpen) verdict = RENEWAL_READINESS.NOT_YET_OPEN
  else if (warnings.length) verdict = RENEWAL_READINESS.ACTION_REQUIRED

  return {
    verdict,
    checks,
    reasons: [...blocked, ...warnings].map((item) => item.detail),
    blocking: blocked.map((item) => item.detail),
    informational: warnings.map((item) => item.detail),
  }
}

/* ------------------------------------------------------------------ */
/* Accounts, portfolio and the reminder check                          */
/* ------------------------------------------------------------------ */

/** Everything the renewal list and details need for one policy. */
export const buildRenewalAccount = ({ policy, history, premiumSummary, asOf, config = RENEWAL_CONFIG }) => {
  const plan = buildReminderPlan(policy, history, asOf, config)
  return {
    policyId: policy.id,
    asOf,
    daysUntilExpiry: getDaysUntilExpiry(policy, asOf),
    status: getRenewalStatus(policy, asOf, config),
    eligibility: plan.eligibility,
    window: plan.window,
    plan,
    currentStageId: plan.currentStage?.id ?? null,
    currentStageState: plan.currentStage?.state ?? null,
    lastReminder: plan.lastReminder,
    nextReminder: plan.nextReminder,
    readiness: evaluateRenewalReadiness({ policy, premiumSummary, asOf, config }),
    premiumStanding: premiumSummary?.standing ?? null,
  }
}

/** Issued policies with a valid expiry that are still eligible for reminders. */
export const getEligibleRenewalPolicies = (policies, asOf, config = RENEWAL_CONFIG) =>
  policies.filter((policy) => evaluateRenewalEligibility(policy, asOf, config).eligible)

/** Headline counts. Always derived from the accounts, never stored. */
export const summariseRenewals = (accounts) => {
  const withinDays = (account, limit) =>
    account.eligibility.eligible &&
    account.daysUntilExpiry !== null &&
    account.daysUntilExpiry >= 0 &&
    account.daysUntilExpiry <= limit

  return {
    total: accounts.length,
    eligible: accounts.filter((account) => account.eligibility.eligible).length,
    within60: accounts.filter((account) => withinDays(account, RENEWAL_CONFIG.statusWindows.upcomingDays)).length,
    within30: accounts.filter((account) => withinDays(account, RENEWAL_CONFIG.statusWindows.dueSoonDays)).length,
    within7: accounts.filter((account) => withinDays(account, RENEWAL_CONFIG.statusWindows.dueDays)).length,
    expired: accounts.filter((account) => account.status === RENEWAL_STATUS.EXPIRED).length,
    remindersPending: accounts.filter((account) => account.plan.pendingAction !== null).length,
  }
}

/**
 * Decide what a reminder check should do, without doing it.
 *
 * For each policy: ineligible → reported; before the window → not yet due;
 * current stage handled → already handled (never duplicated); failed →
 * needs a retry (retries are explicit, never automatic); due → generate.
 * Earlier stages that passed unsent are recorded as skipped, not sent late.
 */
export const planReminderCheck = ({ policies, history, asOf, config = RENEWAL_CONFIG }) => {
  const outcome = {
    asOf,
    evaluated: policies.length,
    generate: [],
    supersede: [],
    alreadyHandled: [],
    needsRetry: [],
    notYetDue: [],
    notEligible: [],
  }

  for (const policy of policies) {
    const plan = buildReminderPlan(policy, history, asOf, config)

    if (!plan.eligibility.eligible) {
      outcome.notEligible.push({ policyId: policy.id, code: plan.eligibility.code, reason: plan.eligibility.reason })
      continue
    }

    const current = plan.currentStage
    if (!current) {
      outcome.notYetDue.push({ policyId: policy.id, opensOn: plan.window.opensOn })
      continue
    }

    for (const stage of plan.stages) {
      if (stage.state === REMINDER_STAGE_STATE.MISSED) {
        outcome.supersede.push({ policyId: policy.id, stageId: stage.id, scheduledFor: stage.scheduledFor, channel: stage.channel, supersededBy: current.id })
      }
    }

    const entry = { policyId: policy.id, stageId: current.id, scheduledFor: current.scheduledFor, channel: current.channel }
    if (current.state === REMINDER_STAGE_STATE.SENT || current.state === REMINDER_STAGE_STATE.SKIPPED) {
      outcome.alreadyHandled.push({ ...entry, state: current.state })
    } else if (current.state === REMINDER_STAGE_STATE.FAILED) {
      outcome.needsRetry.push({ ...entry, reminderId: current.latestAttempt.reminderId })
    } else {
      outcome.generate.push(entry)
    }
  }

  return outcome
}
