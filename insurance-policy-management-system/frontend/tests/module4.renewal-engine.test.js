/**
 * Module 4 — renewal engine, reminder rules, query and display helpers (pure).
 *
 * Every date-dependent call passes an explicit `asOf`, so these tests do not
 * depend on the run date. Test policies are derived from the seed Personal
 * Accident policy POL-2024-000519 (expiry 2026-11-09) with only IDs and dates
 * changed — see tests/fixtures/renewalFixtures.js.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'
import { derivePolicy, premiumSummary, reminderEvent } from './fixtures/renewalFixtures.js'

let harness
let engine
let rules
let query
let format
let constants
let dates
let seedPolicies
let seedReminders
let base

before(async () => {
  harness = await createHarness()
  engine = await harness.load('/src/utils/renewalEngine.js')
  rules = await harness.load('/src/utils/reminderRules.js')
  query = await harness.load('/src/utils/renewalQuery.js')
  format = await harness.load('/src/utils/renewalFormat.js')
  constants = await harness.load('/src/utils/constants.js')
  dates = await harness.load('/src/utils/dateUtils.js')
  seedPolicies = (await harness.load('/src/data/issuedPolicies.js')).issuedPolicies
  seedReminders = (await harness.load('/src/data/reminderHistory.js')).reminderHistory
  base = seedPolicies.find((policy) => policy.id === 'POL-2024-000519')
})

after(() => harness.close())

const EXPIRY = '2026-11-09'
const policyExpiring = (endDate = EXPIRY, overrides = {}) => derivePolicy(base, { id: `POL-T-${endDate}`, endDate, ...overrides })

const stageDates = (policy) =>
  Object.fromEntries(engine.buildStageSchedule(policy).map((stage) => [stage.id, stage.scheduledFor]))

/* ------------------------------------------------------------------ */

describe('configuration', () => {
  test('stages are centralised, unique and ordered 60/30/15/7/1/expiry/post-expiry', () => {
    const { stages } = constants.RENEWAL_CONFIG
    assert.deepEqual(
      engine.getOrderedStages().map((stage) => stage.offsetDays),
      [-60, -30, -15, -7, -1, 0, 7],
    )
    assert.equal(new Set(stages.map((stage) => stage.id)).size, stages.length)
    const channels = Object.values(constants.REMINDER_CHANNELS)
    assert.ok(stages.every((stage) => stage.label && channels.includes(stage.channel)))
  })

  test('status windows nest and the follow-up window covers the last stage', () => {
    const { statusWindows, followUpWindowDays, stages } = constants.RENEWAL_CONFIG
    assert.ok(statusWindows.upcomingDays > statusWindows.dueSoonDays)
    assert.ok(statusWindows.dueSoonDays > statusWindows.dueDays)
    assert.ok(followUpWindowDays >= Math.max(...stages.map((stage) => stage.offsetDays)))
  })
})

