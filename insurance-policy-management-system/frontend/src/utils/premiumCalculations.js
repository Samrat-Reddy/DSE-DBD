/**
 * Premium schedule domain logic — pure functions only.
 *
 * Nothing here reads storage, the clock, or React state. Every time-dependent
 * function takes an explicit `asOf` date, which keeps the rules deterministic
 * and unit-testable, and lets the backend supply its own "as of" date later.
 *
 * Terminology:
 *   header       premium terms of one policy (`premiumSchedules.js`)
 *   instalment   one scheduled premium within that header
 *   payment      one attempt to pay an instalment (`payments.js`)
 *   standing     policy-level summary of its instalments (OVERDUE, DUE, …)
 *
 * Policy status (ACTIVE, EXPIRED, …) is deliberately NOT derived here. An
 * unpaid instalment never changes the policy status.
 */

import {
  DUE_WINDOW_DAYS,
  FREQUENCY_INSTALMENTS_PER_YEAR,
  INSTALLMENT_STATUS,
  PAYMENT_STANDING,
  PAYMENT_STATUS,
  POLICY_STATUS,
} from './constants'
import { addMonthsIso, compareIsoDates, daysBetween } from './dateUtils'
import { calculateEndDate } from './policyPricing'

const sumAmounts = (items) =>
  items.reduce((total, item) => total + (Number(item.amount) || 0), 0)

const byStatus = (installments, status) =>
  installments.filter((installment) => installment.status === status)

const byDueDate = (a, b) => compareIsoDates(a.dueDate, b.dueDate)

/** Chronological copy of a list of instalments. */
export const sortInstallmentsByDueDate = (installments) => [...installments].sort(byDueDate)

/* ------------------------------------------------------------------ */
/* Schedule construction                                               */
/* ------------------------------------------------------------------ */

/** `POL-2024-000226`, 9 → `INS-2024-000226-009`. */
export const buildInstallmentId = (policyId, installmentNumber) =>
  `INS-${String(policyId).replace(/^POL-/, '')}-${String(installmentNumber).padStart(3, '0')}`

export const buildScheduleId = (policyId) =>
  `SCH-${String(policyId).replace(/^POL-/, '')}`

/** Months between consecutive instalments for a premium frequency. */
export const monthsBetweenInstallments = (frequency) => {
  const perYear = FREQUENCY_INSTALMENTS_PER_YEAR[frequency]
  return perYear ? 12 / perYear : null
}

/**
 * Generate the instalments of a schedule header.
 *
 * Each due date is calculated from the start date (not from the previous
 * instalment), so month-end clamping never accumulates drift.
 */
export const generateInstallments = (header) => {
  const step = monthsBetweenInstallments(header?.frequency)
  const count = Number(header?.totalInstallments) || 0

  if (!step || !header?.startDate || count <= 0) return []

  return Array.from({ length: count }, (_, index) => ({
    installmentId: buildInstallmentId(header.policyId, index + 1),
    scheduleId: header.scheduleId,
    policyId: header.policyId,
    installmentNumber: index + 1,
    dueDate: addMonthsIso(header.startDate, index * step),
    amount: Number(header.premiumAmount) || 0,
  }))
}

/** A premium schedule exists only for a policy that has been issued. */
export const isPolicyScheduleEligible = (policy) =>
  Boolean(policy) && Boolean(policy.issueDate) && policy.status !== POLICY_STATUS.PENDING

/**
 * Derive a schedule header from an issued policy.
 *
 * Used for policies issued in the browser session through Module 1, which
 * have no seeded header. Returns `null` for policies that are not issued.
 */
export const buildScheduleHeaderFromPolicy = (policy) => {
  if (!isPolicyScheduleEligible(policy)) return null

  const perYear = FREQUENCY_INSTALMENTS_PER_YEAR[policy.premiumFrequency]
  const durationYears = Number(policy.durationYears)
  if (!perYear || !durationYears) return null

  return {
    scheduleId: buildScheduleId(policy.id),
    policyId: policy.id,
    premiumAmount: Number(policy.premium) || 0,
    frequency: policy.premiumFrequency,
    startDate: policy.startDate,
    endDate: policy.endDate ?? calculateEndDate(policy.startDate, durationYears),
    totalInstallments: perYear * durationYears,
  }
}

/* ------------------------------------------------------------------ */
/* Status resolution                                                   */
/* ------------------------------------------------------------------ */

/**
 * Time-based status of one instalment.
 *
 *   PAID      a successful payment exists
 *   OVERDUE   unpaid and the due date has passed
 *   DUE       unpaid and due within DUE_WINDOW_DAYS (including today)
 *   UPCOMING  unpaid and due later than that
 */
