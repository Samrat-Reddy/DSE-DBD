/**
 * Module 2 — pure premium calculations, schedule generation, status rules,
 * query helpers and data integrity.
 *
 * Every time-dependent function is evaluated at a fixed `asOf` date, so these
 * results never change with the day the suite runs.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'

const AS_OF = '2026-09-15'

let harness
let calc
let dates
let query
let data

before(async () => {
  harness = await createHarness()
  calc = await harness.load('/src/utils/premiumCalculations.js')
  dates = await harness.load('/src/utils/dateUtils.js')
  query = await harness.load('/src/utils/premiumQuery.js')
  data = {
    schedules: (await harness.load('/src/data/premiumSchedules.js')).premiumSchedules,
    payments: (await harness.load('/src/data/payments.js')).payments,
    policies: (await harness.load('/src/data/issuedPolicies.js')).issuedPolicies,
    constants: await harness.load('/src/utils/constants.js'),
  }
})

after(() => harness.close())

/** Build the resolved account for a seeded policy at AS_OF. */
const accountFor = (policyId, payments = data.payments) => {
  const header = data.schedules.find((item) => item.policyId === policyId)
  const policy = data.policies.find((item) => item.id === policyId) ?? null
  return calc.buildPremiumAccount(header, policy, payments, AS_OF)
}

describe('calendar date helpers', () => {
  test('rejects impossible dates and non-ISO strings', () => {
    assert.equal(dates.isValidIsoDate('2026-02-29'), false)
    assert.equal(dates.isValidIsoDate('2024-02-29'), true)
    assert.equal(dates.isValidIsoDate('15/09/2026'), false)
  })

  test('adds months with end-of-month clamping', () => {
    assert.equal(dates.addMonthsIso('2024-01-31', 1), '2024-02-29')
    assert.equal(dates.addMonthsIso('2025-01-31', 1), '2025-02-28')
    assert.equal(dates.addMonthsIso('2024-11-10', 3), '2025-02-10')
    assert.equal(dates.addMonthsIso('2024-07-05', 12 * 25), '2049-07-05')
  })

  test('counts days in either direction', () => {
    assert.equal(dates.daysBetween('2026-09-15', '2026-10-05'), 20)
    assert.equal(dates.daysBetween('2026-09-15', '2026-07-05'), -72)
  })
})

describe('schedule generation', () => {
  test('generates the right number of instalments with deterministic IDs', () => {
    const header = data.schedules.find((item) => item.policyId === 'POL-2024-000226')
    const installments = calc.generateInstallments(header)

    assert.equal(installments.length, 100)
    assert.equal(installments[0].installmentId, 'INS-2024-000226-001')
    assert.equal(installments[0].dueDate, '2024-07-05')
    assert.equal(installments[9].dueDate, '2026-10-05')
    assert.equal(installments[99].installmentId, 'INS-2024-000226-100')
    assert.ok(installments.every((item) => item.amount === 4650))
  })

  test('due dates are measured from the start date, so month-end clamping never drifts', () => {
    const installments = calc.generateInstallments({
      scheduleId: 'SCH-T',
      policyId: 'POL-2025-999999',
      premiumAmount: 1000,
      frequency: 'Monthly',
      startDate: '2025-01-31',
      totalInstallments: 3,
    })
    assert.deepEqual(installments.map((item) => item.dueDate), ['2025-01-31', '2025-02-28', '2025-03-31'])
  })

  test('returns no instalments for an invalid header', () => {
    assert.deepEqual(calc.generateInstallments({ frequency: 'Weekly', startDate: '2025-01-01', totalInstallments: 4 }), [])
    assert.deepEqual(calc.generateInstallments(null), [])
  })

  test('derives a header for an issued policy but not for a pending one', () => {
    const issued = data.policies.find((item) => item.id === 'POL-2024-000519')
    const header = calc.buildScheduleHeaderFromPolicy(issued)
    assert.equal(header.totalInstallments, 4)
    assert.equal(header.premiumAmount, 1550)

    const pending = data.policies.find((item) => item.id === 'POL-2025-000031')
    assert.equal(calc.isPolicyScheduleEligible(pending), false)
    assert.equal(calc.buildScheduleHeaderFromPolicy(pending), null)
  })
})

