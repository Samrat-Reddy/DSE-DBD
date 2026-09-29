/**
 * Claim eligibility — pure, explicit, testable.
 *
 * These are ILLUSTRATIVE frontend rules, stated openly rather than presented
 * as an insurer's legal terms. Every check returns a plain-language result so
 * the UI can show exactly why a policy can or cannot be claimed against.
 *
 * Rules:
 *   1. Policy found        — the policy number exists.
 *   2. Policy issued       — it is not still pending issuance.
 *   3. Policy active       — not lapsed, cover has started, and either cover is
 *                            running or ended no more than
 *                            CLAIM_FILING_WINDOW_DAYS ago (late filing for an
 *                            incident during cover).
 *   4. Coverage available  — the product carries at least one claimable
 *                            benefit modelled in `claimTypes.js`.
 *   5. Premium status      — checked and shown, but NEVER blocks filing. An
 *                            overdue premium is flagged for the claims officer.
 *
 * This is the eligibility layer only, not a readiness score.
 */

import {
  CLAIM_FILING_WINDOW_DAYS,
  PAYMENT_STANDING,
  POLICY_STATUS,
} from './constants'
import { addDaysIso, compareIsoDates } from './dateUtils'
import { formatCurrency, formatDate } from './formatters'

export const ELIGIBILITY_OUTCOME = {
  PASS: 'pass',
  FAIL: 'fail',
  WARNING: 'warning',
  SKIPPED: 'skipped',
}

const { PASS, FAIL, WARNING, SKIPPED } = ELIGIBILITY_OUTCOME

const check = (id, label, outcome, detail) => ({ id, label, outcome, detail })

/** Claim types whose coverage item actually exists on this product. */
export const getCompatibleClaimTypes = (policy, product, claimTypes) => {
  if (!policy || !product) return []
  const coverageNames = new Set((product.coverageItems ?? []).map((item) => item.name))
  return claimTypes.filter(
    (type) => type.policyType === policy.type && coverageNames.has(type.coverageItem),
  )
}

export const findClaimType = (value, claimTypes) =>
  claimTypes.find((type) => type.value === value) ?? null

/**
 * Evaluate whether a claim can be filed against a policy today.
 *
 * @param {{policy: object|null, product: object|null, premiumSummary: object|null,
 *          claimTypes: Array, asOf: string}} input
 */
