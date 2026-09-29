/**
 * Claim verification, assessment and decision rules — pure.
 *
 * ILLUSTRATIVE FRONTEND BUSINESS RULES. They show how a transparent,
 * rule-based decision can be explained; they are not insurance adjudication
 * rules. There is no AI, scoring or model here, and nothing is inferred —
 * every reason is produced by an explicit rule below.
 */

import {
  CLAIM_REJECTION_REASON_MIN_LENGTH,
  CLAIM_STATUS,
  PAYMENT_STANDING,
} from './constants'
import { compareIsoDates } from './dateUtils'
import { formatCurrency, formatDate } from './formatters'

const S = CLAIM_STATUS

export const ASSESSMENT_NOTE_MIN_LENGTH = 10

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * Illustrative limit for a claim type on a policy:
 *   coverage × percentOfCoverage / 100, capped at maxAmount when set.
 */
export const calculateIllustrativeLimit = (claimType, coverageAmount) => {
  if (!claimType || !coverageAmount) return null

  const { percentOfCoverage, maxAmount } = claimType.limitRule
  const byPercentage = Math.round((Number(coverageAmount) * percentOfCoverage) / 100)
  const limit = maxAmount ? Math.min(byPercentage, maxAmount) : byPercentage

  return {
    limit,
    coverageAmount: Number(coverageAmount),
    percentOfCoverage,
    maxAmount: maxAmount ?? null,
    basis: claimType.limitBasis,
    cappedByMaximum: Boolean(maxAmount) && byPercentage > maxAmount,
  }
}

/** The amount an officer would normally start from: claimed, capped at the limit. */
export const suggestAssessedAmount = (claimedAmount, limit) =>
  Math.min(Number(claimedAmount) || 0, Number(limit) || 0)

/* ------------------------------------------------------------------ */
/* Verification                                                        */
/* ------------------------------------------------------------------ */

const verificationCheck = (id, label, outcome, detail) => ({ id, label, outcome, detail })

/**
 * Structured checklist a claims officer reviews before verifying.
 * `fail` blocks verification; `warning` is shown but does not block.
 */
export const buildVerificationChecklist = ({ claim, policy, product, claimType, premiumSummary, limit }) => {
  const checks = []

  // Policy valid on the incident date
  if (!policy) {
    checks.push(verificationCheck('cover-on-incident', 'Policy valid on incident date', 'fail', 'The policy record is unavailable.'))
  } else {
    const within =
      compareIsoDates(claim.incidentDate, policy.startDate) >= 0 &&
      compareIsoDates(claim.incidentDate, policy.endDate) <= 0
    checks.push(
      verificationCheck(
        'cover-on-incident',
        'Policy valid on incident date',
        within ? 'pass' : 'fail',
        within
          ? `Incident on ${formatDate(claim.incidentDate)} falls within cover (${formatDate(policy.startDate)} to ${formatDate(policy.endDate)}).`
          : `Incident on ${formatDate(claim.incidentDate)} is outside cover (${formatDate(policy.startDate)} to ${formatDate(policy.endDate)}).`,
      ),
    )
  }

  // Coverage applies
  const coverageNames = new Set((product?.coverageItems ?? []).map((item) => item.name))
  const covered = Boolean(policy && claimType && claimType.policyType === policy.type && coverageNames.has(claimType.coverageItem))
  checks.push(
    verificationCheck(
      'coverage-applies',
      'Coverage applies',
      covered ? 'pass' : 'fail',
      covered
        ? `${claimType.label} is covered under "${claimType.coverageItem}".`
        : 'The claim type is not covered by this policy.',
    ),
  )

  // Incident date is consistent with filing
  const plausible = compareIsoDates(claim.incidentDate, claim.filingDate) <= 0
  checks.push(
    verificationCheck(
      'incident-date',
      'Incident date',
      plausible ? 'pass' : 'fail',
      plausible
        ? `Incident on ${formatDate(claim.incidentDate)}, filed on ${formatDate(claim.filingDate)}.`
        : 'The incident date is after the filing date.',
    ),
  )

  // Claimed amount
  if (!(claim.claimedAmount > 0)) {
    checks.push(verificationCheck('claimed-amount', 'Claimed amount', 'fail', 'The claimed amount is not positive.'))
  } else if (limit && claim.claimedAmount > limit.limit) {
    checks.push(
      verificationCheck(
        'claimed-amount',
        'Claimed amount',
        'warning',
        `${formatCurrency(claim.claimedAmount)} exceeds the illustrative limit of ${formatCurrency(limit.limit)}; assessment will be capped.`,
      ),
    )
  } else {
    checks.push(
      verificationCheck(
        'claimed-amount',
        'Claimed amount',
        'pass',
        `${formatCurrency(claim.claimedAmount)}${limit ? `, within the illustrative limit of ${formatCurrency(limit.limit)}` : ''}.`,
      ),
    )
  }

  // Required documents
  const submittedTypes = new Set((claim.documents ?? []).map((item) => item.type))
  const missing = (claimType?.requiredDocuments ?? []).filter(
    (requirement) => requirement.required && !submittedTypes.has(requirement.type),
  )
  checks.push(
    verificationCheck(
      'documents',
      'Required documents submitted',
      missing.length ? 'fail' : 'pass',
      missing.length
        ? `Missing: ${missing.map((item) => item.label).join(', ')}.`
        : `${(claim.documents ?? []).length} document record${(claim.documents ?? []).length === 1 ? '' : 's'} on file.`,
    ),
  )

  // Premium standing — informational
  if (!premiumSummary) {
    checks.push(verificationCheck('premium-standing', 'Premium standing', 'warning', 'Premium standing could not be checked.'))
  } else if (premiumSummary.standing === PAYMENT_STANDING.OVERDUE) {
    checks.push(
      verificationCheck(
        'premium-standing',
        'Premium standing',
        'warning',
        `${formatCurrency(premiumSummary.overdueAmount)} overdue since ${formatDate(premiumSummary.oldestOverdueDate)}. Noted; it does not block this illustrative workflow.`,
      ),
    )
  } else {
    checks.push(verificationCheck('premium-standing', 'Premium standing', 'pass', 'No premium is overdue.'))
  }

  return {
    checks,
    passed: checks.filter((item) => item.outcome === 'pass').length,
    warnings: checks.filter((item) => item.outcome === 'warning').length,
    failures: checks.filter((item) => item.outcome === 'fail').length,
    blocking: checks.some((item) => item.outcome === 'fail'),
  }
}

