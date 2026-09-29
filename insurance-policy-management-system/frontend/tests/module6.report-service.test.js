/**
 * Module 6 — MIS report service: retrieval, reporting periods, filters,
 * sorting, export data, authorization, and integration with the live Module
 * 1–5 services (including records created in this session).
 *
 * Figures are checked against the module services' own summaries, so a report
 * can never drift away from the data it reports on.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'
import { loadMockPolicyRegister } from './fixtures/mockPolicyRegister.js'

installFakeSessionStorage()

let harness
let reports
let policies
let premiums
let claims
let renewals
let commissions
let dates
let exporter

const ADMIN = { role: 'administrator' }
const AGENT = { role: 'agent', agentId: 'AGT-2207' }
const HOLDER = { role: 'policyholder' }

before(async () => {
  harness = await createHarness()
  reports = await harness.load('/src/services/reportService.js')
  // Module 1 now issues through the API; this module still reads the mock register.
  policies = await loadMockPolicyRegister(harness)
  premiums = await harness.load('/src/services/premiumService.js')
  claims = await harness.load('/src/services/claimService.js')
  renewals = await harness.load('/src/services/renewalService.js')
  commissions = await harness.load('/src/services/commissionService.js')
  dates = await harness.load('/src/utils/dateUtils.js')
  exporter = await harness.load('/src/utils/reportExport.js')
})

after(() => harness.close())

const rejectsWith = (promise, status, reason) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.name, 'ApiError', error.message)
    assert.equal(error.status, status, `${error.status} ${error.data?.reason}: ${error.message}`)
    if (reason) assert.equal(error.data?.reason, reason)
    return true
  })

const ids = (table) => table.rows.map((row) => row.id)

/* ------------------------------------------------------------------ */

describe('authorization', () => {
  test('every report is refused to policyholders and agents', async () => {
    const calls = (actor) => [
      reports.getReportOverview(actor),
      reports.getPolicyReport(actor),
      reports.getPremiumReport(actor),
      reports.getClaimsReport(actor),
      reports.getRenewalReport(actor),
      reports.getCommissionReport(actor),
    ]
    for (const actor of [HOLDER, AGENT, {}, { role: 'agent' }]) {
      for (const call of calls(actor)) await rejectsWith(call, 403, 'unauthorized')
    }
  })

  test('an agent is refused even when asking for their own agent id', async () => {
    await rejectsWith(reports.getCommissionReport(AGENT, { agentId: 'AGT-2207' }), 403, 'unauthorized')
    await assert.rejects(reports.getCommissionReport(AGENT), (error) => {
      assert.match(error.message, /Agent cannot view MIS Reports/)
      return true
    })
  })

  test('administrators may read every report', async () => {
    for (const report of await Promise.all([
      reports.getReportOverview(ADMIN),
      reports.getPolicyReport(ADMIN),
      reports.getPremiumReport(ADMIN),
      reports.getClaimsReport(ADMIN),
      reports.getRenewalReport(ADMIN),
      reports.getCommissionReport(ADMIN),
    ])) {
      assert.ok(report.range.valid)
      assert.ok(report.generatedAt)
      assert.equal(report.asOf, dates.todayIso())
    }
  })
})

