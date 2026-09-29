/**
 * Agent Commission — eligibility (pure).
 *
 * Two separate questions:
 *
 *   Policy level   Can this policy earn commission at all? It must be issued,
 *                  name an agent who is registered and active, and its
 *                  product must have a commission rule.
 *
 *   Payment level  Does this premium payment generate a commission? It must be
 *                  successful, carry its references, belong to an instalment
 *                  of that policy's schedule, not already have a commission,
 *                  and a rule must be in force on the payment date.
 *
 * Each evaluation returns a checklist, so the UI can show exactly which rule
 * passed or blocked, plus a `code` the service maps to an error status.
 */

import { AGENT_STATUS, PAYMENT_STATUS, POLICY_STATUS } from './constants'
import {
  calculateCommission,
  determineCommissionBasis,
  explainCommission,
  formatRate,
  getPolicyYear,
  getRateForBasis,
  hasAnyRuleForProduct,
  resolveCommissionRule,
} from './commissionCalculation'
import { buildInstallmentId, parseInstallmentNumber } from './premiumCalculations'
import { formatCurrency, formatDate } from './formatters'

export const ELIGIBILITY_CODES = {
  ELIGIBLE: 'eligible',
  POLICY_NOT_FOUND: 'policy-not-found',
  POLICY_NOT_ISSUED: 'policy-not-issued',
  MISSING_AGENT: 'missing-agent',
  AGENT_NOT_REGISTERED: 'agent-not-registered',
  AGENT_INACTIVE: 'agent-inactive',
  NO_RULE: 'no-commission-rule',
  PAYMENT_NOT_FOUND: 'payment-not-found',
  MISSING_PAYMENT_REFERENCE: 'missing-payment-reference',
  PAYMENT_NOT_SUCCESSFUL: 'payment-not-successful',
  INVALID_LINKAGE: 'invalid-linkage',
  DUPLICATE: 'duplicate-commission',
  INVALID_CALCULATION: 'invalid-calculation',
}

const C = ELIGIBILITY_CODES

/**
 * Run checks in order. The first failure blocks; later checks are marked
 * "not checked" so the checklist never implies they passed.
 *
 * Each check returns `{ ok: true, detail }` or `{ ok: false, code, detail }`.
 */
const runChecks = (definitions) => {
  const checks = []
  let failure = null

  for (const [id, label, evaluate] of definitions) {
    if (failure) {
      checks.push({ id, label, outcome: 'skipped', detail: 'Not checked because an earlier check failed.' })
      continue
    }
    const result = evaluate()
    checks.push({ id, label, outcome: result.ok ? 'pass' : 'blocked', detail: result.detail })
    if (!result.ok) failure = result
  }

  return {
    eligible: !failure,
    code: failure ? failure.code : C.ELIGIBLE,
    reason: failure ? failure.detail : null,
    checks,
  }
}

const pass = (detail) => ({ ok: true, detail })
const fail = (code, detail) => ({ ok: false, code, detail })

/* ------------------------------------------------------------------ */
/* Policy level                                                        */
/* ------------------------------------------------------------------ */

