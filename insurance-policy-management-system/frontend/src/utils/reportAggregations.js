/**
 * MIS Reports — report aggregation (pure).
 *
 * These builders take records that the Module 1–5 services have already
 * derived and turn them into management figures. They deliberately REUSE the
 * existing domain summaries rather than restating a business rule:
 *
 *   claims      summariseClaims            (Module 3)
 *   payments    summarisePayments          (Module 2)
 *   premium     calculatePortfolioSummary  (Module 2)
 *   renewals    summariseRenewals          (Module 4)
 *   commission  summariseCommissions       (Module 5)
 *
 * So "paid", "overdue", "open claim", "due soon" and "earned" mean exactly
 * what they mean everywhere else in the application. What is added here is
 * only counting, grouping, summing and period scoping.
 *
 * Nothing reads the clock: every builder is given its resolved range.
 */

import { summariseClaims } from './claimQuery'
import { sumAmounts } from './commissionCalculation'
import { summariseCommissions } from './commissionSummary'
import { calculatePortfolioSummary } from './premiumCalculations'
import { summarisePayments } from './premiumQuery'
import { getStageDefinition, summariseRenewals } from './renewalEngine'
import { partitionByDate } from './reportDateRange'
import {
  CLAIM_STATUS,
  CLAIM_STATUS_LABELS,
  COMMISSION_STATUS_LABELS,
  INSTALLMENT_STATUS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  POLICY_STATUS,
  RENEWAL_STATUS_LABELS,
  RENEWAL_READINESS_LABELS,
} from './constants'
import { titleCase } from './formatters'

/* ------------------------------------------------------------------ */
/* Grouping helpers                                                    */
/* ------------------------------------------------------------------ */

/** Policy lifecycle labels, so a distribution never shows a raw status value. */
const POLICY_STATUS_LABELS = {
  [POLICY_STATUS.ACTIVE]: 'Active',
  [POLICY_STATUS.PENDING]: 'Pending',
  [POLICY_STATUS.EXPIRED]: 'Expired',
  [POLICY_STATUS.LAPSED]: 'Lapsed',
}

const share = (count, total) => (total > 0 ? Math.round((count / total) * 1000) / 10 : 0)

/**
 * Count rows per key, largest first.
 *
 * @param {object[]} rows
 * @param {string} keyField
 * @param {{labelField?: string, labels?: Record<string, string>, amountField?: string}} options
 * @returns {{key: string, label: string, count: number, share: number, amount?: number}[]}
 */
export const distribution = (rows = [], keyField, { labelField, labels, amountField } = {}) => {
  const groups = new Map()

  for (const row of rows) {
    const key = row[keyField] ?? 'unknown'
    if (!groups.has(key)) {
      groups.set(key, { key, label: labels?.[key] ?? row[labelField ?? keyField] ?? titleCase(String(key)), rows: [] })
    }
    groups.get(key).rows.push(row)
  }

  return [...groups.values()]
    .map((group) => ({
      key: group.key,
      label: group.label,
      count: group.rows.length,
      share: share(group.rows.length, rows.length),
      ...(amountField ? { amount: sumAmounts(group.rows.map((row) => Number(row[amountField]) || 0)) } : {}),
    }))
    .sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)))
}