describe('instalment status', () => {
  const INSTALLMENT_STATUS = { PAID: 'paid', DUE: 'due', UPCOMING: 'upcoming', OVERDUE: 'overdue' }

  test('PAID wins over any date', () => {
    assert.equal(calc.resolveInstallmentStatus('2020-01-01', { paymentId: 'X' }, AS_OF), INSTALLMENT_STATUS.PAID)
  })

  test('boundaries of the due window', () => {
    assert.equal(calc.resolveInstallmentStatus('2026-09-14', null, AS_OF), INSTALLMENT_STATUS.OVERDUE)
    assert.equal(calc.resolveInstallmentStatus('2026-09-15', null, AS_OF), INSTALLMENT_STATUS.DUE)
    assert.equal(calc.resolveInstallmentStatus('2026-10-15', null, AS_OF), INSTALLMENT_STATUS.DUE)
    assert.equal(calc.resolveInstallmentStatus('2026-10-16', null, AS_OF), INSTALLMENT_STATUS.UPCOMING)
  })

  test('a failed payment does not mark an instalment paid', () => {
    const life = accountFor('POL-2024-000226')
    const ninth = life.installments[8]
    assert.equal(ninth.status, 'overdue')
    assert.equal(ninth.failedAttempts, 1)
    assert.equal(ninth.paymentId, null)
    assert.equal(ninth.daysOverdue, 72)
  })

  test('a pending payment blocks the instalment from being payable again', () => {
    const header = data.schedules.find((item) => item.policyId === 'POL-2024-000519')
    const withPending = [
      ...data.payments,
      { paymentId: 'PAY-T-1', policyId: 'POL-2024-000519', installmentId: 'INS-2024-000519-004', amount: 1550, paymentDate: AS_OF, status: 'pending' },
    ]
    const installments = calc.resolveInstallments(calc.generateInstallments(header), withPending, AS_OF)
    assert.equal(installments[3].pendingPaymentId, 'PAY-T-1')
    assert.equal(calc.getPayableInstallments(installments).length, 0)
  })
})

