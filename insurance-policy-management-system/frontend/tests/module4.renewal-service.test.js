/**
 * Module 4 — renewal service: retrieval, role enforcement, the simulation
 * clock, the reminder check, manual triggers, failure and retry, duplicate
 * prevention, persistence across a reload, and integration with Modules 1–2.
 *
 * Reminder scenarios use POL-2024-000226 (Life, expiry 2049-07-04) with the
 * simulation clock moved forward to its reminder dates, so they do not depend
 * on the run date. Its stage dates:
 *   d60 2049-05-05 · d30 2049-06-04 · d15 2049-06-19 · d7 2049-06-27
 *   d1 2049-07-03 · d0 2049-07-04 · post 2049-07-11 · window closes 2049-08-03
 * By then every other demo policy is outside its reminder window.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'
import { loadMockPolicyRegister } from './fixtures/mockPolicyRegister.js'

const storage = installFakeSessionStorage()
const STORAGE_KEY = 'ipms.renewals.session'

let harness
let renewals
let policies
let premiums
let dates

const ADMIN = { role: 'administrator' }
const AGENT = { role: 'agent' }
const HOLDER = { role: 'policyholder' }
const LIFE = 'POL-2024-000226'
const HEALTH = 'POL-2024-000148'
const HOME = 'POL-2023-000874'
const MOTOR_PENDING = 'POL-2025-000031'

before(async () => {
  harness = await createHarness()
  renewals = await harness.load('/src/services/renewalService.js')
  // Module 1 now issues through the API; this module still reads the mock register.
  policies = await loadMockPolicyRegister(harness)
  premiums = await harness.load('/src/services/mockPremiumLedger.js')
  dates = await harness.load('/src/utils/dateUtils.js')
})

after(() => harness.close())

/** Assert a rejected ApiError with the given status and reason. */
const rejectsWith = (promise, status, reason) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.name, 'ApiError', error.message)
    assert.equal(error.status, status, `${error.status} ${error.data?.reason}: ${error.message}`)
    if (reason) assert.equal(error.data?.reason, reason)
    return true
  })

const lifeStage = async (stageId) =>
  (await renewals.getRenewalPolicyById(LIFE)).account.plan.stages.find((stage) => stage.id === stageId)

const forPolicy = (items, policyId) => items.filter((item) => item.policyId === policyId)

/* ------------------------------------------------------------------ */

