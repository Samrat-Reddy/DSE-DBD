/**
 * Claim Filing & Approval Workflow service (Module 3) — backed by the FastAPI API.
 *
 *   React  ->  claimService  ->  authApi (JWT)  ->  FastAPI  ->  MySQL
 *
 * Every Module 3 screen reads and writes through this file only, and it holds
 * no claim data of its own: claims, their workflow history, verification,
 * assessment, decisions and settlements all come from MySQL. The backend is
 * the enforcement boundary (scope, eligibility, the state machine, each
 * step's rules, locking); this file only translates the API contract into the
 * shapes the existing screens render.
 *
 * `actor` arguments are kept for signature compatibility and ignored: the
 * backend identifies the caller from the JWT, never from the request.
 *
 * Module 6 (MIS) still reads `mockClaimLedger` until its own migration.
 */

import { ApiError } from './apiClient'
import { authApi } from './authSession'
import { ENDPOINTS } from './endpoints'
import { getAllowedTransitions, getTransitionRule, getWorkflowStages } from '../utils/claimWorkflow'
import { documentFieldKey } from '../utils/claimValidation'
import { PAYMENT_STANDING, POLICY_TYPES } from '../utils/constants'

/** Lists have no paging UI yet; this is the API's maximum page size. */
const LIST_LIMIT = 200

const TYPE_LABELS = {
  health: POLICY_TYPES.HEALTH,
  life: POLICY_TYPES.LIFE,
  motor: POLICY_TYPES.MOTOR,
  personal_accident: POLICY_TYPES.PERSONAL_ACCIDENT,
  home: POLICY_TYPES.HOME,
}
const STANDING_LABELS = {
  overdue: PAYMENT_STANDING.OVERDUE,
  due: PAYMENT_STANDING.DUE,
  up_to_date: PAYMENT_STANDING.UP_TO_DATE,
  fully_paid: PAYMENT_STANDING.FULLY_PAID,
}

/** API codes are snake_case, the UI's are kebab-case ("under_review" <-> "under-review"). */
const toUiCode = (value) => (value ? String(value).replaceAll('_', '-') : value)
const toApiCode = (value) => (value ? String(value).replaceAll('-', '_') : value)
const toNumber = (value) => (value === null || value === undefined ? null : Number(value))
const filterValue = (value) => (!value || value === 'all' ? undefined : value)

/* ------------------------------------------------------------------ */
/* API -> UI shapes                                                    */
/* ------------------------------------------------------------------ */

const toActor = (actor) => (actor ? { name: actor.name, role: actor.role } : null)

const toLimit = (limit) => ({
  limit: toNumber(limit.limit),
  coverageAmount: toNumber(limit.coverage_amount),
  percentOfCoverage: limit.percent_of_coverage,
  maxAmount: toNumber(limit.max_amount),
  basis: limit.basis,
  cappedByMaximum: limit.capped_by_maximum,
})

const toClaimType = (type) => ({
  value: type.code,
  label: type.label,
  policyType: TYPE_LABELS[type.product_type] ?? type.product_type,
  coverageItem: type.coverage_item,
  limitRule: { percentOfCoverage: type.percent_of_coverage, maxAmount: toNumber(type.max_amount) },
  limitBasis: type.limit_basis,
  description: type.description,
  requiredDocuments: type.documents.map((doc) => ({
    type: doc.doc_type,
    label: doc.label,
    suggestedName: doc.suggested_name,
    required: doc.required,
  })),
  ...(type.illustrative_limit ? { illustrativeLimit: toLimit(type.illustrative_limit) } : {}),
})

const toPolicy = (policy) => ({
  id: policy.policy_number,
  productId: policy.product_code,
  productName: policy.product_name,
  type: TYPE_LABELS[policy.product_type] ?? policy.product_type,
  status: policy.status,
  coverageAmount: toNumber(policy.coverage_amount),
  startDate: policy.start_date,
  endDate: policy.end_date,
  issueDate: policy.issue_date,
  policyholderName: policy.policyholder_name,
  customerId: policy.customer_code,
  agentName: policy.agent_name,
})