describe('days until expiry and renewal status', () => {
  const cases = [
    ['2026-09-08', 62, 'not-due'],
    ['2026-09-09', 61, 'not-due'],
    ['2026-09-10', 60, 'upcoming'],
    ['2026-10-09', 31, 'upcoming'],
    ['2026-10-10', 30, 'due-soon'],
    ['2026-10-25', 15, 'due-soon'],
    ['2026-11-01', 8, 'due-soon'],
    ['2026-11-02', 7, 'due'],
    ['2026-11-08', 1, 'due'],
    ['2026-11-09', 0, 'expiring-today'],
    ['2026-11-10', -1, 'expired'],
    ['2027-06-01', -204, 'expired'],
  ]

  for (const [asOf, days, status] of cases) {
    test(`as of ${asOf}: ${days} days, ${status}`, () => {
      const policy = policyExpiring()
      assert.equal(engine.getDaysUntilExpiry(policy, asOf), days)
      assert.equal(engine.getRenewalStatus(policy, asOf), status)
    })
  }

  test('invalid or missing expiry dates are reported as unknown, never guessed', () => {
    for (const endDate of [null, '', '2026-02-30', 'not-a-date']) {
      const policy = policyExpiring(EXPIRY, { endDate })
      assert.equal(engine.getDaysUntilExpiry(policy, '2026-09-15'), null)
      assert.equal(engine.getRenewalStatus(policy, '2026-09-15'), 'expiry-unknown')
      assert.deepEqual(engine.buildStageSchedule(policy), [])
      assert.equal(engine.getRenewalWindow(policy), null)
    }
    assert.equal(engine.getDaysUntilExpiry(policyExpiring(), 'garbage'), null)
    assert.equal(engine.getDaysUntilExpiry(null, '2026-09-15'), null)
  })

  test('day counts cross a leap day and a year boundary correctly', () => {
    assert.equal(engine.getDaysUntilExpiry(policyExpiring('2028-03-01'), '2028-02-28'), 2)
    assert.equal(engine.getDaysUntilExpiry(policyExpiring('2027-03-01'), '2027-02-28'), 1)
    assert.equal(engine.getDaysUntilExpiry(policyExpiring('2027-01-01'), '2026-12-31'), 1)
    assert.equal(engine.getDaysUntilExpiry(policyExpiring('2029-01-01'), '2028-01-01'), 366)
  })

  test('statuses are derived, not read from the stored policy status', () => {
    const storedExpired = policyExpiring(EXPIRY, { status: 'expired' })
    assert.equal(engine.getRenewalStatus(storedExpired, '2026-09-15'), 'upcoming')
  })
})

describe('reminder schedule', () => {
  test('stage dates for the seed Personal Accident policy', () => {
    assert.deepEqual(stageDates(base), {
      d60: '2026-09-10',
      d30: '2026-10-10',
      d15: '2026-10-25',
      d7: '2026-11-02',
      d1: '2026-11-08',
      d0: '2026-11-09',
      post: '2026-11-16',
    })
  })

  test('each stage is actionable until the day before the next one; the last until the window closes', () => {
    const schedule = engine.buildStageSchedule(base)
    assert.deepEqual(
      schedule.map((stage) => [stage.id, stage.actionableUntil]),
      [
        ['d60', '2026-10-09'],
        ['d30', '2026-10-24'],
        ['d15', '2026-11-01'],
        ['d7', '2026-11-07'],
        ['d1', '2026-11-08'],
        ['d0', '2026-11-15'],
        ['post', '2026-12-09'],
      ],
    )
    assert.deepEqual(engine.getRenewalWindow(base), { opensOn: '2026-09-10', expiresOn: EXPIRY, closesOn: '2026-12-09' })
  })

  test('leap year: a 1 March 2028 expiry has its 1-day reminder on 29 February', () => {
    const dates2028 = stageDates(policyExpiring('2028-03-01'))
    assert.equal(dates2028.d1, '2028-02-29')
    assert.equal(dates2028.d7, '2028-02-23')
    assert.equal(dates2028.d30, '2028-01-31')
    assert.equal(dates2028.d60, '2028-01-01')
  })

  test('non-leap year and month/year boundaries', () => {
    const march2027 = stageDates(policyExpiring('2027-03-01'))
    assert.equal(march2027.d1, '2027-02-28')
    assert.equal(march2027.d7, '2027-02-22')

    const newYear = stageDates(policyExpiring('2027-01-01'))
    assert.equal(newYear.d1, '2026-12-31')
    assert.equal(newYear.d60, '2026-11-02')
    assert.equal(newYear.post, '2027-01-08')

    const monthEnd = stageDates(policyExpiring('2026-05-31'))
    assert.equal(monthEnd.d30, '2026-05-01')
    assert.equal(monthEnd.post, '2026-06-07')
  })

  const currentCases = [
    ['2026-09-09', null],
    ['2026-09-10', 'd60'],
    ['2026-10-09', 'd60'],
    ['2026-10-10', 'd30'],
    ['2026-10-24', 'd30'],
    ['2026-10-25', 'd15'],
    ['2026-11-02', 'd7'],
    ['2026-11-07', 'd7'],
    ['2026-11-08', 'd1'],
    ['2026-11-09', 'd0'],
    ['2026-11-15', 'd0'],
    ['2026-11-16', 'post'],
    ['2026-12-09', 'post'],
    ['2026-12-10', null],
  ]

  for (const [asOf, stageId] of currentCases) {
    test(`current stage as of ${asOf} is ${stageId ?? 'none'}`, () => {
      assert.equal(engine.getCurrentReminderStage(base, asOf)?.id ?? null, stageId)
    })
  }

  test('milestones mark reached dates completed and the next one current', () => {
    const milestones = engine.getRenewalMilestones(base, '2026-09-15')
    assert.deepEqual(
      milestones.map((item) => [item.stage, item.status]),
      [
        ['Cover started', 'completed'],
        ['Renewal window opens', 'completed'],
        ['Policy expires', 'current'],
        ['Follow-up window closes', 'upcoming'],
      ],
    )
    assert.deepEqual(engine.getRenewalMilestones(policyExpiring(EXPIRY, { endDate: null }), '2026-09-15'), [])
  })
})