describe('retrieval', () => {
  before(() => renewals.resetRenewalSimulation(ADMIN))

  test('lists issued policies with a derived summary and today as the engine date', async () => {
    const result = await renewals.getRenewalPolicies()
    assert.equal(result.clock.asOf, dates.todayIso())
    assert.equal(result.clock.isSimulated, false)
    assert.equal(result.total, 4)
    assert.equal(result.notIssued, 1)
    assert.equal(result.items.length, 4)
    assert.ok(!result.items.some((item) => item.policyId === MOTOR_PENDING), 'pending policy excluded')

    const { summary, items } = result
    assert.equal(summary.total, items.length)
    assert.equal(summary.eligible, items.filter((item) => item.eligibility.eligible).length)
    assert.equal(summary.expired, items.filter((item) => item.status === 'expired').length)
    assert.equal(summary.remindersPending, items.filter((item) => item.plan.pendingAction).length)
    assert.ok(summary.within7 <= summary.within30 && summary.within30 <= summary.within60)
  })

  test('each item carries status, stage, next reminder, readiness and premium standing', async () => {
    const { items } = await renewals.getRenewalPolicies()
    for (const item of items) {
      assert.ok(item.policy.productName && item.policy.policyholderName)
      assert.ok(item.status)
      assert.ok(item.readiness.verdict)
      assert.ok('currentStageId' in item && 'nextReminder' in item && 'premiumStanding' in item)
    }
  })

  test('recent reminders are newest first, labelled and marked as mock', async () => {
    const { recentReminders } = await renewals.getRenewalPolicies()
    assert.ok(recentReminders.length > 0 && recentReminders.length <= 6)
    const times = recentReminders.map((event) => event.attemptedAt)
    assert.deepEqual(times, [...times].sort().reverse())
    assert.ok(recentReminders.every((event) => event.isMock && event.stageLabel && event.channelLabel))
  })

  test('search, filters and sort are applied by the service; summary stays unfiltered', async () => {
    const searched = await renewals.getRenewalPolicies({ search: 'vikram' })
    assert.deepEqual(searched.items.map((item) => item.policyId), [LIFE])
    assert.equal(searched.summary.total, 4)

    const expired = await renewals.getRenewalPolicies({ status: 'expired' })
    assert.ok(expired.items.every((item) => item.status === 'expired'))
    assert.ok(expired.items.some((item) => item.policyId === HOME))

    const none = await renewals.getRenewalPolicies({ search: 'no such policyholder' })
    assert.equal(none.items.length, 0)
  })

  test('details include the account, premium context, history and milestones', async () => {
    const details = await renewals.getRenewalPolicyById(HEALTH)
    assert.equal(details.issued, true)
    assert.equal(details.policy.id, HEALTH)
    assert.equal(details.account.status, 'expired')
    assert.equal(details.account.eligibility.eligible, false)
    assert.equal(details.history.length, 8)
    assert.equal(details.milestones.length, 4)
    assert.ok(details.premium && details.premium.standing)
  })

  test('a pending policy is shown as not issued and not eligible', async () => {
    const details = await renewals.getRenewalPolicyById(MOTOR_PENDING)
    assert.equal(details.issued, false)
    assert.equal(details.account.readiness.verdict, 'not-eligible')
    assert.equal(details.account.eligibility.code, 'policy-not-issued')
  })

  test('reminder history is newest first and keeps retry links', async () => {
    const { items, total } = await renewals.getReminderHistory(HEALTH)
    assert.equal(total, 8)
    const retry = items.find((event) => event.retryOf)
    assert.equal(retry.retryOf, 'RMD-2025-000040')
    assert.ok(items.findIndex((event) => event.reminderId === retry.reminderId) < items.findIndex((event) => event.reminderId === 'RMD-2025-000040'))
  })

  test('unknown policies are 404', async () => {
    await rejectsWith(renewals.getRenewalPolicyById('POL-0000-000000'), 404, 'policy-not-found')
    await rejectsWith(renewals.getReminderHistory('POL-0000-000000'), 404, 'policy-not-found')
    await rejectsWith(renewals.getReminderPlan('POL-0000-000000'), 404, 'policy-not-found')
  })

  test('the reminder plan can be projected for any date without recording anything', async () => {
    const plan = await renewals.getReminderPlan(LIFE, '2049-05-05')
    assert.equal(plan.currentStage.id, 'd60')
    assert.equal(plan.currentStage.state, 'due')
    assert.equal((await renewals.getReminderHistory(LIFE)).total, 0)
    await rejectsWith(renewals.getReminderPlan(LIFE, '2049-02-30'), 422, 'invalid-date')
  })
})

describe('role enforcement', () => {
  test('policyholders cannot run the reminder check', async () => {
    await assert.rejects(renewals.runReminderCheck(HOLDER), (error) => {
      assert.equal(error.status, 403)
      assert.equal(error.data.reason, 'unauthorized')
      assert.match(error.message, /Policyholder cannot run the reminder check\. Only an Agent or Administrator can\./)
      return true
    })
    await rejectsWith(renewals.runReminderCheck({}), 403, 'unauthorized')
  })

  test('only administrators trigger, retry, move or reset the simulation', async () => {
    for (const actor of [AGENT, HOLDER]) {
      await rejectsWith(renewals.triggerReminder(LIFE, 'd60', actor), 403, 'unauthorized')
      await rejectsWith(renewals.retryReminder('RMD-2024-000058', actor), 403, 'unauthorized')
      await rejectsWith(renewals.advanceRenewalClock('2049-05-05', actor), 403, 'unauthorized')
      await rejectsWith(renewals.resetRenewalSimulation(actor), 403, 'unauthorized')
    }
    const { clock } = await renewals.getRenewalPolicies()
    assert.equal(clock.isSimulated, false, 'rejected calls change nothing')
  })

  test('role is checked before the policy, so unauthorised callers learn nothing', async () => {
    await rejectsWith(renewals.triggerReminder('POL-0000-000000', 'd60', AGENT), 403, 'unauthorized')
  })
})

