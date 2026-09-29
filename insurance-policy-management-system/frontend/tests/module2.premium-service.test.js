/**
 * Module 2 — premium service: lookups, mock payments, duplicate prevention,
 * Module 1 integration and refresh persistence.
 *
 * The service evaluates statuses against the real current date. To stay
 * deterministic, payments here target instalments whose status cannot change
 * with the run date: past due dates (always OVERDUE) and far-future ones
 * (UPCOMING for a decade).
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'
import { loadMockPolicyRegister } from './fixtures/mockPolicyRegister.js'

const storage = installFakeSessionStorage()

let harness
let premiums
let policies
let dates

const PA_POLICY = 'POL-2024-000519'
const PA_LAST_INSTALMENT = 'INS-2024-000519-004' // due 2026-05-10 → OVERDUE from any later date
const LIFE_POLICY = 'POL-2024-000226'

before(async () => {
  harness = await createHarness()
  premiums = await harness.load('/src/services/mockPremiumLedger.js')
  // Module 1 now issues through the API; this module still reads the mock register.
  policies = await loadMockPolicyRegister(harness)
  dates = await harness.load('/src/utils/dateUtils.js')
})

after(() => harness.close())

describe('premium schedule lookups', () => {
  test('lists one premium account per issued policy with derived portfolio totals', async () => {
    const result = await premiums.getPremiumSchedules({ asOf: '2026-09-15' })

    assert.equal(result.total, 4)
    assert.equal(result.awaitingIssuance, 1, 'the pending Motor policy has no schedule')
    assert.equal(result.items[0].installments, undefined, 'list rows omit instalments')
    assert.equal(result.portfolio.payableNow, 10850)
    assert.equal(result.portfolio.overdueCount, 2)
  })

  test('service applies search and standing filters but keeps portfolio totals whole', async () => {
    const result = await premiums.getPremiumSchedules({ asOf: '2026-09-15', search: 'vikram' })
    assert.deepEqual(result.items.map((item) => item.policyId), [LIFE_POLICY])
    assert.equal(result.portfolio.policies, 4)

    const fullyPaid = await premiums.getPremiumSchedules({ asOf: '2026-09-15', standing: 'fully-paid' })
    assert.equal(fullyPaid.total, 2)
  })

  test('a valid policy returns its full schedule and payments, newest first', async () => {
    const account = await premiums.getPremiumScheduleByPolicyId(LIFE_POLICY, { asOf: '2026-09-15' })

    assert.equal(account.installments.length, 100)
    assert.equal(account.policy.policyholderName, 'Vikram Desai')
    assert.equal(account.payments.length, 9)
    assert.equal(account.payments[0].paymentId, 'PAY-2026-000079')
    assert.equal(account.isOrphaned, false)
  })

  test('an unknown policy rejects with 404', async () => {
    await assert.rejects(premiums.getPremiumScheduleByPolicyId('POL-0000-000000'), (error) => {
      assert.equal(error.name, 'ApiError')
      assert.equal(error.status, 404)
      return true
    })
  })

  test('a policy that is not issued rejects with 409, not 404', async () => {
    await assert.rejects(premiums.getPremiumScheduleByPolicyId('POL-2025-000031'), {
      status: 409,
    })
  })

  test('a known payment resolves with its instalment; an unknown one rejects with 404', async () => {
    const record = await premiums.getPaymentById('PAY-2024-000102', { asOf: '2026-09-15' })
    assert.equal(record.payment.status, 'success')
    assert.equal(record.installment.installmentNumber, 1)
    assert.equal(record.installment.status, 'paid')
    assert.equal(record.policy.id, LIFE_POLICY)

    await assert.rejects(premiums.getPaymentById('PAY-0000-000000'), { status: 404 })
  })
})

describe('recording a mock payment', () => {
  let portfolioBefore
  let result

  test('pays an overdue instalment and generates payment ID and transaction reference', async () => {
    portfolioBefore = await premiums.getPremiumSchedules()

    result = await premiums.recordMockPayment({
      policyId: PA_POLICY,
      installmentId: PA_LAST_INSTALMENT,
      amount: 1550,
      method: 'upi',
    })

    const year = dates.todayIso().slice(0, 4)
    assert.match(result.payment.paymentId, new RegExp(`^PAY-${year}-\\d{6}$`))
    assert.match(result.payment.transactionReference, /^MOCKTXN-[2-9A-HJ-NP-Z]{10}$/)
    assert.equal(result.payment.status, 'success')
    assert.equal(result.payment.paymentDate, dates.todayIso())
    assert.equal(result.payment.isMock, true)
  })

  test('the instalment becomes PAID with a paid date and the payment ID', () => {
    assert.equal(result.installment.status, 'paid')
    assert.equal(result.installment.paidDate, dates.todayIso())
    assert.equal(result.installment.paymentId, result.payment.paymentId)
  })

  test('the policy totals update immediately', () => {
    assert.equal(result.previousSummary.outstanding, 1550)
    assert.equal(result.account.summary.outstanding, 0)
    assert.equal(result.account.summary.totalPaid, result.previousSummary.totalPaid + 1550)
    assert.equal(result.account.summary.standing, 'fully-paid')
  })

  test('portfolio totals update: paid rises and overdue falls by the amount', async () => {
    const portfolioAfter = await premiums.getPremiumSchedules()
    assert.equal(portfolioAfter.portfolio.totalPaid, portfolioBefore.portfolio.totalPaid + 1550)
    assert.equal(portfolioAfter.portfolio.overdueAmount, portfolioBefore.portfolio.overdueAmount - 1550)
    assert.equal(portfolioAfter.portfolio.overdueCount, portfolioBefore.portfolio.overdueCount - 1)
  })

  test('the payment appears first in history and opens as a successful record', async () => {
    const history = await premiums.getPayments({ sort: 'date-desc' })
    assert.equal(history.items[0].paymentId, result.payment.paymentId)
    assert.equal(history.summary.success, 14)

    const found = await premiums.getPayments({ search: result.payment.transactionReference })
    assert.equal(found.total, 1)

    const record = await premiums.getPaymentById(result.payment.paymentId)
    assert.equal(record.payment.status, 'success')
    assert.equal(record.installment.status, 'paid')
  })

  test('a duplicate payment for the same instalment is rejected and not recorded', async () => {
    const countBefore = (await premiums.getPayments()).total

    await assert.rejects(
      premiums.recordMockPayment({ policyId: PA_POLICY, installmentId: PA_LAST_INSTALMENT, amount: 1550, method: 'card' }),
      (error) => {
        assert.equal(error.status, 409)
        assert.match(error.message, /already paid/)
        return true
      },
    )

    assert.equal((await premiums.getPayments()).total, countBefore)
  })

  test('concurrent double submission records exactly one payment', async () => {
    const lifeNine = 'INS-2024-000226-009'
    const countBefore = (await premiums.getPayments()).total

    const outcomes = await Promise.allSettled([
      premiums.recordMockPayment({ policyId: LIFE_POLICY, installmentId: lifeNine, amount: 4650, method: 'upi' }),
      premiums.recordMockPayment({ policyId: LIFE_POLICY, installmentId: lifeNine, amount: 4650, method: 'upi' }),
    ])

    assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1)
    assert.equal(outcomes.filter((o) => o.status === 'rejected').length, 1)
    assert.equal((await premiums.getPayments()).total, countBefore + 1)
  })

  test('PAID, UPCOMING and unknown instalments cannot be paid', async () => {
    const countBefore = (await premiums.getPayments()).total

    await assert.rejects(
      premiums.recordMockPayment({ policyId: LIFE_POLICY, installmentId: 'INS-2024-000226-001', amount: 4650, method: 'upi' }),
      { status: 409 },
    )
    await assert.rejects(
      premiums.recordMockPayment({ policyId: LIFE_POLICY, installmentId: 'INS-2024-000226-050', amount: 4650, method: 'upi' }),
      (error) => {
        assert.equal(error.status, 409)
        assert.match(error.message, /not due yet/)
        return true
      },
    )
    await assert.rejects(
      premiums.recordMockPayment({ policyId: LIFE_POLICY, installmentId: 'INS-2024-000226-999', amount: 4650, method: 'upi' }),
      { status: 404 },
    )
    await assert.rejects(
      premiums.recordMockPayment({ policyId: 'POL-0000-000000', installmentId: 'X', amount: 1, method: 'upi' }),
      { status: 404 },
    )

    assert.equal((await premiums.getPayments()).total, countBefore)
  })

  test('invalid amount or missing method rejects with 422 and records nothing', async () => {
    // A policy issued today has a first instalment that is DUE on any run date.
    const policy = await issueTestPolicy('Annual', 1)
    const account = await premiums.getPremiumScheduleByPolicyId(policy.id)
    const target = { policyId: policy.id, installmentId: account.installments[0].installmentId }
    const amount = account.installments[0].amount
    const countBefore = (await premiums.getPayments()).total

    await assert.rejects(premiums.recordMockPayment({ ...target, amount: 0, method: 'upi' }), { status: 422 })
    await assert.rejects(premiums.recordMockPayment({ ...target, amount: -amount, method: 'upi' }), { status: 422 })
    await assert.rejects(premiums.recordMockPayment({ ...target, amount: amount - 1, method: 'upi' }), { status: 422 })
    await assert.rejects(premiums.recordMockPayment({ ...target, amount, method: '' }), { status: 422 })

    assert.equal((await premiums.getPayments()).total, countBefore)
  })
})

describe('declined mock payment', () => {
  test('records a FAILED payment and leaves the instalment unpaid and payable', async () => {
    // Issue a new policy starting today so its first instalment is DUE today.
    const policy = await issueTestPolicy('Annual', 1)
    const account = await premiums.getPremiumScheduleByPolicyId(policy.id)
    const first = account.installments[0]
    assert.equal(first.status, 'due')

    const declined = await premiums.recordMockPayment({
      policyId: policy.id,
      installmentId: first.installmentId,
      amount: first.amount,
      method: 'card',
      outcome: premiums.MOCK_PAYMENT_OUTCOMES.DECLINE,
    })

    assert.equal(declined.payment.status, 'failed')
    assert.ok(declined.payment.failureReason)
    assert.equal(declined.installment.status, 'due')
    assert.equal(declined.installment.failedAttempts, 1)
    assert.equal(declined.account.summary.totalPaid, 0)

    // Still payable after a failure.
    const approved = await premiums.recordMockPayment({
      policyId: policy.id,
      installmentId: first.installmentId,
      amount: first.amount,
      method: 'upi',
    })
    assert.equal(approved.installment.status, 'paid')
  })

  test('an unknown outcome is rejected', async () => {
    const policy = await issueTestPolicy('Annual', 1)
    const account = await premiums.getPremiumScheduleByPolicyId(policy.id)
    await assert.rejects(
      premiums.recordMockPayment({
        policyId: policy.id,
        installmentId: account.installments[0].installmentId,
        amount: account.installments[0].amount,
        method: 'upi',
        outcome: 'maybe',
      }),
      { status: 422 },
    )
  })
})

/** Issue a Module 1 policy that starts today. */
async function issueTestPolicy(premiumFrequency, durationYears) {
  return policies.issuePolicy({
    productId: 'PRD-HLT-001',
    values: {
      fullName: 'Integration Test Holder',
      customerId: '',
      dateOfBirth: '1990-01-01',
      email: 'integration@example.com',
      phone: '9845012399',
      addressLine1: '1 Test Road',
      addressLine2: '',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      coverageAmount: '1000000',
      startDate: dates.todayIso(),
      durationYears: String(durationYears),
      premiumFrequency,
      nomineeName: 'Test Nominee',
      nomineeRelationship: 'Spouse',
      nomineeDateOfBirth: '1991-01-01',
    },
  })
}

