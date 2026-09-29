/**
 * Module 5 — commission service: retrieval and derived summaries, role
 * enforcement and agent isolation, payment-linked generation, duplicate
 * prevention, status transitions, audit history, persistence across a reload,
 * and integration with Module 1 (issuance) and Module 2 (payments).
 *
 * Seed commission comes from payments made before 2026-05, so its 30-day
 * earning hold has always passed. Payments recorded here are dated today, so
 * their hold is always active. Neither depends on the run date.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'
import { loadMockPolicyRegister } from './fixtures/mockPolicyRegister.js'

const storage = installFakeSessionStorage()
const STORAGE_KEY = 'ipms.commissions.session'

let harness
let commissions
let premiums
let policies
let dates

const ADMIN = { role: 'administrator' }
const MEERA = { role: 'agent', agentId: 'AGT-2207' }
const ARJUN = { role: 'agent', agentId: 'AGT-1184' }
const HOLDER = { role: 'policyholder' }

before(async () => {
  harness = await createHarness()
  commissions = await harness.load('/src/services/commissionService.js')
  premiums = await harness.load('/src/services/mockPremiumLedger.js')
  // Module 1 now issues through the API; this module still reads the mock register.
  policies = await loadMockPolicyRegister(harness)
  dates = await harness.load('/src/utils/dateUtils.js')
})

after(() => harness.close())

const rejectsWith = (promise, status, reason) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.name, 'ApiError', error.message)
    assert.equal(error.status, status, `${error.status} ${error.data?.reason}: ${error.message}`)
    if (reason) assert.equal(error.data?.reason, reason)
    return true
  })

const ids = (items) => items.map((item) => item.commissionId)

/* ------------------------------------------------------------------ */