export const evaluateClaimEligibility = ({ policy, product, premiumSummary, claimTypes, asOf }) => {
  const checks = []

  // 1. Policy found
  if (!policy) {
    checks.push(check('policy-found', 'Policy found', FAIL, 'No issued policy exists with this policy number.'))
    for (const [id, label] of [
      ['policy-issued', 'Policy issued'],
      ['policy-active', 'Policy active'],
      ['coverage', 'Coverage available'],
      ['premium-standing', 'Premium status checked'],
    ]) {
      checks.push(check(id, label, SKIPPED, 'Not checked because the policy was not found.'))
    }
    return finalise(checks, { compatibleClaimTypes: [], policy: null, asOf })
  }
  checks.push(check('policy-found', 'Policy found', PASS, `${policy.id} · ${policy.productName}`))

  // 2. Policy issued
  const issued = Boolean(policy.issueDate) && policy.status !== POLICY_STATUS.PENDING
  checks.push(
    check(
      'policy-issued',
      'Policy issued',
      issued ? PASS : FAIL,
      issued ? `Issued on ${formatDate(policy.issueDate)}.` : 'The policy is still pending issuance.',
    ),
  )

  // 3. Policy active (status and cover period)
  const filingDeadline = policy.endDate ? addDaysIso(policy.endDate, CLAIM_FILING_WINDOW_DAYS) : null
  let activeCheck

  if (!issued) {
    activeCheck = check('policy-active', 'Policy active', SKIPPED, 'Not checked because the policy is not issued.')
  } else if (policy.status === POLICY_STATUS.LAPSED) {
    activeCheck = check('policy-active', 'Policy active', FAIL, 'The policy has lapsed.')
  } else if (compareIsoDates(asOf, policy.startDate) < 0) {
    activeCheck = check('policy-active', 'Policy active', FAIL, `Cover has not started yet. It begins on ${formatDate(policy.startDate)}.`)
  } else if (compareIsoDates(asOf, policy.endDate) <= 0) {
    activeCheck = check('policy-active', 'Policy active', PASS, `Cover runs from ${formatDate(policy.startDate)} to ${formatDate(policy.endDate)}.`)
  } else if (compareIsoDates(asOf, filingDeadline) <= 0) {
    activeCheck = check(
      'policy-active',
      'Policy active',
      WARNING,
      `Cover ended on ${formatDate(policy.endDate)}. Claims for incidents during cover can still be filed until ${formatDate(filingDeadline)}.`,
    )
  } else {
    activeCheck = check(
      'policy-active',
      'Policy active',
      FAIL,
      `Cover ended on ${formatDate(policy.endDate)}. The ${CLAIM_FILING_WINDOW_DAYS}-day window to file claims closed on ${formatDate(filingDeadline)}.`,
    )
  }
  checks.push(activeCheck)

  // 4. Coverage available
  const compatibleClaimTypes = getCompatibleClaimTypes(policy, product, claimTypes)
  if (!product) {
    checks.push(check('coverage', 'Coverage available', FAIL, 'The product behind this policy could not be found, so its cover cannot be confirmed.'))
  } else if (!compatibleClaimTypes.length) {
    checks.push(check('coverage', 'Coverage available', FAIL, `No claimable benefit on ${product.name} is modelled in this demonstration.`))
  } else {
    checks.push(
      check('coverage', 'Coverage available', PASS, `Claimable benefits: ${compatibleClaimTypes.map((type) => type.label).join(', ')}.`),
    )
  }

  // 5. Premium standing — informational, never blocking
  if (!issued) {
    checks.push(check('premium-standing', 'Premium status checked', SKIPPED, 'Not checked because the policy is not issued, so it has no premium schedule.'))
  } else if (!premiumSummary) {
    checks.push(check('premium-standing', 'Premium status checked', WARNING, 'No premium schedule was found, so premium standing could not be checked.'))
  } else if (premiumSummary.standing === PAYMENT_STANDING.OVERDUE) {
    checks.push(
      check(
        'premium-standing',
        'Premium status checked',
        WARNING,
        `${premiumSummary.counts.overdue} instalment${premiumSummary.counts.overdue === 1 ? '' : 's'} overdue (${formatCurrency(
          premiumSummary.overdueAmount,
        )}) since ${formatDate(premiumSummary.oldestOverdueDate)}. Filing is still allowed; the claims officer will see this.`,
      ),
    )
  } else if (premiumSummary.standing === PAYMENT_STANDING.DUE) {
    checks.push(check('premium-standing', 'Premium status checked', PASS, 'An instalment is due soon; no premium is overdue.'))
  } else {
    checks.push(check('premium-standing', 'Premium status checked', PASS, 'No premium is overdue.'))
  }

  return finalise(checks, { compatibleClaimTypes, policy, asOf, filingDeadline })
}

const finalise = (checks, { compatibleClaimTypes, policy, asOf, filingDeadline = null }) => {
  const failures = checks.filter((item) => item.outcome === FAIL)
  const eligible = failures.length === 0

  return {
    eligible,
    checks,
    reasons: failures.map((item) => item.detail),
    warnings: checks.filter((item) => item.outcome === WARNING).map((item) => item.detail),
    compatibleClaimTypes: compatibleClaimTypes.map((type) => type.value),
    // Incidents must fall inside cover and cannot be in the future.
    incidentWindow: policy
      ? {
          earliest: policy.startDate,
          latest: compareIsoDates(policy.endDate, asOf) < 0 ? policy.endDate : asOf,
        }
      : null,
    filingDeadline,
  }
}
