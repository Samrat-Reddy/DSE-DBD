/**
 * Module 6 — MIS reporting domain logic (pure): reporting periods and their
 * boundaries, filtering, sorting, aggregation, CSV export and access rules.
 *
 * Every date-dependent call passes `today` explicitly, so these tests never
 * depend on the run date.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'

let harness
let dates
let filters
let aggregations
let exporter
let access
let claimQuery
let commissionSummary
let premiumQuery

const TODAY = '2026-09-16'

before(async () => {
  harness = await createHarness()
  dates = await harness.load('/src/utils/reportDateRange.js')
  filters = await harness.load('/src/utils/reportFilters.js')
  aggregations = await harness.load('/src/utils/reportAggregations.js')
  exporter = await harness.load('/src/utils/reportExport.js')
  access = await harness.load('/src/utils/reportAccess.js')
  claimQuery = await harness.load('/src/utils/claimQuery.js')
  commissionSummary = await harness.load('/src/utils/commissionSummary.js')
  premiumQuery = await harness.load('/src/utils/premiumQuery.js')
})

after(() => harness.close())

const range = (from, to) => ({ valid: true, from, to, inclusiveEnd: true })
const resolve = (period, extra = {}) => dates.resolveReportPeriod({ period, today: TODAY, ...extra })

/* ------------------------------------------------------------------ */

describe('reporting periods', () => {
  test('each period resolves to an inclusive range ending today', () => {
    assert.deepEqual([resolve('today').from, resolve('today').to], [TODAY, TODAY])
    assert.deepEqual([resolve('last-7').from, resolve('last-7').to], ['2026-09-10', TODAY], '7 days including today')
    assert.deepEqual([resolve('last-30').from, resolve('last-30').to], ['2026-08-18', TODAY])
    assert.deepEqual([resolve('this-month').from, resolve('this-month').to], ['2026-09-01', TODAY], 'month to date')
    assert.deepEqual([resolve('last-month').from, resolve('last-month').to], ['2026-08-01', '2026-08-31'])
    assert.ok(resolve('today').inclusiveEnd)
    assert.equal(dates.rangeLengthInDays(resolve('last-7')), 7)
    assert.equal(dates.rangeLengthInDays(resolve('today')), 1)
  })

  test('month boundaries, year boundaries and leap years are handled', () => {
    const lastMonth = (today) => {
      const result = dates.resolveReportPeriod({ period: 'last-month', today })
      return [result.from, result.to]
    }
    assert.deepEqual(lastMonth('2026-01-15'), ['2025-12-01', '2025-12-31'], 'January reports on December')
    assert.deepEqual(lastMonth('2028-03-10'), ['2028-02-01', '2028-02-29'], 'leap February')
    assert.deepEqual(lastMonth('2027-03-10'), ['2027-02-01', '2027-02-28'])
    assert.deepEqual(lastMonth('2026-05-31'), ['2026-04-01', '2026-04-30'])
    assert.deepEqual([resolve('this-month', { today: '2026-01-01' }).from], ['2026-01-01'], 'month to date in January')
  })

  test('all time runs from the earliest dated record to today', () => {
    const resolved = resolve('all-time', { earliest: '2023-09-14' })
    assert.deepEqual([resolved.from, resolved.to, resolved.label], ['2023-09-14', TODAY, 'All time'])

    const noData = resolve('all-time', { earliest: null })
    assert.equal(noData.valid, true)
    assert.equal(noData.code, 'no-dated-records')
    assert.deepEqual([noData.from, noData.to], [TODAY, TODAY])
  })

  test('custom ranges are validated, never silently corrected', () => {
    const valid = resolve('custom', { from: '2025-01-01', to: '2025-03-31' })
    assert.deepEqual([valid.valid, valid.from, valid.to], [true, '2025-01-01', '2025-03-31'])
    assert.match(valid.label, /01 Jan 2025/)

    const reversed = resolve('custom', { from: '2026-01-01', to: '2025-01-01' })
    assert.deepEqual([reversed.valid, reversed.code], [false, 'range-reversed'])

    const future = resolve('custom', { from: '2027-01-01', to: '2027-02-01' })
    assert.deepEqual([future.valid, future.code], [false, 'future-date'])
    assert.match(future.message, /cannot end after today/)

    for (const input of [{ from: 'nope', to: '2026-01-01' }, { from: '2026-01-01', to: '' }, { from: '2026-02-30', to: TODAY }]) {
      assert.equal(resolve('custom', input).code, 'invalid-date', JSON.stringify(input))
    }

    const sameDay = resolve('custom', { from: TODAY, to: TODAY })
    assert.equal(sameDay.valid, true)
    assert.equal(dates.rangeLengthInDays(sameDay), 1, 'today to today is one day, not zero')
  })

  test('an unknown period falls back to all time rather than failing', () => {
    assert.equal(resolve('nonsense', { earliest: '2024-01-01' }).valid, true)
    assert.equal(resolve('nonsense', { earliest: '2024-01-01' }).periodId, 'all-time')
  })

  test('both ends of a range are inside it; undated rows never are', () => {
    const window = range('2025-01-01', '2025-01-31')
    assert.equal(dates.isWithinRange('2025-01-01', window), true, 'start is inclusive')
    assert.equal(dates.isWithinRange('2025-01-31', window), true, 'end is inclusive')
    assert.equal(dates.isWithinRange('2024-12-31', window), false)
    assert.equal(dates.isWithinRange('2025-02-01', window), false)
    for (const value of [null, undefined, '', 'not-a-date', '2025-02-30']) {
      assert.equal(dates.isWithinRange(value, window), false, String(value))
    }
    assert.equal(dates.isWithinRange('2025-01-15', { valid: false }), false)
  })

  test('rows without a usable date are separated, not dropped silently', () => {
    const rows = [
      { id: 'a', date: '2025-01-05' },
      { id: 'b', date: '2024-06-01' },
      { id: 'c', date: null },
      { id: 'd', date: 'unknown' },
    ]
    const result = dates.partitionByDate(rows, (row) => row.date, range('2025-01-01', '2025-01-31'))
    assert.deepEqual(result.inRange.map((row) => row.id), ['a'])
    assert.deepEqual(result.outOfRange.map((row) => row.id), ['b'])
    assert.deepEqual(result.undated.map((row) => row.id), ['c', 'd'])
  })

  test('helpers describe a range and find the earliest date', () => {
    assert.equal(dates.describeRange(range('2025-01-01', '2025-01-31')), '01 Jan 2025 – 31 Jan 2025 (both dates included)')
    assert.equal(dates.describeRange({ valid: false }), 'No valid reporting period')
    assert.equal(dates.earliestDate(['2025-01-01', '2023-09-14', null, 'bad']), '2023-09-14')
    assert.equal(dates.earliestDate([]), null)
  })
})