const policyChecks = ({ policy, agent, rules }) => [
  ['policy-exists', 'Policy exists', () => (policy ? pass(`${policy.id} · ${policy.productName}`) : fail(C.POLICY_NOT_FOUND, 'The policy could not be found.'))],
  [
    'policy-issued',
    'Policy issued',
    () =>
      policy.issueDate && policy.status !== POLICY_STATUS.PENDING
        ? pass(`Issued on ${formatDate(policy.issueDate)}.`)
        : fail(C.POLICY_NOT_ISSUED, 'The policy is still pending issuance, so it has no premium to earn commission on.'),
  ],
  [
    'agent-assigned',
    'Agent assigned',
    () => (policy.agent?.id ? pass(`${policy.agent.name ?? 'Agent'} (${policy.agent.id}).`) : fail(C.MISSING_AGENT, 'No agent is recorded on this policy.')),
  ],
  [
    'agent-registered',
    'Agent registered and active',
    () => {
      if (!agent) return fail(C.AGENT_NOT_REGISTERED, `Agent ${policy.agent.id} is not in the agent registry.`)
      if (agent.status !== AGENT_STATUS.ACTIVE) return fail(C.AGENT_INACTIVE, `${agent.name} is not an active agent.`)
      return pass(`${agent.name}, ${agent.branch}.`)
    },
  ],
  [
    'commission-rule',
    'Commission rule configured',
    () =>
      hasAnyRuleForProduct(rules, policy.productId, policy.agent.id)
        ? pass(`Commission rules exist for ${policy.productName}.`)
        : fail(C.NO_RULE, `No commission rule is configured for ${policy.productName}.`),
  ],
]

/** @param {{policy: object|null, agent: object|null, rules: object[], asOf: string}} input */
export const evaluatePolicyCommissionEligibility = ({ policy, agent, rules, asOf }) => {
  const result = runChecks(policyChecks({ policy, agent, rules }))
  const currentRule =
    result.eligible && asOf ? resolveCommissionRule(rules, { productId: policy.productId, agentId: policy.agent.id, date: asOf }) : null
  return { ...result, currentRule }
}

/* ------------------------------------------------------------------ */
/* Payment level                                                       */
/* ------------------------------------------------------------------ */

/**
 * Does a payment generate a commission?
 *
 * @param {{payment: object|null, policy: object|null, agent: object|null,
 *          schedule: {frequency: string, totalInstallments: number}|null,
 *          rules: object[], existingCommissions: object[]}} input
 * @returns eligibility with `preview` (the commission it would generate)
 */
