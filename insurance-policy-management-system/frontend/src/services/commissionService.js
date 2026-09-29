/**
 * Agent Commission service.
 *
 *   React  ->  commissionService  ->  mock commission store / data   (today)
 *   React  ->  commissionService  ->  FastAPI  ->  MySQL             (later)
 *
 * Commission is SIMULATED. No payout is made and no bank or payment provider
 * is contacted. Commission comes from successful premium payments recorded by
 * Module 2 on policies issued by Module 1; this service reads that data
 * through their services and stores and never changes it.
 *
 * It is the enforcement boundary: role access, agent isolation, duplicate
 * prevention and status transitions are checked here on every call. Checks
 * run synchronously before the simulated latency, so a double submission
 * sees the first change and is rejected.
 *
 * Errors are `ApiError`s with a stable `data.reason`:
 *   403  unauthorized, agent-not-identified, commission-inaccessible
 *   404  commission-not-found, payment-not-found, policy-not-found, agent-not-found
 *   409  duplicate-commission, payment-not-successful, invalid-linkage,
 *        policy-not-issued, missing-agent, agent-not-registered, agent-inactive,
 *        no-commission-rule, invalid-transition, earning-hold-active
 *   422  invalid-status, invalid-note, invalid-calculation, missing-payment-reference
 */

import { ApiError } from './apiClient'
import { findPolicyById, getAllPolicies } from './mockPolicyStore'
import { getPaymentRecords, getPremiumScheduleHeader } from './premiumService'
import {
  addCommission,
  addCommissionEvents,
  createCommissionIdGenerator,
  createEventIdGenerator,
  findCommissionById,
  generatePayoutReference,
  getAllCommissions,
  getEventsForCommission,
} from './mockCommissionStore'
import { agents as agentRegistry } from '../data/agents'
import { commissionRules } from '../data/commissionRules'
import { policyProducts } from '../data/policyProducts'
import { explainCommission, isRuleEffectiveOn } from '../utils/commissionCalculation'
import { evaluatePaymentCommission, evaluatePolicyCommissionEligibility, verifyCommissionLinkage } from '../utils/commissionEligibility'
import { checkCommissionTransition, deriveCommissionState, getAllowedTransitions, getEarnableFrom } from '../utils/commissionLifecycle'
import {
  checkAgentRecordAccess,
  checkCommissionManageAccess,
  checkCommissionViewAccess,
  filterVisibleToActor,
} from '../utils/commissionAccess'
import { queryCommissions, summariseByAgent, summariseCommissions } from '../utils/commissionSummary'
import { todayIso } from '../utils/dateUtils'
import { formatDate } from '../utils/formatters'
import { parseInstallmentNumber } from '../utils/premiumCalculations'
import {
  COMMISSION_BASIS_LABELS,
  COMMISSION_CONFIG,
  COMMISSION_EVENT_TYPES,
  COMMISSION_STATUS,
  COMMISSION_STATUS_LABELS,
  PAYMENT_STATUS,
  ROLE_OPTIONS,
  ROLES,
} from '../utils/constants'

const MOCK_LATENCY_MS = 220
const NOTE_MAX_LENGTH = 300

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

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

const STATUS_BY_REASON = {
  unauthorized: 403,
  'agent-not-identified': 403,
  'commission-inaccessible': 403,
  'commission-not-found': 404,
  'payment-not-found': 404,
  'policy-not-found': 404,
  'agent-not-found': 404,
  'invalid-status': 422,
  'invalid-note': 422,
  'invalid-calculation': 422,
  'missing-payment-reference': 422,
}

const fail = (reason, message, data = {}) => {
  throw new ApiError(message, { status: STATUS_BY_REASON[reason] ?? 409, data: { reason, ...data } })
}

const enforce = (check) => {
  if (!check.allowed) fail(check.code, check.message)
}

/* ------------------------------------------------------------------ */
/* Joins                                                               */
/* ------------------------------------------------------------------ */

const findAgent = (agentId) => agentRegistry.find((agent) => agent.id === agentId) ?? null
const findProduct = (productId) => policyProducts.find((product) => product.id === productId) ?? null
const findPayment = (paymentId) => getPaymentRecords().find((payment) => payment.paymentId === paymentId) ?? null

const actorSnapshot = (actor) => ({
  name: actor.role === ROLES.ADMINISTRATOR ? 'Commission Administrator (demo)' : `${ROLE_LABELS[actor.role] ?? 'User'} (demo)`,
  role: actor.role,
})