const toEligibility = (eligibility) => ({
  eligible: eligibility.eligible,
  checks: eligibility.checks.map((check) => ({ ...check })),
  reasons: eligibility.reasons,
  warnings: eligibility.warnings,
  compatibleClaimTypes: eligibility.compatible_claim_types,
  incidentWindow: eligibility.incident_earliest
    ? { earliest: eligibility.incident_earliest, latest: eligibility.incident_latest }
    : null,
  filingDeadline: eligibility.filing_deadline,
})

const toEvent = (claimNumber) => (event) => ({
  eventId: `${claimNumber}-E${event.sequence_no}`,
  at: event.occurred_at,
  action: toUiCode(event.action),
  label: event.label,
  fromStatus: toUiCode(event.from_status),
  toStatus: toUiCode(event.to_status),
  actor: toActor(event.actor),
  note: event.note,
})

const toClaimSummary = (claim) => ({
  claimId: claim.claim_number,
  policyId: claim.policy_number,
  policyholderId: claim.customer_code,
  policyholderName: claim.policyholder_name,
  productName: claim.product_name,
  claimType: claim.claim_type,
  claimTypeLabel: claim.claim_type_label,
  incidentDate: claim.incident_date,
  filingDate: claim.filing_date,
  claimedAmount: toNumber(claim.claimed_amount),
  approvedAmount: toNumber(claim.approved_amount),
  status: toUiCode(claim.status),
  filedBy: toActor(claim.filed_by),
  assignedTo: toActor(claim.assigned_to),
  createdAt: claim.created_at,
  updatedAt: claim.updated_at,
  policyExists: true,
})

const toClaim = (detail) => {
  const number = detail.claim.claim_number
  const decisionEvent = detail.decision?.decided_at ? detail.decision : null
  return {
    ...toClaimSummary(detail.claim),
    description: detail.description,
    rejectionReason: detail.rejection_reason,
    documents: detail.documents.map((doc, index) => ({
      documentId: `${number}-D${index + 1}`,
      type: doc.doc_type,
      label: doc.label,
      fileName: doc.file_name,
      required: doc.required,
      status: doc.status,
      submittedAt: doc.submitted_at,
    })),
    verification: detail.verification
      ? {
          verifiedAt: detail.verification.verified_at,
          verifiedBy: toActor(detail.verification.verified_by),
          checksPassed: detail.verification.checks_passed,
          checksTotal: detail.verification.checks_total,
          warnings: detail.verification.warnings,
          note: detail.verification.note,
        }
      : null,
    assessment: detail.assessment
      ? {
          assessedAmount: toNumber(detail.assessment.assessed_amount),
          illustrativeLimit: toNumber(detail.assessment.illustrative_limit),
          limitBasis: detail.assessment.limit_basis,
          note: detail.assessment.note,
          assessedAt: detail.assessment.assessed_at,
          assessedBy: toActor(detail.assessment.assessed_by),
        }
      : null,
    decision:
      decisionEvent && ['approved', 'rejected', 'settled'].includes(detail.decision.decision)
        ? {
            outcome: detail.decision.decision === 'rejected' ? 'rejected' : 'approved',
            reason: detail.decision.reasons.at(-1),
            decidedAt: detail.decision.decided_at,
            decidedBy: toActor(detail.decision.decided_by),
          }
        : null,
    settlement: detail.settlement
      ? {
          reference: detail.settlement.settlement_reference,
          settledAt: detail.settlement.settled_at,
          settledDate: detail.settlement.settled_on,
          amount: toNumber(detail.settlement.amount),
          settledBy: toActor(detail.settlement.settled_by),
          note: 'Settlement recorded. No payment is made by this demonstration system.',
        }
      : null,
    activity: detail.events.map(toEvent(number)),
  }
}