describe('eligibility', () => {
  const at = '2026-09-15'

  test('issued, dated, active policies are eligible — even before their window opens', () => {
    assert.deepEqual(engine.evaluateRenewalEligibility(base, at), { eligible: true, code: 'eligible', reason: null })
    assert.equal(engine.evaluateRenewalEligibility(policyExpiring('2040-01-01'), at).eligible, true)
  })

  test('reasons for ineligibility are explicit', () => {
    const cases = [
      [null, 'policy-not-found'],
      [policyExpiring(EXPIRY, { status: 'pending', issueDate: null }), 'policy-not-issued'],
      [policyExpiring(EXPIRY, { endDate: null }), 'no-expiry-date'],
      [policyExpiring(EXPIRY, { status: 'lapsed' }), 'policy-lapsed'],
    ]
    for (const [policy, code] of cases) {
      const result = engine.evaluateRenewalEligibility(policy, at)
      assert.equal(result.eligible, false)
      assert.equal(result.code, code)
      assert.ok(result.reason)
    }
  })

  test('eligibility ends exactly 30 days after expiry', () => {
    assert.equal(engine.evaluateRenewalEligibility(base, '2026-12-09').eligible, true)
    const closed = engine.evaluateRenewalEligibility(base, '2026-12-10')
    assert.equal(closed.code, 'window-closed')
    assert.match(closed.reason, /30 days after expiry/)
  })

  test('only eligible policies are returned by getEligibleRenewalPolicies', () => {
    const pending = policyExpiring(EXPIRY, { id: 'POL-T-PENDING', status: 'pending', issueDate: null })
    const old = policyExpiring('2020-01-01')
    assert.deepEqual(
      engine.getEligibleRenewalPolicies([base, pending, old], at).map((policy) => policy.id),
      [base.id],
    )
  })
})