/** A commission record joined with its policy, agent, payment and derived status. */
const buildView = (record, payments) => {
  const policy = findPolicyById(record.policyId)
  const agent = findAgent(record.agentId)
  const payment = payments.find((item) => item.paymentId === record.paymentId) ?? null
  const state = deriveCommissionState(getEventsForCommission(record.commissionId))
  const paymentDate = payment?.paymentDate ?? null

  return {
    ...record,
    agentName: agent?.name ?? policy?.agent?.name ?? 'Unknown agent',
    agentBranch: agent?.branch ?? null,
    productName: policy?.productName ?? findProduct(record.productId)?.name ?? record.productId,
    policyholderName: policy?.policyholder?.name ?? null,
    paymentDate,
    paymentStatus: payment?.status ?? null,
    transactionReference: payment?.transactionReference ?? null,
    basisLabel: COMMISSION_BASIS_LABELS[record.basis],
    status: state.status,
    statusLabel: COMMISSION_STATUS_LABELS[state.status] ?? 'Unknown',
    earnedAt: state.earnedAt,
    paidAt: state.paidAt,
    payoutReference: state.payoutReference,
    earnableFrom: getEarnableFrom(paymentDate),
    linkage: verifyCommissionLinkage(record, payment),
    isMock: true,
  }
}

const allViews = () => {
  const payments = getPaymentRecords()
  return getAllCommissions().map((record) => buildView(record, payments))
}

const requireViewAccess = (actor) => enforce(checkCommissionViewAccess(actor))

const requireCommission = (commissionId, actor) => {
  requireViewAccess(actor)
  const record = findCommissionById(commissionId)
  if (!record) fail('commission-not-found', `No commission found for "${commissionId}".`, { commissionId })
  enforce(checkAgentRecordAccess(actor, record.agentId))
  return record
}

const scheduleFor = (policyId) => {
  const header = getPremiumScheduleHeader(policyId)
  return header ? { frequency: header.frequency, totalInstallments: header.totalInstallments } : null
}

const evaluatePayment = (payment, existingCommissions = getAllCommissions()) => {
  const policy = payment ? findPolicyById(payment.policyId) : null
  return evaluatePaymentCommission({
    payment,
    policy,
    agent: policy?.agent?.id ? findAgent(policy.agent.id) : null,
    schedule: policy ? scheduleFor(policy.id) : null,
    rules: commissionRules,
    existingCommissions,
  })
}

const describeEvent = (event) => ({
  ...event,
  fromLabel: event.fromStatus ? COMMISSION_STATUS_LABELS[event.fromStatus] : null,
  toLabel: COMMISSION_STATUS_LABELS[event.toStatus],
  label:
    event.type === COMMISSION_EVENT_TYPES.GENERATED
      ? 'Commission generated'
      : event.toStatus === COMMISSION_STATUS.EARNED
        ? 'Confirmed as earned'
        : 'Marked as paid (simulated payout)',
})

const validateNote = (note) => {
  if (note === undefined || note === null || note === '') return null
  if (typeof note !== 'string') fail('invalid-note', 'The note must be text.')
  const trimmed = note.trim()
  if (trimmed.length > NOTE_MAX_LENGTH) fail('invalid-note', `The note can be at most ${NOTE_MAX_LENGTH} characters.`)
  return trimmed || null
}

const withRuleLabels = (rule) => ({
  ...rule,
  productName: findProduct(rule.productId)?.name ?? rule.productId,
  agentName: rule.agentId ? (findAgent(rule.agentId)?.name ?? rule.agentId) : null,
  scope: rule.agentId ? 'agent' : 'product',
})

/** Rules an actor may see: agents do not see other agents' negotiated rates. */
const visibleRules = (actor) =>
  commissionRules.filter((rule) => actor.role === ROLES.ADMINISTRATOR || !rule.agentId || rule.agentId === actor.agentId)

