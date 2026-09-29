/**
 * Premium Schedule & Payments service.
 *
 * The only module the Module 2 UI talks to for data. Backed by mock data and
 * the session payment store today, by FastAPI later:
 *
 *   React  ->  premiumService  ->  mock data / store   (today)
 *   React  ->  premiumService  ->  FastAPI  ->  MySQL  (later)
 *
 * Functions are async and reject with `ApiError`, exactly like `apiClient`,
 * so pages need no change when the backend arrives. No HTTP request is made
 * and no money moves: payments recorded here are simulations.
 *
 * Schedules are tied to Module 1 policies via `mockPolicyStore`. Seeded
 * headers come from `premiumSchedules.js`; policies issued in the browser
 * session get a header derived from their own premium terms.
 */

import { ApiError } from './apiClient'
import { premiumSchedules } from '../data/premiumSchedules'
import { findPolicyById, getAllPolicies } from './mockPolicyStore'
import {
  addPayment,
  findPaymentById,
  generatePaymentId,
  generateTransactionReference,
  getAllPayments,
} from './mockPaymentStore'
import {
  buildPremiumAccount,
  buildScheduleHeaderFromPolicy,
  calculatePortfolioSummary,
  isPolicyScheduleEligible,
  parseInstallmentNumber,
} from '../utils/premiumCalculations'
import { queryPayments, queryPremiumAccounts, summarisePayments } from '../utils/premiumQuery'
import { PAYABILITY_REASON, validatePaymentRequest } from '../utils/paymentValidation'
import { todayIso } from '../utils/dateUtils'
import { PAYMENT_STATUS } from '../utils/constants'

/** Same deliberate delay as `policyService`, so loading states are real. */
const MOCK_LATENCY_MS = 220

const withMockLatency = (value) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS)
  })

/** Deep copy so callers can never mutate the mock source of truth. */
const clone = (value) => JSON.parse(JSON.stringify(value))

/** Outcomes a reviewer can choose for a simulated payment. */
export const MOCK_PAYMENT_OUTCOMES = {
  APPROVE: 'approve',
  DECLINE: 'decline',
}

/* ------------------------------------------------------------------ */
/* Internal joins                                                      */
/* ------------------------------------------------------------------ */

const findSeededHeader = (policyId) =>
  premiumSchedules.find((header) => header.policyId === policyId) ?? null

/**
 * Every schedule header in the demo: seeded headers (even if their policy is
 * missing — those surface as orphaned) plus derived headers for issued
 * policies that have no seeded header.
 */
const getAllScheduleHeaders = () => {
  const seededPolicyIds = new Set(premiumSchedules.map((header) => header.policyId))

  const derived = getAllPolicies()
    .filter((policy) => !seededPolicyIds.has(policy.id))
    .map(buildScheduleHeaderFromPolicy)
    .filter(Boolean)

  return [...derived, ...premiumSchedules]
}

const resolveHeaderForPolicy = (policyId) => {
  const policy = findPolicyById(policyId)
  const header = findSeededHeader(policyId) ?? buildScheduleHeaderFromPolicy(policy)
  return { policy, header }
}

/** Throw the right error when a policy has no schedule. */
const assertHeaderExists = (policyId, policy, header) => {
  if (header) return

  if (policy && !isPolicyScheduleEligible(policy)) {
    throw new ApiError(
      `Policy ${policyId} has not been issued yet, so it has no premium schedule.`,
      { status: 409, data: { reason: 'policy-not-issued', policyId } },
    )
  }

  throw new ApiError(`No premium schedule found for policy "${policyId}".`, {
    status: 404,
    data: { reason: 'policy-not-found', policyId },
  })
}