describe('reminder plan', () => {
  const plan = (history, asOf) => engine.buildReminderPlan(base, history, asOf)
  const stageState = (result) => Object.fromEntries(result.stages.map((stage) => [stage.id, stage.state]))

  test('with no history the current stage is due and later stages are scheduled', () => {
    const result = plan([], '2026-09-10')
    assert.deepEqual(stageState(result), {
      d60: 'due', d30: 'scheduled', d15: 'scheduled', d7: 'scheduled', d1: 'scheduled', d0: 'scheduled', post: 'scheduled',
    })
    assert.equal(result.currentStage.id, 'd60')
    assert.equal(result.currentStage.canTrigger, true)
    assert.equal(result.pendingAction, 'send')
    assert.deepEqual(result.nextReminder, {
      stageId: 'd60', label: '60 days before expiry', date: '2026-09-10', scheduledFor: '2026-09-10', dueNow: true, action: 'send',
    })
  })

  test('a sent stage is handled and the next reminder is the following stage', () => {
    const sent = reminderEvent({ policyId: base.id, stage: 'd60', scheduledFor: '2026-09-10' })
    const result = plan([sent], '2026-09-20')
    assert.equal(result.currentStage.state, 'sent')
    assert.equal(result.currentStage.canTrigger, false)
    assert.equal(result.pendingAction, null)
    assert.equal(result.lastReminder.reminderId, sent.reminderId)
    assert.equal(result.nextReminder.stageId, 'd30')
    assert.equal(result.nextReminder.date, '2026-10-10')
    assert.equal(result.nextReminder.dueNow, false)
  })

  test('a failed stage needs a retry; a later successful retry handles it', () => {
    const failed = reminderEvent({ policyId: base.id, stage: 'd60', status: 'failed' })
    const failedPlan = plan([failed], '2026-09-12')
    assert.equal(failedPlan.currentStage.state, 'failed')
    assert.equal(failedPlan.currentStage.canRetry, true)
    assert.equal(failedPlan.currentStage.canTrigger, false)
    assert.equal(failedPlan.pendingAction, 'retry')
    assert.equal(failedPlan.nextReminder.action, 'retry')

    const retried = reminderEvent({ policyId: base.id, stage: 'd60', retryOf: failed.reminderId, trigger: 'retry' })
    const retriedPlan = plan([failed, retried], '2026-09-12')
    assert.equal(retriedPlan.currentStage.state, 'sent')
    assert.equal(retriedPlan.currentStage.attempts.length, 2)
    assert.equal(retriedPlan.pendingAction, null)
  })

  test('a skipped stage is handled and is not offered again', () => {
    const skipped = reminderEvent({ policyId: base.id, stage: 'd60', status: 'skipped' })
    const result = plan([skipped], '2026-09-12')
    assert.equal(result.currentStage.state, 'skipped')
    assert.equal(result.currentStage.handled, true)
    assert.equal(result.pendingAction, null)
  })

  test('stages that passed without an attempt are missed, not due', () => {
    const result = plan([], '2026-10-25')
    assert.equal(stageState(result).d60, 'missed')
    assert.equal(stageState(result).d30, 'missed')
    assert.equal(result.currentStage.id, 'd15')
    assert.equal(result.stages.find((stage) => stage.id === 'd60').canTrigger, false)
  })

  test("another policy's history never affects this plan", () => {
    const other = reminderEvent({ policyId: 'POL-OTHER', stage: 'd60' })
    assert.equal(plan([other], '2026-09-10').currentStage.state, 'due')
  })

  test('an ineligible policy has no actions and no next reminder', () => {
    const result = plan([], '2027-01-15')
    assert.equal(result.eligibility.eligible, false)
    assert.equal(result.currentStage, null)
    assert.equal(result.nextReminder, null)
    assert.ok(result.stages.every((stage) => !stage.canTrigger && !stage.canRetry))
  })

  test('before the window the next reminder is the first scheduled stage', () => {
    const result = plan([], '2026-08-01')
    assert.equal(result.currentStage, null)
    assert.equal(result.nextReminder.stageId, 'd60')
    assert.equal(result.nextReminder.dueNow, false)
  })
})