/** Pending → Earned → Paid, in the shape `LifecycleTimeline` renders. */
const milestonesFor = (view) => {
  const { PENDING, EARNED } = COMMISSION_STATUS
  return [
    { stage: 'Pending', date: view.generatedAt, status: 'completed', note: `Generated from payment ${view.paymentId}.` },
    {
      stage: 'Earned',
      date: view.earnedAt,
      status: view.earnedAt ? 'completed' : 'current',
      stateLabel: view.earnedAt ? undefined : 'Next',
      note: view.earnedAt
        ? 'Earning hold completed and confirmed by an administrator.'
        : `Can be confirmed from ${formatDate(view.earnableFrom)}, ${COMMISSION_CONFIG.earningHoldDays} days after the payment.`,
    },
    {
      stage: 'Paid',
      date: view.paidAt,
      status: view.paidAt ? 'completed' : view.status === EARNED ? 'current' : 'upcoming',
      stateLabel: view.paidAt ? undefined : view.status === PENDING ? 'Scheduled' : 'Next',
      note: view.paidAt ? `Simulated payout ${view.payoutReference}.` : 'Recorded by an administrator once earned. No real payout is made.',
    },
  ]
}

const buildDetails = (record, actor, asOf) => {
  const payments = getPaymentRecords()
  const view = buildView(record, payments)
  const payment = payments.find((item) => item.paymentId === record.paymentId) ?? null
  const policy = findPolicyById(record.policyId)
  const rule = commissionRules.find((item) => item.ruleId === record.ruleId) ?? null
  const header = getPremiumScheduleHeader(record.policyId)

  const actions =
    actor.role === ROLES.ADMINISTRATOR
      ? getAllowedTransitions(view.status).map((toStatus) => ({
          toStatus,
          label: COMMISSION_STATUS_LABELS[toStatus],
          ...checkCommissionTransition({
            currentStatus: view.status,
            toStatus,
            role: actor.role,
            paymentDate: view.paymentDate,
            asOf,
            linkageValid: view.linkage.valid,
          }),
        }))
      : []

  return {
    asOf,
    commission: view,
    explanation: explainCommission({
      commissionableAmount: record.commissionableAmount,
      ratePercent: record.ratePercent,
      amount: record.amount,
      basis: record.basis,
      policyYear: record.policyYear,
      installmentNumber: parseInstallmentNumber(record.installmentId),
      frequency: header?.frequency ?? null,
      rule,
      paymentId: record.paymentId,
      paymentDate: view.paymentDate,
    }),
    rule: rule ? withRuleLabels(rule) : null,
    payment,
    policy: policy
      ? {
          id: policy.id,
          productName: policy.productName,
          status: policy.status,
          policyholderName: policy.policyholder?.name ?? null,
          startDate: policy.startDate,
          endDate: policy.endDate,
          premium: policy.premium,
          premiumFrequency: policy.premiumFrequency,
          agentId: policy.agent?.id ?? null,
          agentName: policy.agent?.name ?? null,
        }
      : null,
    history: getEventsForCommission(record.commissionId)
      .sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
      .map(describeEvent),
    milestones: milestonesFor(view),
    actions,
    canManage: actor.role === ROLES.ADMINISTRATOR,
  }
}

/** Successful payments on visible policies that have no commission yet. */
const awaitingFor = (actor) => {
  const commissions = getAllCommissions()
  const commissioned = new Set(commissions.map((record) => record.paymentId))
  const visiblePolicyIds =
    actor.role === ROLES.ADMINISTRATOR
      ? null
      : new Set(getAllPolicies().filter((policy) => policy.agent?.id === actor.agentId).map((policy) => policy.id))

  const candidates = getPaymentRecords()
    .filter((payment) => payment.status === PAYMENT_STATUS.SUCCESS && !commissioned.has(payment.paymentId))
    .filter((payment) => !visiblePolicyIds || visiblePolicyIds.has(payment.policyId))
    .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || b.paymentId.localeCompare(a.paymentId))

  const eligible = []
  const blocked = []
  for (const payment of candidates) {
    const evaluation = evaluatePayment(payment, commissions)
    const policy = findPolicyById(payment.policyId)
    const row = {
      paymentId: payment.paymentId,
      policyId: payment.policyId,
      installmentId: payment.installmentId,
      paymentDate: payment.paymentDate,
      amount: payment.amount,
      productName: policy?.productName ?? null,
      policyholderName: policy?.policyholder?.name ?? null,
      agentId: policy?.agent?.id ?? null,
      agentName: policy?.agent?.name ?? null,
    }
    if (evaluation.eligible) eligible.push({ ...row, preview: evaluation.preview })
    else blocked.push({ ...row, code: evaluation.code, reason: evaluation.reason })
  }
  return { eligible, blocked }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The commission register, with summary totals over every record the actor
 * may see (unfiltered, so headline figures stay put while filtering).
 *
 * @param {{role: string, agentId?: string}} actor
 * @param {{search?: string, status?: string, agentId?: string, sort?: string}} query
 */