/** Payment plus the policy details needed to display it in a list. */
const enrichPayment = (payment) => {
  const policy = findPolicyById(payment.policyId)

  return {
    ...payment,
    installmentNumber:
      payment.installmentNumber ?? parseInstallmentNumber(payment.installmentId),
    policyholderName: policy?.policyholder?.name ?? null,
    customerId: policy?.policyholder?.customerId ?? null,
    productName: policy?.productName ?? null,
    policyExists: Boolean(policy),
    isMock: true,
  }
}

/** A list row does not need every instalment of a 100-instalment plan. */
const withoutInstallments = (account) => {
  const listRow = { ...account }
  delete listRow.installments
  return listRow
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Synchronous premium summary for one policy, or `null` when it has no
 * schedule. For other services that need premium context (Module 3 claims)
 * without duplicating schedule logic. UI code should use the async API.
 */
export const getPremiumAccountSnapshot = (policyId, asOf = todayIso()) => {
  const { policy, header } = resolveHeaderForPolicy(policyId)
  if (!header) return null
  const account = buildPremiumAccount(header, policy, getAllPayments(), asOf)
  return { policyId, asOf, premiumAmount: account.premiumAmount, frequency: account.frequency, summary: account.summary }
}

/**
 * Synchronous schedule header (premium terms) for one policy, or `null`.
 * For Module 5 commission, which must check that a payment belongs to the
 * policy's schedule, without duplicating how headers are resolved.
 */
export const getPremiumScheduleHeader = (policyId) => {
  const { header } = resolveHeaderForPolicy(policyId)
  return header ? clone(header) : null
}

/** Synchronous read of all payments, for other services (Module 5). */
export const getPaymentRecords = () => clone(getAllPayments())

/**
 * Premium accounts for every policy with a schedule, plus portfolio totals.
 *
 * Portfolio totals always cover the whole demo book, not just the filtered
 * rows, so the headline figures do not change while the user searches.
 *
 * @param {{search?: string, standing?: string, sort?: string, asOf?: string}} query
 */
export const getPremiumSchedules = async (query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.premiumSchedules, { params: query })
  const asOf = query.asOf ?? todayIso()
  const payments = getAllPayments()

  const accounts = getAllScheduleHeaders().map((header) =>
    buildPremiumAccount(header, findPolicyById(header.policyId), payments, asOf),
  )

  const items = queryPremiumAccounts(accounts, query).map(withoutInstallments)
  const awaitingIssuance = getAllPolicies().filter(
    (policy) => !isPolicyScheduleEligible(policy),
  ).length

  return withMockLatency(
    clone({
      items,
      total: items.length,
      portfolio: calculatePortfolioSummary(accounts),
      awaitingIssuance,
      asOf,
    }),
  )
}

/**
 * Full premium account for one policy: instalments, summary and payments.
 *
 * Rejects with 404 for an unknown policy and 409 for a policy that exists
 * but has not been issued.
 */
export const getPremiumScheduleByPolicyId = async (policyId, options = {}) => {
  // Future: return apiClient.get(ENDPOINTS.premiumScheduleByPolicyId(policyId))
  const asOf = options.asOf ?? todayIso()
  const { policy, header } = resolveHeaderForPolicy(policyId)
  assertHeaderExists(policyId, policy, header)

  const payments = getAllPayments()
  const account = buildPremiumAccount(header, policy, payments, asOf)

  const policyPayments = queryPayments(
    payments.filter((payment) => payment.policyId === policyId).map(enrichPayment),
    { sort: 'date-desc' },
  )

  return withMockLatency(clone({ ...account, payments: policyPayments }))
}

/**
 * Payment history, searchable and filterable.
 *
 * @param {{search?: string, status?: string, method?: string, sort?: string}} query
 */
export const getPayments = async (query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.payments, { params: query })
  const enriched = getAllPayments().map(enrichPayment)
  const items = queryPayments(enriched, query)

  return withMockLatency(
    clone({ items, total: items.length, summary: summarisePayments(enriched) }),
  )
}

/**
 * One payment with the instalment it was applied to, in its current state.
 */