describe('renewal readiness', () => {
  const readiness = (policy, summary, asOf = '2026-09-15') =>
    engine.evaluateRenewalReadiness({ policy, premiumSummary: summary, asOf })
  const outcome = (result, id) => result.checks.find((check) => check.id === id)?.outcome

  test('ready when in the window with no premium overdue', () => {
    const result = readiness(base, premiumSummary('up-to-date'))
    assert.equal(result.verdict, 'ready')
    assert.ok(result.checks.every((check) => check.outcome === 'pass'))
    assert.deepEqual(result.reasons, [])
  })

  test('overdue premium is informational: action required, never blocked', () => {
    const result = readiness(base, premiumSummary('overdue'))
    assert.equal(result.verdict, 'action-required')
    assert.equal(outcome(result, 'premium-standing'), 'warning')
    assert.deepEqual(result.blocking, [])
    assert.match(result.informational[0], /Informational only/)
  })

  test('a missing premium schedule is a warning', () => {
    assert.equal(outcome(readiness(base, null), 'premium-standing'), 'warning')
  })

  test('before the window opens the verdict is window-not-open', () => {
    const result = readiness(policyExpiring('2030-01-01'), premiumSummary('fully-paid'))
    assert.equal(result.verdict, 'window-not-open')
    assert.equal(outcome(result, 'renewal-window'), 'warning')
  })

  test('closed window, lapsed, pending and missing policies are not eligible', () => {
    assert.equal(readiness(base, premiumSummary('fully-paid'), '2026-12-10').verdict, 'not-eligible')
    assert.equal(outcome(readiness(policyExpiring(EXPIRY, { status: 'lapsed' }), null), 'policy-condition'), 'blocked')

    const pending = readiness(policyExpiring(EXPIRY, { status: 'pending', issueDate: null }), null)
    assert.equal(pending.verdict, 'not-eligible')
    assert.equal(outcome(pending, 'policy-issued'), 'blocked')
    assert.equal(outcome(pending, 'premium-standing'), 'skipped')

    const missing = readiness(null, null)
    assert.equal(missing.verdict, 'not-eligible')
    assert.equal(missing.checks.length, 6)
  })
})

describe('portfolio summary and the reminder check plan', () => {
  const at = '2026-10-25'
  const buildAccounts = (policies, history = []) =>
    policies.map((policy) =>
      engine.buildRenewalAccount({ policy, history, premiumSummary: premiumSummary('up-to-date'), asOf: at }),
    )

  test('summary counts are derived from accounts', () => {
    const policies = [
      policyExpiring('2026-11-09'), // 15 days
      policyExpiring('2026-11-01'), // 7 days
      policyExpiring('2026-12-20'), // 56 days
      policyExpiring('2027-06-01'), // not due
      policyExpiring('2026-10-01'), // expired, still in follow-up window
      policyExpiring('2025-01-01'), // expired, window closed
    ]
    assert.deepEqual(engine.summariseRenewals(buildAccounts(policies)), {
      total: 6,
      eligible: 5,
      within60: 3,
      within30: 2,
      within7: 1,
      expired: 2,
      remindersPending: 4,
    })
  })

  test('plans generation, supersession, handled, retry, not-yet-due and not-eligible', () => {
    const due = policyExpiring('2026-11-09')
    // All three are in their 15-day stage on 25 Oct 2026.
    const handled = policyExpiring('2026-11-09', { id: 'POL-T-HANDLED' })
    const failed = policyExpiring('2026-11-08', { id: 'POL-T-FAILED' })
    const later = policyExpiring('2027-06-01')
    const closed = policyExpiring('2025-01-01')
    const history = [
      reminderEvent({ policyId: handled.id, stage: 'd15' }),
      reminderEvent({ policyId: handled.id, stage: 'd60' }),
      reminderEvent({ policyId: handled.id, stage: 'd30' }),
      reminderEvent({ policyId: failed.id, stage: 'd15', status: 'failed' }),
    ]

    const result = engine.planReminderCheck({ policies: [due, handled, failed, later, closed], history, asOf: at })
    assert.equal(result.evaluated, 5)
    assert.deepEqual(result.generate.map((item) => [item.policyId, item.stageId]), [[due.id, 'd15']])
    assert.deepEqual(result.alreadyHandled.map((item) => item.policyId), [handled.id])
    assert.deepEqual(result.needsRetry.map((item) => item.policyId), [failed.id])
    assert.equal(result.needsRetry[0].reminderId, history[3].reminderId)
    assert.deepEqual(result.notYetDue.map((item) => item.policyId), [later.id])
    assert.deepEqual(result.notEligible.map((item) => item.code), ['window-closed'])
    assert.deepEqual(
      result.supersede.map((item) => [item.policyId, item.stageId, item.supersededBy]).sort(),
      [
        [due.id, 'd30', 'd15'],
        [due.id, 'd60', 'd15'],
        [failed.id, 'd30', 'd15'],
        [failed.id, 'd60', 'd15'],
      ].sort(),
    )
  })

  test('running the check again on its own output generates nothing (idempotent)', () => {
    const policies = [policyExpiring('2026-11-09')]
    const first = engine.planReminderCheck({ policies, history: [], asOf: at })
    const recorded = [
      ...first.supersede.map((item) => reminderEvent({ policyId: item.policyId, stage: item.stageId, status: 'skipped' })),
      ...first.generate.map((item) => reminderEvent({ policyId: item.policyId, stage: item.stageId })),
    ]
    const second = engine.planReminderCheck({ policies, history: recorded, asOf: at })
    assert.equal(second.generate.length, 0)
    assert.equal(second.supersede.length, 0)
    assert.equal(second.alreadyHandled.length, 1)
  })
})

