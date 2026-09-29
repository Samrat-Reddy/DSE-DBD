/**
 * Module 5 — Agent Commission domain logic (pure): calculation, rate and
 * amount validation, rule resolution, policy- and payment-level eligibility,
 * duplicate prevention, payment linkage, lifecycle transitions, access rules,
 * summaries, query and seed-data integrity.
 *
 * Every date-dependent call passes an explicit date, so these tests do not
 * depend on the run date. Test records are derived from seed records — see
 * tests/fixtures/commissionFixtures.js.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'
import { commissionEvent, derive, paymentFor } from './fixtures/commissionFixtures.js'

let harness
let calc
let eligibility
let lifecycle
let access
let summary
let format
let constants
let seed

before(async () => {
  harness = await createHarness()
  calc = await harness.load('/src/utils/commissionCalculation.js')
  eligibility = await harness.load('/src/utils/commissionEligibility.js')
  lifecycle = await harness.load('/src/utils/commissionLifecycle.js')
  access = await harness.load('/src/utils/commissionAccess.js')
  summary = await harness.load('/src/utils/commissionSummary.js')
  format = await harness.load('/src/utils/commissionFormat.js')
  constants = await harness.load('/src/utils/constants.js')
  const premium = await harness.load('/src/utils/premiumCalculations.js')
  seed = {
    policies: (await harness.load('/src/data/issuedPolicies.js')).issuedPolicies,
    payments: (await harness.load('/src/data/payments.js')).payments,
    schedules: (await harness.load('/src/data/premiumSchedules.js')).premiumSchedules,
    agents: (await harness.load('/src/data/agents.js')).agents,
    rules: (await harness.load('/src/data/commissionRules.js')).commissionRules,
    commissions: (await harness.load('/src/data/commissions.js')).commissions,
    events: (await harness.load('/src/data/commissions.js')).commissionEvents,
    premium,
  }
})

after(() => harness.close())

const LIFE = 'POL-2024-000226'
const policy = (id) => seed.policies.find((item) => item.id === id)
const agent = (id) => seed.agents.find((item) => item.id === id)
const schedule = (policyId) => seed.schedules.find((item) => item.policyId === policyId)

/** Evaluate a payment against seed data, with overrides for one input. */
const evaluate = (payment, overrides = {}) => {
  const pol = overrides.policy !== undefined ? overrides.policy : policy(payment?.policyId)
  return eligibility.evaluatePaymentCommission({
    payment,
    policy: pol,
    agent: overrides.agent !== undefined ? overrides.agent : pol?.agent ? agent(pol.agent.id) : null,
    schedule: overrides.schedule !== undefined ? overrides.schedule : pol ? schedule(pol.id) : null,
    rules: overrides.rules ?? seed.rules,
    existingCommissions: overrides.existingCommissions ?? [],
  })
}

/* ------------------------------------------------------------------ */

