/**
 * Renewal Reminder Engine service.
 *
 *   React  ->  renewalService  ->  mock renewal store / data   (today)
 *   React  ->  renewalService  ->  FastAPI  ->  MySQL           (later)
 *
 * All reminder activity is SIMULATED. No email, SMS or in-app message is sent
 * and no provider is contacted. This service never renews a policy and never
 * changes a policy's status.
 *
 * It is the enforcement boundary: roles, stage rules and duplicate prevention
 * are checked here on every call, whatever the UI showed. All checks run
 * synchronously before the simulated latency, so a double submission sees the
 * first change and is rejected.
 *
 * Errors are `ApiError`s with a stable `data.reason`:
 *   403  unauthorized
 *   404  policy-not-found, reminder-not-found
 *   409  not-eligible, already-sent, already-handled, retry-required,
 *        reminder-not-due, stage-closed, invalid-retry
 *   422  invalid-stage, invalid-outcome, invalid-channel, invalid-date,
 *        clock-backwards
 */

import { ApiError } from './apiClient'
import { findPolicyById, getAllPolicies } from './mockPolicyStore'
import { getPremiumAccountSnapshot } from './premiumService'
import {
  addReminders,
  createReminderIdGenerator,
  findReminderById,
  getAllReminders,
  getSimulationDate,
  resetRenewalStore,
  setSimulationDate,
} from './mockRenewalStore'
import {
  buildReminderPlan,
  buildRenewalAccount,
  getRenewalMilestones,
  getStageDefinition,
  isPolicyIssued,
  planReminderCheck,
  summariseRenewals,
} from '../utils/renewalEngine'
import { checkReminderRetry, checkReminderTrigger, REMINDER_RULE_CODES } from '../utils/reminderRules'
import { queryRenewals } from '../utils/renewalQuery'
import { daysBetween, isValidIsoDate, todayIso } from '../utils/dateUtils'
import {
  REMINDER_CHANNEL_LABELS,
  REMINDER_EVENT_STATUS,
  REMINDER_TRIGGERS,
  ROLE_OPTIONS,
  ROLES,
  ROLES_ALLOWED_TO_MANAGE_REMINDERS,
  ROLES_ALLOWED_TO_RUN_REMINDER_CHECK,
} from '../utils/constants'

const MOCK_LATENCY_MS = 220

const withMockLatency = (value) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS)
  })

const clone = (value) => JSON.parse(JSON.stringify(value))

/** Run a synchronous operation so any failure becomes a rejected promise. */
const asAsync = (runner) =>
  new Promise((resolve, reject) => {
    try {
      resolve(runner())
    } catch (error) {
      reject(error)
    }
  })

/** General role names (Module 3's titles call administrators claims officers). */
const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

const RULE_STATUS = {
  [REMINDER_RULE_CODES.INVALID_STAGE]: 422,
  [REMINDER_RULE_CODES.INVALID_OUTCOME]: 422,
  [REMINDER_RULE_CODES.INVALID_CHANNEL]: 422,
  [REMINDER_RULE_CODES.REMINDER_NOT_FOUND]: 404,
}

const ruleError = (check) =>
  new ApiError(check.message, { status: RULE_STATUS[check.code] ?? 409, data: { reason: check.code } })

/* ------------------------------------------------------------------ */
/* Clock                                                               */
/* ------------------------------------------------------------------ */

/**
 * The engine's "as of" date: the simulation date if one is set and is not
 * behind the real date, otherwise today.
 */
const resolveAsOf = () => {
  const today = todayIso()
  const simulated = getSimulationDate()
  return simulated && daysBetween(today, simulated) > 0 ? simulated : today
}

