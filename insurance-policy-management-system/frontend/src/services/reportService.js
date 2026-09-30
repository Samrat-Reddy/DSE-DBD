/**
 * MIS Reports service (Module 6).
 *
 *   React  ->  reportService  ->  Module 1–5 services  ->  mock data / stores
 *
 * This service owns NO business data of its own. It asks the existing module
 * services for what they have already derived, applies the reporting period
 * and filters, and hands the result to the pure builders in
 * `utils/reportAggregations.js`. Every figure is therefore traceable to a
 * record in Modules 1–5 and to their definitions of paid, overdue, open,
 * due soon and earned. Nothing is invented and no history is simulated.
 *
 * Reports always read current session data: a policy issued, a payment made,
 * a claim moved or a commission paid in this browser session shows up in the
 * next report read.
 *
 * It is the enforcement boundary for report access: MIS Reports are
 * administrator-only, checked here on every call.
 *
 * Errors are `ApiError`s with a stable `data.reason`:
 *   403  unauthorized
 *   422  invalid-period
 */

import { ApiError } from './apiClient'
import { getAllPolicies } from './mockPolicyStore'
import { getPayments, getPremiumSchedules } from './mockPremiumLedger'
import { getClaims } from './mockClaimLedger'
import { getReminderRecords, getRenewalPolicies } from './renewalService'
import { getCommissions } from './commissionService'
import { checkReportAccess } from '../utils/reportAccess'
import {
  buildClaimsReport,
  buildCommissionReport,
  buildPolicyReport,
  buildPremiumReport,
  buildRenewalReport,
} from '../utils/reportAggregations'
import { boundRows, filterReportRows, optionsFromRows, sortReportRows } from '../utils/reportFilters'
import { describeRange, earliestDate, resolveReportPeriod } from '../utils/reportDateRange'
import { buildReportFilename } from '../utils/reportExport'
import { todayIso } from '../utils/dateUtils'
import { titleCase } from '../utils/formatters'
import {
  CLAIM_STATUS_OPTIONS,
  COMMISSION_STATUS_OPTIONS,
  DEFAULT_REPORT_QUERY,
  PAYMENT_STATUS_OPTIONS,
  POLICY_STATUS,
  REPORT_IDS,
  REPORT_ROW_LIMIT,
  REPORT_SORT_DIRECTIONS,
  RENEWAL_STATUS_OPTIONS,
  ROUTES,
} from '../utils/constants'

const MOCK_LATENCY_MS = 220

const withMockLatency = (value) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS)
  })

const clone = (value) => JSON.parse(JSON.stringify(value))

const requireAccess = (actor) => {
  const check = checkReportAccess(actor)
  if (!check.allowed) throw new ApiError(check.message, { status: 403, data: { reason: check.code } })
}

const invalidPeriod = (range) => {
  throw new ApiError(range.message, { status: 422, data: { reason: 'invalid-period', code: range.code } })
}

/** Resolve the reporting period against the dates actually present in the data. */
const resolveRange = (query, dates) => {
  const range = resolveReportPeriod({
    period: query.period ?? DEFAULT_REPORT_QUERY.period,
    from: query.from,
    to: query.to,
    today: todayIso(),
    earliest: earliestDate(dates),
  })
  if (!range.valid) invalidPeriod(range)
  return { ...range, description: describeRange(range) }
}

const matchesProduct = (value, productName) => value === 'all' || !value || productName === value

/** Rows → sorted, bounded table, with the sort the caller asked for. */
const buildTable = ({ columns, rows, query, defaultSort, searchFields, filters = {} }) => {
  const filtered = filterReportRows(rows, query, { searchFields, filters })
  const sortKey = query.sort || defaultSort
  const direction = query.direction === REPORT_SORT_DIRECTIONS.ASC ? REPORT_SORT_DIRECTIONS.ASC : REPORT_SORT_DIRECTIONS.DESC
  const sorted = sortReportRows(filtered, columns, sortKey, direction)
  const { rows: bounded, truncated } = boundRows(sorted, REPORT_ROW_LIMIT)

  return { columns, rows: bounded, total: filtered.length, truncated, sort: sortKey, direction, limit: REPORT_ROW_LIMIT }
}

const statusOptions = (values) => values.map((value) => ({ value, label: titleCase(value) }))

