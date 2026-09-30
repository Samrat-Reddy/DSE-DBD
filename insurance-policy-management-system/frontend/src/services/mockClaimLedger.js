/**
 * LEGACY MOCK claim ledger - read ONLY by the not-yet-migrated Module 6 (MIS).
 *
 * Module 3's own screens use the FastAPI/MySQL-backed `claimService`. The MIS
 * claims report still derives its figures from the mock claims below, exactly
 * as before Module 3 moved to the API. This file is the previous mock
 * `claimService`, unchanged apart from this header, and is deleted once MIS
 * reads claims from the API.
 *
 *   Module 6    ->  mockClaimLedger  ->  mock claim store / data
 *   Module 3 UI ->  claimService     ->  FastAPI  ->  MySQL
 */

import { ApiError } from './apiClient'
import { claimTypes } from '../data/claimTypes'
import { policyProducts } from '../data/policyProducts'
import { findPolicyById, getAllPolicies } from './mockPolicyStore'
import { getPremiumAccountSnapshot } from './mockPremiumLedger'
import {
  findClaimById,
  generateClaimId,
  generateSettlementReference,
  getAllClaims,
  saveClaim,
} from './mockClaimStore'
import {
  ClaimWorkflowError,
  WORKFLOW_ERROR_CODES,
  applyTransition,
  assertTransition,
  getAllowedTransitions,
  getTransitionRule,
  getWorkflowStages,
  resolveActor,
} from '../utils/claimWorkflow'
import { evaluateClaimEligibility, findClaimType, getCompatibleClaimTypes } from '../utils/claimEligibility'
import { buildDocumentRecords, validateClaimForm } from '../utils/claimValidation'
import {
  buildDecisionSummary,
  buildVerificationChecklist,
  calculateIllustrativeLimit,
  checkApprovalReadiness,
  validateAssessment,
  validateRejectionReason,
} from '../utils/claimAssessment'
import { queryClaims, summariseClaims } from '../utils/claimQuery'
import { todayIso } from '../utils/dateUtils'
import { formatCurrency } from '../utils/formatters'
import { CLAIM_STATUS, ROLES, ROLES_ALLOWED_TO_FILE_CLAIM } from '../utils/constants'

const S = CLAIM_STATUS

/** Same deliberate delay as the other services, so loading states are real. */
const MOCK_LATENCY_MS = 220

const withMockLatency = (value) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS)
  })

const clone = (value) => JSON.parse(JSON.stringify(value))

const nowIso = () => new Date().toISOString()

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const findProduct = (policy) =>
  policy ? policyProducts.find((product) => product.id === policy.productId) ?? null : null

const policyNotFound = (policyId) =>
  new ApiError(`No issued policy found for "${policyId}".`, {
    status: 404,
    data: { reason: 'policy-not-found', policyId },
  })

const requireClaim = (claimId) => {
  const claim = findClaimById(claimId)
  if (!claim) {
    throw new ApiError(`No claim found for "${claimId}".`, {
      status: 404,
      data: { reason: 'claim-not-found', claimId },
    })
  }
  return claim
}

const requireActor = (actor, policy) => {
  if (!Object.values(ROLES).includes(actor?.role)) {
    throw new ApiError('A valid demo role is required to change a claim.', {
      status: 403,
      data: { reason: 'invalid-actor' },
    })
  }
  // Names are always resolved from the role and policy, never trusted from input.
  return resolveActor(actor.role, policy)
}

const toApiError = (error) => {
  if (!(error instanceof ClaimWorkflowError)) return error
  const status =
    error.code === WORKFLOW_ERROR_CODES.UNAUTHORIZED_TRANSITION
      ? 403
      : error.code === WORKFLOW_ERROR_CODES.UNKNOWN_STATUS
        ? 422
        : 409
  return new ApiError(error.message, {
    status,
    data: { reason: error.code, from: error.from, to: error.to, role: error.role },
  })
}

const toPolicySnapshot = (policy) =>
  policy
    ? {
        id: policy.id,
        productId: policy.productId,
        productName: policy.productName,
        type: policy.type,
        status: policy.status,
        coverageAmount: policy.coverageAmount,
        startDate: policy.startDate,
        endDate: policy.endDate,
        issueDate: policy.issueDate,
        policyholderName: policy.policyholder?.name ?? null,
        customerId: policy.policyholder?.customerId ?? null,
        agentName: policy.agent?.name ?? null,
      }
    : null