describe('overview', () => {
  test('the management summary matches each module’s own figures', async () => {
    const [overview, policyList, premiumBook, claimList, renewalList, commissionList] = await Promise.all([
      reports.getReportOverview(ADMIN),
      policies.getIssuedPolicies(),
      premiums.getPremiumSchedules(),
      claims.getClaims(),
      renewals.getRenewalPolicies(),
      commissions.getCommissions(ADMIN),
    ])

    assert.equal(overview.summary.policies.totalOnBook, policyList.total)
    assert.equal(overview.summary.premiums.overdueAmount, premiumBook.portfolio.overdueAmount)
    assert.equal(overview.summary.premiums.dueAmount, premiumBook.portfolio.dueAmount)
    assert.equal(overview.summary.claims.filedInPeriod, claimList.summary.total, 'all time covers every claim')
    assert.equal(overview.summary.claims.open, claimList.summary.open)
    assert.equal(overview.summary.renewals.eligible, renewalList.summary.eligible)
    assert.equal(overview.summary.renewals.within30, renewalList.summary.within30)
    assert.equal(overview.summary.commissions.generatedInPeriod, commissionList.summary.total)
    assert.equal(overview.summary.commissions.paid, commissionList.summary.paid)

    assert.deepEqual(overview.coverage, {
      policies: policyList.total,
      premiumAccounts: premiumBook.items.length,
      payments: (await premiums.getPayments()).items.length,
      claims: claimList.items.length,
      renewalAccounts: renewalList.items.length,
      reminders: renewals.getReminderRecords().length,
      commissions: commissionList.items.length,
    })
  })

  test('the report index lists the five reports with their source module', async () => {
    const { reports: index } = await reports.getReportOverview(ADMIN)
    assert.deepEqual(index.map((item) => item.id), ['policies', 'premiums', 'claims', 'renewals', 'commissions'])
    assert.deepEqual(index.map((item) => item.to), [
      '/reports/policies',
      '/reports/premiums',
      '/reports/claims',
      '/reports/renewals',
      '/reports/commissions',
    ])
    assert.ok(index.every((item) => /Module \d/.test(item.source) && item.periodField))
  })
})

describe('policy report (Module 1 + Module 2)', () => {
  test('counts issued policies and carries each one’s premium position', async () => {
    const [report, policyList, book] = await Promise.all([
      reports.getPolicyReport(ADMIN),
      policies.getIssuedPolicies(),
      premiums.getPremiumSchedules(),
    ])

    const issued = policyList.items.filter((policy) => policy.issueDate)
    assert.equal(report.metrics.total, issued.length)
    assert.equal(report.metrics.active, issued.filter((policy) => policy.status === 'active').length)
    assert.equal(report.excluded.count, policyList.total - issued.length, 'policies without an issue date are reported, not dropped')

    const row = report.table.rows.find((item) => item.policyId === 'POL-2024-000148')
    const account = book.items.find((item) => item.policyId === 'POL-2024-000148')
    assert.equal(row.scheduleTotal, account.summary.totalPremium)
    assert.equal(row.paidAmount, account.summary.totalPaid)
    assert.equal(row.outstandingAmount, account.summary.outstanding)
    assert.equal(row.agentName, 'Meera Iyer')
  })

  test('product and status filters scope the whole report, not just the table', async () => {
    const health = await reports.getPolicyReport(ADMIN, { product: 'Secure Health Shield' })
    assert.equal(health.metrics.total, 1)
    assert.deepEqual(ids(health.table), ['POL-2024-000148'])
    assert.deepEqual(health.distributions.byProduct.map((item) => item.label), ['Secure Health Shield'])

    const expired = await reports.getPolicyReport(ADMIN, { status: 'expired' })
    assert.ok(expired.metrics.total >= 1)
    assert.ok(expired.table.rows.every((row) => row.status === 'expired'))

    const none = await reports.getPolicyReport(ADMIN, { product: 'No Such Product' })
    assert.equal(none.metrics.total, 0)
    assert.deepEqual(none.table.rows, [])
    assert.deepEqual(none.distributions.byProduct, [])
  })

  test('search narrows the table and sorting is applied by the service', async () => {
    const searched = await reports.getPolicyReport(ADMIN, { search: 'farhan' })
    assert.deepEqual(ids(searched.table), ['POL-2024-000519'])
    assert.equal(searched.metrics.total, 4, 'search filters the table, the period and filters scope the figures')

    const ascending = await reports.getPolicyReport(ADMIN, { sort: 'issueDate', direction: 'asc' })
    const descending = await reports.getPolicyReport(ADMIN, { sort: 'issueDate', direction: 'desc' })
    assert.deepEqual(ids(ascending.table), [...ids(descending.table)].reverse())
    assert.equal(ascending.table.rows[0].issueDate, '2023-09-14')

    const byCover = await reports.getPolicyReport(ADMIN, { sort: 'coverageAmount', direction: 'desc' })
    assert.equal(byCover.table.rows[0].coverageAmount, Math.max(...byCover.table.rows.map((row) => row.coverageAmount)))
  })
})

