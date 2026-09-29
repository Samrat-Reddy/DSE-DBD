/**
 * Premium Schedule & Payments service (Module 2) — backed by the FastAPI API.
 *
 *   React  ->  premiumService  ->  authApi (JWT)  ->  FastAPI  ->  MySQL
 *
 * Every Module 2 screen reads and writes through this file only, and it has
 * no mock data: MySQL is the single source of truth. The backend owns every
 * rule and figure (instalment amounts, balances, statuses, payability, who
 * may see or pay what); this file only translates the API contract
 * (snake_case, decimal-string money, numeric instalment IDs) into the shapes
 * the existing screens render.
 *
 * Not-yet-migrated Modules 3–6 read `mockPremiumLedger` instead.
 */

import { ApiError } from './apiClient'
import { authApi } from './authSession'
import { ENDPOINTS } from './endpoints'
import { buildInstallmentId } from '../utils/premiumCalculations'
import { daysBetween } from '../utils/dateUtils'
import {
  INSTALLMENT_STATUS,
  PAYMENT_METHODS,
  PAYMENT_STANDING,
  PAYMENT_STATUS,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
} from '../utils/constants'

/** How a payment attempt resolves. There is no payment gateway yet, so the payer states it. */
export const PAYMENT_OUTCOMES = {
  APPROVE: 'successful',
  DECLINE: 'failed',
}

/** Lists have no paging UI yet; this is the API's maximum page size. */
const LIST_LIMIT = 200

const TYPE_LABELS = {
  health: POLICY_TYPES.HEALTH,
  life: POLICY_TYPES.LIFE,
  motor: POLICY_TYPES.MOTOR,
  personal_accident: POLICY_TYPES.PERSONAL_ACCIDENT,
  home: POLICY_TYPES.HOME,
}
const FREQUENCY_LABELS = {
  monthly: PREMIUM_FREQUENCIES.MONTHLY,
  quarterly: PREMIUM_FREQUENCIES.QUARTERLY,
  half_yearly: PREMIUM_FREQUENCIES.HALF_YEARLY,
  annual: PREMIUM_FREQUENCIES.ANNUAL,
}
const STANDING_LABELS = {
  overdue: PAYMENT_STANDING.OVERDUE,
  due: PAYMENT_STANDING.DUE,
  up_to_date: PAYMENT_STANDING.UP_TO_DATE,
  fully_paid: PAYMENT_STANDING.FULLY_PAID,
}
const PAYMENT_STATUS_LABELS = {
  successful: PAYMENT_STATUS.SUCCESS,
  failed: PAYMENT_STATUS.FAILED,
  pending: PAYMENT_STATUS.PENDING,
}
const METHOD_LABELS = {
  upi: PAYMENT_METHODS.UPI,
  card: PAYMENT_METHODS.CARD,
  net_banking: PAYMENT_METHODS.NET_BANKING,
}
const invert = (map) => Object.fromEntries(Object.entries(map).map(([code, label]) => [label, code]))
const STANDING_CODES = invert(STANDING_LABELS)
const PAYMENT_STATUS_CODES = invert(PAYMENT_STATUS_LABELS)
const METHOD_CODES = invert(METHOD_LABELS)

const toNumber = (value) => (value === null || value === undefined ? null : Number(value))
const filterValue = (value, codes) => (!value || value === 'all' ? undefined : codes?.[value] ?? value)

/* ------------------------------------------------------------------ */
/* API -> UI shapes                                                    */
/* ------------------------------------------------------------------ */

const toPolicySnapshot = (policy) => ({
  id: policy.policy_number,
  productId: policy.product_code,
  productName: policy.product_name,
  type: TYPE_LABELS[policy.product_type] ?? policy.product_type,
  status: policy.status,
  policyholderName: policy.policyholder_name,
  customerId: policy.customer_code,
  startDate: policy.start_date,
  endDate: policy.end_date,
  durationYears: policy.term_years,
})

const toSummary = (summary, policyNumber) => {
  const ref = (item) => (item ? buildInstallmentId(policyNumber, item.installment_number) : null)
  return {
    totalInstallments: summary.installment_count,
    counts: {
      paid: summary.counts.paid,
      due: summary.counts.due,
      upcoming: summary.counts.upcoming,
      overdue: summary.counts.overdue,
    },
    partiallyPaidCount: summary.counts.partially_paid,
    totalPremium: toNumber(summary.total_premium),
    totalPaid: toNumber(summary.total_paid),
    outstanding: toNumber(summary.outstanding),
    overdueAmount: toNumber(summary.overdue_amount),
    dueAmount: toNumber(summary.due_amount),
    upcomingAmount: toNumber(summary.upcoming_amount),
    payableNow: toNumber(summary.payable_now),
    nextDueAmount: toNumber(summary.next_due?.amount_outstanding) ?? 0,
    nextDueDate: summary.next_due?.due_date ?? null,
    nextDueInstallmentId: ref(summary.next_due),
    nextDueStatus: null,
    oldestOverdueDate: summary.oldest_overdue?.due_date ?? null,
    oldestOverdueInstallmentId: ref(summary.oldest_overdue),
    oldestOverdueDays: summary.oldest_overdue_days,
    paidRatio: summary.installment_count ? summary.counts.paid / summary.installment_count : 0,
    standing: STANDING_LABELS[summary.standing] ?? summary.standing,
  }
}