describe('commission calculation', () => {
  test('commission = commissionable amount × rate, exact to the paisa', () => {
    const cases = [
      [4650, 22.5, 1046.25],
      [4650, 5.5, 255.75],
      [18500, 15, 2775],
      [1550, 12, 186],
      [1550, 6, 93],
      [8400, 10, 840],
      [999.99, 7.5, 75],
      [0.01, 50, 0.01],
      [100.1, 0.01, 0.01],
    ]
    for (const [commissionableAmount, ratePercent, amount] of cases) {
      const result = calc.calculateCommission({ commissionableAmount, ratePercent })
      assert.equal(result.valid, true, `${commissionableAmount} × ${ratePercent}%`)
      assert.equal(result.amount, amount, `${commissionableAmount} × ${ratePercent}%`)
    }
  })

  test('rounding is half-up on whole paise, never floating-point drift', () => {
    assert.equal(calc.calculateCommission({ commissionableAmount: 0.3, ratePercent: 50 }).amount, 0.15)
    assert.equal(calc.calculateCommission({ commissionableAmount: 1.01, ratePercent: 12.5 }).amount, 0.13)
    assert.equal(calc.calculateCommission({ commissionableAmount: 333.33, ratePercent: 33.33 }).amount, 111.1)
    assert.equal(calc.sumAmounts([0.1, 0.2]), 0.3)
    assert.equal(calc.sumAmounts([1046.25, 1046.25, 255.75]), 2348.25)
  })

  test('invalid calculation input is rejected with a code, never NaN or negative', () => {
    const bad = [
      [{ commissionableAmount: -100, ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: 0, ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: Number.NaN, ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: Infinity, ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: '4650', ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: 10.001, ratePercent: 10 }, 'invalid-amount'],
      [{ commissionableAmount: 4650 }, 'invalid-rate'],
      [{}, 'invalid-amount'],
      [undefined, 'invalid-amount'],
    ]
    for (const [input, code] of bad) {
      const result = calc.calculateCommission(input)
      assert.equal(result.valid, false)
      assert.equal(result.code, code, JSON.stringify(input))
      assert.equal(result.amount, undefined)
    }
  })

  test('rate validation: a number within 0.01–50% with at most 2 decimals', () => {
    for (const rate of [0.01, 5, 7.5, 22.55, 50]) assert.equal(calc.validateCommissionRate(rate).valid, true, String(rate))
    for (const rate of [0, -1, 50.01, 100, 12.345, Number.NaN, null, '10', undefined]) {
      const result = calc.validateCommissionRate(rate)
      assert.equal(result.valid, false, String(rate))
      assert.equal(result.code, 'invalid-rate')
    }
  })

  test('policy year and basis come from the instalment number and frequency', () => {
    assert.equal(calc.getPolicyYear(1, 'Quarterly'), 1)
    assert.equal(calc.getPolicyYear(4, 'Quarterly'), 1)
    assert.equal(calc.getPolicyYear(5, 'Quarterly'), 2)
    assert.equal(calc.getPolicyYear(2, 'Half-Yearly'), 1)
    assert.equal(calc.getPolicyYear(3, 'Half-Yearly'), 2)
    assert.equal(calc.getPolicyYear(12, 'Monthly'), 1)
    assert.equal(calc.getPolicyYear(13, 'Monthly'), 2)
    assert.equal(calc.getPolicyYear(2, 'Annual'), 2)
    assert.equal(calc.getPolicyYear(0, 'Annual'), null)
    assert.equal(calc.getPolicyYear(1, 'Weekly'), null)
    assert.equal(calc.determineCommissionBasis(1), 'first-year')
    assert.equal(calc.determineCommissionBasis(2), 'renewal')
  })

  test('the explanation states formula, basis and rule', () => {
    const rule = seed.rules.find((item) => item.ruleId === 'CR-LIF-002-AGT-1184')
    const explanation = calc.explainCommission({
      commissionableAmount: 4650,
      ratePercent: 22.5,
      amount: 1046.25,
      basis: 'first-year',
      policyYear: 1,
      installmentNumber: 3,
      frequency: 'Quarterly',
      rule,
      paymentId: 'PAY-2025-000007',
      paymentDate: '2025-01-04',
    })
    assert.equal(explanation.formula, '₹4,650.00 × 22.5% = ₹1,046.25')
    assert.match(explanation.basisReason, /Instalment 3 of a quarterly plan falls in policy year 1, so the first-year rate applies/)
    assert.match(explanation.ruleReason, /Agent-specific rule CR-LIF-002-AGT-1184 was in force on 04 Jan 2025/)
    assert.equal(explanation.ruleScope, 'agent')
  })
})