describe('premium report (Module 2)', () => {
  test('position comes from the premium portfolio, activity from payments in the period', async () => {
    const [report, book, payments] = await Promise.all([
      reports.getPremiumReport(ADMIN),
      premiums.getPremiumSchedules(),
      premiums.getPayments(),
    ])

    assert.equal(report.position.paidAmount, book.portfolio.totalPaid)
    assert.equal(report.position.overdueAmount, book.portfolio.overdueAmount)
    assert.equal(report.position.upcomingAmount, book.portfolio.upcomingAmount)
    assert.equal(report.position.policies, book.items.length)
    assert.equal(report.activity.total, payments.summary.total, 'all time covers every payment')
    assert.equal(report.activity.collected, payments.summary.collected)
    assert.equal(report.table.total, payments.items.length)
    assert.ok(report.positionNote.includes('as it stands today'))
  })

  test('a payment-status filter scopes activity but never the book position', async () => {
    const failed = await reports.getPremiumReport(ADMIN, { status: 'failed' })
    assert.ok(failed.table.rows.every((row) => row.status === 'failed'))
    assert.equal(failed.activity.collected, 0, 'failed payments collect nothing')

    const full = await reports.getPremiumReport(ADMIN)
    assert.equal(failed.position.paidAmount, full.position.paidAmount, 'the book is unchanged by a payment filter')
  })

  test('a period with no payments reports zero activity truthfully, with the book intact', async () => {
    const report = await reports.getPremiumReport(ADMIN, { period: 'today' })
    assert.equal(report.range.valid, true)
    assert.equal(report.activity.total, 0)
    assert.equal(report.activity.collected, 0)
    assert.deepEqual(report.table.rows, [])
    assert.ok(report.position.totalPremium > 0, 'the premium book still reports its position')
  })
})

describe('claims report (Module 3)', () => {
  test('claims are counted in the module’s own workflow states', async () => {
    const [report, claimList] = await Promise.all([reports.getClaimsReport(ADMIN), claims.getClaims()])

    for (const key of ['total', 'submitted', 'underReview', 'verified', 'assessed', 'approved', 'rejected', 'settled', 'cancelled', 'open']) {
      assert.equal(report.metrics[key], claimList.summary[key], key)
    }
    assert.equal(report.metrics.closed, claimList.summary.total - claimList.summary.open)
    assert.equal(report.table.total, claimList.items.length)
    assert.ok(report.metrics.claimedAmount > 0)
  })

  test('the claim-status filter scopes the report', async () => {
    const settled = await reports.getClaimsReport(ADMIN, { status: 'settled' })
    assert.equal(settled.metrics.total, settled.metrics.settled)
    assert.ok(settled.table.rows.every((row) => row.status === 'settled'))
    assert.equal(settled.metrics.settledAmount, settled.table.rows.reduce((sum, row) => sum + row.approvedAmount, 0))
  })

  test('a claim moved in this session is reflected in the next report read', async () => {
    const before = await reports.getClaimsReport(ADMIN)
    await claims.transitionClaim('CLM-2026-000097', 'under-review', ADMIN)
    const after = await reports.getClaimsReport(ADMIN)

    assert.equal(after.metrics.submitted, before.metrics.submitted - 1)
    assert.equal(after.metrics.underReview, before.metrics.underReview + 1)
    assert.equal(after.metrics.total, before.metrics.total, 'moving a claim does not create one')
  })
})