describe('financial calculations', () => {
  test('total premium, paid, outstanding, overdue, due and upcoming for a long policy', () => {
    const { installments } = accountFor('POL-2024-000226')

    assert.equal(calc.calculateTotalPremium(installments), 465000)
    assert.equal(calc.calculateTotalPaid(installments), 37200)
    assert.equal(calc.calculateOutstanding(installments), 427800)
    assert.equal(calc.calculateOverdueAmount(installments), 4650)
    assert.equal(calc.calculateDueAmount(installments), 4650)
    assert.equal(calc.calculateUpcomingAmount(installments), 418500)
    assert.equal(calc.calculatePayableNow(installments), 9300)
    assert.deepEqual(calc.countInstallmentsByStatus(installments), { paid: 8, due: 1, upcoming: 90, overdue: 1 })
  })

  test('the four status buckets are exclusive and add up to the total', () => {
    const { installments } = accountFor('POL-2024-000226')
    const sum =
      calc.calculateTotalPaid(installments) +
      calc.calculateOverdueAmount(installments) +
      calc.calculateDueAmount(installments) +
      calc.calculateUpcomingAmount(installments)
    assert.equal(sum, calc.calculateTotalPremium(installments))
  })

  test('next due instalment is the earliest unpaid one, overdue first', () => {
    const { installments } = accountFor('POL-2024-000226')
    const next = calc.getNextDueInstallment(installments)
    assert.equal(next.installmentId, 'INS-2024-000226-009')
    assert.equal(next.status, 'overdue')
    assert.equal(calc.getOldestOverdueInstallment(installments).dueDate, '2026-07-05')
  })

  test('a fully paid policy has no next due instalment and is FULLY_PAID', () => {
    const { summary } = accountFor('POL-2024-000148')
    assert.equal(summary.outstanding, 0)
    assert.equal(summary.nextDueDate, null)
    assert.equal(summary.standing, 'fully-paid')
  })

  test('payment standing follows the most urgent instalment', () => {
    assert.equal(calc.derivePaymentStanding({ paid: 1, due: 1, upcoming: 1, overdue: 1 }), 'overdue')
    assert.equal(calc.derivePaymentStanding({ paid: 1, due: 1, upcoming: 1, overdue: 0 }), 'due')
    assert.equal(calc.derivePaymentStanding({ paid: 1, due: 0, upcoming: 1, overdue: 0 }), 'up-to-date')
    assert.equal(calc.derivePaymentStanding({ paid: 1, due: 0, upcoming: 0, overdue: 0 }), 'fully-paid')
  })

  test('an overdue instalment never changes the policy status', () => {
    const account = accountFor('POL-2024-000519')
    assert.equal(account.summary.standing, 'overdue')
    assert.equal(account.policy.status, 'active')
  })

  test('portfolio summary is derived from the accounts and never double counts', () => {
    const accounts = data.schedules.map((header) => accountFor(header.policyId))
    const portfolio = calc.calculatePortfolioSummary(accounts)

    assert.deepEqual(portfolio, {
      policies: 4,
      totalPaid: 68750,
      paidCount: 13,
      dueAmount: 4650,
      dueCount: 1,
      overdueAmount: 6200,
      overdueCount: 2,
      upcomingAmount: 418500,
      upcomingCount: 90,
      payableNow: 10850,
      policiesOverdue: 2,
    })
  })

  test('long schedules collapse only far-future upcoming rows', () => {
    const { installments } = accountFor('POL-2024-000226')
    const { visible, hiddenCount } = calc.selectVisibleInstallments(installments, 3)
    assert.equal(visible.length, 13)
    assert.equal(hiddenCount, 87)
    assert.ok(visible.filter((item) => item.status !== 'upcoming').length === 10, 'no past row hidden')
  })
})

describe('missing policy relationship', () => {
  test('a schedule whose policy is absent is flagged orphaned but still calculated', () => {
    const header = data.schedules.find((item) => item.policyId === 'POL-2024-000519')
    const account = calc.buildPremiumAccount(header, null, data.payments, AS_OF)

    assert.equal(account.isOrphaned, true)
    assert.equal(account.policy, null)
    assert.equal(account.summary.totalPaid, 4650)
  })
})