/** Screen status: paid / overdue come from the API; otherwise DUE once payable-from has arrived. */
const displayStatus = (installment, asOf) => {
  if (installment.status === 'paid') return INSTALLMENT_STATUS.PAID
  if (installment.status === 'overdue') return INSTALLMENT_STATUS.OVERDUE
  return asOf >= installment.payable_from ? INSTALLMENT_STATUS.DUE : INSTALLMENT_STATUS.UPCOMING
}

const toInstallment = (installment, asOf) => {
  const status = displayStatus(installment, asOf)
  const daysUntilDue = daysBetween(asOf, installment.due_date)
  return {
    id: installment.id,
    installmentId: buildInstallmentId(installment.policy_number, installment.installment_number),
    policyId: installment.policy_number,
    installmentNumber: installment.installment_number,
    dueDate: installment.due_date,
    // `amount` is the instalment's full amount; `outstanding` what is still owed.
    amount: toNumber(installment.amount_due),
    amountPaid: toNumber(installment.amount_paid),
    outstanding: toNumber(installment.amount_outstanding),
    isPartiallyPaid: status !== INSTALLMENT_STATUS.PAID && Number(installment.amount_paid) > 0,
    status,
    paidDate: status === INSTALLMENT_STATUS.PAID ? installment.last_paid_at?.slice(0, 10) ?? null : null,
    // Latest successful payment: the one a paid instalment links to.
    paymentId: installment.last_payment_number,
    pendingPaymentId: installment.pending_payment_number,
    failedAttempts: installment.failed_attempts,
    daysOverdue: status === INSTALLMENT_STATUS.OVERDUE ? Math.abs(daysUntilDue ?? 0) : 0,
    daysUntilDue: status === INSTALLMENT_STATUS.PAID ? null : daysUntilDue,
  }
}

const toAccount = (schedule) => ({
  scheduleId: `SCH-${schedule.policy.policy_number.replace(/^POL-/, '')}`,
  policyId: schedule.policy.policy_number,
  premiumAmount: toNumber(schedule.regular_installment_amount),
  annualPremium: toNumber(schedule.annual_premium),
  frequency: FREQUENCY_LABELS[schedule.frequency] ?? schedule.frequency,
  startDate: schedule.policy.start_date,
  endDate: schedule.policy.end_date,
  totalInstallments: schedule.installment_count,
  policy: toPolicySnapshot(schedule.policy),
  isOrphaned: false,
  summary: toSummary(schedule.summary, schedule.policy.policy_number),
  asOf: schedule.as_of,
})

const toPayment = (payment) => ({
  paymentId: payment.payment_number,
  policyId: payment.policy_number,
  installmentId: buildInstallmentId(payment.policy_number, payment.installment_number),
  installmentNumber: payment.installment_number,
  amount: toNumber(payment.amount),
  paymentDate: payment.paid_at.slice(0, 10),
  paidAt: payment.paid_at,
  paymentMethod: METHOD_LABELS[payment.payment_method] ?? payment.payment_method,
  status: PAYMENT_STATUS_LABELS[payment.status] ?? payment.status,
  transactionReference: payment.payment_reference,
  failureReason: payment.failure_reason,
  policyholderName: payment.policyholder_name,
  customerId: payment.customer_code,
  productName: payment.product_name,
  policyExists: true,
  isMock: false,
})

const toPortfolio = (portfolio) => ({
  policies: portfolio.policies,
  totalPaid: toNumber(portfolio.total_paid),
  paidCount: portfolio.paid_count,
  dueAmount: toNumber(portfolio.due_amount),
  dueCount: portfolio.due_count,
  overdueAmount: toNumber(portfolio.overdue_amount),
  overdueCount: portfolio.overdue_count,
  upcomingAmount: toNumber(portfolio.upcoming_amount),
  upcomingCount: portfolio.upcoming_count,
  payableNow: toNumber(portfolio.payable_now),
  policiesOverdue: portfolio.policies_overdue,
})