describe('filtering, sorting and bounding', () => {
  const rows = [
    { id: 'r1', policyId: 'POL-1', product: 'Health', status: 'active', amount: 100, date: '2025-01-01' },
    { id: 'r2', policyId: 'POL-2', product: 'Life', status: 'expired', amount: 2000.5, date: '2024-06-01' },
    { id: 'r3', policyId: 'POL-3', product: 'Health', status: 'active', amount: null, date: '2026-01-01' },
  ]
  const columns = [
    { key: 'policyId', type: 'text' },
    { key: 'amount', type: 'currency' },
    { key: 'date', type: 'date' },
  ]
  const ids = (result) => result.map((row) => row.id)

  test('search matches the declared fields only, case-insensitively', () => {
    const config = { searchFields: ['policyId', 'product'] }
    assert.deepEqual(ids(filters.filterReportRows(rows, { search: 'pol-2' }, config)), ['r2'])
    assert.deepEqual(ids(filters.filterReportRows(rows, { search: 'HEALTH' }, config)), ['r1', 'r3'])
    assert.deepEqual(ids(filters.filterReportRows(rows, { search: 'active' }, config)), [], 'status is not a search field here')
    assert.deepEqual(ids(filters.filterReportRows(rows, { search: '   ' }, config)), ['r1', 'r2', 'r3'])
  })

  test('declared filters narrow rows; "all" and missing values do not', () => {
    const config = { filters: { status: 'status', product: 'product' } }
    assert.deepEqual(ids(filters.filterReportRows(rows, { status: 'active' }, config)), ['r1', 'r3'])
    assert.deepEqual(ids(filters.filterReportRows(rows, { status: 'active', product: 'Life' }, config)), [])
    assert.deepEqual(ids(filters.filterReportRows(rows, { status: 'all', product: undefined }, config)), ['r1', 'r2', 'r3'])
  })

  test('sorting handles text, numbers and dates, both directions, nulls last', () => {
    assert.deepEqual(ids(filters.sortReportRows(rows, columns, 'amount', 'desc')), ['r2', 'r1', 'r3'], 'rows without an amount sort last')
    assert.deepEqual(ids(filters.sortReportRows(rows, columns, 'amount', 'asc')), ['r1', 'r2', 'r3'])
    assert.deepEqual(ids(filters.sortReportRows(rows, columns, 'date', 'desc')), ['r3', 'r1', 'r2'])
    assert.deepEqual(ids(filters.sortReportRows(rows, columns, 'policyId', 'asc')), ['r1', 'r2', 'r3'])
    assert.deepEqual(ids(filters.sortReportRows(rows, columns, 'unknown-column', 'asc')), ['r1', 'r2', 'r3'], 'unknown key leaves order alone')
    assert.deepEqual(ids(filters.sortReportRows([], columns, 'amount', 'asc')), [])
  })

  test('rows are bounded with the overflow reported', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ id: index }))
    assert.deepEqual(filters.boundRows(many, 20), { rows: many, truncated: 0 })
    const bounded = filters.boundRows(many, 10)
    assert.equal(bounded.rows.length, 10)
    assert.equal(bounded.truncated, 2)
  })

  test('filter options come from the rows themselves, de-duplicated and sorted', () => {
    assert.deepEqual(filters.optionsFromRows(rows, 'product'), [
      { value: 'Health', label: 'Health' },
      { value: 'Life', label: 'Life' },
    ])
    assert.deepEqual(filters.optionsFromRows([{ agentId: 'A1', agentName: 'Zara' }, { agentId: 'A1', agentName: 'Zara' }], 'agentId', 'agentName'), [
      { value: 'A1', label: 'Zara' },
    ])
    assert.deepEqual(filters.optionsFromRows([], 'product'), [])
  })
})