describe('simulation clock', () => {
  test('rejects invalid dates', async () => {
    for (const date of ['', '2049-13-01', 'tomorrow', null]) {
      await rejectsWith(renewals.advanceRenewalClock(date, ADMIN), 422, 'invalid-date')
    }
  })

  test('moves forward, never backwards', async () => {
    const clock = await renewals.advanceRenewalClock('2049-05-05', ADMIN)
    assert.deepEqual(clock, { asOf: '2049-05-05', today: dates.todayIso(), isSimulated: true })
    await rejectsWith(renewals.advanceRenewalClock('2049-05-04', ADMIN), 422, 'clock-backwards')
    await rejectsWith(renewals.advanceRenewalClock(dates.todayIso(), ADMIN), 422, 'clock-backwards')
    assert.equal((await renewals.advanceRenewalClock('2049-05-05', ADMIN)).asOf, '2049-05-05', 'same date is allowed')
    assert.equal((await renewals.getRenewalClock()).asOf, '2049-05-05')
  })

  test('status and premium standing are evaluated as of the engine date', async () => {
    const details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.account.asOf, '2049-05-05')
    assert.equal(details.account.daysUntilExpiry, 60)
    assert.equal(details.account.status, 'upcoming')
    const snapshot = premiums.getPremiumAccountSnapshot(LIFE, '2049-05-05')
    assert.equal(details.premium.standing, snapshot.summary.standing)
    assert.equal(details.account.premiumStanding, snapshot.summary.standing)
  })
})

describe('reminder check and duplicate prevention', () => {
  let firstRun

  test('overdue premium is informational: the due reminder is still offered', async () => {
    const details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.premium.standing, 'overdue')
    assert.equal(details.account.readiness.verdict, 'action-required')
    assert.equal(details.account.plan.currentStage.canTrigger, true)
  })

  test('an agent run records one simulated reminder for the due stage', async () => {
    firstRun = await renewals.runReminderCheck(AGENT)
    assert.equal(firstRun.asOf, '2049-05-05')
    assert.equal(firstRun.runBy.role, 'agent')
    assert.equal(firstRun.counts.evaluated, firstRun.evaluated)

    const [event, ...extra] = forPolicy(firstRun.generated, LIFE)
    assert.equal(extra.length, 0)
    assert.equal(event.stage, 'd60')
    assert.equal(event.status, 'sent')
    assert.equal(event.trigger, 'reminder-check')
    assert.equal(event.channel, 'email')
    assert.equal(event.scheduledFor, '2049-05-05')
    assert.equal(event.evaluatedAsOf, '2049-05-05')
    assert.ok(event.sentAt)
    assert.match(event.reminderId, /^RMD-2049-\d{6}$/)
    assert.match(event.result, /No real message was sent/)
    assert.deepEqual(forPolicy(firstRun.skippedSuperseded, LIFE), [])
    assert.ok(firstRun.counts.notEligible >= 3)
  })

  test('running the check again creates no duplicate', async () => {
    const second = await renewals.runReminderCheck(ADMIN)
    assert.deepEqual(forPolicy(second.generated, LIFE), [])
    assert.equal(forPolicy(second.alreadyHandled, LIFE)[0].stageId, 'd60')
    assert.equal((await renewals.getReminderHistory(LIFE)).total, 1)
  })

  test('manual trigger of a sent stage is refused; future stages are not due', async () => {
    await rejectsWith(renewals.triggerReminder(LIFE, 'd60', ADMIN), 409, 'already-sent')
    await rejectsWith(renewals.triggerReminder(LIFE, 'd30', ADMIN), 409, 'reminder-not-due')
    assert.equal((await renewals.getReminderHistory(LIFE)).total, 1)
  })

  test('invalid stage, outcome, channel and policy are validated', async () => {
    await rejectsWith(renewals.triggerReminder(LIFE, 'd45', ADMIN), 422, 'invalid-stage')
    await rejectsWith(renewals.triggerReminder(LIFE, 'd60', ADMIN, { outcome: 'bounced' }), 422, 'invalid-outcome')
    await rejectsWith(renewals.triggerReminder(LIFE, 'd60', ADMIN, { channel: 'whatsapp' }), 422, 'invalid-channel')
    await rejectsWith(renewals.triggerReminder('POL-0000-000000', 'd60', ADMIN), 404, 'policy-not-found')
  })

  test('the plan shows the handled stage and the next reminder', async () => {
    const details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.account.plan.currentStage.state, 'sent')
    assert.equal(details.account.plan.pendingAction, null)
    assert.equal(details.account.nextReminder.stageId, 'd30')
    assert.equal(details.account.nextReminder.date, '2049-06-04')
    assert.equal(details.account.lastReminder.stage, 'd60')
  })
})