/* ------------------------------------------------------------------ */
/* Report definitions                                                  */
/* ------------------------------------------------------------------ */

export const REPORT_DEFINITIONS = [
  {
    id: REPORT_IDS.POLICIES,
    title: 'Policy report',
    description: 'Policies issued in the period, by product, status and type, with their premium position.',
    to: ROUTES.POLICY_REPORT,
    source: 'Module 1 · Policy Catalog & Issuance (with Module 2 premium accounts)',
    periodField: 'Issue date',
  },
  {
    id: REPORT_IDS.PREMIUMS,
    title: 'Premium & payment report',
    description: 'The premium book as it stands today, and the payments recorded in the period.',
    to: ROUTES.PREMIUM_REPORT,
    source: 'Module 2 · Premium Schedule & Payments',
    periodField: 'Payment date',
  },
  {
    id: REPORT_IDS.CLAIMS,
    title: 'Claims report',
    description: 'Claims filed in the period across the Module 3 workflow states, with claimed and approved amounts.',
    to: ROUTES.CLAIMS_REPORT,
    source: 'Module 3 · Claim Filing & Approval Workflow',
    periodField: 'Filing date',
  },
  {
    id: REPORT_IDS.RENEWALS,
    title: 'Renewal report',
    description: 'The renewal pipeline as it stands today, plus reminder activity inside the period.',
    to: ROUTES.RENEWAL_REPORT,
    source: 'Module 4 · Renewal Reminder Engine',
    periodField: 'Reminder date (pipeline is as of today)',
  },
  {
    id: REPORT_IDS.COMMISSIONS,
    title: 'Agent commission report',
    description: 'Commission generated in the period by agent, product and status.',
    to: ROUTES.COMMISSION_REPORT,
    source: 'Module 5 · Agent Commission',
    periodField: 'Generated date',
  },
]

/* ------------------------------------------------------------------ */
/* Shared loaders                                                      */
/* ------------------------------------------------------------------ */

/**
 * Module 6 is not migrated yet, so it keeps reading the Module 1 mock register
 * that Modules 2–5 also read. Its figures therefore stay consistent with their
 * mock schedules, payments and claims. It moves to the API in the MIS milestone.
 */
const getIssuedPolicies = async () => ({ items: JSON.parse(JSON.stringify(getAllPolicies())) })

const loadPolicyData = async () => {
  const [policies, schedules] = await Promise.all([getIssuedPolicies(), getPremiumSchedules()])
  const accountsByPolicy = new Map(schedules.items.map((account) => [account.policyId, account]))
  return { policies: policies.items, schedules, accountsByPolicy }
}

const productOptionsFrom = (policies) =>
  optionsFromRows(
    policies.map((policy) => ({ productName: policy.productName })),
    'productName',
  )