describe('aggregation', () => {
  const window = range('2024-01-01', '2026-12-31')

  test('a distribution counts, shares and optionally sums, largest first', () => {
    const rows = [
      { type: 'Health', amount: 100 },
      { type: 'Life', amount: 50 },
      { type: 'Health', amount: 25.5 },
      { type: 'Health', amount: 0 },
    ]
    assert.deepEqual(aggregations.distribution(rows, 'type', { amountField: 'amount' }), [
      { key: 'Health', label: 'Health', count: 3, share: 75, amount: 125.5 },
      { key: 'Life', label: 'Life', count: 1, share: 25, amount: 50 },
    ])
    assert.deepEqual(aggregations.distribution([], 'type'), [])
    assert.equal(aggregations.distribution([{ type: null }], 'type')[0].key, 'unknown')
  })

  test('a counted distribution keeps zero rows so nothing looks missing', () => {
    const result = aggregations.distributionFromCounts({ approved: 2, rejected: 0 }, { approved: 'Approved', rejected: 'Rejected' }, 2)
    assert.deepEqual(result, [
      { key: 'approved', label: 'Approved', count: 2, share: 100 },
      { key: 'rejected', label: 'Rejected', count: 0, share: 0 },
    ])
  })

  test('policy report counts issued policies and reports the undated ones', () => {
    const policies = [
      { id: 'P1', productId: 'PRD-1', productName: 'Health', type: 'Health', status: 'active', issueDate: '2025-02-01', coverageAmount: 1000, premium: 100, policyholder: { name: 'A' }, agent: { id: 'AG1', name: 'Zara' } },
      { id: 'P2', productId: 'PRD-2', productName: 'Life', type: 'Life', status: 'expired', issueDate: '2024-02-01', coverageAmount: 2000, premium: 200, policyholder: { name: 'B' }, agent: { id: 'AG1', name: 'Zara' } },
      { id: 'P3', productId: 'PRD-1', productName: 'Health', type: 'Health', status: 'pending', issueDate: null, coverageAmount: 500, premium: 50, policyholder: { name: 'C' }, agent: { id: 'AG2', name: 'Anil' } },
    ]
    const accounts = new Map([['P1', { summary: { totalPremium: 1200, totalPaid: 400, outstanding: 800 } }]])
    const report = aggregations.buildPolicyReport({ policies, accountsByPolicy: accounts, range: window })

    assert.deepEqual(
      { total: report.metrics.total, active: report.metrics.active, expired: report.metrics.expired, cover: report.metrics.coverageTotal },
      { total: 2, active: 1, expired: 1, cover: 3000 },
    )
    assert.deepEqual([report.metrics.scheduledPremium, report.metrics.premiumCollected, report.metrics.premiumOutstanding], [1200, 400, 800])
    assert.equal(report.excluded.count, 1)
    assert.deepEqual(report.excluded.ids, ['P3'])
    assert.deepEqual(report.distributions.byProduct.map((item) => [item.label, item.count]), [['Health', 1], ['Life', 1]])
    assert.deepEqual(aggregations.buildPolicyReport({ policies: [], range: window }).metrics.total, 0)
  })

  test('premium report keeps today’s book apart from period activity, reusing Module 2 summaries', () => {
    const accounts = [
      { summary: { totalPremium: 1000, totalPaid: 600, outstanding: 400, dueAmount: 100, overdueAmount: 50, upcomingAmount: 250, payableNow: 150, counts: { paid: 3, due: 1, overdue: 1, upcoming: 2 } } },
    ]
    const payments = [
      { paymentId: 'PAY-1', policyId: 'P1', paymentDate: '2025-05-01', amount: 200, status: 'success', paymentMethod: 'upi', installmentId: 'INS-1', productName: 'Health' },
      { paymentId: 'PAY-2', policyId: 'P1', paymentDate: '2023-05-01', amount: 999, status: 'success', paymentMethod: 'card', installmentId: 'INS-0', productName: 'Health' },
      { paymentId: 'PAY-3', policyId: 'P1', paymentDate: '2025-06-01', amount: 100, status: 'failed', paymentMethod: 'card', installmentId: 'INS-2', productName: 'Health' },
      { paymentId: 'PAY-4', policyId: 'P1', paymentDate: null, amount: 10, status: 'success', paymentMethod: 'upi', installmentId: 'INS-3', productName: 'Health' },
    ]
    const report = aggregations.buildPremiumReport({ accounts, payments, range: window })

    assert.deepEqual(
      [report.position.totalPremium, report.position.paidAmount, report.position.overdueAmount, report.position.outstandingAmount],
      [1000, 600, 50, 400],
    )
    assert.equal(report.rows.length, 2, 'only payments inside the period')
    assert.equal(report.activity.collected, 200, 'a failed payment collects nothing')
    assert.deepEqual(report.activity, { ...premiumQuery.summarisePayments(payments.slice(0, 1).concat(payments[2])), attempted: 2, byStatus: report.activity.byStatus, byMethod: report.activity.byMethod, byProduct: report.activity.byProduct })
    assert.equal(report.excluded.count, 1)
    assert.deepEqual(report.distributions.byInstalmentStatus.map((item) => [item.key, item.count]).sort(), [['due', 1], ['overdue', 1], ['paid', 3], ['upcoming', 2]].sort())
  })

  test('claims report counts through Module 3’s own summary', () => {
    const claims = [
      { claimId: 'C1', policyId: 'P1', filingDate: '2025-01-05', status: 'settled', claimedAmount: 1000, approvedAmount: 800, claimType: 'hospitalisation', claimTypeLabel: 'Hospitalisation', productName: 'Health' },
      { claimId: 'C2', policyId: 'P1', filingDate: '2025-02-05', status: 'submitted', claimedAmount: 500, approvedAmount: null, claimType: 'hospitalisation', claimTypeLabel: 'Hospitalisation', productName: 'Health' },
      { claimId: 'C3', policyId: 'P2', filingDate: '2020-02-05', status: 'approved', claimedAmount: 700, approvedAmount: 700, claimType: 'theft', claimTypeLabel: 'Theft', productName: 'Motor' },
    ]
    const report = aggregations.buildClaimsReport({ claims, range: window })
    const expected = claimQuery.summariseClaims(claims.slice(0, 2))

    for (const key of Object.keys(expected)) assert.equal(report.metrics[key], expected[key], key)
    assert.deepEqual([report.metrics.claimedAmount, report.metrics.settledAmount, report.metrics.closed], [1500, 800, 1])
    assert.equal(report.distributions.byStatus.find((item) => item.key === 'rejected').count, 0, 'zero states still appear')
    assert.equal(report.rows.length, 2)
  })

  test('renewal report reuses the Module 4 pipeline summary and scopes reminders', () => {
    const accounts = [
      { policyId: 'P1', status: 'upcoming', daysUntilExpiry: 40, eligibility: { eligible: true }, readiness: { verdict: 'ready' }, plan: { pendingAction: 'send', currentStage: { label: '60 days before expiry' } }, premiumStanding: 'due', policy: { productName: 'Health', policyholderName: 'A', endDate: '2026-10-26' } },
      { policyId: 'P2', status: 'expired', daysUntilExpiry: -10, eligibility: { eligible: false }, readiness: { verdict: 'not-eligible' }, plan: { pendingAction: null }, premiumStanding: 'fully-paid', policy: { productName: 'Life', policyholderName: 'B', endDate: '2026-09-06' } },
    ]
    const reminders = [
      { reminderId: 'R1', policyId: 'P1', stage: 'd60', channel: 'email', status: 'sent', evaluatedAsOf: '2025-03-01' },
      { reminderId: 'R2', policyId: 'P1', stage: 'd30', channel: 'sms', status: 'failed', evaluatedAsOf: '2025-04-01' },
      { reminderId: 'R3', policyId: 'P2', stage: 'd30', channel: 'sms', status: 'sent', evaluatedAsOf: '2020-04-01' },
      { reminderId: 'R4', policyId: 'P2', stage: 'd30', channel: 'sms', status: 'sent', evaluatedAsOf: null },
    ]
    const report = aggregations.buildRenewalReport({ accounts, reminders, range: window })

    assert.deepEqual(report.pipeline, { total: 2, eligible: 1, within60: 1, within30: 0, within7: 0, expired: 1, remindersPending: 1 })
    assert.deepEqual([report.reminderActivity.total, report.reminderActivity.sent, report.reminderActivity.failed], [2, 1, 1])
    assert.equal(report.reminderActivity.policies, 1)
    assert.equal(report.excluded.count, 1)
    assert.deepEqual(report.reminderActivity.byStage.map((item) => item.label).sort(), ['30 days', '60 days'], 'stages are labelled, not raw ids')
    assert.equal(report.rows[0].readinessLabel, 'Ready for renewal')
  })

  test('commission report reuses the Module 5 summary and groups by agent and product', () => {
    const commissions = [
      { commissionId: 'CM1', agentId: 'AG1', agentName: 'Zara', policyId: 'P1', productId: 'PRD-1', productName: 'Health', amount: 100.25, status: 'paid', generatedAt: '2025-01-01T10:00:00.000Z', basis: 'first-year', ratePercent: 15, commissionableAmount: 668.33 },
      { commissionId: 'CM2', agentId: 'AG1', agentName: 'Zara', policyId: 'P2', productId: 'PRD-2', productName: 'Life', amount: 50, status: 'pending', generatedAt: '2025-02-01T10:00:00.000Z', basis: 'renewal', ratePercent: 5, commissionableAmount: 1000 },
      { commissionId: 'CM3', agentId: 'AG2', agentName: 'Anil', policyId: 'P3', productId: 'PRD-1', productName: 'Health', amount: 10, status: 'earned', generatedAt: '2020-02-01T10:00:00.000Z', basis: 'renewal', ratePercent: 5, commissionableAmount: 200 },
    ]
    const report = aggregations.buildCommissionReport({ commissions, range: window })
    const expected = commissionSummary.summariseCommissions(
      commissions.slice(0, 2).map((item) => ({ ...item, id: item.commissionId })),
    )

    assert.deepEqual(report.metrics, expected)
    assert.equal(report.metrics.total, 150.25)
    assert.deepEqual(report.byAgent.map((agent) => [agent.label, agent.total, agent.records]), [['Zara', 150.25, 2]])
    assert.deepEqual(report.byProduct.map((product) => [product.label, product.total]), [['Health', 100.25], ['Life', 50]])
    assert.equal(report.distributions.byStatus.find((item) => item.key === 'paid').amount, 100.25)
  })

  test('every builder survives an empty data set without inventing figures', () => {
    const empty = { range: window }
    assert.equal(aggregations.buildPolicyReport(empty).metrics.total, 0)
    assert.equal(aggregations.buildPremiumReport(empty).position.totalPremium, 0)
    assert.equal(aggregations.buildClaimsReport(empty).metrics.total, 0)
    assert.equal(aggregations.buildRenewalReport(empty).pipeline.total, 0)
    assert.equal(aggregations.buildCommissionReport(empty).metrics.total, 0)
    assert.deepEqual(aggregations.buildCommissionReport(empty).byAgent, [])
  })
})