export const resolveInstallmentStatus = (dueDate, successfulPayment, asOf) => {
  if (successfulPayment) return INSTALLMENT_STATUS.PAID

  const daysUntilDue = daysBetween(asOf, dueDate)
  if (daysUntilDue === null) return INSTALLMENT_STATUS.UPCOMING
  if (daysUntilDue < 0) return INSTALLMENT_STATUS.OVERDUE
  if (daysUntilDue <= DUE_WINDOW_DAYS) return INSTALLMENT_STATUS.DUE
  return INSTALLMENT_STATUS.UPCOMING
}

/**
 * Join instalments with their payment attempts and resolve their status.
 *
 * @param {Array} installments Output of `generateInstallments`.
 * @param {Array} payments All payment records (any policy).
 * @param {string} asOf ISO date the statuses are evaluated against.
 */
export const resolveInstallments = (installments, payments, asOf) => {
  const attemptsByInstallment = new Map()

  for (const payment of payments) {
    const attempts = attemptsByInstallment.get(payment.installmentId) ?? []
    attempts.push(payment)
    attemptsByInstallment.set(payment.installmentId, attempts)
  }

  return installments.map((installment) => {
    const attempts = attemptsByInstallment.get(installment.installmentId) ?? []
    const successful = attempts.find((p) => p.status === PAYMENT_STATUS.SUCCESS) ?? null
    const pending = attempts.find((p) => p.status === PAYMENT_STATUS.PENDING) ?? null
    const status = resolveInstallmentStatus(installment.dueDate, successful, asOf)
    const daysUntilDue = daysBetween(asOf, installment.dueDate)

    return {
      ...installment,
      status,
      paidDate: successful?.paymentDate ?? null,
      paymentId: successful?.paymentId ?? null,
      pendingPaymentId: pending?.paymentId ?? null,
      failedAttempts: attempts.filter((p) => p.status === PAYMENT_STATUS.FAILED).length,
      daysOverdue: status === INSTALLMENT_STATUS.OVERDUE ? Math.abs(daysUntilDue) : 0,
      daysUntilDue: status === INSTALLMENT_STATUS.PAID ? null : daysUntilDue,
    }
  })
}

/* ------------------------------------------------------------------ */
/* Financial calculations                                              */
/* ------------------------------------------------------------------ */

/** Total premium payable over the full term. */
export const calculateTotalPremium = (installments) => sumAmounts(installments)

export const calculateTotalPaid = (installments) =>
  sumAmounts(byStatus(installments, INSTALLMENT_STATUS.PAID))

/** Remaining unpaid premium over the rest of the term. */
export const calculateOutstanding = (installments) =>
  calculateTotalPremium(installments) - calculateTotalPaid(installments)

export const calculateOverdueAmount = (installments) =>
  sumAmounts(byStatus(installments, INSTALLMENT_STATUS.OVERDUE))

export const calculateDueAmount = (installments) =>
  sumAmounts(byStatus(installments, INSTALLMENT_STATUS.DUE))

export const calculateUpcomingAmount = (installments) =>
  sumAmounts(byStatus(installments, INSTALLMENT_STATUS.UPCOMING))

/** Amount payable right now: everything DUE plus everything OVERDUE. */
export const calculatePayableNow = (installments) =>
  calculateDueAmount(installments) + calculateOverdueAmount(installments)

export const countInstallmentsByStatus = (installments) => ({
  paid: byStatus(installments, INSTALLMENT_STATUS.PAID).length,
  due: byStatus(installments, INSTALLMENT_STATUS.DUE).length,
  upcoming: byStatus(installments, INSTALLMENT_STATUS.UPCOMING).length,
  overdue: byStatus(installments, INSTALLMENT_STATUS.OVERDUE).length,
})

/** Earliest unpaid instalment — the next one the policyholder must pay. */
export const getNextDueInstallment = (installments) =>
  [...installments]
    .filter((installment) => installment.status !== INSTALLMENT_STATUS.PAID)
    .sort(byDueDate)[0] ?? null

export const getOldestOverdueInstallment = (installments) =>
  [...byStatus(installments, INSTALLMENT_STATUS.OVERDUE)].sort(byDueDate)[0] ?? null

/**
 * Instalments that can be paid now, oldest first. A PENDING payment blocks
 * the instalment so it cannot be paid twice.
 */
export const getPayableInstallments = (installments) =>
  installments
    .filter(
      (installment) =>
        (installment.status === INSTALLMENT_STATUS.DUE ||
          installment.status === INSTALLMENT_STATUS.OVERDUE) &&
        !installment.pendingPaymentId,
    )
    .sort(byDueDate)

/** Policy-level standing, used for filtering and badges. */
export const derivePaymentStanding = (counts) => {
  if (counts.overdue > 0) return PAYMENT_STANDING.OVERDUE
  if (counts.due > 0) return PAYMENT_STANDING.DUE
  if (counts.upcoming > 0) return PAYMENT_STANDING.UP_TO_DATE
  return PAYMENT_STANDING.FULLY_PAID
}