describe('commission rules', () => {
  const resolve = (productId, agentId, date, rules = seed.rules) => calc.resolveCommissionRule(rules, { productId, agentId, date })?.ruleId ?? null

  test('every seed rule is structurally valid', () => {
    for (const rule of seed.rules) assert.deepEqual(calc.validateCommissionRule(rule), { valid: true, errors: [] }, rule.ruleId)
  })

  test('rule validation reports each problem', () => {
    const base = seed.rules[0]
    assert.equal(calc.validateCommissionRule(null).valid, false)
    assert.match(calc.validateCommissionRule({ ...base, productId: '' }).errors.join(), /no product/)
    assert.match(calc.validateCommissionRule({ ...base, firstYearRatePercent: 75 }).errors.join(), /between/)
    assert.match(calc.validateCommissionRule({ ...base, effectiveFrom: '2025-02-30' }).errors.join(), /effective-from/)
    assert.match(calc.validateCommissionRule({ ...base, effectiveTo: '2022-12-31' }).errors.join(), /before the effective-from/)
  })

  test('agent-specific rules beat product rules only for that agent and period', () => {
    assert.equal(resolve('PRD-LIF-002', 'AGT-1184', '2024-12-31'), 'CR-LIF-002-STD')
    assert.equal(resolve('PRD-LIF-002', 'AGT-1184', '2025-01-01'), 'CR-LIF-002-AGT-1184')
    assert.equal(resolve('PRD-LIF-002', 'AGT-2207', '2025-06-01'), 'CR-LIF-002-STD')
  })

  test('effective periods are inclusive at both ends', () => {
    assert.equal(resolve('PRD-HOM-005', 'AGT-0456', '2023-01-01'), 'CR-HOM-005-2023')
    assert.equal(resolve('PRD-HOM-005', 'AGT-0456', '2024-12-31'), 'CR-HOM-005-2023')
    assert.equal(resolve('PRD-HOM-005', 'AGT-0456', '2025-01-01'), 'CR-HOM-005-2025')
    assert.equal(resolve('PRD-HOM-005', 'AGT-0456', '2022-12-31'), null)
  })

  test('no rule for inactive products, invalid dates or invalid rules', () => {
    assert.equal(resolve('PRD-LIF-007', 'AGT-1184', '2025-06-01'), null)
    assert.equal(resolve('PRD-HLT-001', 'AGT-2207', 'not-a-date'), null)
    const broken = [{ ...seed.rules[0], ruleId: 'BROKEN', firstYearRatePercent: -5 }]
    assert.equal(resolve('PRD-HLT-001', 'AGT-2207', '2025-06-01', broken), null)
  })

  test('among equal-priority rules the latest effective-from wins, then rule ID', () => {
    const rules = [
      { ...seed.rules[0], ruleId: 'B-OLD', effectiveFrom: '2023-01-01' },
      { ...seed.rules[0], ruleId: 'C-NEW', effectiveFrom: '2024-01-01' },
      { ...seed.rules[0], ruleId: 'A-NEW', effectiveFrom: '2024-01-01' },
    ]
    assert.equal(resolve('PRD-HLT-001', 'AGT-2207', '2025-01-01', rules), 'A-NEW')
  })
})

describe('policy-level eligibility', () => {
  const run = (pol, agentRecord = pol?.agent ? agent(pol.agent.id) : null, rules = seed.rules) =>
    eligibility.evaluatePolicyCommissionEligibility({ policy: pol, agent: agentRecord, rules, asOf: '2026-09-15' })

  test('an issued policy with a registered agent and a rule is eligible', () => {
    const result = run(policy(LIFE))
    assert.equal(result.eligible, true)
    assert.equal(result.currentRule.ruleId, 'CR-LIF-002-AGT-1184')
    assert.ok(result.checks.every((check) => check.outcome === 'pass'))
  })

  test('each blocking reason is explicit and later checks are not claimed as passed', () => {
    const base = policy('POL-2024-000148')
    const cases = [
      [run(null), 'policy-not-found'],
      [run(policy('POL-2025-000031')), 'policy-not-issued'],
      [run(derive(base, { agent: null }), null), 'missing-agent'],
      [run(derive(base, { agent: { id: 'AGT-9999', name: 'Nobody' } }), null), 'agent-not-registered'],
      [run(base, { ...agent('AGT-2207'), status: 'inactive' }), 'agent-inactive'],
      [run(derive(base, { productId: 'PRD-HLT-006', productName: 'Senior Care Health Plan' })), 'no-commission-rule'],
    ]
    for (const [result, code] of cases) {
      assert.equal(result.eligible, false, code)
      assert.equal(result.code, code)
      assert.ok(result.reason)
      const blockedIndex = result.checks.findIndex((check) => check.outcome === 'blocked')
      assert.ok(result.checks.slice(blockedIndex + 1).every((check) => check.outcome === 'skipped'), code)
    }
  })
})