describe('failure, retry and skipping', () => {
  let failed

  before(() => renewals.advanceRenewalClock('2049-06-19', ADMIN))

  test('a missed stage cannot be triggered late', async () => {
    assert.equal((await lifeStage('d30')).state, 'missed')
    await rejectsWith(renewals.triggerReminder(LIFE, 'd30', ADMIN), 409, 'stage-closed')
  })

  test('an administrator can record a simulated failure', async () => {
    const { reminder, details } = await renewals.triggerReminder(LIFE, 'd15', ADMIN, { outcome: 'failed', channel: 'sms' })
    failed = reminder
    assert.equal(reminder.status, 'failed')
    assert.equal(reminder.sentAt, null)
    assert.equal(reminder.channel, 'sms')
    assert.equal(reminder.trigger, 'manual')
    assert.equal(reminder.createdBy.role, 'administrator')
    assert.match(reminder.result, /No real provider was contacted/)
    assert.equal(details.account.plan.currentStage.state, 'failed')
    assert.equal(details.account.plan.pendingAction, 'retry')
  })

  test('a failed stage requires a retry, not a new trigger', async () => {
    await rejectsWith(renewals.triggerReminder(LIFE, 'd15', ADMIN), 409, 'retry-required')
  })

  test('the check skips the missed stage and reports the retry without retrying automatically', async () => {
    const run = await renewals.runReminderCheck(AGENT)
    assert.deepEqual(forPolicy(run.generated, LIFE), [])
    const [skipped] = forPolicy(run.skippedSuperseded, LIFE)
    assert.equal(skipped.stage, 'd30')
    assert.equal(skipped.status, 'skipped')
    assert.match(skipped.result, /Skipped automatically/)
    assert.equal(forPolicy(run.needsRetry, LIFE)[0].reminderId, failed.reminderId)

    await rejectsWith(renewals.triggerReminder(LIFE, 'd30', ADMIN), 409, 'already-handled')
    const again = await renewals.runReminderCheck(AGENT)
    assert.deepEqual(forPolicy(again.skippedSuperseded, LIFE), [], 'skips are not duplicated either')
  })

  test('retries are new linked events; only the latest failed attempt can be retried', async () => {
    const { reminder: failedAgain } = await renewals.retryReminder(failed.reminderId, ADMIN, { outcome: 'failed' })
    assert.equal(failedAgain.retryOf, failed.reminderId)
    assert.equal(failedAgain.trigger, 'retry')
    assert.equal(failedAgain.channel, 'sms', 'channel carries over')

    await rejectsWith(renewals.retryReminder(failed.reminderId, ADMIN), 409, 'invalid-retry')
    await rejectsWith(renewals.retryReminder(failedAgain.reminderId, ADMIN, { outcome: 'skipped' }), 422, 'invalid-outcome')

    const { reminder: sent, details } = await renewals.retryReminder(failedAgain.reminderId, ADMIN, { channel: 'email' })
    assert.equal(sent.status, 'sent')
    assert.equal(sent.retryOf, failedAgain.reminderId)
    assert.equal(details.account.plan.currentStage.state, 'sent')

    await rejectsWith(renewals.retryReminder(failedAgain.reminderId, ADMIN), 409, 'already-sent')
    await rejectsWith(renewals.retryReminder(failed.reminderId, ADMIN), 409, 'already-sent')
    await rejectsWith(renewals.retryReminder(sent.reminderId, ADMIN), 409, 'invalid-retry')

    const history = (await renewals.getReminderHistory(LIFE)).items
    const d15 = history.filter((event) => event.stage === 'd15')
    assert.deepEqual(d15.map((event) => event.status).sort(), ['failed', 'failed', 'sent'])
    assert.equal(history.find((event) => event.reminderId === failed.reminderId).status, 'failed', 'original attempt unchanged')
  })

  test('concurrent submissions cannot both succeed', async () => {
    await renewals.advanceRenewalClock('2049-06-27', ADMIN)
    const results = await Promise.allSettled([
      renewals.triggerReminder(LIFE, 'd7', ADMIN),
      renewals.triggerReminder(LIFE, 'd7', ADMIN),
    ])
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
    assert.equal(results.find((result) => result.status === 'rejected').reason.data.reason, 'already-sent')
  })

  test('retrying reminders that are not failed, unknown or out of window is refused', async () => {
    await rejectsWith(renewals.retryReminder('RMD-2025-000012', ADMIN), 409, 'invalid-retry')
    await rejectsWith(renewals.retryReminder('RMD-9999-000000', ADMIN), 404, 'reminder-not-found')
    await rejectsWith(renewals.retryReminder('RMD-2024-000058', ADMIN), 409, 'not-eligible')
  })

  test('an administrator can skip a stage with a note', async () => {
    await renewals.advanceRenewalClock('2049-07-03', ADMIN)
    const { reminder } = await renewals.triggerReminder(LIFE, 'd1', ADMIN, { outcome: 'skipped', note: 'Customer confirmed renewal by phone.' })
    assert.equal(reminder.status, 'skipped')
    assert.equal(reminder.note, 'Customer confirmed renewal by phone.')
    assert.match(reminder.result, /Customer confirmed renewal by phone/)
    await rejectsWith(renewals.triggerReminder(LIFE, 'd1', ADMIN), 409, 'already-handled')
  })

  test('expiry and post-expiry stages never change the policy itself', async () => {
    await renewals.advanceRenewalClock('2049-07-04', ADMIN)
    let details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.account.status, 'expiring-today')
    assert.equal(details.account.currentStageId, 'd0')

    await renewals.advanceRenewalClock('2049-07-12', ADMIN)
    details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.account.status, 'expired')
    assert.equal(details.account.currentStageId, 'post')
    assert.equal((await lifeStage('d0')).state, 'missed')

    const { reminder } = await renewals.triggerReminder(LIFE, 'post', ADMIN)
    assert.equal(reminder.status, 'sent')

    const policy = await policies.getIssuedPolicyById(LIFE)
    assert.equal(policy.status, 'active', 'this module never changes policy status')
    assert.equal(policy.endDate, '2049-07-04')
  })

  test('after the follow-up window closes nothing more can be recorded', async () => {
    await renewals.advanceRenewalClock('2049-08-04', ADMIN)
    const details = await renewals.getRenewalPolicyById(LIFE)
    assert.equal(details.account.eligibility.code, 'window-closed')
    await rejectsWith(renewals.triggerReminder(LIFE, 'post', ADMIN), 409, 'not-eligible')
    const run = await renewals.runReminderCheck(ADMIN)
    assert.equal(run.counts.generated, 0)
  })
})