describe('integration with Module 1 issuance', () => {
  let issued

  test('a policy issued through Module 1 gets a premium schedule automatically', async () => {
    issued = await issueTestPolicy('Quarterly', 2)
    const account = await premiums.getPremiumScheduleByPolicyId(issued.id)

    assert.equal(account.installments.length, 8)
    assert.equal(account.premiumAmount, issued.premium)
    assert.equal(account.installments[0].amount, issued.premium, 'instalment = per-instalment premium')
    assert.equal(account.installments[0].dueDate, issued.startDate)
    assert.equal(account.installments[0].status, 'due')
    assert.equal(account.policy.policyholderName, 'Integration Test Holder')

    const list = await premiums.getPremiumSchedules({ search: issued.id })
    assert.equal(list.total, 1)
  })

  test('its first instalment can be paid', async () => {
    const account = await premiums.getPremiumScheduleByPolicyId(issued.id)
    const result = await premiums.recordMockPayment({
      policyId: issued.id,
      installmentId: account.installments[0].installmentId,
      amount: account.installments[0].amount,
      method: 'net-banking',
    })
    assert.equal(result.installment.status, 'paid')
    assert.equal(result.account.summary.counts.paid, 1)
  })
})

describe('refresh persistence', () => {
  test('recorded payments are mirrored to sessionStorage under their own key', () => {
    const stored = JSON.parse(storage.getItem('ipms.payments.session'))
    assert.ok(Array.isArray(stored))
    assert.ok(stored.some((payment) => payment.installmentId === PA_LAST_INSTALMENT))
  })

  test('a fresh page load (new module instances) still shows the payment and PAID status', async () => {
    const reloaded = await createHarness()
    try {
      const freshPremiums = await reloaded.load('/src/services/mockPremiumLedger.js')
      const account = await freshPremiums.getPremiumScheduleByPolicyId(PA_POLICY)
      const last = account.installments.find((item) => item.installmentId === PA_LAST_INSTALMENT)

      assert.equal(last.status, 'paid')
      assert.ok(last.paymentId)
      assert.equal(account.summary.outstanding, 0)

      const history = await freshPremiums.getPayments()
      assert.ok(history.items.some((payment) => payment.paymentId === last.paymentId))
    } finally {
      await reloaded.close()
    }
  })

  test('corrupted storage falls back to seed data instead of crashing', async () => {
    storage.setItem('ipms.payments.session', '{not valid json')
    const reloaded = await createHarness()
    try {
      const freshPremiums = await reloaded.load('/src/services/mockPremiumLedger.js')
      const history = await freshPremiums.getPayments()
      assert.equal(history.total, 14, 'only the seeded payments remain')
    } finally {
      await reloaded.close()
    }
  })
})