export const evaluatePaymentCommission = ({ payment, policy, agent, schedule, rules, existingCommissions = [] }) => {
  let rule = null
  let calculation = null
  let policyYear = null
  let basis = null
  const installmentNumber = parseInstallmentNumber(payment?.installmentId)

  const definitions = [
    ['payment-exists', 'Payment exists', () => (payment ? pass(`${payment.paymentId} · ${formatCurrency(payment.amount)}`) : fail(C.PAYMENT_NOT_FOUND, 'The payment could not be found.'))],
    [
      'not-duplicate',
      'No commission already generated',
      () => {
        const existing = existingCommissions.find((item) => item.paymentId === payment.paymentId)
        return existing
          ? fail(C.DUPLICATE, `Commission ${existing.commissionId} already exists for payment ${payment.paymentId}. A duplicate will not be created.`)
          : pass('This payment has not generated a commission yet.')
      },
    ],
    [
      'payment-references',
      'Payment references present',
      () =>
        payment.transactionReference && payment.installmentId && payment.policyId
          ? pass(`Transaction ${payment.transactionReference} for instalment ${payment.installmentId}.`)
          : fail(C.MISSING_PAYMENT_REFERENCE, 'The payment is missing its policy, instalment or transaction reference.'),
    ],
    [
      'payment-successful',
      'Payment successful',
      () =>
        payment.status === PAYMENT_STATUS.SUCCESS
          ? pass(`Paid on ${formatDate(payment.paymentDate)}.`)
          : fail(C.PAYMENT_NOT_SUCCESSFUL, `The payment status is "${payment.status}". Only successful premium payments earn commission.`),
    ],
    [
      'payment-linkage',
      'Payment belongs to the policy schedule',
      () => {
        if (!policy) return fail(C.INVALID_LINKAGE, `Payment ${payment.paymentId} refers to policy ${payment.policyId}, which does not exist.`)
        if (!schedule) return fail(C.INVALID_LINKAGE, `Policy ${policy.id} has no premium schedule for this payment to belong to.`)
        const withinSchedule =
          installmentNumber !== null &&
          installmentNumber <= Number(schedule.totalInstallments) &&
          buildInstallmentId(policy.id, installmentNumber) === payment.installmentId
        if (!withinSchedule) {
          return fail(C.INVALID_LINKAGE, `Instalment ${payment.installmentId} is not part of the premium schedule for ${policy.id}.`)
        }
        policyYear = getPolicyYear(installmentNumber, schedule.frequency)
        if (!policyYear) return fail(C.INVALID_LINKAGE, `The premium frequency "${schedule.frequency}" is not recognised.`)
        basis = determineCommissionBasis(policyYear)
        return pass(`Instalment ${installmentNumber} of ${schedule.totalInstallments} (${schedule.frequency}), policy year ${policyYear}.`)
      },
    ],
    ...policyChecks({ policy, agent, rules }).slice(1),
    [
      'rule-in-force',
      'Rule in force on the payment date',
      () => {
        rule = resolveCommissionRule(rules, { productId: policy.productId, agentId: policy.agent.id, date: payment.paymentDate })
        return rule
          ? pass(`${rule.ruleId}: ${formatRate(getRateForBasis(rule, basis))} ${basis === 'first-year' ? 'first-year' : 'renewal'} rate.`)
          : fail(C.NO_RULE, `No commission rule for ${policy.productName} was in force on ${formatDate(payment.paymentDate)}.`)
      },
    ],
    [
      'calculation-valid',
      'Commission calculates to a valid amount',
      () => {
        calculation = calculateCommission({ commissionableAmount: payment.amount, ratePercent: getRateForBasis(rule, basis) })
        return calculation.valid
          ? pass(`${formatCurrency(calculation.commissionableAmount)} × ${formatRate(calculation.ratePercent)} = ${formatCurrency(calculation.amount)}.`)
          : fail(C.INVALID_CALCULATION, calculation.message)
      },
    ],
  ]

  const result = runChecks(definitions)

  const preview = result.eligible
    ? {
        policyId: policy.id,
        agentId: policy.agent.id,
        productId: policy.productId,
        paymentId: payment.paymentId,
        installmentId: payment.installmentId,
        installmentNumber,
        policyYear,
        basis,
        ruleId: rule.ruleId,
        ratePercent: calculation.ratePercent,
        commissionableAmount: calculation.commissionableAmount,
        amount: calculation.amount,
        explanation: explainCommission({
          ...calculation,
          basis,
          policyYear,
          installmentNumber,
          frequency: schedule.frequency,
          rule,
          paymentId: payment.paymentId,
          paymentDate: payment.paymentDate,
        }),
      }
    : null

  return { ...result, preview }
}

/* ------------------------------------------------------------------ */
/* Stored record ↔ payment linkage                                     */
/* ------------------------------------------------------------------ */

/**
 * Is a stored commission still backed by the payment it was calculated from?
 * The payment must exist, belong to the same policy and instalment, still be
 * successful, and match the commissionable amount.
 */
export const verifyCommissionLinkage = (record, payment) => {
  const broken = (message) => ({ valid: false, code: C.INVALID_LINKAGE, message })
  if (!payment) return broken(`Payment ${record.paymentId} no longer exists.`)
  if (payment.policyId !== record.policyId) return broken(`Payment ${payment.paymentId} belongs to ${payment.policyId}, not ${record.policyId}.`)
  if (payment.installmentId !== record.installmentId) {
    return broken(`Payment ${payment.paymentId} is for instalment ${payment.installmentId}, not ${record.installmentId}.`)
  }
  if (payment.status !== PAYMENT_STATUS.SUCCESS) return broken(`Payment ${payment.paymentId} is no longer successful.`)
  if (Math.round(payment.amount * 100) !== Math.round(record.commissionableAmount * 100)) {
    return broken(`Payment ${payment.paymentId} is ${formatCurrency(payment.amount)}, but the commission was calculated on ${formatCurrency(record.commissionableAmount)}.`)
  }
  return { valid: true, code: 'ok', message: null }
}