describe('retrieval and derived summaries', () => {
  test('administrators see every seed commission with totals derived from records', async () => {
    const result = await commissions.getCommissions(ADMIN)
    assert.equal(result.scope, 'all')
    assert.equal(result.total, 12)
    assert.deepEqual(result.summary, {
      records: 12,
      total: 8799.75,
      pending: 255.75,
      earned: 604.5,
      paid: 7939.5,
      pendingCount: 1,
      earnedCount: 3,
      paidCount: 8,
      agents: 3,
      policies: 4,
    })
    const recomputed = result.items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100
    assert.equal(recomputed, result.summary.total)
    assert.ok(result.items.every((item) => item.linkage.valid && item.isMock && item.agentName && item.transactionReference))
  })

  test('register rows carry agent, policy, payment reference, rate, basis, amount and dates', async () => {
    const { items } = await commissions.getCommissions(ADMIN, { search: 'COM-2025-000003' })
    assert.equal(items.length, 1)
    const [row] = items
    assert.equal(row.agentName, 'Arjun Nair')
    assert.equal(row.policyholderName, 'Vikram Desai')
    assert.equal(row.productName, 'LifeSecure Term Plan')
    assert.equal(row.paymentId, 'PAY-2025-000007')
    assert.equal(row.transactionReference, 'MOCKTXN-3VJ7BT2P9Q')
    assert.equal(row.ratePercent, 22.5)
    assert.equal(row.basisLabel, 'First-year premium')
    assert.equal(row.amount, 1046.25)
    assert.equal(row.status, 'paid')
    assert.equal(row.earnedAt.slice(0, 10), '2025-02-04')
    assert.equal(row.paidAt.slice(0, 10), '2025-02-28')
  })

  test('search, status and agent filters and sorting are applied; summary stays unfiltered', async () => {
    const earned = await commissions.getCommissions(ADMIN, { status: 'earned' })
    assert.deepEqual(ids(earned.items).sort(), ['COM-2025-000041', 'COM-2025-000058', 'COM-2025-000066'])
    assert.equal(earned.summary.records, 12)

    const nisha = await commissions.getCommissions(ADMIN, { agentId: 'AGT-0456' })
    assert.deepEqual(ids(nisha.items), ['COM-2023-000014'])

    const byAmount = await commissions.getCommissions(ADMIN, { sort: 'amount-desc' })
    assert.equal(byAmount.items[0].commissionId, 'COM-2024-000031')

    assert.deepEqual((await commissions.getCommissions(ADMIN, { search: 'no such thing' })).items, [])
    assert.deepEqual(
      (await commissions.getCommissions(ADMIN)).agentOptions.map((option) => option.value).sort(),
      ['AGT-0456', 'AGT-1184', 'AGT-2207'],
    )
  })

  test('the payment awaiting commission is listed with its preview', async () => {
    const { awaiting } = await commissions.getCommissions(ADMIN)
    assert.deepEqual(awaiting.eligible.map((row) => [row.paymentId, row.preview.amount, row.preview.ruleId]), [
      ['PAY-2026-000036', 255.75, 'CR-LIF-002-AGT-1184'],
    ])
    assert.deepEqual(awaiting.blocked, [])
  })

  test('details explain the calculation and link payment, policy, rule and history', async () => {
    const details = await commissions.getCommissionById('COM-2025-000003', ADMIN)
    assert.equal(details.explanation.formula, '₹4,650.00 × 22.5% = ₹1,046.25')
    assert.match(details.explanation.basisReason, /policy year 1/)
    assert.equal(details.rule.ruleId, 'CR-LIF-002-AGT-1184')
    assert.equal(details.rule.agentName, 'Arjun Nair')
    assert.equal(details.payment.paymentId, 'PAY-2025-000007')
    assert.equal(details.policy.id, 'POL-2024-000226')
    assert.deepEqual(details.history.map((event) => event.toStatus), ['pending', 'earned', 'paid'])
    assert.deepEqual(details.milestones.map((item) => item.status), ['completed', 'completed', 'completed'])
    assert.deepEqual(details.actions, [], 'paid is final')
  })

  test('agent-wise summaries cover every registered agent, including those without commission', async () => {
    const { items, summary } = await commissions.getAgentCommissionSummaries(ADMIN)
    const rows = Object.fromEntries(items.map((row) => [row.agentId, [row.policyCount, row.records, row.total, row.pending, row.earned, row.paid]]))
    assert.deepEqual(rows, {
      'AGT-0456': [1, 1, 840, 0, 0, 840],
      'AGT-1184': [1, 7, 4719.75, 255.75, 511.5, 3952.5],
      'AGT-2207': [2, 4, 3240, 0, 93, 3147],
      'AGT-3390': [1, 0, 0, 0, 0, 0],
      'AGT-0000': [0, 0, 0, 0, 0, 0],
    })
    assert.equal(summary.total, 8799.75)
  })

  test('an agent view lists associated policies with policy-level eligibility', async () => {
    const sandeep = await commissions.getAgentCommissions('AGT-3390', ADMIN)
    assert.equal(sandeep.policies.length, 1)
    assert.equal(sandeep.policies[0].eligible, false)
    assert.match(sandeep.policies[0].eligibilityReason, /pending issuance/)
    await rejectsWith(commissions.getAgentCommissions('AGT-9999', ADMIN), 404, 'agent-not-found')
  })

  test('a policy view shows each payment\'s commission outcome', async () => {
    const view = await commissions.getPolicyCommissions('POL-2024-000226', ADMIN)
    const outcome = Object.fromEntries(view.payments.map((row) => [row.paymentId, row.commissionId ?? row.code]))
    assert.equal(outcome['PAY-2026-000079'], 'payment-not-successful')
    assert.equal(outcome['PAY-2026-000036'], 'eligible')
    assert.equal(outcome['PAY-2025-000007'], 'COM-2025-000003')
    assert.equal(view.eligibility.eligible, true)
    assert.deepEqual(view.rules.map((rule) => rule.ruleId).sort(), ['CR-LIF-002-AGT-1184', 'CR-LIF-002-STD'])
    assert.equal(view.summary.records, 7)

    const pending = await commissions.getPolicyCommissions('POL-2025-000031', ADMIN)
    assert.equal(pending.eligibility.code, 'policy-not-issued')
    assert.deepEqual(pending.payments, [])
    await rejectsWith(commissions.getPolicyCommissions('POL-0000-000000', ADMIN), 404, 'policy-not-found')
    await rejectsWith(commissions.getCommissionById('COM-0000-000000', ADMIN), 404, 'commission-not-found')
  })

  test('rules include the configuration; agents do not see other agents\' negotiated rates', async () => {
    const admin = await commissions.getCommissionRules(ADMIN)
    assert.equal(admin.rules.length, 7)
    assert.equal(admin.config.earningHoldDays, 30)
    const meera = await commissions.getCommissionRules(MEERA)
    assert.ok(!meera.rules.some((rule) => rule.ruleId === 'CR-LIF-002-AGT-1184'))
    const arjun = await commissions.getCommissionRules(ARJUN)
    assert.ok(arjun.rules.some((rule) => rule.ruleId === 'CR-LIF-002-AGT-1184'))
  })
})