describe('reminder trigger and retry rules', () => {
  const plan = (history, asOf) => engine.buildReminderPlan(base, history, asOf)
  const trigger = (history, asOf, stageId, outcome = 'sent', channel) =>
    rules.checkReminderTrigger({ plan: plan(history, asOf), stageId, outcome, channel })

  test('a due stage may be triggered with any valid outcome and channel', () => {
    for (const outcome of ['sent', 'failed', 'skipped']) {
      assert.equal(trigger([], '2026-09-10', 'd60', outcome, 'sms').allowed, true)
    }
  })

  test('invalid stage, outcome and channel are rejected before anything else', () => {
    assert.equal(trigger([], '2026-09-10', 'd45').code, 'invalid-stage')
    assert.equal(trigger([], '2026-09-10', 'd60', 'delivered').code, 'invalid-outcome')
    assert.equal(trigger([], '2026-09-10', 'd60', 'sent', 'whatsapp').code, 'invalid-channel')
  })

  test('duplicates are refused for sent and skipped stages; failed stages require a retry', () => {
    const sent = reminderEvent({ policyId: base.id, stage: 'd60' })
    const skipped = reminderEvent({ policyId: base.id, stage: 'd60', status: 'skipped' })
    const failed = reminderEvent({ policyId: base.id, stage: 'd60', status: 'failed' })
    assert.equal(trigger([sent], '2026-09-10', 'd60').code, 'already-sent')
    assert.equal(trigger([skipped], '2026-09-10', 'd60').code, 'already-handled')
    assert.equal(trigger([failed], '2026-09-10', 'd60').code, 'retry-required')
  })

  test('future stages are not due, passed stages are closed, ineligible policies refused', () => {
    assert.equal(trigger([], '2026-09-10', 'd30').code, 'reminder-not-due')
    assert.equal(trigger([], '2026-10-25', 'd60').code, 'stage-closed')
    assert.equal(trigger([], '2027-01-01', 'post').code, 'not-eligible')
  })

  test('retry: only the latest failed attempt of the current stage', () => {
    const failed = reminderEvent({ policyId: base.id, stage: 'd60', status: 'failed', channel: 'email' })
    const retry = (reminder, history, asOf, outcome = 'sent', channel) =>
      rules.checkReminderRetry({ reminder, plan: plan(history, asOf), outcome, channel })

    assert.equal(retry(failed, [failed], '2026-09-12').allowed, true)
    assert.equal(retry(failed, [failed], '2026-09-12', 'failed').allowed, true)
    assert.equal(retry(failed, [failed], '2026-09-12', 'skipped').code, 'invalid-outcome')
    assert.equal(retry(failed, [failed], '2026-09-12', 'sent', 'fax').code, 'invalid-channel')
    assert.equal(rules.checkReminderRetry({ reminder: null, plan: null, outcome: 'sent' }).code, 'reminder-not-found')

    const sent = reminderEvent({ policyId: base.id, stage: 'd60', retryOf: failed.reminderId })
    assert.equal(retry(sent, [failed, sent], '2026-09-12').code, 'invalid-retry')
    assert.equal(retry(failed, [failed, sent], '2026-09-12').code, 'already-sent')

    const failedAgain = reminderEvent({ policyId: base.id, stage: 'd60', status: 'failed', retryOf: failed.reminderId })
    assert.equal(retry(failed, [failed, failedAgain], '2026-09-12').code, 'invalid-retry')
    assert.equal(retry(failedAgain, [failed, failedAgain], '2026-09-12').allowed, true)

    assert.equal(retry(failed, [failed], '2026-10-12').code, 'stage-closed')
    assert.equal(retry(failed, [failed], '2027-01-12').code, 'not-eligible')
  })
})