/** A distribution over a fixed set of counted statuses (so zeroes still show). */
export const distributionFromCounts = (counts, labels, total) =>
  Object.entries(counts)
    .map(([key, count]) => ({ key, label: labels[key] ?? titleCase(key), count, share: share(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

const sumField = (rows, field) => sumAmounts(rows.map((row) => Number(row[field]) || 0))

const excluded = (undated, reason) => ({ count: undated.length, reason, ids: undated.map((row) => row.id ?? row.reference ?? null) })

/* ------------------------------------------------------------------ */
/* A. Policy report                                                    */
/* ------------------------------------------------------------------ */

/**
 * Policies issued inside the period, with the premium position Module 2
 * already calculated for each one.
 *
 * @param {{policies: object[], accountsByPolicy: Map<string, object>, range: object}} input
 */
export const buildPolicyReport = ({ policies = [], accountsByPolicy = new Map(), range }) => {
  const { inRange, undated } = partitionByDate(policies, (policy) => policy.issueDate, range)

  const rows = inRange.map((policy) => {
    const account = accountsByPolicy.get(policy.id) ?? null
    return {
      id: policy.id,
      policyId: policy.id,
      productId: policy.productId,
      productName: policy.productName,
      type: policy.type,
      status: policy.status,
      policyholderName: policy.policyholder?.name ?? null,
      agentId: policy.agent?.id ?? null,
      agentName: policy.agent?.name ?? null,
      issueDate: policy.issueDate,
      startDate: policy.startDate,
      endDate: policy.endDate,
      coverageAmount: Number(policy.coverageAmount) || 0,
      premium: Number(policy.premium) || 0,
      premiumFrequency: policy.premiumFrequency,
      scheduleTotal: account ? account.summary.totalPremium : null,
      paidAmount: account ? account.summary.totalPaid : null,
      outstandingAmount: account ? account.summary.outstanding : null,
    }
  })

  const countStatus = (status) => rows.filter((row) => row.status === status).length

  return {
    rows,
    metrics: {
      total: rows.length,
      active: countStatus(POLICY_STATUS.ACTIVE),
      expired: countStatus(POLICY_STATUS.EXPIRED),
      lapsed: countStatus(POLICY_STATUS.LAPSED),
      pending: countStatus(POLICY_STATUS.PENDING),
      coverageTotal: sumField(rows, 'coverageAmount'),
      scheduledPremium: sumField(rows, 'scheduleTotal'),
      premiumCollected: sumField(rows, 'paidAmount'),
      premiumOutstanding: sumField(rows, 'outstandingAmount'),
    },
    distributions: {
      byProduct: distribution(rows, 'productId', { labelField: 'productName' }),
      byStatus: distribution(rows, 'status', { labels: POLICY_STATUS_LABELS }),
      byType: distribution(rows, 'type'),
    },
    excluded: excluded(undated, 'Not yet issued, so the policy has no issue date to report in a period.'),
  }
}

/* ------------------------------------------------------------------ */
/* B. Premium & payment report                                         */
/* ------------------------------------------------------------------ */

const INSTALLMENT_LABELS = {
  [INSTALLMENT_STATUS.PAID]: 'Paid',
  [INSTALLMENT_STATUS.OVERDUE]: 'Overdue',
  [INSTALLMENT_STATUS.DUE]: 'Due',
  [INSTALLMENT_STATUS.UPCOMING]: 'Upcoming',
}

const PAYMENT_STATUS_LABELS = {
  [PAYMENT_STATUS.SUCCESS]: 'Successful',
  [PAYMENT_STATUS.FAILED]: 'Failed',
  [PAYMENT_STATUS.PENDING]: 'Pending',
}

/**
 * Two things a premium report must keep apart:
 *   position  the premium book as it stands today (Module 2 portfolio totals)
 *   activity  the payments actually recorded inside the reporting period
 *
 * @param {{accounts: object[], payments: object[], range: object}} input
 */
export const buildPremiumReport = ({ accounts = [], payments = [], range }) => {
  const portfolio = calculatePortfolioSummary(accounts)
  const totalPremium = sumAmounts(accounts.map((account) => account.summary.totalPremium))

  const { inRange, undated } = partitionByDate(payments, (payment) => payment.paymentDate, range)

  const rows = inRange.map((payment) => ({
    id: payment.paymentId,
    paymentId: payment.paymentId,
    policyId: payment.policyId,
    policyholderName: payment.policyholderName,
    productName: payment.productName,
    installmentId: payment.installmentId,
    paymentDate: payment.paymentDate,
    method: payment.paymentMethod,
    methodLabel: PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod,
    status: payment.status,
    statusLabel: PAYMENT_STATUS_LABELS[payment.status] ?? payment.status,
    amount: Number(payment.amount) || 0,
    transactionReference: payment.transactionReference,
  }))

  const instalmentCounts = {
    [INSTALLMENT_STATUS.PAID]: portfolio.paidCount,
    [INSTALLMENT_STATUS.OVERDUE]: portfolio.overdueCount,
    [INSTALLMENT_STATUS.DUE]: portfolio.dueCount,
    [INSTALLMENT_STATUS.UPCOMING]: portfolio.upcomingCount,
  }
  const instalmentTotal = Object.values(instalmentCounts).reduce((total, count) => total + count, 0)

  return {
    rows,
    position: {
      policies: portfolio.policies,
      totalPremium,
      paidAmount: portfolio.totalPaid,
      outstandingAmount: sumAmounts([totalPremium, -portfolio.totalPaid]),
      dueAmount: portfolio.dueAmount,
      overdueAmount: portfolio.overdueAmount,
      upcomingAmount: portfolio.upcomingAmount,
      payableNow: portfolio.payableNow,
      policiesOverdue: portfolio.policiesOverdue,
      counts: instalmentCounts,
    },
    activity: {
      ...summarisePayments(inRange),
      attempted: inRange.length,
      byStatus: distribution(rows, 'status', { labels: PAYMENT_STATUS_LABELS, amountField: 'amount' }),
      byMethod: distribution(rows, 'method', { labelField: 'methodLabel', amountField: 'amount' }),
      byProduct: distribution(rows, 'productName', { amountField: 'amount' }),
    },
    distributions: {
      byInstalmentStatus: distributionFromCounts(instalmentCounts, INSTALLMENT_LABELS, instalmentTotal),
    },
    excluded: excluded(undated, 'The payment has no payment date.'),
  }
}

/* ------------------------------------------------------------------ */
/* C. Claims report                                                    */
/* ------------------------------------------------------------------ */

/** `summariseClaims` key → the Module 3 status it counts. */
const CLAIM_SUMMARY_KEYS = {
  draft: CLAIM_STATUS.DRAFT,
  submitted: CLAIM_STATUS.SUBMITTED,
  underReview: CLAIM_STATUS.UNDER_REVIEW,
  verified: CLAIM_STATUS.VERIFIED,
  assessed: CLAIM_STATUS.ASSESSED,
  approved: CLAIM_STATUS.APPROVED,
  rejected: CLAIM_STATUS.REJECTED,
  settled: CLAIM_STATUS.SETTLED,
  cancelled: CLAIM_STATUS.CANCELLED,
}

/** Claims filed inside the period, counted through Module 3's own workflow states. */
export const buildClaimsReport = ({ claims = [], range }) => {
  const { inRange, undated } = partitionByDate(claims, (claim) => claim.filingDate, range)

  const rows = inRange.map((claim) => ({
    id: claim.claimId,
    claimId: claim.claimId,
    policyId: claim.policyId,
    policyholderName: claim.policyholderName,
    productName: claim.productName,
    claimType: claim.claimType,
    claimTypeLabel: claim.claimTypeLabel,
    incidentDate: claim.incidentDate,
    filingDate: claim.filingDate,
    status: claim.status,
    statusLabel: CLAIM_STATUS_LABELS[claim.status] ?? claim.status,
    claimedAmount: Number(claim.claimedAmount) || 0,
    approvedAmount: Number(claim.approvedAmount) || 0,
    updatedAt: claim.updatedAt,
  }))

  const summary = summariseClaims(inRange)
  const settled = rows.filter((row) => row.status === CLAIM_STATUS.SETTLED)
  const approved = rows.filter((row) => [CLAIM_STATUS.APPROVED, CLAIM_STATUS.SETTLED].includes(row.status))

  // `summariseClaims` counts by camelCase key; the distribution is labelled
  // with the workflow's own status labels, and keeps states with no claims.
  const statusCounts = Object.fromEntries(
    Object.entries(CLAIM_SUMMARY_KEYS).map(([summaryKey, status]) => [status, summary[summaryKey]]),
  )

  return {
    rows,
    metrics: {
      ...summary,
      claimedAmount: sumField(rows, 'claimedAmount'),
      approvedAmount: sumField(approved, 'approvedAmount'),
      settledAmount: sumField(settled, 'approvedAmount'),
      closed: summary.total - summary.open,
    },
    distributions: {
      byStatus: distributionFromCounts(statusCounts, CLAIM_STATUS_LABELS, summary.total),
      byType: distribution(rows, 'claimType', { labelField: 'claimTypeLabel', amountField: 'claimedAmount' }),
      byProduct: distribution(rows, 'productName', { amountField: 'claimedAmount' }),
    },
    excluded: excluded(undated, 'The claim has no filing date.'),
  }
}

/* ------------------------------------------------------------------ */
/* D. Renewal report                                                   */
/* ------------------------------------------------------------------ */

const REMINDER_STATUS_LABELS = { sent: 'Sent', failed: 'Failed', skipped: 'Skipped' }

/**
 * The renewal pipeline is a position, not a period: it describes where every
 * policy stands today. The reporting period is applied only to reminder
 * activity, which is genuinely dated.
 *
 * @param {{accounts: object[], reminders: object[], range: object}} input
 */
export const buildRenewalReport = ({ accounts = [], reminders = [], range }) => {
  const rows = accounts.map((account) => ({
    id: account.policyId,
    policyId: account.policyId,
    productId: account.policy?.productId ?? null,
    productName: account.policy?.productName ?? null,
    policyholderName: account.policy?.policyholderName ?? null,
    agentName: account.policy?.agentName ?? null,
    endDate: account.policy?.endDate ?? null,
    daysUntilExpiry: account.daysUntilExpiry,
    status: account.status,
    statusLabel: RENEWAL_STATUS_LABELS[account.status] ?? account.status,
    eligible: account.eligibility?.eligible ?? false,
    readiness: account.readiness?.verdict ?? null,
    readinessLabel: RENEWAL_READINESS_LABELS[account.readiness?.verdict] ?? null,
    currentStage: account.plan?.currentStage?.label ?? null,
    pendingAction: account.plan?.pendingAction ?? null,
    premiumStanding: account.premiumStanding,
    lastReminderOn: account.lastReminder?.evaluatedAsOf ?? null,
  }))

  const { inRange, undated } = partitionByDate(reminders, (reminder) => reminder.evaluatedAsOf, range)

  const reminderRows = inRange.map((reminder) => ({
    id: reminder.reminderId,
    reminderId: reminder.reminderId,
    policyId: reminder.policyId,
    stage: reminder.stage,
    stageLabel: getStageDefinition(reminder.stage)?.shortLabel ?? reminder.stage,
    channel: reminder.channel,
    status: reminder.status,
    evaluatedAsOf: reminder.evaluatedAsOf,
    trigger: reminder.trigger,
  }))

  return {
    rows,
    pipeline: summariseRenewals(accounts),
    reminderActivity: {
      total: reminderRows.length,
      sent: reminderRows.filter((row) => row.status === 'sent').length,
      failed: reminderRows.filter((row) => row.status === 'failed').length,
      skipped: reminderRows.filter((row) => row.status === 'skipped').length,
      policies: new Set(reminderRows.map((row) => row.policyId)).size,
      byStatus: distribution(reminderRows, 'status', { labels: REMINDER_STATUS_LABELS }),
      byStage: distribution(reminderRows, 'stage', { labelField: 'stageLabel' }),
    },
    distributions: {
      byStatus: distribution(rows, 'status', { labelField: 'statusLabel' }),
      byReadiness: distribution(rows, 'readiness', { labelField: 'readinessLabel' }),
      byProduct: distribution(rows, 'productName'),
    },
    excluded: excluded(undated, 'The reminder has no evaluation date.'),
  }
}

/* ------------------------------------------------------------------ */
/* E. Agent commission report                                          */
/* ------------------------------------------------------------------ */

/**
 * Commission generated inside the period. Status totals come from Module 5's
 * own summary, which replays each commission's audit events.
 *
 * @param {{commissions: object[], range: object}} input
 */
export const buildCommissionReport = ({ commissions = [], range }) => {
  const { inRange, undated } = partitionByDate(commissions, (item) => String(item.generatedAt ?? '').slice(0, 10), range)

  const rows = inRange.map((item) => ({
    id: item.commissionId,
    commissionId: item.commissionId,
    agentId: item.agentId,
    agentName: item.agentName,
    policyId: item.policyId,
    productId: item.productId,
    productName: item.productName,
    policyholderName: item.policyholderName,
    paymentId: item.paymentId,
    paymentDate: item.paymentDate,
    basis: item.basis,
    basisLabel: item.basisLabel,
    ratePercent: item.ratePercent,
    commissionableAmount: item.commissionableAmount,
    amount: item.amount,
    status: item.status,
    statusLabel: item.statusLabel,
    generatedOn: String(item.generatedAt ?? '').slice(0, 10),
  }))

  const groupSummary = (keyField, labelField) =>
    [...new Set(rows.map((row) => row[keyField]))]
      .filter(Boolean)
      .map((key) => {
        const group = rows.filter((row) => row[keyField] === key)
        return { key, label: group[0][labelField] ?? key, ...summariseCommissions(group) }
      })
      .sort((a, b) => b.total - a.total || String(a.label).localeCompare(String(b.label)))

  return {
    rows,
    metrics: summariseCommissions(rows),
    byAgent: groupSummary('agentId', 'agentName'),
    byProduct: groupSummary('productId', 'productName'),
    distributions: {
      byStatus: distribution(rows, 'status', { labels: COMMISSION_STATUS_LABELS, amountField: 'amount' }),
      byAgent: distribution(rows, 'agentId', { labelField: 'agentName', amountField: 'amount' }),
      byProduct: distribution(rows, 'productId', { labelField: 'productName', amountField: 'amount' }),
    },
    excluded: excluded(undated, 'The commission has no generation date.'),
  }
}