describe('persistence', () => {
  test('reminders and the engine date survive a page reload', async () => {
    const stored = JSON.parse(storage.getItem(STORAGE_KEY))
    assert.equal(stored.version, 1)
    assert.equal(stored.simulationDate, '2049-08-04')
    const before = await renewals.getReminderHistory(LIFE)
    assert.ok(before.total >= 7)

    const reloaded = await createHarness()
    try {
      const fresh = await reloaded.load('/src/services/renewalService.js')
      assert.equal((await fresh.getReminderHistory(LIFE)).total, before.total)
      assert.equal((await fresh.getRenewalClock()).asOf, '2049-08-04')
      assert.equal((await fresh.getReminderHistory(HEALTH)).total, 8, 'seed history intact')
    } finally {
      await reloaded.close()
    }
  })

  test('reminder IDs continue after a reload', async () => {
    const ids = (await renewals.getReminderHistory(LIFE)).items.map((event) => event.reminderId)
    const reloaded = await createHarness()
    try {
      const fresh = await reloaded.load('/src/services/renewalService.js')
      const plan = await fresh.getReminderPlan(LIFE)
      assert.equal(plan.eligibility.eligible, false)
      const highest = Math.max(...ids.filter((id) => id.startsWith('RMD-2049-')).map((id) => Number(id.slice(9))))
      assert.equal(highest, ids.length, 'sequential with no gaps or reuse')
    } finally {
      await reloaded.close()
    }
  })

  test('corrupted or foreign storage falls back to seed history and today', async () => {
    const saved = storage.getItem(STORAGE_KEY)
    const values = [
      '{not json',
      JSON.stringify({ version: 99, reminders: [], simulationDate: '2049-01-01' }),
      JSON.stringify({ version: 1, reminders: 'nope' }),
      JSON.stringify({ version: 1, reminders: [{ reminderId: 'RMD-BAD' }], simulationDate: 'not-a-date' }),
    ]
    try {
      for (const value of values) {
        storage.setItem(STORAGE_KEY, value)
        const reloaded = await createHarness()
        try {
          const fresh = await reloaded.load('/src/services/renewalService.js')
          assert.equal((await fresh.getReminderHistory(LIFE)).total, 0, `fallback for ${value.slice(0, 24)}`)
          assert.equal((await fresh.getReminderHistory(HEALTH)).total, 8)
          assert.equal((await fresh.getRenewalClock()).isSimulated, false)
        } finally {
          await reloaded.close()
        }
      }
    } finally {
      storage.setItem(STORAGE_KEY, saved)
    }
  })

  test('reset returns to today and discards session reminders only', async () => {
    const clock = await renewals.resetRenewalSimulation(ADMIN)
    assert.equal(clock.isSimulated, false)
    assert.equal((await renewals.getReminderHistory(LIFE)).total, 0)
    assert.equal((await renewals.getReminderHistory(HOME)).total, 7)
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).reminders, [])
  })
})