describe('renewal query', () => {
  const at = '2026-10-25'
  const rows = () =>
    [
      derivePolicy(base, { id: 'POL-Q-1', endDate: '2026-11-09', policyholder: { ...base.policyholder, name: 'Zara Iqbal' } }),
      derivePolicy(base, { id: 'POL-Q-2', endDate: '2026-11-01', productName: 'Motor Shield', policyholder: { ...base.policyholder, name: 'Aarav Mehta', customerId: 'CUS-Q2' } }),
      derivePolicy(base, { id: 'POL-Q-3', endDate: '2026-10-01', policyholder: { ...base.policyholder, name: 'Maya Rao' } }),
      derivePolicy(base, { id: 'POL-Q-4', endDate: null, policyholder: { ...base.policyholder, name: 'Neel Das' } }),
    ].map((policy, index) => ({
      ...engine.buildRenewalAccount({
        policy,
        history: [],
        premiumSummary: index === 3 ? null : premiumSummary(index === 1 ? 'overdue' : 'up-to-date'),
        asOf: at,
      }),
      policy: {
        productName: policy.productName,
        policyholderName: policy.policyholder.name,
        customerId: policy.policyholder.customerId,
      },
    }))
  const ids = (result) => result.map((row) => row.policyId)

  test('search matches policy ID, policyholder, customer ID and product, case-insensitively', () => {
    assert.deepEqual(ids(query.queryRenewals(rows(), { search: 'pol-q-3' })), ['POL-Q-3'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { search: 'aarav' })), ['POL-Q-2'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { search: 'cus-q2' })), ['POL-Q-2'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { search: 'MOTOR' })), ['POL-Q-2'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { search: 'nobody' })), [])
  })

  test('filters by renewal status, reminder stage and premium standing', () => {
    assert.deepEqual(ids(query.queryRenewals(rows(), { status: 'due' })), ['POL-Q-2'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { status: 'expiry-unknown' })), ['POL-Q-4'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { stage: 'd15' })), ['POL-Q-1'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { stage: 'none' })), ['POL-Q-4'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { premium: 'overdue' })), ['POL-Q-2'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { premium: 'none' })), ['POL-Q-4'])
    assert.equal(query.queryRenewals(rows(), { status: 'all', stage: 'all', premium: 'all' }).length, 4)
  })

  test('sorts by expiry, days remaining, urgency and policyholder; unknown expiry last', () => {
    assert.deepEqual(ids(query.queryRenewals(rows(), { sort: 'expiry-asc' })), ['POL-Q-3', 'POL-Q-2', 'POL-Q-1', 'POL-Q-4'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { sort: 'days-asc' })), ['POL-Q-2', 'POL-Q-1', 'POL-Q-3', 'POL-Q-4'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { sort: 'status' })), ['POL-Q-2', 'POL-Q-1', 'POL-Q-3', 'POL-Q-4'])
    assert.deepEqual(ids(query.queryRenewals(rows(), { sort: 'policyholder-asc' })), ['POL-Q-2', 'POL-Q-3', 'POL-Q-4', 'POL-Q-1'])
  })
})