/** Everything the financial summary of one policy needs, in one pass. */
export const calculatePaymentSummary = (installments) => {
  const counts = countInstallmentsByStatus(installments)
  const next = getNextDueInstallment(installments)
  const oldestOverdue = getOldestOverdueInstallment(installments)
  const totalPremium = calculateTotalPremium(installments)
  const totalPaid = calculateTotalPaid(installments)

  return {
    totalInstallments: installments.length,
    counts,
    totalPremium,
    totalPaid,
    outstanding: totalPremium - totalPaid,
    overdueAmount: calculateOverdueAmount(installments),
    dueAmount: calculateDueAmount(installments),
    upcomingAmount: calculateUpcomingAmount(installments),
    payableNow: calculatePayableNow(installments),
    nextDueAmount: next?.amount ?? 0,
    nextDueDate: next?.dueDate ?? null,
    nextDueInstallmentId: next?.installmentId ?? null,
    nextDueStatus: next?.status ?? null,
    oldestOverdueDate: oldestOverdue?.dueDate ?? null,
    oldestOverdueInstallmentId: oldestOverdue?.installmentId ?? null,
    oldestOverdueDays: oldestOverdue?.daysOverdue ?? 0,
    paidRatio: installments.length ? counts.paid / installments.length : 0,
    standing: derivePaymentStanding(counts),
  }
}

/** Aggregate totals across many premium accounts for the overview page. */
export const calculatePortfolioSummary = (accounts) =>
  accounts.reduce(
    (portfolio, account) => {
      const { summary } = account
      return {
        policies: portfolio.policies + 1,
        totalPaid: portfolio.totalPaid + summary.totalPaid,
        paidCount: portfolio.paidCount + summary.counts.paid,
        dueAmount: portfolio.dueAmount + summary.dueAmount,
        dueCount: portfolio.dueCount + summary.counts.due,
        overdueAmount: portfolio.overdueAmount + summary.overdueAmount,
        overdueCount: portfolio.overdueCount + summary.counts.overdue,
        upcomingAmount: portfolio.upcomingAmount + summary.upcomingAmount,
        upcomingCount: portfolio.upcomingCount + summary.counts.upcoming,
        payableNow: portfolio.payableNow + summary.payableNow,
        policiesOverdue:
          portfolio.policiesOverdue + (summary.counts.overdue > 0 ? 1 : 0),
      }
    },
    {
      policies: 0,
      totalPaid: 0,
      paidCount: 0,
      dueAmount: 0,
      dueCount: 0,
      overdueAmount: 0,
      overdueCount: 0,
      upcomingAmount: 0,
      upcomingCount: 0,
      payableNow: 0,
      policiesOverdue: 0,
    },
  )

/* ------------------------------------------------------------------ */
/* Joining schedules with policies                                     */
/* ------------------------------------------------------------------ */

/** `INS-2024-000226-009` → 9. */
export const parseInstallmentNumber = (installmentId) => {
  const match = /-(\d{3})$/.exec(String(installmentId ?? ''))
  return match ? Number(match[1]) : null
}

/** The subset of a Module 1 policy that premium screens display. */
export const toPolicySnapshot = (policy) =>
  policy
    ? {
        id: policy.id,
        productId: policy.productId,
        productName: policy.productName,
        type: policy.type,
        status: policy.status,
        policyholderName: policy.policyholder?.name ?? null,
        customerId: policy.policyholder?.customerId ?? null,
        startDate: policy.startDate,
        endDate: policy.endDate,
        durationYears: policy.durationYears,
      }
    : null

/**
 * Assemble a premium account: header + resolved instalments + summary.
 *
 * `policy` may be `null` when the schedule's policy is missing from the
 * policy store. The account is then flagged `isOrphaned` instead of failing,
 * so the UI can explain the broken relationship.
 */
export const buildPremiumAccount = (header, policy, payments, asOf) => {
  const installments = resolveInstallments(generateInstallments(header), payments, asOf)

  return {
    ...header,
    policy: toPolicySnapshot(policy),
    isOrphaned: !policy,
    installments,
    summary: calculatePaymentSummary(installments),
    asOf,
  }
}

/**
 * Limit long schedules to the rows that matter now: every paid, overdue and
 * due instalment, plus the next few upcoming ones. Past rows are never
 * hidden — only far-future instalments are collapsed.
 */
export const selectVisibleInstallments = (installments, previewUpcoming) => {
  const sorted = [...installments].sort(byDueDate)
  let upcomingShown = 0

  const visible = sorted.filter((installment) => {
    if (installment.status !== INSTALLMENT_STATUS.UPCOMING) return true
    upcomingShown += 1
    return upcomingShown <= previewUpcoming
  })

  return { visible, hiddenCount: sorted.length - visible.length }
}
