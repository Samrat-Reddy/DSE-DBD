/**
 * Agent Commission — calculation rules (pure).
 *
 *   commission = commissionable amount × commission rate
 *
 * The commissionable amount is a successful premium payment (Module 2). The
 * rate comes from the commission rule for the policy's product (and agent, if
 * an agent-specific rule exists) in force on the payment date, and depends on
 * whether the paid instalment falls in policy year 1 (first-year rate) or a
 * later year (renewal rate).
 *
 * Money is calculated in whole paise and rounded half-up once, so amounts are
 * exact to two decimals and never NaN or negative. Nothing here reads the
 * clock, storage or React state.
 */

import {
  COMMISSION_BASIS,
  COMMISSION_BASIS_LABELS,
  COMMISSION_CONFIG,
  FREQUENCY_INSTALMENTS_PER_YEAR,
} from './constants'
import { daysBetween, isValidIsoDate } from './dateUtils'
import { formatCurrency, formatDate } from './formatters'

export const CALCULATION_ERROR_CODES = {
  INVALID_RATE: 'invalid-rate',
  INVALID_AMOUNT: 'invalid-amount',
}

const invalid = (code, message) => ({ valid: false, code, message })

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

export const toPaise = (amount) => Math.round(Number(amount) * 100)
export const fromPaise = (paise) => paise / 100

/** Sum rupee amounts without floating-point drift. */
export const sumAmounts = (amounts) => fromPaise(amounts.reduce((total, amount) => total + toPaise(amount), 0))

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const hasAtMostDecimals = (value, decimals) => {
  const scaled = value * 10 ** decimals
  return Math.abs(scaled - Math.round(scaled)) < 1e-9
}

/** A rate is a percentage between the configured bounds, to 2 decimals. */
export const validateCommissionRate = (ratePercent, config = COMMISSION_CONFIG) => {
  const { minRatePercent, maxRatePercent, rateDecimals } = config
  if (typeof ratePercent !== 'number' || !Number.isFinite(ratePercent)) {
    return invalid(CALCULATION_ERROR_CODES.INVALID_RATE, 'The commission rate must be a number.')
  }
  if (ratePercent < minRatePercent || ratePercent > maxRatePercent) {
    return invalid(
      CALCULATION_ERROR_CODES.INVALID_RATE,
      `The commission rate must be between ${minRatePercent}% and ${maxRatePercent}%.`,
    )
  }
  if (!hasAtMostDecimals(ratePercent, rateDecimals)) {
    return invalid(CALCULATION_ERROR_CODES.INVALID_RATE, `The commission rate can have at most ${rateDecimals} decimal places.`)
  }
  return { valid: true, code: null, message: null }
}

/** A commissionable amount is a positive rupee amount to 2 decimals. */
export const validateCommissionableAmount = (amount) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return invalid(CALCULATION_ERROR_CODES.INVALID_AMOUNT, 'The commissionable amount must be a positive number.')
  }
  if (!hasAtMostDecimals(amount, 2)) {
    return invalid(CALCULATION_ERROR_CODES.INVALID_AMOUNT, 'The commissionable amount can have at most 2 decimal places.')
  }
  return { valid: true, code: null, message: null }
}

/* ------------------------------------------------------------------ */
/* Calculation                                                         */
/* ------------------------------------------------------------------ */

/**
 * @param {{commissionableAmount: number, ratePercent: number}} input
 * @returns {{valid: true, commissionableAmount: number, ratePercent: number, amount: number}
 *         | {valid: false, code: string, message: string}}
 */
export const calculateCommission = ({ commissionableAmount, ratePercent } = {}) => {
  const amountCheck = validateCommissionableAmount(commissionableAmount)
  if (!amountCheck.valid) return amountCheck
  const rateCheck = validateCommissionRate(ratePercent)
  if (!rateCheck.valid) return rateCheck

  const basisPoints = Math.round(ratePercent * 100)
  const commissionPaise = Math.round((toPaise(commissionableAmount) * basisPoints) / 10000)

  return { valid: true, commissionableAmount, ratePercent, amount: fromPaise(commissionPaise) }
}

/* ------------------------------------------------------------------ */
/* Basis: which policy year an instalment belongs to                   */
/* ------------------------------------------------------------------ */

/** Instalment 5 of a quarterly plan → policy year 2. `null` if unknown. */
export const getPolicyYear = (installmentNumber, frequency) => {
  const perYear = FREQUENCY_INSTALMENTS_PER_YEAR[frequency]
  if (!perYear || !Number.isInteger(installmentNumber) || installmentNumber < 1) return null
  return Math.ceil(installmentNumber / perYear)
}

export const determineCommissionBasis = (policyYear) =>
  policyYear === 1 ? COMMISSION_BASIS.FIRST_YEAR : COMMISSION_BASIS.RENEWAL

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