describe('payment-level eligibility, linkage and duplicate prevention', () => {
  const seedPayment = (id) => seed.payments.find((item) => item.paymentId === id)

  test('an eligible seed payment previews exactly what will be generated', () => {
    const result = evaluate(seedPayment('PAY-2026-000036'))
    assert.equal(result.eligible, true)
    assert.deepEqual(
      {
        installmentNumber: result.preview.installmentNumber,
        policyYear: result.preview.policyYear,
        basis: result.preview.basis,
        ruleId: result.preview.ruleId,
        ratePercent: result.preview.ratePercent,
        amount: result.preview.amount,
      },
      { installmentNumber: 8, policyYear: 2, basis: 'renewal', ruleId: 'CR-LIF-002-AGT-1184', ratePercent: 5.5, amount: 255.75 },
    )
    assert.equal(result.preview.explanation.formula, '₹4,650.00 × 5.5% = ₹255.75')
  })

  test('first-year and renewal instalments use different rates', () => {
    const yearOne = evaluate(paymentFor('POL-2024-000519', 2, { amount: 1550, paymentDate: '2025-05-09' }))
    const yearTwo = evaluate(paymentFor('POL-2024-000519', 3, { amount: 1550, paymentDate: '2025-11-07' }))
    assert.equal(yearOne.preview.ratePercent, 12)
    assert.equal(yearTwo.preview.ratePercent, 6)
  })

  test('a payment that already has a commission is a duplicate', () => {
    const payment = seedPayment('PAY-2026-000036')
    const result = evaluate(payment, { existingCommissions: [{ commissionId: 'COM-2026-000099', paymentId: payment.paymentId }] })
    assert.equal(result.code, 'duplicate-commission')
    assert.match(result.reason, /COM-2026-000099 already exists/)
    assert.equal(result.preview, null)
  })

  test('failed, missing and reference-less payments generate nothing', () => {
    assert.equal(evaluate(null).code, 'payment-not-found')
    assert.equal(evaluate(seedPayment('PAY-2026-000079')).code, 'payment-not-successful')
    assert.equal(evaluate({ ...seedPayment('PAY-2026-000036'), status: 'pending' }).code, 'payment-not-successful')
    assert.equal(evaluate({ ...seedPayment('PAY-2026-000036'), transactionReference: '' }).code, 'missing-payment-reference')
    assert.equal(evaluate({ ...seedPayment('PAY-2026-000036'), installmentId: null }).code, 'missing-payment-reference')
  })

  test('invalid payment ↔ policy linkage is refused', () => {
    const base = seedPayment('PAY-2026-000036')
    assert.equal(evaluate({ ...base, installmentId: 'INS-2024-000519-001' }).code, 'invalid-linkage', 'instalment of another policy')
    assert.equal(evaluate({ ...base, installmentId: 'INS-2024-000226-101' }).code, 'invalid-linkage', 'beyond the schedule')
    assert.equal(evaluate({ ...base, policyId: 'POL-0000-000000' }).code, 'invalid-linkage', 'policy does not exist')
    assert.equal(evaluate(base, { schedule: null }).code, 'invalid-linkage', 'no schedule')
    assert.equal(evaluate(base, { schedule: { frequency: 'Weekly', totalInstallments: 100 } }).code, 'invalid-linkage', 'unknown frequency')
  })

  test('policy-level problems block payment-level generation', () => {
    const base = seedPayment('PAY-2026-000036')
    const pol = policy(LIFE)
    assert.equal(evaluate(base, { policy: derive(pol, { agent: null }), agent: null }).code, 'missing-agent')
    assert.equal(evaluate(base, { agent: null }).code, 'agent-not-registered')
    assert.equal(evaluate(base, { agent: { ...agent('AGT-1184'), status: 'inactive' } }).code, 'agent-inactive')
    assert.equal(evaluate({ ...base, paymentDate: '2022-06-01' }).code, 'no-commission-rule')
  })

  test('an invalid amount never produces a commission', () => {
    const result = evaluate({ ...seedPayment('PAY-2026-000036'), amount: -4650 })
    assert.equal(result.code, 'invalid-calculation')
    assert.equal(result.preview, null)
  })

  test('stored records are verified against their payment', () => {
    const record = seed.commissions.find((item) => item.commissionId === 'COM-2025-000003')
    const payment = seedPayment(record.paymentId)
    assert.equal(eligibility.verifyCommissionLinkage(record, payment).valid, true)
    assert.equal(eligibility.verifyCommissionLinkage(record, null).code, 'invalid-linkage')
    assert.match(eligibility.verifyCommissionLinkage(record, { ...payment, policyId: 'POL-X' }).message, /belongs to POL-X/)
    assert.match(eligibility.verifyCommissionLinkage(record, { ...payment, installmentId: 'INS-X' }).message, /instalment INS-X/)
    assert.match(eligibility.verifyCommissionLinkage(record, { ...payment, status: 'failed' }).message, /no longer successful/)
    assert.match(eligibility.verifyCommissionLinkage(record, { ...payment, amount: 1 }).message, /calculated on/)
  })
})