const toDetails = (detail) => {
  const claim = toClaim(detail)
  return {
    claim,
    claimType: toClaimType(detail.claim_type),
    policy: toPolicy(detail.policy),
    policyError: null,
    coverage: {
      coverageItem: detail.coverage_item ? { ...detail.coverage_item } : null,
      limit: toLimit(detail.limit),
    },
    premium: detail.premium
      ? {
          standing: STANDING_LABELS[detail.premium.standing] ?? detail.premium.standing,
          counts: { overdue: detail.premium.overdue_count },
          overdueAmount: toNumber(detail.premium.overdue_amount),
          oldestOverdueDate: detail.premium.oldest_overdue_date,
        }
      : null,
    verificationChecklist: { ...detail.verification_checklist },
    decisionSummary: detail.decision
      ? {
          claimedAmount: toNumber(detail.decision.claimed_amount),
          illustrativeLimit: toNumber(detail.decision.illustrative_limit),
          limitBasis: detail.decision.limit_basis,
          assessedAmount: toNumber(detail.decision.assessed_amount),
          approvedAmount: toNumber(detail.decision.approved_amount),
          decision: detail.decision.decision,
          decisionLabel: detail.decision.decision_label,
          reasons: detail.decision.reasons,
        }
      : null,
    // Display only: the same state-machine table the backend enforces.
    workflowStages: getWorkflowStages(claim),
    allowedTransitions: getAllowedTransitions(claim.status).map((toStatus) => ({
      toStatus,
      ...getTransitionRule(claim.status, toStatus),
    })),
    asOf: detail.as_of,
  }
}

/* ------------------------------------------------------------------ */
/* Errors: API field paths -> the form keys the screens already use     */
/* ------------------------------------------------------------------ */

const FIELD_KEYS = {
  'body.policy_number': 'policyId',
  'body.claim_type': 'claimType',
  'body.incident_date': 'incidentDate',
  'body.claimed_amount': 'claimedAmount',
  'body.description': 'description',
  'body.assessed_amount': 'assessedAmount',
  'body.note': 'note',
  'body.reason': 'rejectionReason',
}

const toFieldKey = (field) => {
  if (FIELD_KEYS[field]) return FIELD_KEYS[field]
  const document = /^body\.documents\.(.+)$/.exec(field)
  return document ? documentFieldKey(document[1]) : field
}

/** Turn the API's `errors` list into the `{ fieldKey: message }` map the forms read. */
const withFieldErrors = (error) => {
  if (!(error instanceof ApiError) || !Array.isArray(error.data?.errors)) return error
  const errors = Object.fromEntries(
    error.data.errors.map(({ field, message }) => [toFieldKey(field), message]),
  )
  return new ApiError(error.message, { status: error.status, data: { ...error.data, errors } })
}