/** Claim plus the display fields list views need. */
const enrichClaim = (claim) => {
  const policy = findPolicyById(claim.policyId)
  const claimType = findClaimType(claim.claimType, claimTypes)
  return {
    ...claim,
    policyholderName: policy?.policyholder?.name ?? null,
    productName: policy?.productName ?? null,
    claimTypeLabel: claimType?.label ?? claim.claimType,
    policyExists: Boolean(policy),
  }
}

/** Everything derived around one claim that its details page needs. */
const buildClaimContext = (claim, asOf) => {
  const policy = findPolicyById(claim.policyId)
  const product = findProduct(policy)
  const claimType = findClaimType(claim.claimType, claimTypes)
  const premium = policy ? getPremiumAccountSnapshot(policy.id, asOf) : null
  const limit = policy && claimType ? calculateIllustrativeLimit(claimType, policy.coverageAmount) : null
  return { policy, product, claimType, premium, limit }
}

const buildClaimDetails = (claim, asOf = todayIso()) => {
  const { policy, product, claimType, premium, limit } = buildClaimContext(claim, asOf)

  return {
    claim: enrichClaim(claim),
    claimType,
    policy: toPolicySnapshot(policy),
    policyError: policy
      ? null
      : { status: 404, message: `The policy ${claim.policyId} for this claim could not be found.` },
    coverage:
      claimType && product
        ? {
            coverageItem: product.coverageItems.find((item) => item.name === claimType.coverageItem) ?? null,
            limit,
          }
        : null,
    premium: premium ? premium.summary : null,
    verificationChecklist: buildVerificationChecklist({
      claim,
      policy,
      product,
      claimType,
      premiumSummary: premium?.summary ?? null,
      limit,
    }),
    decisionSummary: buildDecisionSummary(claim),
    workflowStages: getWorkflowStages(claim),
    allowedTransitions: getAllowedTransitions(claim.status).map((toStatus) => ({
      toStatus,
      ...getTransitionRule(claim.status, toStatus),
    })),
    asOf,
  }
}

/**
 * The one path every workflow change takes:
 *   claim exists → valid actor → legal transition for that role →
 *   dedicated-action rule → payload validation → apply and save.
 */
const runTransition = ({ claimId, toStatus, actor, note = null, dedicated = null, validate, buildPatch }) => {
  const claim = requireClaim(claimId)
  const context = buildClaimContext(claim, todayIso())
  const resolvedActor = requireActor(actor, context.policy)

  let rule
  try {
    rule = assertTransition(claim.status, toStatus, resolvedActor.role)
  } catch (error) {
    throw toApiError(error)
  }

  if (rule.dedicated && rule.dedicated !== dedicated) {
    throw new ApiError(
      `"${rule.label}" must be recorded through the ${rule.dedicated} step, not a direct status change.`,
      { status: 422, data: { reason: 'dedicated-action-required', step: rule.dedicated } },
    )
  }

  const at = nowIso()
  validate?.(claim, { ...context, actor: resolvedActor, at })

  const updated = applyTransition(claim, toStatus, resolvedActor, {
    at,
    note,
    patch: buildPatch ? buildPatch(claim, { ...context, actor: resolvedActor, at }) : {},
  })

  saveClaim(updated)
  return withMockLatency(clone(buildClaimDetails(updated)))
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Claims list with derived summary counts (always across all claims).
 *
 * @param {{search?: string, status?: string, claimType?: string, sort?: string}} query
 */
export const getClaims = async (query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.claims, { params: query })
  const all = getAllClaims()
  const items = queryClaims(all.map(enrichClaim), query)

  return withMockLatency(
    clone({
      items,
      total: items.length,
      summary: summariseClaims(all),
      claimTypeOptions: claimTypes.map(({ value, label }) => ({ value, label })),
    }),
  )
}

/** One claim with policy, coverage, premium and workflow context. */
export const getClaimById = async (claimId, options = {}) => {
  // Future: return apiClient.get(ENDPOINTS.claimById(claimId))
  const claim = requireClaim(claimId)
  return withMockLatency(clone(buildClaimDetails(claim, options.asOf ?? todayIso())))
}