describe('commission lifecycle', () => {
  const check = (overrides) =>
    lifecycle.checkCommissionTransition({
      currentStatus: 'pending',
      toStatus: 'earned',
      role: 'administrator',
      paymentDate: '2026-01-03',
      asOf: '2026-09-15',
      linkageValid: true,
      ...overrides,
    })

  test('only pending → earned → paid exist', () => {
    assert.deepEqual(lifecycle.COMMISSION_TRANSITIONS, { pending: ['earned'], earned: ['paid'], paid: [] })
    const statuses = ['pending', 'earned', 'paid']
    for (const from of statuses) {
      for (const to of statuses) {
        const expected = (from === 'pending' && to === 'earned') || (from === 'earned' && to === 'paid')
        assert.equal(lifecycle.canTransition(from, to), expected, `${from} → ${to}`)
      }
    }
  })

  test('invalid transitions return controlled codes with reasons', () => {
    assert.equal(check({ toStatus: 'cancelled' }).code, 'invalid-status')
    assert.match(check({ toStatus: 'paid' }).message, /cannot move from Pending to Paid\. It must be confirmed as earned first/)
    assert.match(check({ currentStatus: 'paid', toStatus: 'earned' }).message, /Paid is final/)
    assert.equal(check({ currentStatus: 'earned', toStatus: 'pending' }).code, 'invalid-transition')
    assert.equal(check({ currentStatus: 'earned', toStatus: 'earned' }).code, 'invalid-transition')
  })

  test('only administrators may change status', () => {
    for (const role of ['agent', 'policyholder', undefined]) assert.equal(check({ role }).code, 'unauthorized')
    assert.equal(check({ currentStatus: 'earned', toStatus: 'paid' }).allowed, true)
  })

  test('the earning hold ends exactly 30 days after the payment', () => {
    assert.equal(lifecycle.getEarnableFrom('2026-01-31'), '2026-03-02')
    assert.equal(check({ paymentDate: '2026-08-16', asOf: '2026-09-14' }).code, 'earning-hold-active')
    assert.match(check({ paymentDate: '2026-08-16', asOf: '2026-09-14' }).message, /from 15 Sept? 2026/)
    assert.equal(check({ paymentDate: '2026-08-16', asOf: '2026-09-15' }).allowed, true)
    assert.equal(check({ paymentDate: null }).code, 'earning-hold-active')
    assert.equal(check({ currentStatus: 'earned', toStatus: 'paid', paymentDate: '2026-09-15', asOf: '2026-09-15' }).allowed, true, 'hold only gates earning')
  })

  test('a broken payment link blocks any status change', () => {
    assert.equal(check({ linkageValid: false }).code, 'invalid-linkage')
    assert.equal(check({ currentStatus: 'earned', toStatus: 'paid', linkageValid: false }).code, 'invalid-linkage')
  })

  test('status is derived by replaying events; impossible events are ignored', () => {
    const id = 'COM-TEST'
    const generated = commissionEvent(id, 'generated', null, 'pending', '2026-01-01T10:00:00Z')
    const earned = commissionEvent(id, 'status-changed', 'pending', 'earned', '2026-02-01T10:00:00Z')
    const paid = commissionEvent(id, 'status-changed', 'earned', 'paid', '2026-02-10T10:00:00Z', { payoutReference: 'MOCKPAYOUT-X' })

    assert.equal(lifecycle.deriveCommissionState([]).status, null)
    assert.equal(lifecycle.deriveCommissionState([generated]).status, 'pending')
    const full = lifecycle.deriveCommissionState([paid, generated, earned])
    assert.equal(full.status, 'paid')
    assert.equal(full.payoutReference, 'MOCKPAYOUT-X')
    assert.equal(full.earnedAt, earned.at)
    assert.deepEqual(full.events.map((event) => event.eventId), [generated, earned, paid].map((event) => event.eventId))

    const skipAhead = commissionEvent(id, 'status-changed', 'pending', 'paid', '2026-01-05T10:00:00Z')
    const backwards = commissionEvent(id, 'status-changed', 'paid', 'pending', '2026-03-01T10:00:00Z')
    const corrupted = lifecycle.deriveCommissionState([generated, skipAhead, earned, paid, backwards])
    assert.equal(corrupted.status, 'paid')
    assert.deepEqual(corrupted.ignoredEvents, [skipAhead.eventId, backwards.eventId])
  })
})