const clockSnapshot = () => {
  const today = todayIso()
  const asOf = resolveAsOf()
  return { asOf, today, isSimulated: asOf !== today }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const requireRole = (actor, allowedRoles, action) => {
  if (!allowedRoles.includes(actor?.role)) {
    const allowed = allowedRoles.map((role) => ROLE_LABELS[role]).join(' or ')
    throw new ApiError(
      `${ROLE_LABELS[actor?.role] ?? 'This role'} cannot ${action}. Only an ${allowed} can.`,
      { status: 403, data: { reason: 'unauthorized' } },
    )
  }
  return { name: actorName(actor.role), role: actor.role }
}

const actorName = (role) =>
  role === ROLES.ADMINISTRATOR ? 'Renewals Administrator (demo)' : `${ROLE_LABELS[role] ?? 'User'} (demo)`

const requirePolicy = (policyId) => {
  const policy = findPolicyById(policyId)
  if (!policy) {
    throw new ApiError(`No policy found for "${policyId}".`, { status: 404, data: { reason: 'policy-not-found', policyId } })
  }
  return policy
}

const toPolicySnapshot = (policy) => ({
  id: policy.id,
  productName: policy.productName,
  type: policy.type,
  status: policy.status,
  issueDate: policy.issueDate,
  startDate: policy.startDate,
  endDate: policy.endDate,
  policyholderName: policy.policyholder?.name ?? null,
  customerId: policy.policyholder?.customerId ?? null,
  agentName: policy.agent?.name ?? null,
})

const premiumSummaryFor = (policyId, asOf) => getPremiumAccountSnapshot(policyId, asOf)?.summary ?? null

const accountFor = (policy, asOf, history = getAllReminders()) => ({
  ...buildRenewalAccount({ policy, history, premiumSummary: premiumSummaryFor(policy.id, asOf), asOf }),
  policy: toPolicySnapshot(policy),
})

/** Reminder event with display labels, for history lists. */
const enrichReminder = (reminder) => {
  const policy = findPolicyById(reminder.policyId)
  return {
    ...reminder,
    stageLabel: getStageDefinition(reminder.stage)?.label ?? reminder.stage,
    channelLabel: REMINDER_CHANNEL_LABELS[reminder.channel] ?? reminder.channel,
    policyholderName: policy?.policyholder?.name ?? null,
    isMock: true,
  }
}

const newestFirst = (a, b) => String(b.attemptedAt).localeCompare(String(a.attemptedAt))

const resultText = ({ status, channel, note, createdBy, supersededBy }) => {
  const channelLabel = REMINDER_CHANNEL_LABELS[channel] ?? channel
  if (status === REMINDER_EVENT_STATUS.SENT) {
    return `Delivered to the simulated ${channelLabel} channel. No real message was sent.`
  }
  if (status === REMINDER_EVENT_STATUS.FAILED) {
    return `Simulated delivery failure selected by ${createdBy.name}. No real provider was contacted.`
  }
  if (supersededBy) {
    return `Skipped automatically: the policy had already reached the ${getStageDefinition(supersededBy)?.label} stage when the check ran.`
  }
  return note ? `Skipped: ${note}` : 'Skipped by an administrator (simulated).'
}

const buildReminderEvent = ({ reminderId, policyId, stageId, scheduledFor, channel, status, trigger, createdBy, asOf, retryOf = null, note = null, supersededBy = null }) => {
  const attemptedAt = new Date().toISOString()
  return {
    reminderId,
    policyId,
    stage: stageId,
    scheduledFor,
    attemptedAt,
    evaluatedAsOf: asOf,
    sentAt: status === REMINDER_EVENT_STATUS.SENT ? attemptedAt : null,
    channel,
    status,
    result: resultText({ status, channel, note, createdBy, supersededBy }),
    trigger,
    createdBy,
    retryOf,
    note: note ? String(note).trim() : null,
  }
}

const buildDetails = (policy, asOf) => {
  const history = getAllReminders()
  const premium = getPremiumAccountSnapshot(policy.id, asOf)

  return {
    clock: clockSnapshot(),
    policy: toPolicySnapshot(policy),
    issued: isPolicyIssued(policy),
    account: buildRenewalAccount({ policy, history, premiumSummary: premium?.summary ?? null, asOf }),
    premium: premium
      ? {
          standing: premium.summary.standing,
          outstanding: premium.summary.outstanding,
          overdueAmount: premium.summary.overdueAmount,
          overdueCount: premium.summary.counts.overdue,
          oldestOverdueDate: premium.summary.oldestOverdueDate,
          nextDueDate: premium.summary.nextDueDate,
          nextDueAmount: premium.summary.nextDueAmount,
        }
      : null,
    history: history.filter((event) => event.policyId === policy.id).sort(newestFirst).map(enrichReminder),
    milestones: getRenewalMilestones(policy, asOf),
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export const getRenewalClock = async () => withMockLatency(clockSnapshot())

/**
 * Synchronous read of every reminder attempt (seed plus this session), for
 * other services. Module 6 reports reminder activity for a period and must
 * not re-read the reminder store itself.
 */
export const getReminderRecords = () => clone(getAllReminders())

/**
 * Renewal accounts for every issued policy, with derived summary counts and
 * recent reminder activity. Summary always covers all issued policies.
 *
 * @param {{search?: string, status?: string, stage?: string, premium?: string, sort?: string}} query
 */
export const getRenewalPolicies = async (query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.renewals, { params: query })
  const asOf = resolveAsOf()
  const history = getAllReminders()
  const policies = getAllPolicies()
  const accounts = policies.filter(isPolicyIssued).map((policy) => accountFor(policy, asOf, history))

  return withMockLatency(
    clone({
      clock: clockSnapshot(),
      items: queryRenewals(accounts, query),
      total: accounts.length,
      summary: summariseRenewals(accounts),
      notIssued: policies.length - accounts.length,
      recentReminders: [...history].sort(newestFirst).slice(0, 6).map(enrichReminder),
    }),
  )
}

/** One policy's renewal account, plan, readiness, premium context and history. */
export const getRenewalPolicyById = async (policyId) => {
  // Future: return apiClient.get(ENDPOINTS.renewalByPolicyId(policyId))
  const policy = requirePolicy(policyId)
  return withMockLatency(clone(buildDetails(policy, resolveAsOf())))
}

export const getReminderHistory = async (policyId) => {
  // Future: return apiClient.get(ENDPOINTS.reminderHistory(policyId))
  requirePolicy(policyId)
  const items = getAllReminders().filter((event) => event.policyId === policyId).sort(newestFirst).map(enrichReminder)
  return withMockLatency(clone({ items, total: items.length }))
}

/**
 * Read-only reminder plan for any date. Nothing is recorded, so projecting a
 * past or future date is safe.
 */
export const getReminderPlan = async (policyId, asOf = resolveAsOf()) => {
  // Future: return apiClient.get(ENDPOINTS.reminderPlan(policyId), { params: { asOf } })
  const policy = requirePolicy(policyId)
  if (!isValidIsoDate(asOf)) {
    throw new ApiError('Enter a valid date for the reminder plan.', { status: 422, data: { reason: 'invalid-date' } })
  }
  return withMockLatency(clone(buildReminderPlan(policy, getAllReminders(), asOf)))
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/**
 * Simulate one run of the reminder engine as of the engine date.
 *
 * Reads every policy, works out the current stage, checks history, records
 * simulated reminders only for stages that are due and unhandled, records
 * superseded stages as skipped, and never creates a duplicate.
 */
export const runReminderCheck = (actor) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.reminderChecks)
    const createdBy = requireRole(actor, ROLES_ALLOWED_TO_RUN_REMINDER_CHECK, 'run the reminder check')
    const asOf = resolveAsOf()
    const policies = getAllPolicies()
    const plan = planReminderCheck({ policies, history: getAllReminders(), asOf })
    const nextId = createReminderIdGenerator(asOf.slice(0, 4))

    const skippedEvents = plan.supersede.map((item) =>
      buildReminderEvent({
        reminderId: nextId(),
        policyId: item.policyId,
        stageId: item.stageId,
        scheduledFor: item.scheduledFor,
        channel: item.channel,
        status: REMINDER_EVENT_STATUS.SKIPPED,
        trigger: REMINDER_TRIGGERS.CHECK,
        createdBy,
        asOf,
        supersededBy: item.supersededBy,
      }),
    )

    const sentEvents = plan.generate.map((item) =>
      buildReminderEvent({
        reminderId: nextId(),
        policyId: item.policyId,
        stageId: item.stageId,
        scheduledFor: item.scheduledFor,
        channel: item.channel,
        status: REMINDER_EVENT_STATUS.SENT,
        trigger: REMINDER_TRIGGERS.CHECK,
        createdBy,
        asOf,
      }),
    )

    addReminders([...skippedEvents, ...sentEvents])

    const describe = (item) => ({
      ...item,
      policyholderName: findPolicyById(item.policyId)?.policyholder?.name ?? null,
      stageLabel: getStageDefinition(item.stageId)?.label ?? item.stageId,
    })

    return withMockLatency(
      clone({
        asOf,
        runAt: new Date().toISOString(),
        runBy: createdBy,
        evaluated: plan.evaluated,
        generated: sentEvents.map(enrichReminder),
        skippedSuperseded: skippedEvents.map(enrichReminder),
        alreadyHandled: plan.alreadyHandled.map(describe),
        needsRetry: plan.needsRetry.map(describe),
        notYetDue: plan.notYetDue.length,
        notEligible: plan.notEligible.length,
        counts: {
          evaluated: plan.evaluated,
          generated: sentEvents.length,
          skipped: skippedEvents.length,
          alreadyHandled: plan.alreadyHandled.length,
          needsRetry: plan.needsRetry.length,
          notYetDue: plan.notYetDue.length,
          notEligible: plan.notEligible.length,
        },
      }),
    )
  })