describe('role enforcement and agent isolation', () => {
  test('policyholders are refused by every commission read and action', async () => {
    const calls = [
      commissions.getCommissions(HOLDER),
      commissions.getCommissionById('COM-2024-000031', HOLDER),
      commissions.getCommissionHistory('COM-2024-000031', HOLDER),
      commissions.getCommissionRules(HOLDER),
      commissions.getAgentCommissionSummaries(HOLDER),
      commissions.getAgentCommissions('AGT-2207', HOLDER),
      commissions.getPolicyCommissions('POL-2024-000148', HOLDER),
      commissions.generateCommissionForPayment('PAY-2026-000036', HOLDER),
      commissions.generateEligibleCommissions(HOLDER),
      commissions.transitionCommission('COM-2026-000002', 'earned', HOLDER),
      commissions.confirmEligibleEarnings(HOLDER),
    ]
    for (const call of calls) await rejectsWith(call, 403, 'unauthorized')
    await rejectsWith(commissions.getCommissions({}), 403, 'unauthorized')
  })

  test('an agent without an identity sees nothing', async () => {
    await rejectsWith(commissions.getCommissions({ role: 'agent' }), 403, 'agent-not-identified')
  })

  test('an agent sees only their own commission, summaries and awaiting payments', async () => {
    const mine = await commissions.getCommissions(MEERA)
    assert.equal(mine.scope, 'own')
    assert.equal(mine.agent.name, 'Meera Iyer')
    assert.deepEqual(ids(mine.items).sort(), ['COM-2024-000031', 'COM-2024-000089', 'COM-2025-000027', 'COM-2025-000066'])
    assert.equal(mine.summary.total, 3240)
    assert.deepEqual(mine.awaiting.eligible, [], 'another agent\'s awaiting payment is not shown')

    const filteredToOther = await commissions.getCommissions(MEERA, { agentId: 'AGT-1184' })
    assert.deepEqual(filteredToOther.items, [], 'a filter cannot widen an agent\'s scope')

    const agents = await commissions.getAgentCommissionSummaries(MEERA)
    assert.deepEqual(agents.items.map((row) => row.agentId), ['AGT-2207'])
  })

  test('another agent\'s records, agent view and policies are inaccessible', async () => {
    await rejectsWith(commissions.getCommissionById('COM-2025-000003', MEERA), 403, 'commission-inaccessible')
    await rejectsWith(commissions.getCommissionHistory('COM-2025-000003', MEERA), 403, 'commission-inaccessible')
    await rejectsWith(commissions.getAgentCommissions('AGT-1184', MEERA), 403, 'commission-inaccessible')
    await rejectsWith(commissions.getPolicyCommissions('POL-2024-000226', MEERA), 403, 'commission-inaccessible')
    const own = await commissions.getCommissionById('COM-2024-000031', MEERA)
    assert.equal(own.canManage, false)
    assert.deepEqual(own.actions, [])
  })

  test('agents cannot generate, confirm or pay commission — even their own', async () => {
    await rejectsWith(commissions.generateCommissionForPayment('PAY-2026-000036', ARJUN), 403, 'unauthorized')
    await rejectsWith(commissions.generateEligibleCommissions(MEERA), 403, 'unauthorized')
    await rejectsWith(commissions.transitionCommission('COM-2025-000066', 'paid', MEERA), 403, 'unauthorized')
    await rejectsWith(commissions.confirmEligibleEarnings(ARJUN), 403, 'unauthorized')
    const details = await commissions.getCommissionById('COM-2025-000066', ADMIN)
    assert.equal(details.commission.status, 'earned', 'refused calls change nothing')
  })
})