describe('access rules and agent isolation', () => {
  test('policyholders and unknown roles cannot view commission', () => {
    for (const actor of [{ role: 'policyholder' }, {}, null, { role: 'guest' }]) {
      assert.equal(access.checkCommissionViewAccess(actor).code, 'unauthorized')
    }
  })

  test('an agent must be identified and sees only their own records', () => {
    assert.equal(access.checkCommissionViewAccess({ role: 'agent' }).code, 'agent-not-identified')
    const meera = { role: 'agent', agentId: 'AGT-2207' }
    assert.equal(access.checkAgentRecordAccess(meera, 'AGT-2207').allowed, true)
    assert.equal(access.checkAgentRecordAccess(meera, 'AGT-1184').code, 'commission-inaccessible')
    assert.equal(access.checkAgentRecordAccess({ role: 'administrator' }, 'AGT-1184').allowed, true)

    const records = [{ agentId: 'AGT-2207' }, { agentId: 'AGT-1184' }, { agentId: 'AGT-2207' }]
    assert.equal(access.filterVisibleToActor(records, meera).length, 2)
    assert.equal(access.filterVisibleToActor(records, { role: 'administrator' }).length, 3)
    assert.equal(access.filterVisibleToActor(records, { role: 'agent', agentId: null }).length, 0)
  })

  test('only administrators may manage commission', () => {
    assert.equal(access.checkCommissionManageAccess({ role: 'administrator' }).allowed, true)
    assert.match(access.checkCommissionManageAccess({ role: 'agent' }, 'mark commission as paid').message, /Agent cannot mark commission as paid/)
    assert.equal(access.checkCommissionManageAccess({ role: 'policyholder' }).code, 'unauthorized')
  })
})