const meta = (id, range, query, extra = {}) => {
  const definition = REPORT_DEFINITIONS.find((item) => item.id === id)
  return {
    reportId: id,
    title: definition.title,
    description: definition.description,
    source: definition.source,
    periodField: definition.periodField,
    range,
    query: { ...DEFAULT_REPORT_QUERY, ...query },
    asOf: todayIso(),
    generatedAt: new Date().toISOString(),
    filename: buildReportFilename(id, range),
    ...extra,
  }
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

/**
 * Management summary across all five modules, plus the report index.
 * Every figure is the module's own summary, scoped by the period where the
 * underlying records are dated.
 */
export const getReportOverview = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.reportOverview, { params: query })
  requireAccess(actor)

  const [{ policies, schedules, accountsByPolicy }, payments, claims, renewals, commissions] = await Promise.all([
    loadPolicyData(),
    getPayments(),
    getClaims(),
    getRenewalPolicies(),
    getCommissions(actor),
  ])
  const reminders = getReminderRecords()

  const range = resolveRange(query, [
    ...policies.map((policy) => policy.issueDate),
    ...payments.items.map((payment) => payment.paymentDate),
    ...claims.items.map((claim) => claim.filingDate),
    ...commissions.items.map((item) => String(item.generatedAt ?? '').slice(0, 10)),
  ])

  const policyReport = buildPolicyReport({ policies, accountsByPolicy, range })
  const premiumReport = buildPremiumReport({ accounts: schedules.items, payments: payments.items, range })
  const claimsReport = buildClaimsReport({ claims: claims.items, range })
  const renewalReport = buildRenewalReport({ accounts: renewals.items, reminders, range })
  const commissionReport = buildCommissionReport({ commissions: commissions.items, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.POLICIES, range, query),
      reportId: 'overview',
      title: 'MIS Reports',
      description: 'Management information derived from Modules 1 to 5.',
      source: 'Modules 1–5',
      reports: REPORT_DEFINITIONS,
      summary: {
        policies: {
          issuedInPeriod: policyReport.metrics.total,
          totalOnBook: policies.length,
          active: policies.filter((policy) => policy.status === POLICY_STATUS.ACTIVE).length,
          pendingIssuance: policies.filter((policy) => policy.status === POLICY_STATUS.PENDING).length,
        },
        premiums: {
          collectedInPeriod: premiumReport.activity.collected,
          paymentsInPeriod: premiumReport.activity.total,
          overdueAmount: premiumReport.position.overdueAmount,
          dueAmount: premiumReport.position.dueAmount,
          outstandingAmount: premiumReport.position.outstandingAmount,
        },
        claims: {
          filedInPeriod: claimsReport.metrics.total,
          open: claimsReport.metrics.open,
          approved: claimsReport.metrics.approved,
          settled: claimsReport.metrics.settled,
          claimedAmount: claimsReport.metrics.claimedAmount,
        },
        renewals: {
          eligible: renewalReport.pipeline.eligible,
          within30: renewalReport.pipeline.within30,
          within7: renewalReport.pipeline.within7,
          expired: renewalReport.pipeline.expired,
          remindersInPeriod: renewalReport.reminderActivity.total,
        },
        commissions: {
          generatedInPeriod: commissionReport.metrics.total,
          records: commissionReport.metrics.records,
          pending: commissionReport.metrics.pending,
          earned: commissionReport.metrics.earned,
          paid: commissionReport.metrics.paid,
        },
      },
      coverage: {
        policies: policies.length,
        premiumAccounts: schedules.items.length,
        payments: payments.items.length,
        claims: claims.items.length,
        renewalAccounts: renewals.items.length,
        reminders: reminders.length,
        commissions: commissions.items.length,
      },
    }),
  )
}

/* ------------------------------------------------------------------ */
/* A. Policy report                                                    */
/* ------------------------------------------------------------------ */

const POLICY_COLUMNS = [
  { key: 'policyId', label: 'Policy', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'policyholderName', label: 'Policyholder', type: 'text' },
  { key: 'agentName', label: 'Agent', type: 'text' },
  { key: 'issueDate', label: 'Issued', type: 'date' },
  { key: 'endDate', label: 'Cover ends', type: 'date' },
  { key: 'coverageAmount', label: 'Sum insured', type: 'currency' },
  { key: 'premium', label: 'Premium', type: 'currency' },
  { key: 'scheduleTotal', label: 'Scheduled premium', type: 'currency' },
  { key: 'paidAmount', label: 'Premium paid', type: 'currency' },
  { key: 'outstandingAmount', label: 'Outstanding', type: 'currency' },
]

export const getPolicyReport = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.policyReport, { params: query })
  requireAccess(actor)
  const { policies, accountsByPolicy } = await loadPolicyData()

  const range = resolveRange(query, policies.map((policy) => policy.issueDate))
  const scoped = policies.filter(
    (policy) =>
      matchesProduct(query.product, policy.productName) &&
      (!query.status || query.status === 'all' || policy.status === query.status),
  )

  const report = buildPolicyReport({ policies: scoped, accountsByPolicy, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.POLICIES, range, query),
      metrics: report.metrics,
      distributions: report.distributions,
      excluded: report.excluded,
      filterOptions: {
        products: productOptionsFrom(policies),
        statuses: statusOptions(Object.values(POLICY_STATUS)),
      },
      table: buildTable({
        columns: POLICY_COLUMNS,
        rows: report.rows,
        query,
        defaultSort: 'issueDate',
        searchFields: ['policyId', 'productName', 'policyholderName', 'agentName', 'type'],
      }),
    }),
  )
}

/* ------------------------------------------------------------------ */
/* B. Premium & payment report                                         */
/* ------------------------------------------------------------------ */