describe('CSV export', () => {
  test('values are escaped per RFC 4180 and numbers stay numeric', () => {
    assert.equal(exporter.toCsvValue('plain'), 'plain')
    assert.equal(exporter.toCsvValue('has,comma'), '"has,comma"')
    assert.equal(exporter.toCsvValue('say "hi"'), '"say ""hi"""')
    assert.equal(exporter.toCsvValue('line\nbreak'), '"line\nbreak"')
    assert.equal(exporter.toCsvValue('carriage\rreturn'), '"carriage\rreturn"')
    assert.equal(exporter.toCsvValue(' padded '), '" padded "')
    assert.equal(exporter.toCsvValue(1046.25), '1046.25')
    assert.equal(exporter.toCsvValue(0), '0')
    assert.equal(exporter.toCsvValue(Number.NaN), '')
    assert.equal(exporter.toCsvValue(null), '')
    assert.equal(exporter.toCsvValue(undefined), '')
    assert.equal(exporter.toCsvValue(true), 'true')
  })

  test('the CSV has the report’s own header row and one line per record', () => {
    const csv = exporter.buildCsv({
      columns: [
        { key: 'policyId', label: 'Policy' },
        { key: 'amount', label: 'Amount' },
        { key: 'note', label: 'Note' },
      ],
      rows: [
        { policyId: 'POL-1', amount: 1046.25, note: 'Paid, in full' },
        { policyId: 'POL-2', amount: 0, note: null },
      ],
    })

    assert.deepEqual(csv.split('\r\n'), ['Policy,Amount,Note', 'POL-1,1046.25,"Paid, in full"', 'POL-2,0,'])
    assert.equal(exporter.buildCsv({ columns: [{ key: 'a', label: 'A' }], rows: [] }), 'A')
    assert.equal(exporter.buildCsv({}), '')
  })

  test('filenames are deterministic for a report and period', () => {
    const name = exporter.buildReportFilename('claims', { from: '2024-01-01', to: '2026-09-16' })
    assert.equal(name, 'ipms-claims-report_2024-01-01_2026-09-16.csv')
    assert.equal(name, exporter.buildReportFilename('claims', { from: '2024-01-01', to: '2026-09-16' }))
    assert.equal(exporter.buildReportFilename('policies', null), 'ipms-policies-report_start_today.csv')
  })
})

describe('report access', () => {
  test('only administrators may read MIS Reports', () => {
    assert.equal(access.checkReportAccess({ role: 'administrator' }).allowed, true)
    for (const actor of [{ role: 'agent', agentId: 'AGT-2207' }, { role: 'policyholder' }, {}, null]) {
      const result = access.checkReportAccess(actor)
      assert.equal(result.allowed, false, JSON.stringify(actor))
      assert.equal(result.code, 'unauthorized')
      assert.match(result.message, /Only an Administrator can/)
    }
    assert.match(access.checkReportAccess({ role: 'agent' }).message, /Agent cannot view MIS Reports/)
  })
})