describe('summaries and query', () => {
  const rows = [
    { commissionId: 'COM-1', agentId: 'A', agentName: 'Zara', policyId: 'P1', policyholderName: 'Ravi', productName: 'Health', paymentId: 'PAY-1', transactionReference: 'MOCKTXN-AAA', paymentDate: '2025-01-01', amount: 0.1, status: 'pending' },
    { commissionId: 'COM-2', agentId: 'B', agentName: 'Anil', policyId: 'P2', policyholderName: 'Sita', productName: 'Life', paymentId: 'PAY-2', transactionReference: 'MOCKTXN-BBB', paymentDate: '2025-03-01', amount: 0.2, status: 'earned' },
    { commissionId: 'COM-3', agentId: 'A', agentName: 'Zara', policyId: 'P1', policyholderName: 'Ravi', productName: 'Health', paymentId: 'PAY-3', transactionReference: 'MOCKTXN-CCC', paymentDate: '2025-02-01', amount: 1046.25, status: 'paid' },
  ]

  test('totals are derived per status without floating-point error', () => {
    assert.deepEqual(summary.summariseCommissions(rows), {
      records: 3,
      total: 1046.55,
      pending: 0.1,
      earned: 0.2,
      paid: 1046.25,
      pendingCount: 1,
      earnedCount: 1,
      paidCount: 1,
      agents: 2,
      policies: 2,
    })
    assert.equal(summary.summariseCommissions([]).total, 0)
  })

  test('agent-wise summaries include agents with policies but no commission', () => {
    const agents = [
      { id: 'A', name: 'Zara', branch: 'X', status: 'active' },
      { id: 'C', name: 'Chen', branch: 'Y', status: 'active' },
    ]
    const policies = [{ id: 'P1', agent: { id: 'A' } }, { id: 'P9', agent: { id: 'C' } }]
    const [zara, chen] = summary.summariseByAgent(rows, agents, policies)
    assert.deepEqual([zara.records, zara.total, zara.pending, zara.paid, zara.policyCount], [2, 1046.35, 0.1, 1046.25, 1])
    assert.deepEqual([chen.records, chen.total, chen.policyCount], [0, 0, 1])
  })

  test('search covers commission, agent, policy, policyholder, product, payment and reference', () => {
    const ids = (query) => summary.queryCommissions(rows, query).map((row) => row.commissionId)
    assert.deepEqual(ids({ search: 'com-2' }), ['COM-2'])
    assert.deepEqual(ids({ search: 'zara' }), ['COM-3', 'COM-1'])
    assert.deepEqual(ids({ search: 'sita' }), ['COM-2'])
    assert.deepEqual(ids({ search: 'LIFE' }), ['COM-2'])
    assert.deepEqual(ids({ search: 'pay-3' }), ['COM-3'])
    assert.deepEqual(ids({ search: 'mockTxn-aaa' }), ['COM-1'])
    assert.deepEqual(ids({ search: 'nobody' }), [])
  })

  test('filters by status, agent and policy; sorts deterministically', () => {
    const ids = (query) => summary.queryCommissions(rows, query).map((row) => row.commissionId)
    assert.deepEqual(ids({ status: 'earned' }), ['COM-2'])
    assert.deepEqual(ids({ agentId: 'A' }), ['COM-3', 'COM-1'])
    assert.deepEqual(ids({ policyId: 'P2' }), ['COM-2'])
    assert.deepEqual(ids({ status: 'all', agentId: 'all' }), ['COM-2', 'COM-3', 'COM-1'])
    assert.deepEqual(ids({ sort: 'payment-asc' }), ['COM-1', 'COM-3', 'COM-2'])
    assert.deepEqual(ids({ sort: 'amount-desc' }), ['COM-3', 'COM-2', 'COM-1'])
    assert.deepEqual(ids({ sort: 'amount-asc' }), ['COM-1', 'COM-2', 'COM-3'])
    assert.deepEqual(ids({ sort: 'agent-asc' }), ['COM-2', 'COM-1', 'COM-3'])
    assert.deepEqual(ids({ sort: 'status' }), ['COM-1', 'COM-2', 'COM-3'])
  })

  test('run result text', () => {
    assert.equal(format.describeGenerationResult({ generated: [] }), 'No new commission was generated. Every eligible payment already has one.')
    assert.equal(
      format.describeGenerationResult({ generated: [{ commissionId: 'COM-1', amount: 255.75 }] }),
      'Generated 1 commission: COM-1 (₹255.75).',
    )
    assert.equal(
      format.describeEarningResult({ earned: ['COM-1', 'COM-2'], held: [{}] }),
      'Confirmed 2 commissions as earned: COM-1, COM-2. 1 commission still in the earning hold.',
    )
  })
})