describe('integration with Modules 1 and 2', () => {
  test('a policy issued through Module 1 is tracked with its schedule and premium standing', async () => {
    const policy = await policies.issuePolicy({
      productId: 'PRD-HLT-001',
      values: {
        fullName: 'Renewal Integration Holder',
        customerId: '',
        dateOfBirth: '1985-06-06',
        email: 'renewal@example.com',
        phone: '9845012399',
        addressLine1: '4 Test Road',
        addressLine2: '',
        city: 'Pune',
        state: 'Maharashtra',
        postalCode: '411001',
        coverageAmount: '500000',
        startDate: dates.todayIso(),
        durationYears: '1',
        premiumFrequency: 'Annual',
        nomineeName: 'Test Nominee',
        nomineeRelationship: 'Spouse',
        nomineeDateOfBirth: '1987-01-01',
      },
    })

    const { items, total } = await renewals.getRenewalPolicies()
    assert.equal(total, 5)
    const account = items.find((item) => item.policyId === policy.id)
    assert.ok(account, 'newly issued policy appears in renewals')
    assert.equal(account.status, 'not-due')
    assert.equal(account.eligibility.eligible, true)
    assert.equal(account.policy.policyholderName, 'Renewal Integration Holder')
    assert.equal(account.nextReminder.stageId, 'd60')
    assert.equal(account.nextReminder.date, dates.addDaysIso(policy.endDate, -60))

    const snapshot = premiums.getPremiumAccountSnapshot(policy.id, dates.todayIso())
    assert.equal(account.premiumStanding, snapshot?.summary.standing ?? null)

    const run = await renewals.runReminderCheck(AGENT)
    assert.ok(run.notYetDue >= 1)
    assert.deepEqual(forPolicy(run.generated, policy.id), [])
  })
})