export const getClaimsByPolicyId = async (policyId) => {
  // Future: return apiClient.get(ENDPOINTS.claimsByPolicyId(policyId))
  if (!findPolicyById(policyId)) throw policyNotFound(policyId)
  const items = getAllClaims().filter((claim) => claim.policyId === policyId).map(enrichClaim)
  return withMockLatency(clone({ items, total: items.length }))
}

const evaluatePolicy = (policy, asOf) => {
  const product = findProduct(policy)
  return evaluateClaimEligibility({
    policy,
    product,
    premiumSummary: policy ? getPremiumAccountSnapshot(policy.id, asOf)?.summary ?? null : null,
    claimTypes,
    asOf,
  })
}

/** Every policy with its claim eligibility, eligible policies first. */
export const getEligiblePoliciesForClaim = async (options = {}) => {
  // Future: return apiClient.get(ENDPOINTS.claimEligibility)
  const asOf = options.asOf ?? todayIso()
  const items = getAllPolicies()
    .map((policy) => ({ policy: toPolicySnapshot(policy), eligibility: evaluatePolicy(policy, asOf) }))
    .sort((a, b) => Number(b.eligibility.eligible) - Number(a.eligibility.eligible) || a.policy.id.localeCompare(b.policy.id))

  return withMockLatency(
    clone({ items, eligibleCount: items.filter((item) => item.eligibility.eligible).length, asOf }),
  )
}

/** Eligibility and the claim types a filer may choose, for one policy. */
export const getClaimFilingContext = async (policyId, options = {}) => {
  // Future: return apiClient.get(ENDPOINTS.claimFilingContext(policyId))
  const asOf = options.asOf ?? todayIso()
  const policy = findPolicyById(policyId)
  if (!policy) throw policyNotFound(policyId)

  const product = findProduct(policy)
  const eligibility = evaluatePolicy(policy, asOf)
  const types = getCompatibleClaimTypes(policy, product, claimTypes).map((type) => ({
    ...type,
    illustrativeLimit: calculateIllustrativeLimit(type, policy.coverageAmount),
  }))

  return withMockLatency(clone({ policy: toPolicySnapshot(policy), eligibility, claimTypes: types, asOf }))
}

/* ------------------------------------------------------------------ */
/* Filing                                                              */
/* ------------------------------------------------------------------ */

/**
 * File a claim. It is created as a draft and immediately submitted, so its
 * first activity event records Draft → Submitted.
 *
 * @param {object} values Claim form values (see `buildEmptyClaimForm`).
 * @param {{role: string}} actor
 */
export const createClaim = async (values, actor) => {
  // Future: return apiClient.post(ENDPOINTS.claims, values)
  if (!ROLES_ALLOWED_TO_FILE_CLAIM.includes(actor?.role)) {
    throw new ApiError(
      'Claims are filed by the policyholder or their agent. Claims officers review claims and cannot file them.',
      { status: 403, data: { reason: 'unauthorized-filing' } },
    )
  }

  const asOf = todayIso()

  if (!values?.policyId) {
    throw new ApiError('Select the policy this claim is for.', {
      status: 422,
      data: { reason: 'invalid-claim', errors: { policyId: 'Select the policy this claim is for.' } },
    })
  }

  const policy = findPolicyById(values.policyId)
  if (!policy) throw policyNotFound(values.policyId)

  const eligibility = evaluatePolicy(policy, asOf)
  if (!eligibility.eligible) {
    throw new ApiError(`A claim cannot be filed against ${policy.id}: ${eligibility.reasons[0]}`, {
      status: 409,
      data: { reason: 'policy-not-eligible', reasons: eligibility.reasons },
    })
  }

  const claimType = findClaimType(values.claimType, claimTypes)
  const errors = validateClaimForm(values, { policy, claimType, claimTypes, asOf })
  if (claimType && !errors.claimType && !eligibility.compatibleClaimTypes.includes(claimType.value)) {
    errors.claimType = `${claimType.label} is not covered by this policy.`
  }
  if (Object.keys(errors).length) {
    throw new ApiError('The claim has validation errors.', {
      status: 422,
      data: { reason: 'invalid-claim', errors },
    })
  }

  const filer = resolveActor(actor.role, policy)
  const claimId = generateClaimId(Number(asOf.slice(0, 4)))
  const at = nowIso()

  const draft = {
    claimId,
    policyId: policy.id,
    policyholderId: policy.policyholder?.customerId ?? null,
    claimType: claimType.value,
    incidentDate: values.incidentDate,
    filingDate: asOf,
    description: String(values.description).trim(),
    claimedAmount: Number(values.claimedAmount),
    approvedAmount: null,
    status: S.DRAFT,
    assignedTo: null,
    filedBy: filer,
    documents: buildDocumentRecords(claimId, claimType, values.documents, at),
    verification: null,
    assessment: null,
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: at,
    updatedAt: at,
    activity: [],
    isSessionCreated: true,
  }

  const submitted = applyTransition(draft, S.SUBMITTED, filer, {
    at,
    note: filer.role === ROLES.AGENT ? 'Filed by the agent on behalf of the policyholder.' : null,
  })

  saveClaim(submitted)
  return withMockLatency(clone(buildClaimDetails(submitted, asOf)))
}