describe('display helpers', () => {
  test('days remaining text', () => {
    assert.equal(format.describeDaysRemaining(55), '55 days left')
    assert.equal(format.describeDaysRemaining(1), '1 day left')
    assert.equal(format.describeDaysRemaining(0), 'Expires today')
    assert.equal(format.describeDaysRemaining(-1), 'Expired 1 day ago')
    assert.equal(format.describeDaysRemaining(-30), 'Expired 30 days ago')
    assert.equal(format.describeDaysRemaining(null), 'Expiry date unknown')
  })

  test('next reminder text and the next reminder date across accounts', () => {
    assert.equal(format.describeNextReminder(null).when, 'None scheduled')
    assert.equal(format.describeNextReminder({ dueNow: true, action: 'retry', label: 'x' }).when, 'Retry needed now')
    const accounts = [
      { nextReminder: { dueNow: true, date: '2026-09-15' } },
      { nextReminder: { dueNow: false, date: '2026-12-01' } },
      { nextReminder: { dueNow: false, date: '2026-10-10' } },
      { nextReminder: null },
    ]
    assert.equal(format.findNextReminderDate(accounts, '2026-09-15'), '2026-10-10')
    assert.equal(format.findNextReminderDate(accounts, '2026-12-01'), null)
    assert.equal(format.findNextReminderDate(accounts, 'bad'), null)
  })
})

describe('seed reminder history integrity', () => {
  test('IDs are unique and every event references an issued policy and a valid stage', () => {
    assert.equal(new Set(seedReminders.map((event) => event.reminderId)).size, seedReminders.length)
    for (const event of seedReminders) {
      const policy = seedPolicies.find((item) => item.id === event.policyId)
      assert.ok(policy && engine.isPolicyIssued(policy), `${event.reminderId} references an issued policy`)
      assert.ok(engine.isValidStage(event.stage), `${event.reminderId} stage`)
      assert.ok(['sent', 'failed', 'skipped'].includes(event.status))
      assert.ok(Object.values(constants.REMINDER_CHANNELS).includes(event.channel))
      assert.equal(event.scheduledFor, stageDates(policy)[event.stage], `${event.reminderId} scheduledFor matches its stage`)
      assert.equal(Boolean(event.sentAt), event.status === 'sent')
      assert.ok(dates.isValidIsoDate(event.evaluatedAsOf))
    }
  })

  test('retries link to a failed attempt for the same policy and stage', () => {
    const retries = seedReminders.filter((event) => event.retryOf)
    assert.ok(retries.length >= 1)
    for (const retry of retries) {
      const original = seedReminders.find((event) => event.reminderId === retry.retryOf)
      assert.equal(original.status, 'failed')
      assert.equal(original.policyId, retry.policyId)
      assert.equal(original.stage, retry.stage)
    }
  })

  test('no stage has more than one successful reminder', () => {
    const sent = seedReminders.filter((event) => event.status === 'sent').map((event) => `${event.policyId}:${event.stage}`)
    assert.equal(new Set(sent).size, sent.length)
  })

  test('seed data covers sent, failed-then-retried, failed-never-retried and skipped', () => {
    const statuses = new Set(seedReminders.map((event) => event.status))
    assert.deepEqual([...statuses].sort(), ['failed', 'sent', 'skipped'])
    const failedIds = seedReminders.filter((event) => event.status === 'failed').map((event) => event.reminderId)
    const retried = new Set(seedReminders.map((event) => event.retryOf).filter(Boolean))
    assert.ok(failedIds.some((id) => retried.has(id)))
    assert.ok(failedIds.some((id) => !retried.has(id)))
  })
})