/* ------------------------------------------------------------------ */
/* Assessment and decision                                             */
/* ------------------------------------------------------------------ */

/**
 * @returns {Record<string, string>} `assessedAmount` and/or `note` errors.
 */
export const validateAssessment = ({ assessedAmount, claimedAmount, limit, note }) => {
  const errors = {}
  const text = String(assessedAmount ?? '').trim()
  const amount = Number(text)

  if (!text) {
    errors.assessedAmount = 'Enter the assessed amount.'
  } else if (!Number.isFinite(amount)) {
    errors.assessedAmount = 'The assessed amount must be a number.'
  } else if (amount <= 0) {
    errors.assessedAmount = 'The assessed amount must be greater than zero. Reject the claim instead if nothing is payable.'
  } else if (amount > Number(claimedAmount)) {
    errors.assessedAmount = `The assessed amount cannot exceed the claimed amount of ${formatCurrency(claimedAmount)}.`
  } else if (limit !== null && limit !== undefined && amount > Number(limit)) {
    errors.assessedAmount = `The assessed amount cannot exceed the illustrative coverage limit of ${formatCurrency(limit)}.`
  }

  // A reduction must be explained, so the decision summary can show why.
  const noteText = String(note ?? '').trim()
  if (!errors.assessedAmount && amount < Number(claimedAmount) && noteText.length < ASSESSMENT_NOTE_MIN_LENGTH) {
    errors.note = `Explain why the assessed amount is below the claimed amount (at least ${ASSESSMENT_NOTE_MIN_LENGTH} characters).`
  }

  return errors
}

export const validateRejectionReason = (reason) => {
  const text = String(reason ?? '').trim()
  if (!text) return 'A rejection reason is required.'
  if (text.length < CLAIM_REJECTION_REASON_MIN_LENGTH) {
    return `Give a clearer rejection reason (at least ${CLAIM_REJECTION_REASON_MIN_LENGTH} characters).`
  }
  return null
}

/**
 * Whether an assessed claim can be approved: it needs a recorded assessment
 * whose amount is still valid against the claimed amount and the limit.
 */
export const checkApprovalReadiness = (claim) => {
  if (claim.status !== S.ASSESSED) {
    return { ready: false, reason: 'Only an assessed claim can be approved.' }
  }
  const assessment = claim.assessment
  if (!assessment || !(assessment.assessedAmount > 0)) {
    return { ready: false, reason: 'The claim has no valid assessment. Assess it before approving.' }
  }
  const errors = validateAssessment({
    assessedAmount: assessment.assessedAmount,
    claimedAmount: claim.claimedAmount,
    limit: assessment.illustrativeLimit,
    note: assessment.note,
  })
  if (Object.keys(errors).length) {
    return { ready: false, reason: `The recorded assessment is no longer valid: ${Object.values(errors)[0]}` }
  }
  return { ready: true, reason: null }
}

const DECISION_LABELS = {
  pending: 'Awaiting decision',
  [S.APPROVED]: 'Approved',
  [S.REJECTED]: 'Rejected',
  [S.SETTLED]: 'Approved and settled',
}

/**
 * Transparent, rule-based decision summary. Returns `null` until the claim
 * has been assessed. Every reason comes from an explicit rule.
 */
export const buildDecisionSummary = (claim) => {
  const assessment = claim.assessment
  if (!assessment) return null

  const { assessedAmount, illustrativeLimit } = assessment
  const claimed = claim.claimedAmount
  const reasons = []

  if (assessedAmount === claimed && claimed <= illustrativeLimit) {
    reasons.push('The claimed amount is within the illustrative coverage limit.')
  } else if (claimed > illustrativeLimit && assessedAmount === illustrativeLimit) {
    reasons.push(
      `The claimed amount exceeds the illustrative limit, so the assessment is capped at ${formatCurrency(illustrativeLimit)}.`,
    )
  } else if (assessedAmount < claimed) {
    reasons.push(
      `Assessed ${formatCurrency(claimed - assessedAmount)} below the claimed amount${assessment.note ? `: ${assessment.note}` : '.'}`,
    )
  }

  let decision = 'pending'
  if (claim.status === S.REJECTED) {
    decision = S.REJECTED
    reasons.push(`Rejected: ${claim.rejectionReason}`)
  } else if (claim.status === S.APPROVED) {
    decision = S.APPROVED
    reasons.push(`Approved for the assessed amount of ${formatCurrency(claim.approvedAmount)}.`)
  } else if (claim.status === S.SETTLED) {
    decision = S.SETTLED
    reasons.push(`Approved for ${formatCurrency(claim.approvedAmount)} and settled under reference ${claim.settlement?.reference}.`)
  } else {
    reasons.push('Awaiting an approval or rejection decision by a claims officer.')
  }

  return {
    claimedAmount: claimed,
    illustrativeLimit,
    limitBasis: assessment.limitBasis,
    assessedAmount,
    approvedAmount: claim.approvedAmount,
    decision,
    decisionLabel: DECISION_LABELS[decision],
    reasons,
  }
}