/**
 * Manually trigger the simulated reminder for a policy stage.
 *
 * @param {string} policyId
 * @param {string} stageId
 * @param {{role: string}} actor
 * @param {{outcome?: 'sent'|'failed'|'skipped', channel?: string, note?: string}} options
 */
export const triggerReminder = (policyId, stageId, actor, options = {}) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.reminders(policyId), { stageId, ...options })
    const createdBy = requireRole(actor, ROLES_ALLOWED_TO_MANAGE_REMINDERS, 'trigger reminders')
    const policy = requirePolicy(policyId)
    const asOf = resolveAsOf()
    const outcome = options.outcome ?? REMINDER_EVENT_STATUS.SENT
    const plan = buildReminderPlan(policy, getAllReminders(), asOf)

    const check = checkReminderTrigger({ plan, stageId, outcome, channel: options.channel })
    if (!check.allowed) throw ruleError(check)

    const stage = plan.stages.find((item) => item.id === stageId)
    const event = buildReminderEvent({
      reminderId: createReminderIdGenerator(asOf.slice(0, 4))(),
      policyId,
      stageId,
      scheduledFor: stage.scheduledFor,
      channel: options.channel ?? stage.channel,
      status: outcome,
      trigger: REMINDER_TRIGGERS.MANUAL,
      createdBy,
      asOf,
      note: options.note,
    })
    addReminders([event])

    return withMockLatency(clone({ reminder: enrichReminder(event), details: buildDetails(policy, asOf) }))
  })