/* ------------------------------------------------------------------ */
/* Workflow                                                            */
/* ------------------------------------------------------------------ */

/** Wrap a synchronous runner so every failure surfaces as a rejected promise. */
const asAsync = (runner) =>
  new Promise((resolve, reject) => {
    try {
      resolve(runner())
    } catch (error) {
      reject(error)
    }
  })

/**
 * Change a claim's status directly. Only transitions without extra rules
 * (start review, withdraw) can be made this way; everything else is rejected
 * and must use its dedicated action.
 */
export const transitionClaim = (claimId, nextStatus, actor, options = {}) =>
  asAsync(() =>
    runTransition({
      claimId,
      toStatus: nextStatus,
      actor,
      note: options.note,
      buildPatch: (claim, { actor: resolvedActor }) =>
        nextStatus === S.UNDER_REVIEW ? { assignedTo: resolvedActor } : {},
    }),
  )

/** Under review → Verified, after the verification checklist passes. */
export const verifyClaim = (claimId, actor, options = {}) =>
  asAsync(() =>
    runTransition({
      claimId,
      toStatus: S.VERIFIED,
      actor,
      note: options.note,
      dedicated: 'verification',
      validate: (claim, context) => {
        const checklist = buildVerificationChecklist({
          claim,
          policy: context.policy,
          product: context.product,
          claimType: context.claimType,
          premiumSummary: context.premium?.summary ?? null,
          limit: context.limit,
        })
        if (checklist.blocking) {
          const failed = checklist.checks.filter((item) => item.outcome === 'fail')
          throw new ApiError(`The claim cannot be verified: ${failed.map((item) => item.detail).join(' ')}`, {
            status: 422,
            data: { reason: 'verification-checks-failed', checks: checklist.checks },
          })
        }
      },
      buildPatch: (claim, context) => {
        const checklist = buildVerificationChecklist({
          claim,
          policy: context.policy,
          product: context.product,
          claimType: context.claimType,
          premiumSummary: context.premium?.summary ?? null,
          limit: context.limit,
        })
        return {
          verification: {
            verifiedAt: context.at,
            verifiedBy: context.actor,
            checksPassed: checklist.passed,
            checksTotal: checklist.checks.length,
            warnings: checklist.warnings,
            note: options.note ? String(options.note).trim() : null,
          },
          documents: claim.documents.map((item) => ({ ...item, status: 'verified' })),
        }
      },
    }),
  )