describe('status transitions and audit history', () => {
  test('pending cannot jump to paid; invalid statuses and notes are rejected', async () => {
    await rejectsWith(commissions.transitionCommission('COM-2026-000002', 'paid', ADMIN), 409, 'invalid-transition')
    await rejectsWith(commissions.transitionCommission('COM-2026-000002', 'cancelled', ADMIN), 422, 'invalid-status')
    await rejectsWith(commissions.transitionCommission('COM-2026-000002', 'earned', ADMIN, { note: 'x'.repeat(301) }), 422, 'invalid-note')
    await rejectsWith(commissions.transitionCommission('COM-0000-000000', 'earned', ADMIN), 404, 'commission-not-found')
  })

  test('pending → earned → paid appends events and leaves earlier history untouched', async () => {
    const before = (await commissions.getCommissionHistory('COM-2026-000002', ADMIN)).items
    assert.equal(before.length, 1)

    const earned = await commissions.transitionCommission('COM-2026-000002', 'earned', ADMIN, { note: 'Hold completed.' })
    assert.equal(earned.commission.status, 'earned')
    assert.deepEqual(earned.actions.map((action) => [action.toStatus, action.allowed]), [['paid', true]])

    const paid = await commissions.transitionCommission('COM-2026-000002', 'paid', ADMIN)
    assert.equal(paid.commission.status, 'paid')
    assert.match(paid.commission.payoutReference, /^MOCKPAYOUT-[2-9A-HJ-NP-Z]{10}$/)

    const history = (await commissions.getCommissionHistory('COM-2026-000002', ADMIN)).items
    assert.equal(history.length, 3)
    assert.deepEqual(history[0], before[0], 'the generated event is unchanged')
    assert.deepEqual(history.map((event) => [event.fromStatus, event.toStatus]), [[null, 'pending'], ['pending', 'earned'], ['earned', 'paid']])
    assert.equal(history[1].note, 'Hold completed.')
    assert.equal(history[1].actor.role, 'administrator')
    assert.match(history[1].eventId, /^CEV-\d{4}-\d{6}$/)
    assert.ok(history.every((event) => event.at && event.label))

    await rejectsWith(commissions.transitionCommission('COM-2026-000002', 'paid', ADMIN), 409, 'invalid-transition')
    await rejectsWith(commissions.transitionCommission('COM-2026-000002', 'earned', ADMIN), 409, 'invalid-transition')
  })

  test('a double submission records only one transition', async () => {
    const results = await Promise.allSettled([
      commissions.transitionCommission('COM-2025-000066', 'paid', ADMIN),
      commissions.transitionCommission('COM-2025-000066', 'paid', ADMIN),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.find((result) => result.status === 'rejected').reason.data.reason, 'invalid-transition')
    const history = (await commissions.getCommissionHistory('COM-2025-000066', ADMIN)).items
    assert.equal(history.filter((event) => event.toStatus === 'paid').length, 1)
  })

  test('summaries follow the new statuses', async () => {
    const { summary } = await commissions.getCommissions(ADMIN)
    assert.equal(summary.total, 8799.75, 'status changes never change amounts')
    assert.equal(summary.pending, 0)
    assert.equal(summary.paid, 7939.5 + 255.75 + 93)
  })
})

describe('payment-linked generation and duplicate prevention', () => {
  test('an administrator generates commission for an eligible payment', async () => {
    const details = await commissions.generateCommissionForPayment('PAY-2026-000036', ADMIN, { note: 'April premium.' })
    assert.match(details.commission.commissionId, /^COM-\d{4}-\d{6}$/)
    assert.equal(details.commission.status, 'pending')
    assert.equal(details.commission.amount, 255.75)
    assert.equal(details.commission.agentId, 'AGT-1184')
    assert.equal(details.explanation.formula, '₹4,650.00 × 5.5% = ₹255.75')
    assert.equal(details.history.length, 1)
    assert.equal(details.history[0].note, 'April premium.')
    assert.equal(details.commission.linkage.valid, true)
  })

  test('the same payment cannot generate a second commission', async () => {
    await rejectsWith(commissions.generateCommissionForPayment('PAY-2026-000036', ADMIN), 409, 'duplicate-commission')
    const bulk = await commissions.generateEligibleCommissions(ADMIN)
    assert.deepEqual(bulk.generated, [])
    const { items } = await commissions.getCommissions(ADMIN, { search: 'PAY-2026-000036' })
    assert.equal(items.length, 1)
  })

  test('failed, unknown and already-commissioned seed payments are refused with reasons', async () => {
    await rejectsWith(commissions.generateCommissionForPayment('PAY-2026-000079', ADMIN), 409, 'payment-not-successful')
    await rejectsWith(commissions.generateCommissionForPayment('PAY-0000-000000', ADMIN), 404, 'payment-not-found')
    await assert.rejects(commissions.generateCommissionForPayment('PAY-2024-000101', ADMIN), (error) => {
      assert.equal(error.data.reason, 'duplicate-commission')
      assert.ok(Array.isArray(error.data.checks), 'the failing checklist is returned')
      return true
    })
    await rejectsWith(commissions.generateCommissionForPayment('PAY-2026-000036', ADMIN, { note: 42 }), 422, 'invalid-note')
  })

  test('a new successful Module 2 payment generates commission once; its earning hold is enforced', async () => {
    const recorded = await premiums.recordMockPayment({
      policyId: 'POL-2024-000519',
      installmentId: 'INS-2024-000519-004',
      amount: 1550,
      method: 'upi',
    })
    assert.equal(recorded.payment.status, 'success')

    const concurrent = await Promise.allSettled([
      commissions.generateCommissionForPayment(recorded.payment.paymentId, ADMIN),
      commissions.generateCommissionForPayment(recorded.payment.paymentId, ADMIN),
    ])
    assert.equal(concurrent.filter((result) => result.status === 'fulfilled').length, 1)
    const created = concurrent.find((result) => result.status === 'fulfilled').value
    assert.equal(created.commission.amount, 93, 'instalment 4 of a half-yearly plan is renewal: 6%')
    assert.equal(created.commission.basis, 'renewal')

    const [earnAction] = created.actions
    assert.equal(earnAction.allowed, false)
    assert.equal(earnAction.code, 'earning-hold-active')
    await rejectsWith(commissions.transitionCommission(created.commission.commissionId, 'earned', ADMIN), 409, 'earning-hold-active')

    const run = await commissions.confirmEligibleEarnings(ADMIN)
    assert.ok(run.held.some((item) => item.commissionId === created.commission.commissionId))
    assert.equal(run.earned.includes(created.commission.commissionId), false)

    const meera = await commissions.getCommissions(MEERA)
    assert.ok(ids(meera.items).includes(created.commission.commissionId), 'the policy\'s agent sees it')
    const arjun = await commissions.getCommissions(ARJUN)
    assert.ok(!ids(arjun.items).includes(created.commission.commissionId), 'other agents do not')
  })

  test('a declined Module 2 payment never generates commission', async () => {
    const declined = await premiums.recordMockPayment({
      policyId: 'POL-2024-000226',
      installmentId: 'INS-2024-000226-010',
      amount: 4650,
      method: 'card',
      outcome: 'decline',
    })
    await rejectsWith(commissions.generateCommissionForPayment(declined.payment.paymentId, ADMIN), 409, 'payment-not-successful')
    const { awaiting } = await commissions.getCommissions(ADMIN)
    assert.ok(!awaiting.eligible.some((row) => row.paymentId === declined.payment.paymentId))
  })

  test('confirming eligible earnings only earns pending commission past its hold', async () => {
    // The previous test already ran a confirmation: the April payment's
    // commission (hold long passed) was earned; today's payment stayed held.
    const { items } = await commissions.getCommissions(ADMIN, { search: 'PAY-2026-000036' })
    assert.equal(items[0].status, 'earned')
    const history = (await commissions.getCommissionHistory(items[0].commissionId, ADMIN)).items
    assert.match(history.at(-1).note, /bulk earning run/)

    const again = await commissions.confirmEligibleEarnings(ADMIN)
    assert.deepEqual(again.earned, [], 'running it again changes nothing')
    assert.ok(again.held.every((item) => item.code === 'earning-hold-active'))
  })
})

describe('integration with Module 1 issuance', () => {
  let issued
  let generated

  test('a policy issued through Module 1 is commission-eligible under its product rule', async () => {
    issued = await policies.issuePolicy({
      productId: 'PRD-HLT-001',
      values: {
        fullName: 'Commission Integration Holder',
        customerId: '',
        dateOfBirth: '1986-02-02',
        email: 'commission@example.com',
        phone: '9845012388',
        addressLine1: '5 Test Road',
        addressLine2: '',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500001',
        coverageAmount: '500000',
        startDate: dates.todayIso(),
        durationYears: '1',
        premiumFrequency: 'Annual',
        nomineeName: 'Test Nominee',
        nomineeRelationship: 'Spouse',
        nomineeDateOfBirth: '1988-01-01',
      },
    })
    const view = await commissions.getPolicyCommissions(issued.id, ADMIN)
    assert.equal(view.eligibility.eligible, true)
    assert.equal(view.agent.id, 'AGT-0000')
    assert.equal(view.eligibility.currentRule.ruleId, 'CR-HLT-001-STD')
    assert.deepEqual(view.payments, [])
  })

  test('its Module 2 payment generates first-year commission for the issuing agent', async () => {
    const account = await premiums.getPremiumScheduleByPolicyId(issued.id)
    const payment = await premiums.recordMockPayment({
      policyId: issued.id,
      installmentId: account.installments[0].installmentId,
      amount: account.installments[0].amount,
      method: 'net-banking',
    })

    const bulk = await commissions.generateEligibleCommissions(ADMIN)
    generated = bulk.generated.find((item) => item.paymentId === payment.payment.paymentId)
    assert.ok(generated, 'generated by the bulk run')
    assert.equal(generated.basis, 'first-year')
    assert.equal(generated.ratePercent, 15)
    assert.equal(generated.amount, Math.round(account.installments[0].amount * 15) / 100)
    assert.equal(generated.agentId, 'AGT-0000')

    const agent = await commissions.getAgentCommissions('AGT-0000', ADMIN)
    assert.equal(agent.summary.records, 1)
    assert.equal(agent.policies[0].policyId, issued.id)
    await rejectsWith(commissions.getCommissionById(generated.commissionId, MEERA), 403, 'commission-inaccessible')
  })
})

describe('persistence', () => {
  test('generated commission and status events survive a page reload', async () => {
    const before = await commissions.getCommissions(ADMIN)
    const stored = JSON.parse(storage.getItem(STORAGE_KEY))
    assert.equal(stored.version, 1)
    assert.ok(stored.commissions.length >= 3)
    assert.ok(stored.events.length >= stored.commissions.length)

    const reloaded = await createHarness()
    try {
      const fresh = await reloaded.load('/src/services/commissionService.js')
      const after = await fresh.getCommissions(ADMIN)
      assert.deepEqual(after.summary, before.summary)
      assert.deepEqual(
        after.items.map((item) => [item.commissionId, item.status]),
        before.items.map((item) => [item.commissionId, item.status]),
      )
      await rejectsWith(fresh.generateCommissionForPayment('PAY-2026-000036', ADMIN), 409, 'duplicate-commission')
    } finally {
      await reloaded.close()
    }
  })

  test('corrupted or foreign storage falls back to the seed book', async () => {
    const saved = storage.getItem(STORAGE_KEY)
    const values = [
      '{not json',
      JSON.stringify({ version: 99, commissions: [], events: [] }),
      JSON.stringify({ version: 1, commissions: 'nope', events: [] }),
      JSON.stringify({ version: 1, commissions: [{ commissionId: 'COM-BAD', amount: Number.NaN }], events: [{ eventId: 'x' }] }),
    ]
    try {
      for (const value of values) {
        storage.setItem(STORAGE_KEY, value)
        const reloaded = await createHarness()
        try {
          const fresh = await reloaded.load('/src/services/commissionService.js')
          const result = await fresh.getCommissions(ADMIN)
          assert.equal(result.total, 12, `fallback for ${value.slice(0, 24)}`)
          assert.equal(result.items.find((item) => item.commissionId === 'COM-2026-000002').status, 'pending')
        } finally {
          await reloaded.close()
        }
      }
    } finally {
      storage.setItem(STORAGE_KEY, saved)
    }
  })
})
