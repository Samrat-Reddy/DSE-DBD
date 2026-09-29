/**
 * Pure search / filter / sort helpers for premium accounts and payments.
 *
 * Mirrors `policyQuery.js` from Module 1: the service layer applies these, so
 * they can later be replaced by FastAPI query parameters with no UI change.
 */

import { PAYMENT_STATUS } from './constants'
import { compareIsoDates } from './dateUtils'

const normalise = (value) => String(value ?? '').toLowerCase().trim()

const matchesAny = (fields, term) => {
  const query = normalise(term)
  if (!query) return true
  return fields.some((field) => normalise(field).includes(query))
}

const isAll = (value) => !value || value === 'all'

/* ------------------------------------------------------------------ */
/* Premium accounts (one per policy with a schedule)                   */
/* ------------------------------------------------------------------ */

/** Search policy number, policyholder name, customer ID and product. */
export const matchesPremiumAccountSearch = (account, term) =>
  matchesAny(
    [
      account.policyId,
      account.policy?.policyholderName,
      account.policy?.customerId,
      account.policy?.productName,
    ],
    term,
  )

export const matchesStanding = (account, standing) =>
  isAll(standing) || account.summary.standing === standing

/** Unknown dates sort last so "next due" ordering stays meaningful. */
const compareNullableDates = (a, b) => {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return compareIsoDates(a, b)
}

const ACCOUNT_SORTS = {
  'next-due-asc': (a, b) =>
    compareNullableDates(a.summary.nextDueDate, b.summary.nextDueDate),
  'overdue-desc': (a, b) => b.summary.overdueAmount - a.summary.overdueAmount,
  'outstanding-desc': (a, b) => b.summary.outstanding - a.summary.outstanding,
  'policy-asc': (a, b) => a.policyId.localeCompare(b.policyId),
  'policyholder-asc': (a, b) =>
    normalise(a.policy?.policyholderName).localeCompare(
      normalise(b.policy?.policyholderName),
    ),
}

export const queryPremiumAccounts = (accounts, query = {}) => {
  const { search, standing, sort } = query
  const filtered = accounts.filter(
    (account) =>
      matchesPremiumAccountSearch(account, search) && matchesStanding(account, standing),
  )
  const comparator = ACCOUNT_SORTS[sort]
  return comparator ? [...filtered].sort(comparator) : filtered
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

/** Search payment ID, policy, instalment, transaction reference, payer. */
export const matchesPaymentSearch = (payment, term) =>
  matchesAny(
    [
      payment.paymentId,
      payment.policyId,
      payment.installmentId,
      payment.transactionReference,
      payment.policyholderName,
      payment.productName,
    ],
    term,
  )

export const matchesPaymentStatus = (payment, status) =>
  isAll(status) || payment.status === status

export const matchesPaymentMethod = (payment, method) =>
  isAll(method) || payment.paymentMethod === method

const PAYMENT_SORTS = {
  // Date first, then the full timestamp or ID so same-day payments are stable.
  'date-desc': (a, b) =>
    compareIsoDates(b.paymentDate, a.paymentDate) ||
    String(b.paidAt ?? '').localeCompare(String(a.paidAt ?? '')) ||
    b.paymentId.localeCompare(a.paymentId),
  'date-asc': (a, b) =>
    compareIsoDates(a.paymentDate, b.paymentDate) ||
    String(a.paidAt ?? '').localeCompare(String(b.paidAt ?? '')) ||
    a.paymentId.localeCompare(b.paymentId),
  'amount-desc': (a, b) => b.amount - a.amount,
  'amount-asc': (a, b) => a.amount - b.amount,
}

export const queryPayments = (payments, query = {}) => {
  const { search, status, method, sort } = query
  const filtered = payments.filter(
    (payment) =>
      matchesPaymentSearch(payment, search) &&
      matchesPaymentStatus(payment, status) &&
      matchesPaymentMethod(payment, method),
  )
  const comparator = PAYMENT_SORTS[sort]
  return comparator ? [...filtered].sort(comparator) : filtered
}

/** Counts and collected total for the payment history header. */
export const summarisePayments = (payments) =>
  payments.reduce(
    (summary, payment) => ({
      total: summary.total + 1,
      success: summary.success + (payment.status === PAYMENT_STATUS.SUCCESS ? 1 : 0),
      failed: summary.failed + (payment.status === PAYMENT_STATUS.FAILED ? 1 : 0),
      pending: summary.pending + (payment.status === PAYMENT_STATUS.PENDING ? 1 : 0),
      collected:
        summary.collected +
        (payment.status === PAYMENT_STATUS.SUCCESS ? Number(payment.amount) || 0 : 0),
    }),
    { total: 0, success: 0, failed: 0, pending: 0, collected: 0 },
  )