const PAYMENT_COLUMNS = [
  { key: 'paymentId', label: 'Payment', type: 'text' },
  { key: 'paymentDate', label: 'Paid on', type: 'date' },
  { key: 'policyId', label: 'Policy', type: 'text' },
  { key: 'policyholderName', label: 'Policyholder', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'installmentId', label: 'Instalment', type: 'text' },
  { key: 'methodLabel', label: 'Method', type: 'text' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'transactionReference', label: 'Transaction reference', type: 'text' },
]

export const getPremiumReport = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.premiumReport, { params: query })
  requireAccess(actor)
  const [{ policies, schedules }, payments] = await Promise.all([loadPolicyData(), getPayments()])

  const range = resolveRange(query, payments.items.map((payment) => payment.paymentDate))
  const scopedAccounts = schedules.items.filter((account) => matchesProduct(query.product, account.policy?.productName))
  const scopedPayments = payments.items.filter(
    (payment) =>
      matchesProduct(query.product, payment.productName) &&
      (!query.status || query.status === 'all' || payment.status === query.status),
  )

  const report = buildPremiumReport({ accounts: scopedAccounts, payments: scopedPayments, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.PREMIUMS, range, query, {
        positionNote: 'The premium position is the book as it stands today; the reporting period scopes payment activity.',
      }),
      position: report.position,
      activity: report.activity,
      distributions: report.distributions,
      excluded: report.excluded,
      filterOptions: {
        products: productOptionsFrom(policies),
        statuses: PAYMENT_STATUS_OPTIONS,
      },
      table: buildTable({
        columns: PAYMENT_COLUMNS,
        rows: report.rows,
        query,
        defaultSort: 'paymentDate',
        searchFields: ['paymentId', 'policyId', 'policyholderName', 'productName', 'installmentId', 'transactionReference'],
      }),
    }),
  )
}

/* ------------------------------------------------------------------ */
/* C. Claims report                                                    */
/* ------------------------------------------------------------------ */

const CLAIM_COLUMNS = [
  { key: 'claimId', label: 'Claim', type: 'text' },
  { key: 'filingDate', label: 'Filed', type: 'date' },
  { key: 'incidentDate', label: 'Incident', type: 'date' },
  { key: 'policyId', label: 'Policy', type: 'text' },
  { key: 'policyholderName', label: 'Policyholder', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'claimTypeLabel', label: 'Claim type', type: 'text' },
  { key: 'status', label: 'Status', type: 'status' },
  { key: 'claimedAmount', label: 'Claimed', type: 'currency' },
  { key: 'approvedAmount', label: 'Approved', type: 'currency' },
]

export const getClaimsReport = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.claimsReport, { params: query })
  requireAccess(actor)
  const [{ policies }, claims] = await Promise.all([loadPolicyData(), getClaims()])

  const range = resolveRange(query, claims.items.map((claim) => claim.filingDate))
  const scoped = claims.items.filter(
    (claim) =>
      matchesProduct(query.product, claim.productName) &&
      (!query.status || query.status === 'all' || claim.status === query.status),
  )

  const report = buildClaimsReport({ claims: scoped, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.CLAIMS, range, query),
      metrics: report.metrics,
      distributions: report.distributions,
      excluded: report.excluded,
      filterOptions: {
        products: productOptionsFrom(policies),
        statuses: CLAIM_STATUS_OPTIONS,
      },
      table: buildTable({
        columns: CLAIM_COLUMNS,
        rows: report.rows,
        query,
        defaultSort: 'filingDate',
        searchFields: ['claimId', 'policyId', 'policyholderName', 'productName', 'claimTypeLabel'],
      }),
    }),
  )
}

/* ------------------------------------------------------------------ */
/* D. Renewal report                                                   */
/* ------------------------------------------------------------------ */

const RENEWAL_COLUMNS = [
  { key: 'policyId', label: 'Policy', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'policyholderName', label: 'Policyholder', type: 'text' },
  { key: 'endDate', label: 'Expiry', type: 'date' },
  { key: 'daysUntilExpiry', label: 'Days to expiry', type: 'number' },
  { key: 'status', label: 'Renewal status', type: 'status' },
  { key: 'currentStage', label: 'Reminder stage', type: 'text' },
  { key: 'lastReminderOn', label: 'Last reminder', type: 'date' },
  { key: 'readinessLabel', label: 'Readiness', type: 'text' },
  { key: 'premiumStanding', label: 'Premium standing', type: 'status' },
]