export const getPaymentById = async (paymentId, options = {}) => {
  // Future: return apiClient.get(ENDPOINTS.paymentById(paymentId))
  const payment = findPaymentById(paymentId)

  if (!payment) {
    throw new ApiError(`No payment found for "${paymentId}".`, {
      status: 404,
      data: { reason: 'payment-not-found', paymentId },
    })
  }

  const asOf = options.asOf ?? todayIso()
  const { policy, header } = resolveHeaderForPolicy(payment.policyId)
  const account = header
    ? buildPremiumAccount(header, policy, getAllPayments(), asOf)
    : null

  const installment =
    account?.installments.find((item) => item.installmentId === payment.installmentId) ??
    null

  return withMockLatency(
    clone({
      payment: enrichPayment(payment),
      installment,
      policy: account?.policy ?? null,
      isOrphaned: !policy,
    }),
  )
}

/**
 * Record a MOCK premium payment. No payment provider is called.
 *
 * Validation runs here as well as in the UI, and runs synchronously before
 * any await, so a double submission sees the first payment and is rejected
 * as a duplicate.
 *
 * @param {{policyId: string, installmentId: string, amount: number,
 *          method: string, outcome?: 'approve'|'decline'}} request
 * @returns {Promise<{payment: object, account: object, previousSummary: object}>}
 */
export const recordMockPayment = async ({
  policyId,
  installmentId,
  amount,
  method,
  outcome = MOCK_PAYMENT_OUTCOMES.APPROVE,
}) => {
  // Future: return apiClient.post(ENDPOINTS.payments, request)
  const asOf = todayIso()
  const { policy, header } = resolveHeaderForPolicy(policyId)
  assertHeaderExists(policyId, policy, header)

  const before = buildPremiumAccount(header, policy, getAllPayments(), asOf)
  const installment =
    before.installments.find((item) => item.installmentId === installmentId) ?? null

  const errors = validatePaymentRequest({ installment, amount, method })

  if (Object.keys(errors).length > 0) {
    const reason = !installment
      ? PAYABILITY_REASON.NOT_FOUND
      : errors.installment
        ? 'installment-not-payable'
        : 'invalid-request'
    const status = !installment ? 404 : errors.installment ? 409 : 422

    throw new ApiError(errors.installment ?? errors.amount ?? errors.method, {
      status,
      data: { reason, errors },
    })
  }

  if (!Object.values(MOCK_PAYMENT_OUTCOMES).includes(outcome)) {
    throw new ApiError('Select a valid mock payment outcome.', {
      status: 422,
      data: { reason: 'invalid-request', errors: { outcome: 'Invalid outcome.' } },
    })
  }

  const isApproved = outcome === MOCK_PAYMENT_OUTCOMES.APPROVE

  const payment = {
    paymentId: generatePaymentId(Number(asOf.slice(0, 4))),
    policyId,
    installmentId,
    installmentNumber: installment.installmentNumber,
    amount: Number(amount),
    paymentDate: asOf,
    paidAt: new Date().toISOString(),
    paymentMethod: method,
    status: isApproved ? PAYMENT_STATUS.SUCCESS : PAYMENT_STATUS.FAILED,
    transactionReference: generateTransactionReference(),
    ...(isApproved
      ? {}
      : { failureReason: 'Declined — simulated outcome chosen during review.' }),
    isSessionRecorded: true,
  }

  addPayment(payment)

  const after = buildPremiumAccount(header, policy, getAllPayments(), asOf)

  return withMockLatency(
    clone({
      payment: enrichPayment(payment),
      installment: after.installments.find((item) => item.installmentId === installmentId),
      account: withoutInstallments(after),
      previousSummary: before.summary,
    }),
  )
}

export default {
  getPremiumSchedules,
  getPremiumScheduleByPolicyId,
  getPayments,
  getPaymentById,
  recordMockPayment,
}