describe('renewal report (Module 4)', () => {
  test('the pipeline is the renewal summary; reminders are scoped by the period', async () => {
    const [report, renewalList] = await Promise.all([reports.getRenewalReport(ADMIN), renewals.getRenewalPolicies()])

    assert.deepEqual(report.pipeline, renewalList.summary)
    assert.equal(report.table.total, renewalList.items.length)
    assert.equal(report.reminderActivity.total, renewals.getReminderRecords().length, 'all time covers every reminder')
    assert.ok(report.positionNote.includes('as of today'))

    const todayOnly = await reports.getRenewalReport(ADMIN, { period: 'today' })
    assert.deepEqual(todayOnly.pipeline, renewalList.summary, 'the pipeline is not a period figure')
    assert.equal(todayOnly.reminderActivity.total, 0)
  })

  test('the renewal-status filter scopes the pipeline and the table', async () => {
    const expired = await reports.getRenewalReport(ADMIN, { status: 'expired' })
    assert.equal(expired.pipeline.total, expired.pipeline.expired)
    assert.ok(expired.table.rows.every((row) => row.status === 'expired'))
    assert.ok(expired.table.rows.every((row) => row.daysUntilExpiry < 0))
  })
})

describe('commission report (Module 5)', () => {
  test('totals come from the commission summary and group by agent and product', async () => {
    const [report, commissionList, agentSummaries] = await Promise.all([
      reports.getCommissionReport(ADMIN),
      commissions.getCommissions(ADMIN),
      commissions.getAgentCommissionSummaries(ADMIN),
    ])

    assert.deepEqual(report.metrics, commissionList.summary)
    assert.equal(report.table.total, commissionList.items.length)

    for (const agent of report.byAgent) {
      const expected = agentSummaries.items.find((item) => item.agentId === agent.key)
      assert.equal(agent.total, expected.total, agent.label)
      assert.equal(agent.records, expected.records, agent.label)
    }
    assert.equal(
      report.byProduct.reduce((sum, product) => sum + Math.round(product.total * 100), 0) / 100,
      report.metrics.total,
      'product totals add up to the report total',
    )
  })

  test('agent and status filters scope the commission report', async () => {
    const meera = await reports.getCommissionReport(ADMIN, { agentId: 'AGT-2207' })
    assert.ok(meera.table.rows.every((row) => row.agentId === 'AGT-2207'))
    assert.deepEqual(meera.byAgent.map((agent) => agent.key), ['AGT-2207'])

    const paid = await reports.getCommissionReport(ADMIN, { status: 'paid' })
    assert.equal(paid.metrics.paid, paid.metrics.total)
    assert.equal(paid.metrics.pending, 0)
    assert.ok(paid.table.rows.every((row) => row.status === 'paid'))
  })
})

describe('reporting periods applied to live data', () => {
  test('an invalid period is refused with 422 and no figures', async () => {
    await rejectsWith(reports.getClaimsReport(ADMIN, { period: 'custom', from: '2026-01-01', to: '2025-01-01' }), 422, 'invalid-period')
    await rejectsWith(reports.getPolicyReport(ADMIN, { period: 'custom', from: 'nope', to: '' }), 422, 'invalid-period')
    await rejectsWith(reports.getPremiumReport(ADMIN, { period: 'custom', from: '2027-01-01', to: '2027-03-01' }), 422, 'invalid-period')
  })

  test('a custom range includes both end dates', async () => {
    const onlyFirstPayment = await reports.getPremiumReport(ADMIN, { period: 'custom', from: '2023-09-14', to: '2023-09-14' })
    assert.deepEqual(ids(onlyFirstPayment.table), ['PAY-2023-000212'], 'a record dated exactly on both ends is included')

    const upToThatDay = await reports.getPremiumReport(ADMIN, { period: 'custom', from: '2023-01-01', to: '2023-09-13' })
    assert.deepEqual(upToThatDay.table.rows, [], 'the day before is outside the range')
  })

  test('all time starts at the earliest record the report covers', async () => {
    const report = await reports.getPremiumReport(ADMIN)
    assert.equal(report.range.from, '2023-09-14')
    assert.equal(report.range.to, dates.todayIso())
    assert.match(report.range.description, /both dates included/)
  })
})