/** Structural validity of a rule; returns every problem found. */
export const validateCommissionRule = (rule) => {
  const errors = []
  if (!rule || typeof rule !== 'object') return { valid: false, errors: ['The rule is missing.'] }
  if (!rule.ruleId) errors.push('The rule has no ID.')
  if (!rule.productId) errors.push('The rule has no product.')
  for (const field of ['firstYearRatePercent', 'renewalRatePercent']) {
    const check = validateCommissionRate(rule[field])
    if (!check.valid) errors.push(`${field}: ${check.message}`)
  }
  if (!isValidIsoDate(rule.effectiveFrom)) errors.push('The rule needs a valid effective-from date.')
  if (rule.effectiveTo !== null && rule.effectiveTo !== undefined) {
    if (!isValidIsoDate(rule.effectiveTo)) errors.push('The effective-to date is not valid.')
    else if (isValidIsoDate(rule.effectiveFrom) && daysBetween(rule.effectiveFrom, rule.effectiveTo) < 0) {
      errors.push('The effective-to date is before the effective-from date.')
    }
  }
  return { valid: errors.length === 0, errors }
}

/** True when `date` is inside the rule's effective period (inclusive). */
export const isRuleEffectiveOn = (rule, date) => {
  if (!isValidIsoDate(date) || !isValidIsoDate(rule?.effectiveFrom)) return false
  if (daysBetween(rule.effectiveFrom, date) < 0) return false
  return !rule.effectiveTo || daysBetween(date, rule.effectiveTo) >= 0
}

/**
 * The rule that applies to a product/agent on a date, or `null`.
 * Invalid rules are ignored. Agent-specific beats product-wide; then the
 * latest effective-from; then rule ID, so the result is always deterministic.
 */
export const resolveCommissionRule = (rules, { productId, agentId, date }) => {
  const candidates = (rules ?? []).filter(
    (rule) =>
      validateCommissionRule(rule).valid &&
      rule.productId === productId &&
      (!rule.agentId || rule.agentId === agentId) &&
      isRuleEffectiveOn(rule, date),
  )

  return (
    candidates.sort(
      (a, b) =>
        Number(Boolean(b.agentId)) - Number(Boolean(a.agentId)) ||
        daysBetween(a.effectiveFrom, b.effectiveFrom) ||
        a.ruleId.localeCompare(b.ruleId),
    )[0] ?? null
  )
}

export const getRateForBasis = (rule, basis) =>
  basis === COMMISSION_BASIS.FIRST_YEAR ? rule.firstYearRatePercent : rule.renewalRatePercent

/** Rules a product has at all, for any agent or period. */
export const hasAnyRuleForProduct = (rules, productId, agentId) =>
  (rules ?? []).some((rule) => rule.productId === productId && (!rule.agentId || rule.agentId === agentId))

/* ------------------------------------------------------------------ */
/* Explanation                                                         */
/* ------------------------------------------------------------------ */

/** "22.5%" — rates shown without trailing zeros. */
export const formatRate = (ratePercent) => `${Number(ratePercent.toFixed(2))}%`

/**
 * Everything the UI needs to answer "why is the commission this amount?".
 * Built from stored or previewed values; it never recalculates silently.
 */
export const explainCommission = ({
  commissionableAmount,
  ratePercent,
  amount,
  basis,
  policyYear,
  installmentNumber,
  frequency,
  rule,
  paymentId,
  paymentDate,
}) => ({
  commissionableAmount,
  ratePercent,
  amount,
  basis,
  basisLabel: COMMISSION_BASIS_LABELS[basis],
  policyYear,
  installmentNumber,
  frequency,
  ruleId: rule?.ruleId ?? null,
  ruleScope: rule ? (rule.agentId ? 'agent' : 'product') : null,
  ruleDescription: rule?.description ?? null,
  effectiveFrom: rule?.effectiveFrom ?? null,
  effectiveTo: rule?.effectiveTo ?? null,
  formula: `${formatCurrency(commissionableAmount)} × ${formatRate(ratePercent)} = ${formatCurrency(amount)}`,
  basisReason:
    installmentNumber && frequency && policyYear
      ? `Instalment ${installmentNumber} of a ${frequency.toLowerCase()} plan falls in policy year ${policyYear}, so the ${
          basis === COMMISSION_BASIS.FIRST_YEAR ? 'first-year' : 'renewal'
        } rate applies.`
      : null,
  ruleReason: rule
    ? `${rule.agentId ? 'Agent-specific' : 'Product'} rule ${rule.ruleId} was in force on ${formatDate(paymentDate)}${
        paymentId ? `, the date of payment ${paymentId}` : ''
      }.`
    : null,
})