/** Verified → Assessed, recording the assessed amount against the limit. */
export const assessClaim = (claimId, { assessedAmount, note } = {}, actor) =>
  asAsync(() =>
    runTransition({
      claimId,
      toStatus: S.ASSESSED,
      actor,
      note: `Assessed at ${formatCurrency(assessedAmount)}.${note ? ` ${String(note).trim()}` : ''}`,
      dedicated: 'assessment',
      validate: (claim, context) => {
        if (!context.limit) {
          throw new ApiError('The illustrative limit cannot be calculated because the policy or claim type is unavailable.', {
            status: 422,
            data: { reason: 'invalid-assessment', errors: { assessedAmount: 'The coverage limit is unavailable.' } },
          })
        }
        const errors = validateAssessment({
          assessedAmount,
          claimedAmount: claim.claimedAmount,
          limit: context.limit.limit,
          note,
        })
        if (Object.keys(errors).length) {
          throw new ApiError(Object.values(errors)[0], {
            status: 422,
            data: { reason: 'invalid-assessment', errors },
          })
        }
      },
      buildPatch: (claim, context) => ({
        assessment: {
          assessedAmount: Number(assessedAmount),
          illustrativeLimit: context.limit.limit,
          limitBasis: context.limit.basis,
          note: note ? String(note).trim() : null,
          assessedAt: context.at,
          assessedBy: context.actor,
        },
      }),
    }),
  )

/** Assessed → Approved. Requires a valid recorded assessment. */
export const approveClaim = (claimId, actor, options = {}) =>
  asAsync(() =>
    runTransition({
      claimId,
      toStatus: S.APPROVED,
      actor,
      note: options.note,
      dedicated: 'decision',
      validate: (claim) => {
        const readiness = checkApprovalReadiness(claim)
        if (!readiness.ready) {
          throw new ApiError(readiness.reason, { status: 422, data: { reason: 'assessment-required' } })
        }
      },
      buildPatch: (claim, context) => ({
        approvedAmount: claim.assessment.assessedAmount,
        decision: {
          outcome: S.APPROVED,
          reason:
            claim.assessment.assessedAmount === claim.claimedAmount
              ? 'Assessed amount is within the illustrative coverage limit.'
              : 'Approved at the assessed amount.',
          decidedAt: context.at,
          decidedBy: context.actor,
        },
      }),
    }),
  )

/** Assessed → Rejected. A reason is mandatory. */
export const rejectClaim = (claimId, reason, actor) =>
  asAsync(() =>
    runTransition({
      claimId,
      toStatus: S.REJECTED,
      actor,
      note: String(reason ?? '').trim(),
      dedicated: 'decision',
      validate: () => {
        const error = validateRejectionReason(reason)
        if (error) {
          throw new ApiError(error, {
            status: 422,
            data: { reason: 'rejection-reason-required', errors: { rejectionReason: error } },
          })
        }
      },
      buildPatch: (claim, context) => ({
        rejectionReason: String(reason).trim(),
        decision: { outcome: S.REJECTED, reason: String(reason).trim(), decidedAt: context.at, decidedBy: context.actor },
      }),
    }),
  )

/**
 * Approved → Settled. Records a settlement reference and date only; no money
 * moves and the premium/payment module is not touched.
 */
export const settleClaim = (claimId, actor) =>
  asAsync(() => {
    const existing = requireClaim(claimId)
    if (existing.status === S.SETTLED) {
      throw new ApiError(
        `Claim ${claimId} is already settled under reference ${existing.settlement?.reference}. It cannot be settled twice.`,
        { status: 409, data: { reason: 'already-settled', reference: existing.settlement?.reference } },
      )
    }

    // Computing the next reference has no side effect; it is only saved if the transition succeeds.
    const reference = generateSettlementReference(Number(todayIso().slice(0, 4)))
    return runTransition({
      claimId,
      toStatus: S.SETTLED,
      actor,
      dedicated: 'settlement',
      validate: (claim) => {
        if (!(claim.approvedAmount > 0)) {
          throw new ApiError('An approved amount is required before settlement.', {
            status: 422,
            data: { reason: 'assessment-required' },
          })
        }
      },
      note: `Settlement reference ${reference}.`,
      buildPatch: (claim, context) => ({
        settlement: {
          reference,
          settledAt: context.at,
          settledDate: todayIso(),
          amount: claim.approvedAmount,
          settledBy: context.actor,
          note: 'Settlement recorded. No payment is made by this demonstration system.',
        },
      }),
    })
  })

export default {
  getClaims,
  getClaimById,
  getClaimsByPolicyId,
  getEligiblePoliciesForClaim,
  getClaimFilingContext,
  createClaim,
  transitionClaim,
  verifyClaim,
  assessClaim,
  approveClaim,
  rejectClaim,
  settleClaim,
}