export const getCommissions = (actor, query = {}) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.commissions, { params: query })
    requireViewAccess(actor)
    const visible = filterVisibleToActor(allViews(), actor)
    const agentIds = new Set(visible.map((record) => record.agentId))

    return withMockLatency(
      clone({
        asOf: todayIso(),
        items: queryCommissions(visible, query),
        total: visible.length,
        summary: summariseCommissions(visible),
        agentOptions: agentRegistry
          .filter((agent) => agentIds.has(agent.id))
          .map((agent) => ({ value: agent.id, label: `${agent.name} (${agent.id})` })),
        awaiting: awaitingFor(actor),
        scope: actor.role === ROLES.ADMINISTRATOR ? 'all' : 'own',
        agent: actor.role === ROLES.AGENT ? findAgent(actor.agentId) : null,
      }),
    )
  })

/** One commission: calculation explanation, payment and policy context, audit history. */
export const getCommissionById = (commissionId, actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.commissionById(commissionId))
    const record = requireCommission(commissionId, actor)
    return withMockLatency(clone(buildDetails(record, actor, todayIso())))
  })

/** Append-only audit trail for one commission, oldest first. */
export const getCommissionHistory = (commissionId, actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.commissionHistory(commissionId))
    const record = requireCommission(commissionId, actor)
    const items = getEventsForCommission(record.commissionId)
      .sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId))
      .map(describeEvent)
    return withMockLatency(clone({ items, total: items.length }))
  })

/** Commission rules the actor may see, with the settings they rely on. */
export const getCommissionRules = (actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.commissionRules)
    requireViewAccess(actor)
    const asOf = todayIso()
    return withMockLatency(
      clone({
        asOf,
        config: COMMISSION_CONFIG,
        rules: visibleRules(actor).map((rule) => ({ ...withRuleLabels(rule), inForceToday: isRuleEffectiveOn(rule, asOf) })),
      }),
    )
  })

/** Agent-wise totals: every agent for administrators, only themselves for an agent. */
export const getAgentCommissionSummaries = (actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.agentCommissions)
    requireViewAccess(actor)
    const visibleAgents = actor.role === ROLES.ADMINISTRATOR ? agentRegistry : agentRegistry.filter((agent) => agent.id === actor.agentId)
    const views = filterVisibleToActor(allViews(), actor)
    const items = summariseByAgent(views, visibleAgents, getAllPolicies())
    return withMockLatency(clone({ items, summary: summariseCommissions(views) }))
  })

/** One agent: associated policies with policy-level eligibility, and their commission. */
export const getAgentCommissions = (agentId, actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.agentCommissionById(agentId))
    enforce(checkAgentRecordAccess(actor, agentId))
    const agent = findAgent(agentId)
    if (!agent) fail('agent-not-found', `No registered agent found for "${agentId}".`, { agentId })

    const asOf = todayIso()
    const views = allViews().filter((record) => record.agentId === agentId)
    const policies = getAllPolicies()
      .filter((policy) => policy.agent?.id === agentId)
      .map((policy) => {
        const own = views.filter((record) => record.policyId === policy.id)
        const eligibility = evaluatePolicyCommissionEligibility({ policy, agent, rules: commissionRules, asOf })
        return {
          policyId: policy.id,
          productName: policy.productName,
          policyholderName: policy.policyholder?.name ?? null,
          policyStatus: policy.status,
          eligible: eligibility.eligible,
          eligibilityReason: eligibility.reason,
          ...summariseCommissions(own),
        }
      })

    return withMockLatency(
      clone({
        asOf,
        agent,
        summary: { ...summariseCommissions(views), policyCount: policies.length },
        policies,
        items: queryCommissions(views, { sort: 'payment-desc' }),
        awaiting: awaitingFor(actor.role === ROLES.ADMINISTRATOR ? { role: ROLES.AGENT, agentId } : actor),
      }),
    )
  })