describe('premium account and payment queries', () => {
  const accounts = () => data.schedules.map((header) => accountFor(header.policyId))

  test('search by policy ID, policyholder, customer ID and product', () => {
    assert.deepEqual(query.queryPremiumAccounts(accounts(), { search: 'POL-2024-000226' }).map((a) => a.policyId), ['POL-2024-000226'])
    assert.deepEqual(query.queryPremiumAccounts(accounts(), { search: 'farhan' }).map((a) => a.policyId), ['POL-2024-000519'])
    assert.deepEqual(query.queryPremiumAccounts(accounts(), { search: 'CUS-100097' }).map((a) => a.policyId), ['POL-2023-000874'])
    assert.deepEqual(query.queryPremiumAccounts(accounts(), { search: 'homeshield' }).map((a) => a.policyId), ['POL-2023-000874'])
    assert.equal(query.queryPremiumAccounts(accounts(), { search: 'no-such-thing' }).length, 0)
  })

  test('filter by payment standing', () => {
    const overdue = query.queryPremiumAccounts(accounts(), { standing: 'overdue' })
    assert.deepEqual(overdue.map((a) => a.policyId).sort(), ['POL-2024-000226', 'POL-2024-000519'])
    assert.equal(query.queryPremiumAccounts(accounts(), { standing: 'fully-paid' }).length, 2)
    assert.equal(query.queryPremiumAccounts(accounts(), { standing: 'all' }).length, 4)
  })

  test('sorts by overdue amount and next due date', () => {
    const byOverdue = query.queryPremiumAccounts(accounts(), { sort: 'overdue-desc' })
    assert.equal(byOverdue[0].policyId, 'POL-2024-000226')

    const byNextDue = query.queryPremiumAccounts(accounts(), { sort: 'next-due-asc' })
    assert.equal(byNextDue[0].policyId, 'POL-2024-000519', 'oldest next due first')
    assert.equal(byNextDue[byNextDue.length - 1].summary.nextDueDate, null, 'fully paid sorts last')
  })

  test('payment history search, status and method filters, and date sort', () => {
    const payments = data.payments

    assert.deepEqual(query.queryPayments(payments, { search: 'MOCKTXN-8WT3LK6F2P' }).map((p) => p.paymentId), ['PAY-2026-000079'])
    assert.equal(query.queryPayments(payments, { search: 'POL-2024-000519' }).length, 3)
    assert.deepEqual(query.queryPayments(payments, { status: 'failed' }).map((p) => p.paymentId), ['PAY-2026-000079'])
    assert.ok(query.queryPayments(payments, { method: 'upi' }).every((p) => p.paymentMethod === 'upi'))

    const newestFirst = query.queryPayments(payments, { sort: 'date-desc' })
    assert.equal(newestFirst[0].paymentId, 'PAY-2026-000079')
    assert.equal(newestFirst[newestFirst.length - 1].paymentId, 'PAY-2023-000212')
  })

  test('payment summary counts statuses and totals only successful amounts', () => {
    assert.deepEqual(query.summarisePayments(data.payments), {
      total: 14,
      success: 13,
      failed: 1,
      pending: 0,
      collected: 68750,
    })
  })
})

describe('mock data integrity', () => {
  test('every schedule belongs to an issued policy and matches its premium terms', () => {
    const perYear = data.constants.FREQUENCY_INSTALMENTS_PER_YEAR

    for (const header of data.schedules) {
      const policy = data.policies.find((item) => item.id === header.policyId)
      assert.ok(policy, `${header.policyId} must exist in issuedPolicies`)
      assert.ok(calc.isPolicyScheduleEligible(policy), `${header.policyId} must be issued`)
      assert.equal(header.premiumAmount, policy.premium, `${header.policyId} premium`)
      assert.equal(header.frequency, policy.premiumFrequency, `${header.policyId} frequency`)
      assert.equal(header.startDate, policy.startDate, `${header.policyId} start`)
      assert.equal(header.endDate, policy.endDate, `${header.policyId} end`)
      assert.equal(header.totalInstallments, policy.durationYears * perYear[policy.premiumFrequency])
    }
  })

  test('no schedule exists for a policy that is not issued', () => {
    assert.equal(data.schedules.some((header) => header.policyId === 'POL-2025-000031'), false)
  })

  test('every payment references a real instalment with the matching amount', () => {
    const installmentsById = new Map(
      data.schedules.flatMap((header) => calc.generateInstallments(header)).map((item) => [item.installmentId, item]),
    )

    for (const payment of data.payments) {
      const installment = installmentsById.get(payment.installmentId)
      assert.ok(installment, `${payment.paymentId} → ${payment.installmentId} must exist`)
      assert.equal(installment.policyId, payment.policyId)
      assert.equal(installment.amount, payment.amount)
      assert.match(payment.transactionReference, /^MOCKTXN-/)
    }
  })

  test('payment IDs are unique and no instalment has two successful payments', () => {
    const ids = data.payments.map((payment) => payment.paymentId)
    assert.equal(new Set(ids).size, ids.length)

    const successful = data.payments.filter((payment) => payment.status === 'success').map((p) => p.installmentId)
    assert.equal(new Set(successful).size, successful.length)
  })
})