const toPaymentSummary = (summary) => ({
  total: summary.total,
  success: summary.successful,
  failed: summary.failed,
  pending: summary.pending,
  collected: toNumber(summary.collected),
})

/* ------------------------------------------------------------------ */
/* Public API (same names and shapes the Module 2 screens already use) */
/* ------------------------------------------------------------------ */

/**
 * Premium accounts in the signed-in account's scope, plus portfolio totals.
 *
 * @param {{search?: string, standing?: string, sort?: string}} query
 */
export const getPremiumSchedules = async (query = {}) => {
  const response = await authApi.get(ENDPOINTS.premiumSchedules, {
    params: {
      search: query.search?.trim() || undefined,
      standing: filterValue(query.standing, STANDING_CODES),
      sort: query.sort,
      limit: LIST_LIMIT,
    },
  })
  return {
    items: response.items.map(toAccount),
    total: response.total,
    portfolio: toPortfolio(response.portfolio),
    awaitingIssuance: response.awaiting_issuance,
    asOf: response.as_of,
  }
}

/**
 * Full premium account for one policy: instalments, summary and payments.
 * Rejects with 404 (unknown or out of scope) or 409 (policy not issued yet).
 */
export const getPremiumScheduleByPolicyId = async (policyId) => {
  const [schedule, installments, payments] = await Promise.all([
    authApi.get(ENDPOINTS.premiumScheduleByPolicyId(policyId)),
    authApi.get(ENDPOINTS.policyInstallments(policyId)),
    authApi.get(ENDPOINTS.payments, { params: { policy_number: policyId, limit: LIST_LIMIT } }),
  ])
  return {
    ...toAccount(schedule),
    installments: installments.items.map((item) => toInstallment(item, installments.as_of)),
    payments: payments.items.map(toPayment),
  }
}

/**
 * Payment history in scope, searchable and filterable.
 *
 * @param {{search?: string, status?: string, method?: string, sort?: string}} query
 */
export const getPayments = async (query = {}) => {
  const response = await authApi.get(ENDPOINTS.payments, {
    params: {
      search: query.search?.trim() || undefined,
      status: filterValue(query.status, PAYMENT_STATUS_CODES),
      method: filterValue(query.method, METHOD_CODES),
      sort: query.sort,
      limit: LIST_LIMIT,
    },
  })
  return {
    items: response.items.map(toPayment),
    total: response.total,
    summary: toPaymentSummary(response.summary),
  }
}

/** One payment with the instalment it was applied to, in its current state. */
export const getPaymentById = async (paymentId) => {
  try {
    const payment = await authApi.get(ENDPOINTS.paymentById(paymentId))
    const [installment, schedule] = await Promise.all([
      authApi.get(ENDPOINTS.installmentById(payment.installment_id)),
      authApi.get(ENDPOINTS.premiumScheduleByPolicyId(payment.policy_number)),
    ])
    return {
      payment: toPayment(payment),
      installment: toInstallment(installment, schedule.as_of),
      policy: toPolicySnapshot(schedule.policy),
      isOrphaned: false,
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(`No payment found for "${paymentId}".`, {
        status: 404,
        data: { ...error.data, reason: 'payment-not-found', paymentId },
      })
    }
    throw error
  }
}

/** A new reference for each payment attempt (retrying the same attempt reuses it). */
export const createPaymentReference = () =>
  `PAY-REF-${crypto.randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase()}`

/**
 * Record a payment attempt. The backend locks the instalment, validates the
 * amount against the remaining balance and records the attempt atomically.
 *
 * @param {{installment: object, amount: number|string, method: string,
 *          outcome?: string, reference: string, account?: object}} request
 * @returns {Promise<{payment: object, installment: object, account: object, previousSummary: object|null}>}
 */
export const recordPayment = async ({
  installment,
  amount,
  method,
  outcome = PAYMENT_OUTCOMES.APPROVE,
  reference,
  account = null,
}) => {
  const response = await authApi.post(ENDPOINTS.installmentPayments(installment.id), {
    amount: String(amount),
    payment_method: METHOD_CODES[method] ?? method,
    payment_reference: reference,
    outcome,
  })
  const schedule = await authApi.get(ENDPOINTS.premiumScheduleByPolicyId(response.installment.policy_number))

  return {
    payment: toPayment(response.payment),
    installment: toInstallment(response.installment, schedule.as_of),
    account: toAccount(schedule),
    previousSummary: account?.summary ?? null,
  }
}

export default {
  getPremiumSchedules,
  getPremiumScheduleByPolicyId,
  getPayments,
  getPaymentById,
  recordPayment,
  createPaymentReference,
}