/** One policy: policy-level eligibility, every payment with its commission outcome, and records. */
export const getPolicyCommissions = (policyId, actor) =>
  asAsync(() => {
    // Future: return apiClient.get(ENDPOINTS.policyCommissions(policyId))
    requireViewAccess(actor)
    const policy = findPolicyById(policyId)
    if (!policy) fail('policy-not-found', `No policy found for "${policyId}".`, { policyId })
    if (actor.role === ROLES.AGENT && policy.agent?.id !== actor.agentId) {
      fail('commission-inaccessible', 'Commission on this policy belongs to another agent and is confidential.')
    }

    const asOf = todayIso()
    const agent = policy.agent?.id ? findAgent(policy.agent.id) : null
    const commissions = getAllCommissions()
    const payments = getPaymentRecords()
    const views = commissions.filter((record) => record.policyId === policyId).map((record) => buildView(record, payments))
    const eligibility = evaluatePolicyCommissionEligibility({ policy, agent, rules: commissionRules, asOf })

    const paymentRows = payments
      .filter((payment) => payment.policyId === policyId)
      .sort((a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || b.paymentId.localeCompare(a.paymentId))
      .map((payment) => {
        const commission = views.find((record) => record.paymentId === payment.paymentId) ?? null
        const evaluation = commission ? null : evaluatePayment(payment, commissions)
        return {
          paymentId: payment.paymentId,
          installmentId: payment.installmentId,
          paymentDate: payment.paymentDate,
          amount: payment.amount,
          status: payment.status,
          transactionReference: payment.transactionReference,
          commissionId: commission?.commissionId ?? null,
          commissionStatus: commission?.status ?? null,
          commissionAmount: commission?.amount ?? null,
          eligible: evaluation ? evaluation.eligible : null,
          code: evaluation?.code ?? null,
          reason: evaluation?.reason ?? null,
          previewAmount: evaluation?.preview?.amount ?? null,
          previewExplanation: evaluation?.preview?.explanation ?? null,
        }
      })

    return withMockLatency(
      clone({
        asOf,
        policy: {
          id: policy.id,
          productId: policy.productId,
          productName: policy.productName,
          status: policy.status,
          policyholderName: policy.policyholder?.name ?? null,
          startDate: policy.startDate,
          endDate: policy.endDate,
          premium: policy.premium,
          premiumFrequency: policy.premiumFrequency,
        },
        agent: agent ?? (policy.agent ? { id: policy.agent.id, name: policy.agent.name, branch: policy.agent.branch, status: null } : null),
        eligibility,
        rules: visibleRules(actor)
          .filter((rule) => rule.productId === policy.productId && (!rule.agentId || rule.agentId === policy.agent?.id))
          .map((rule) => ({ ...withRuleLabels(rule), inForceToday: isRuleEffectiveOn(rule, asOf) })),
        payments: paymentRows,
        items: queryCommissions(views, { sort: 'payment-desc' }),
        summary: summariseCommissions(views),
        canManage: actor.role === ROLES.ADMINISTRATOR,
      }),
    )
  })

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

const generateFromPayment = (payment, createdBy, note, existing) => {
  const evaluation = evaluatePayment(payment, existing)
  if (!evaluation.eligible) return { evaluation, record: null }

  const now = new Date().toISOString()
  const year = now.slice(0, 4)
  const { preview } = evaluation
  const record = {
    commissionId: createCommissionIdGenerator(year)(),
    policyId: preview.policyId,
    agentId: preview.agentId,
    productId: preview.productId,
    paymentId: preview.paymentId,
    installmentId: preview.installmentId,
    policyYear: preview.policyYear,
    basis: preview.basis,
    ruleId: preview.ruleId,
    ratePercent: preview.ratePercent,
    commissionableAmount: preview.commissionableAmount,
    amount: preview.amount,
    generatedAt: now,
    generatedBy: createdBy,
  }
  const event = {
    eventId: createEventIdGenerator(year)(),
    commissionId: record.commissionId,
    type: COMMISSION_EVENT_TYPES.GENERATED,
    fromStatus: null,
    toStatus: COMMISSION_STATUS.PENDING,
    at: now,
    actor: createdBy,
    note: note ?? 'Generated from a successful premium payment.',
    payoutReference: null,
  }
  addCommission(record, event)
  return { evaluation, record }
}

/**
 * Generate the commission for one successful premium payment.
 * Refused (409 duplicate-commission) if that payment already has one.
 */
export const generateCommissionForPayment = (paymentId, actor, options = {}) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.commissions, { paymentId, ...options })
    enforce(checkCommissionManageAccess(actor, 'generate commission'))
    const note = validateNote(options.note)
    const payment = findPayment(paymentId)
    const { evaluation, record } = generateFromPayment(payment, actorSnapshot(actor), note, getAllCommissions())
    if (!record) fail(evaluation.code, evaluation.reason, { paymentId, checks: evaluation.checks })
    return withMockLatency(clone(buildDetails(record, actor, todayIso())))
  })