const call = async (request) => {
  try {
    return await request()
  } catch (error) {
    throw withFieldErrors(error)
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Claims in the signed-in account's scope, with scope-wide status counts.
 *
 * @param {{search?: string, status?: string, claimType?: string, sort?: string}} query
 */
export const getClaims = async (query = {}) => {
  const [response, types] = await Promise.all([
    authApi.get(ENDPOINTS.claims, {
      params: {
        search: query.search?.trim() || undefined,
        status: toApiCode(filterValue(query.status)),
        claim_type: filterValue(query.claimType),
        sort: query.sort,
        limit: LIST_LIMIT,
      },
    }),
    authApi.get(ENDPOINTS.claimTypes),
  ])
  const counts = response.summary
  return {
    items: response.items.map(toClaimSummary),
    total: response.total,
    summary: {
      total: counts.total,
      draft: counts.draft,
      submitted: counts.submitted,
      underReview: counts.under_review,
      verified: counts.verified,
      assessed: counts.assessed,
      approved: counts.approved,
      rejected: counts.rejected,
      settled: counts.settled,
      cancelled: counts.cancelled,
      open: counts.open,
    },
    claimTypeOptions: types.items.map(({ code, label }) => ({ value: code, label })),
  }
}

/** One claim with policy, coverage, premium, workflow and decision context. */
export const getClaimById = async (claimId) =>
  toDetails(await authApi.get(ENDPOINTS.claimById(claimId)))

export const getClaimsByPolicyId = async (policyId) => {
  const response = await authApi.get(ENDPOINTS.claims, {
    params: { policy_number: policyId, limit: LIST_LIMIT },
  })
  return { items: response.items.map(toClaimSummary), total: response.total }
}

/** Every policy in scope with its claim eligibility, eligible policies first. */
export const getEligiblePoliciesForClaim = async () => {
  const response = await authApi.get(ENDPOINTS.claimEligibility)
  return {
    items: response.items.map((item) => ({
      policy: toPolicy(item.policy),
      eligibility: toEligibility(item.eligibility),
    })),
    eligibleCount: response.eligible_count,
    asOf: response.as_of,
  }
}

/** Eligibility and the claim types a filer may choose, for one policy. */
export const getClaimFilingContext = async (policyId) => {
  const response = await authApi.get(ENDPOINTS.claimFilingContext(policyId))
  return {
    policy: toPolicy(response.policy),
    eligibility: toEligibility(response.eligibility),
    claimTypes: response.claim_types.map(toClaimType),
    asOf: response.as_of,
  }
}

/* ------------------------------------------------------------------ */
/* Filing and workflow                                                 */
/* ------------------------------------------------------------------ */

/**
 * File a claim: created and submitted in one server-side transaction, so its
 * first history event records Draft -> Submitted.
 *
 * @param {object} values Claim form values (see `buildEmptyClaimForm`).
 */
export const createClaim = (values) =>
  call(async () => {
    const documents = Object.fromEntries(
      Object.entries(values.documents ?? {})
        .filter(([, entry]) => entry?.provided)
        .map(([type, entry]) => [type, String(entry.fileName ?? '').trim()]),
    )
    const detail = await authApi.post(ENDPOINTS.claims, {
      policy_number: values.policyId,
      claim_type: values.claimType,
      incident_date: values.incidentDate,
      claimed_amount: String(values.claimedAmount).trim(),
      description: String(values.description ?? '').trim(),
      documents,
    })
    return toDetails(detail)
  })

const runAction = (claimId, action, body) =>
  call(async () => toDetails(await authApi.post(ENDPOINTS.claimAction(claimId, action), body)))

/**
 * Status changes without extra rules: start the review, or withdraw a
 * submitted claim (`options.action = 'cancel-draft'` cancels a draft instead).
 */
export const transitionClaim = (claimId, nextStatus, _actor, options = {}) => {
  if (nextStatus === 'under-review') {
    return runAction(claimId, 'start-review', { note: options.note ?? null })
  }
  if (nextStatus === 'cancelled') {
    const action = options.action === 'cancel-draft' ? 'cancel' : 'withdraw'
    return runAction(claimId, action, { note: options.note ?? null })
  }
  return Promise.reject(
    new ApiError(`Use the dedicated action to move a claim to "${nextStatus}".`, {
      status: 422,
      data: { reason: 'dedicated-action-required' },
    }),
  )
}

export const verifyClaim = (claimId, _actor, options = {}) =>
  runAction(claimId, 'verify', { note: options.note ?? null })

export const assessClaim = (claimId, { assessedAmount, note } = {}) =>
  runAction(claimId, 'assess', {
    assessed_amount: String(assessedAmount ?? '').trim(),
    note: note ? String(note).trim() : null,
  })

export const approveClaim = (claimId, _actor, options = {}) =>
  runAction(claimId, 'approve', { note: options.note ?? null })

export const rejectClaim = (claimId, reason) =>
  runAction(claimId, 'reject', { reason: String(reason ?? '') })

/** Approved -> Settled for the approved amount, under a server-generated reference. */
export const settleClaim = (claimId) => runAction(claimId, 'settle')

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