/**
 * Retry a failed simulated reminder. The retry is a new event linked by
 * `retryOf`; the failed attempt stays in the history unchanged.
 */
export const retryReminder = (reminderId, actor, options = {}) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.reminderRetries(reminderId), options)
    const createdBy = requireRole(actor, ROLES_ALLOWED_TO_MANAGE_REMINDERS, 'retry reminders')
    const reminder = findReminderById(reminderId)
    const outcome = options.outcome ?? REMINDER_EVENT_STATUS.SENT

    if (!reminder) {
      throw ruleError(checkReminderRetry({ reminder: null, plan: null, outcome }))
    }

    const policy = requirePolicy(reminder.policyId)
    const asOf = resolveAsOf()
    const plan = buildReminderPlan(policy, getAllReminders(), asOf)

    const check = checkReminderRetry({ reminder, plan, outcome, channel: options.channel })
    if (!check.allowed) throw ruleError(check)

    const event = buildReminderEvent({
      reminderId: createReminderIdGenerator(asOf.slice(0, 4))(),
      policyId: policy.id,
      stageId: reminder.stage,
      scheduledFor: reminder.scheduledFor,
      channel: options.channel ?? reminder.channel,
      status: outcome,
      trigger: REMINDER_TRIGGERS.RETRY,
      createdBy,
      asOf,
      retryOf: reminder.reminderId,
      note: options.note,
    })
    addReminders([event])

    return withMockLatency(clone({ reminder: enrichReminder(event), details: buildDetails(policy, asOf) }))
  })

/**
 * Move the simulation date forward. It can never move backwards: that would
 * let the engine re-send a stage it has already handled.
 */
export const advanceRenewalClock = (date, actor) =>
  asAsync(() => {
    requireRole(actor, ROLES_ALLOWED_TO_MANAGE_REMINDERS, 'change the simulation date')
    if (!isValidIsoDate(date)) {
      throw new ApiError('Enter a valid simulation date.', { status: 422, data: { reason: 'invalid-date' } })
    }
    const current = resolveAsOf()
    if (daysBetween(current, date) < 0) {
      throw new ApiError(
        'The simulation date can only move forward. Reset the simulation to return to today.',
        { status: 422, data: { reason: 'clock-backwards', current } },
      )
    }
    setSimulationDate(date)
    return withMockLatency(clockSnapshot())
  })

/** Return to today and discard every reminder recorded in this session. */
export const resetRenewalSimulation = (actor) =>
  asAsync(() => {
    requireRole(actor, ROLES_ALLOWED_TO_MANAGE_REMINDERS, 'reset the renewal simulation')
    resetRenewalStore()
    return withMockLatency(clockSnapshot())
  })

export default {
  getRenewalClock,
  getReminderRecords,
  getRenewalPolicies,
  getRenewalPolicyById,
  getReminderHistory,
  getReminderPlan,
  runReminderCheck,
  triggerReminder,
  retryReminder,
  advanceRenewalClock,
  resetRenewalSimulation,
}