describe('seed data integrity', () => {
  test('the agent registry matches the agents named on seed policies', () => {
    assert.equal(new Set(seed.agents.map((item) => item.id)).size, seed.agents.length)
    for (const pol of seed.policies) {
      const registered = agent(pol.agent.id)
      assert.ok(registered, `${pol.agent.id} registered`)
      assert.equal(registered.name, pol.agent.name)
      assert.equal(registered.branch, pol.agent.branch)
    }
    assert.ok(agent('AGT-0000'), 'the Module 1 session issuing agent is registered')
  })

  test('every seed commission recalculates exactly from its payment, policy and rule', () => {
    assert.equal(new Set(seed.commissions.map((item) => item.commissionId)).size, seed.commissions.length)
    assert.equal(new Set(seed.commissions.map((item) => item.paymentId)).size, seed.commissions.length, 'one commission per payment')

    for (const record of seed.commissions) {
      const payment = seed.payments.find((item) => item.paymentId === record.paymentId)
      const result = evaluate(payment)
      assert.equal(result.eligible, true, `${record.commissionId}: ${result.reason}`)
      const expected = result.preview
      for (const field of ['policyId', 'agentId', 'productId', 'installmentId', 'policyYear', 'basis', 'ruleId', 'ratePercent', 'commissionableAmount', 'amount']) {
        assert.equal(record[field], expected[field], `${record.commissionId}.${field}`)
      }
      assert.equal(eligibility.verifyCommissionLinkage(record, payment).valid, true)
    }
  })

  test('seed events form a valid lifecycle for every commission', () => {
    assert.equal(new Set(seed.events.map((event) => event.eventId)).size, seed.events.length)
    const statuses = {}
    for (const record of seed.commissions) {
      const state = lifecycle.deriveCommissionState(seed.events.filter((event) => event.commissionId === record.commissionId))
      assert.deepEqual(state.ignoredEvents, [], record.commissionId)
      statuses[record.commissionId] = state.status
      if (state.earnedAt) {
        const payment = seed.payments.find((item) => item.paymentId === record.paymentId)
        assert.ok(state.earnedAt.slice(0, 10) >= lifecycle.getEarnableFrom(payment.paymentDate), `${record.commissionId} earned after its hold`)
      }
      if (state.status === 'paid') assert.match(state.payoutReference, /^MOCKPAYOUT-/)
    }
    const counts = Object.values(statuses).reduce((acc, status) => ({ ...acc, [status]: (acc[status] ?? 0) + 1 }), {})
    assert.deepEqual(counts, { paid: 8, earned: 3, pending: 1 })
  })

  test('the seed book starts with one payment awaiting commission and no commission on failed payments', () => {
    const commissioned = new Set(seed.commissions.map((item) => item.paymentId))
    const awaiting = seed.payments.filter((payment) => payment.status === 'success' && !commissioned.has(payment.paymentId))
    assert.deepEqual(awaiting.map((payment) => payment.paymentId), ['PAY-2026-000036'])
    for (const payment of seed.payments.filter((item) => item.status !== 'success')) {
      assert.ok(!commissioned.has(payment.paymentId), payment.paymentId)
    }
  })

  test('configuration: statuses, hold and rate bounds', () => {
    assert.deepEqual(Object.values(constants.COMMISSION_STATUS), ['pending', 'earned', 'paid'])
    assert.equal(constants.COMMISSION_CONFIG.earningHoldDays, 30)
    assert.ok(constants.COMMISSION_CONFIG.minRatePercent > 0)
    assert.ok(seed.premium.parseInstallmentNumber('INS-2024-000226-008') === 8)
  })
})