/**
 * Generate commission for every eligible successful payment that has none.
 * Running it again generates nothing new.
 */
export const generateEligibleCommissions = (actor) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.commissionGenerationRuns)
    enforce(checkCommissionManageAccess(actor, 'generate commission'))
    const createdBy = actorSnapshot(actor)
    const { eligible, blocked } = awaitingFor(actor)
    const payments = getPaymentRecords()

    const generated = []
    for (const row of eligible) {
      const { record } = generateFromPayment(
        payments.find((payment) => payment.paymentId === row.paymentId),
        createdBy,
        'Generated by a commission generation run.',
        getAllCommissions(),
      )
      if (record) generated.push(record)
    }

    const latestPayments = getPaymentRecords()
    return withMockLatency(
      clone({
        runAt: new Date().toISOString(),
        runBy: createdBy,
        generated: generated.map((record) => buildView(record, latestPayments)),
        blocked,
      }),
    )
  })

/**
 * Move a commission to its next status (earned, then paid). The change is a
 * new event; the record and earlier events are untouched.
 */
export const transitionCommission = (commissionId, toStatus, actor, options = {}) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.commissionTransitions(commissionId), { toStatus, ...options })
    enforce(checkCommissionManageAccess(actor, 'change a commission status'))
    const record = findCommissionById(commissionId)
    if (!record) fail('commission-not-found', `No commission found for "${commissionId}".`, { commissionId })
    const note = validateNote(options.note)

    const asOf = todayIso()
    const view = buildView(record, getPaymentRecords())
    enforce(
      checkCommissionTransition({
        currentStatus: view.status,
        toStatus,
        role: actor.role,
        paymentDate: view.paymentDate,
        asOf,
        linkageValid: view.linkage.valid,
      }),
    )

    const now = new Date().toISOString()
    addCommissionEvents([
      {
        eventId: createEventIdGenerator(now.slice(0, 4))(),
        commissionId,
        type: COMMISSION_EVENT_TYPES.STATUS_CHANGED,
        fromStatus: view.status,
        toStatus,
        at: now,
        actor: actorSnapshot(actor),
        note,
        payoutReference: toStatus === COMMISSION_STATUS.PAID ? generatePayoutReference() : null,
      },
    ])

    return withMockLatency(clone(buildDetails(record, actor, asOf)))
  })

/** Confirm every pending commission whose earning hold has passed. */
export const confirmEligibleEarnings = (actor) =>
  asAsync(() => {
    // Future: return apiClient.post(ENDPOINTS.commissionEarningRuns)
    enforce(checkCommissionManageAccess(actor, 'confirm earned commission'))
    const asOf = todayIso()
    const createdBy = actorSnapshot(actor)
    const pending = allViews().filter((view) => view.status === COMMISSION_STATUS.PENDING)

    const earned = []
    const held = []
    for (const view of pending) {
      const check = checkCommissionTransition({
        currentStatus: view.status,
        toStatus: COMMISSION_STATUS.EARNED,
        role: actor.role,
        paymentDate: view.paymentDate,
        asOf,
        linkageValid: view.linkage.valid,
      })
      if (!check.allowed) {
        held.push({ commissionId: view.commissionId, code: check.code, reason: check.message, earnableFrom: view.earnableFrom })
        continue
      }
      const now = new Date().toISOString()
      addCommissionEvents([
        {
          eventId: createEventIdGenerator(now.slice(0, 4))(),
          commissionId: view.commissionId,
          type: COMMISSION_EVENT_TYPES.STATUS_CHANGED,
          fromStatus: COMMISSION_STATUS.PENDING,
          toStatus: COMMISSION_STATUS.EARNED,
          at: now,
          actor: createdBy,
          note: 'Earning hold completed; confirmed in a bulk earning run.',
          payoutReference: null,
        },
      ])
      earned.push(view.commissionId)
    }

    return withMockLatency(clone({ asOf, earned, held }))
  })

export default {
  getCommissions,
  getCommissionById,
  getCommissionHistory,
  getCommissionRules,
  getAgentCommissionSummaries,
  getAgentCommissions,
  getPolicyCommissions,
  generateCommissionForPayment,
  generateEligibleCommissions,
  transitionCommission,
  confirmEligibleEarnings,
}