export const getRenewalReport = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.renewalReport, { params: query })
  requireAccess(actor)
  const [{ policies }, renewals] = await Promise.all([loadPolicyData(), getRenewalPolicies()])
  const reminders = getReminderRecords()

  const range = resolveRange(query, reminders.map((reminder) => reminder.evaluatedAsOf))
  const scoped = renewals.items.filter(
    (account) =>
      matchesProduct(query.product, account.policy?.productName) &&
      (!query.status || query.status === 'all' || account.status === query.status),
  )
  const scopedPolicyIds = new Set(scoped.map((account) => account.policyId))
  const scopedReminders = reminders.filter((reminder) => scopedPolicyIds.has(reminder.policyId))

  const report = buildRenewalReport({ accounts: scoped, reminders: scopedReminders, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.RENEWALS, range, query, {
        positionNote: 'The renewal pipeline is as of today; the reporting period scopes reminder activity only.',
      }),
      pipeline: report.pipeline,
      reminderActivity: report.reminderActivity,
      distributions: report.distributions,
      excluded: report.excluded,
      filterOptions: {
        products: productOptionsFrom(policies),
        statuses: RENEWAL_STATUS_OPTIONS,
      },
      table: buildTable({
        columns: RENEWAL_COLUMNS,
        rows: report.rows,
        query,
        defaultSort: 'daysUntilExpiry',
        searchFields: ['policyId', 'productName', 'policyholderName', 'agentName'],
      }),
    }),
  )
}

/* ------------------------------------------------------------------ */
/* E. Agent commission report                                          */
/* ------------------------------------------------------------------ */

const COMMISSION_COLUMNS = [
  { key: 'commissionId', label: 'Commission', type: 'text' },
  { key: 'generatedOn', label: 'Generated', type: 'date' },
  { key: 'agentName', label: 'Agent', type: 'text' },
  { key: 'policyId', label: 'Policy', type: 'text' },
  { key: 'productName', label: 'Product', type: 'text' },
  { key: 'paymentId', label: 'Premium payment', type: 'text' },
  { key: 'paymentDate', label: 'Paid on', type: 'date' },
  { key: 'basisLabel', label: 'Basis', type: 'text' },
  { key: 'commissionableAmount', label: 'Commissionable', type: 'currency' },
  { key: 'ratePercent', label: 'Rate %', type: 'number' },
  { key: 'amount', label: 'Commission', type: 'currency' },
  { key: 'status', label: 'Status', type: 'status' },
]

export const getCommissionReport = async (actor, query = {}) => {
  // Future: return apiClient.get(ENDPOINTS.commissionReport, { params: query })
  requireAccess(actor)
  const [{ policies }, commissions] = await Promise.all([loadPolicyData(), getCommissions(actor)])

  const range = resolveRange(query, commissions.items.map((item) => String(item.generatedAt ?? '').slice(0, 10)))
  const scoped = commissions.items.filter(
    (item) =>
      matchesProduct(query.product, item.productName) &&
      (!query.status || query.status === 'all' || item.status === query.status) &&
      (!query.agentId || query.agentId === 'all' || item.agentId === query.agentId),
  )

  const report = buildCommissionReport({ commissions: scoped, range })

  return withMockLatency(
    clone({
      ...meta(REPORT_IDS.COMMISSIONS, range, query),
      metrics: report.metrics,
      byAgent: report.byAgent,
      byProduct: report.byProduct,
      distributions: report.distributions,
      excluded: report.excluded,
      filterOptions: {
        products: productOptionsFrom(policies),
        statuses: COMMISSION_STATUS_OPTIONS,
        agents: optionsFromRows(commissions.items, 'agentId', 'agentName'),
      },
      table: buildTable({
        columns: COMMISSION_COLUMNS,
        rows: report.rows,
        query,
        defaultSort: 'generatedOn',
        searchFields: ['commissionId', 'agentName', 'policyId', 'productName', 'paymentId', 'policyholderName'],
      }),
    }),
  )
}

export default {
  REPORT_DEFINITIONS,
  getReportOverview,
  getPolicyReport,
  getPremiumReport,
  getClaimsReport,
  getRenewalReport,
  getCommissionReport,
}