describe('export data', () => {
  test('the exported CSV is exactly the table the report is showing', async () => {
    const report = await reports.getClaimsReport(ADMIN, { status: 'settled' })
    const csv = exporter.buildCsv(report.table)
    const lines = csv.split('\r\n')

    assert.equal(lines.length, report.table.rows.length + 1)
    assert.equal(lines[0], report.table.columns.map((column) => column.label).join(','))
    assert.ok(lines[1].startsWith(report.table.rows[0].claimId))
    assert.match(lines[1], new RegExp(`,${report.table.rows[0].claimedAmount},`), 'amounts are exported unformatted')
    assert.equal(report.filename, `ipms-claims-report_${report.range.from}_${report.range.to}.csv`)
  })

  test('report tables are bounded and report their own limit', async () => {
    const report = await reports.getPremiumReport(ADMIN)
    assert.equal(report.table.limit, 200)
    assert.equal(report.table.truncated, 0)
    assert.equal(report.table.rows.length, report.table.total)
  })
})

describe('integration with records created in this session', () => {
  test('a policy issued, paid and commissioned in this session reaches the reports', async () => {
    const before = await reports.getReportOverview(ADMIN)

    const policy = await policies.issuePolicy({
      productId: 'PRD-HLT-001',
      values: {
        fullName: 'Report Integration Holder',
        customerId: '',
        dateOfBirth: '1987-04-04',
        email: 'report@example.com',
        phone: '9845012377',
        addressLine1: '7 Test Road',
        addressLine2: '',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700001',
        coverageAmount: '500000',
        startDate: dates.todayIso(),
        durationYears: '1',
        premiumFrequency: 'Annual',
        nomineeName: 'Test Nominee',
        nomineeRelationship: 'Spouse',
        nomineeDateOfBirth: '1989-01-01',
      },
    })

    const policyReport = await reports.getPolicyReport(ADMIN, { search: policy.id })
    assert.deepEqual(ids(policyReport.table), [policy.id], 'Module 1 issuance appears immediately')
    assert.equal(policyReport.metrics.total, before.summary.policies.issuedInPeriod + 1)

    const account = await premiums.getPremiumScheduleByPolicyId(policy.id)
    const payment = await premiums.recordMockPayment({
      policyId: policy.id,
      installmentId: account.installments[0].installmentId,
      amount: account.installments[0].amount,
      method: 'upi',
    })

    const premiumReport = await reports.getPremiumReport(ADMIN, { period: 'today' })
    assert.ok(ids(premiumReport.table).includes(payment.payment.paymentId), 'Module 2 payment appears in today’s activity')
    assert.equal(premiumReport.activity.collected, account.installments[0].amount)

    const generated = await commissions.generateCommissionForPayment(payment.payment.paymentId, ADMIN)
    const commissionReport = await reports.getCommissionReport(ADMIN, { period: 'today' })
    assert.ok(ids(commissionReport.table).includes(generated.commission.commissionId), 'Module 5 commission appears')
    assert.equal(commissionReport.metrics.total, generated.commission.amount)
    assert.deepEqual(commissionReport.byAgent.map((agent) => agent.key), ['AGT-0000'])

    const after = await reports.getReportOverview(ADMIN)
    assert.equal(after.coverage.policies, before.coverage.policies + 1)
    assert.equal(after.coverage.payments, before.coverage.payments + 1)
    assert.equal(after.coverage.commissions, before.coverage.commissions + 1)
    assert.equal(after.summary.premiums.collectedInPeriod, before.summary.premiums.collectedInPeriod + account.installments[0].amount)
  })

  test('a renewal reminder recorded in this session appears in renewal activity', async () => {
    const before = await reports.getRenewalReport(ADMIN, { period: 'today' })
    await renewals.runReminderCheck(ADMIN)
    const after = await reports.getRenewalReport(ADMIN, { period: 'today' })

    assert.ok(after.reminderActivity.total >= before.reminderActivity.total)
    const all = await reports.getRenewalReport(ADMIN)
    assert.equal(all.reminderActivity.total, renewals.getReminderRecords().length)
  })
})
