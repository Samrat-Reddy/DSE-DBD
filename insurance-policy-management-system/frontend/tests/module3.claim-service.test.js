/**
 * Module 3 — claim service: filing, retrieval, the full workflow through the
 * real service, enforcement of invalid and unauthorized changes, persistence
 * across a page reload, and integration with Modules 1 and 2.
 *
 * Filing uses POL-2024-000226 (cover runs to 2049) with an incident a few days
 * before today, so these tests do not depend on the run date.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'
import { loadMockPolicyRegister } from './fixtures/mockPolicyRegister.js'

const storage = installFakeSessionStorage()

let harness
let claims
let policies
let premiums
let dates

const ADMIN = { role: 'administrator' }
const HOLDER = { role: 'policyholder' }
const AGENT = { role: 'agent' }
const LIFE = 'POL-2024-000226'

before(async () => {
  harness = await createHarness()
  claims = await harness.load('/src/services/mockClaimLedger.js')
  // Module 1 now issues through the API; this module still reads the mock register.
  policies = await loadMockPolicyRegister(harness)
  premiums = await harness.load('/src/services/mockPremiumLedger.js')
  dates = await harness.load('/src/utils/dateUtils.js')
})

after(() => harness.close())

const daysAgo = (days) => dates.addDaysIso(dates.todayIso(), -days)

const lifeClaimValues = (overrides = {}) => ({
  policyId: LIFE,
  claimType: 'terminal-illness',
  incidentDate: daysAgo(5),
  claimedAmount: '1500000',
  description: 'Diagnosis confirmed by two independent specialists after further tests this month.',
  documents: {
    'specialist-report': { provided: true, fileName: 'specialist-report.pdf' },
    identity: { provided: true, fileName: 'identity.pdf' },
  },
  ...overrides,
})

/** Assert a rejected ApiError with the given status and reason. */
const rejectsWith = (promise, status, reason) =>
  assert.rejects(promise, (error) => {
    assert.equal(error.name, 'ApiError', error.message)
    assert.equal(error.status, status, `${error.status} ${error.data?.reason}: ${error.message}`)
    if (reason) assert.equal(error.data?.reason, reason)
    return true
  })

/* ------------------------------------------------------------------ */

describe('retrieval', () => {
  test('lists claims with derived summary counts', async () => {
    const result = await claims.getClaims()
    assert.equal(result.total, 8)
    assert.equal(result.summary.settled, 1)
    assert.equal(result.summary.open, 5)
    assert.ok(result.items.every((item) => item.claimTypeLabel && item.policyholderName))
    assert.ok(result.claimTypeOptions.length >= 9)
  })

  test('the service applies search, status and claim type filters', async () => {
    assert.deepEqual((await claims.getClaims({ search: 'CLM-2024-000087' })).items.map((item) => item.claimId), ['CLM-2024-000087'])
    assert.equal((await claims.getClaims({ search: 'Farhan' })).total, 5)
    assert.equal((await claims.getClaims({ status: 'rejected' })).total, 1)
    assert.equal((await claims.getClaims({ claimType: 'hospitalisation' })).total, 1)
  })

  test('a claim resolves with policy, coverage, premium and workflow context', async () => {
    const details = await claims.getClaimById('CLM-2026-000071')
    assert.equal(details.claim.status, 'assessed')
    assert.equal(details.policy.id, 'POL-2024-000519')
    assert.equal(details.coverage.coverageItem.name, 'Permanent partial disability')
    assert.equal(details.coverage.limit.limit, 1250000)
    assert.equal(details.decisionSummary.assessedAmount, 375000)
    assert.deepEqual(details.allowedTransitions.map((item) => item.toStatus).sort(), ['approved', 'rejected'])
    assert.equal(details.policyError, null)
  })

  test('unknown claim and unknown policy reject with 404', async () => {
    await rejectsWith(claims.getClaimById('CLM-0000-000000'), 404, 'claim-not-found')
    await rejectsWith(claims.getClaimsByPolicyId('POL-0000-000000'), 404, 'policy-not-found')
    await rejectsWith(claims.getClaimFilingContext('POL-0000-000000'), 404, 'policy-not-found')
  })

  test('claims by policy', async () => {
    const result = await claims.getClaimsByPolicyId('POL-2024-000519')
    assert.equal(result.total, 5)
    assert.ok(result.items.every((item) => item.policyId === 'POL-2024-000519'))
  })

  test('every policy is listed with eligibility, eligible first', async () => {
    const result = await claims.getEligiblePoliciesForClaim({ asOf: '2026-09-15' })
    assert.equal(result.items.length, 5)
    assert.equal(result.eligibleCount, 2)
    assert.ok(result.items[0].eligibility.eligible && result.items[1].eligibility.eligible)
    assert.equal(result.items.find((item) => item.policy.id === 'POL-2025-000031').eligibility.eligible, false)
  })

  test('filing context offers only claim types the policy covers', async () => {
    const context = await claims.getClaimFilingContext('POL-2024-000519', { asOf: '2026-09-15' })
    assert.equal(context.eligibility.eligible, true)
    assert.deepEqual(context.claimTypes.map((type) => type.value).sort(), ['permanent-disability', 'temporary-disablement'])
    assert.equal(context.claimTypes.find((type) => type.value === 'temporary-disablement').illustrativeLimit.limit, 2500000)
  })
})

/* ------------------------------------------------------------------ */

describe('filing', () => {
  let filed

  test('a policyholder files a valid claim: ID generated, SUBMITTED, activity recorded', async () => {
    filed = await claims.createClaim(lifeClaimValues(), HOLDER)
    const { claim } = filed
    const year = dates.todayIso().slice(0, 4)

    assert.match(claim.claimId, new RegExp(`^CLM-${year}-\\d{6}$`))
    assert.equal(claim.status, 'submitted')
    assert.equal(claim.filingDate, dates.todayIso())
    assert.equal(claim.policyId, LIFE)
    assert.equal(claim.policyholderId, 'CUS-100388')
    assert.equal(claim.claimedAmount, 1500000)
    assert.equal(claim.filedBy.name, 'Vikram Desai')
    assert.equal(claim.documents.length, 2)
    assert.ok(claim.documents.every((doc) => doc.status === 'submitted'))

    assert.equal(claim.activity.length, 1)
    assert.deepEqual(
      { from: claim.activity[0].fromStatus, to: claim.activity[0].toStatus, role: claim.activity[0].actor.role },
      { from: 'draft', to: 'submitted', role: 'policyholder' },
    )
  })

  test('the new claim can be retrieved and appears first by last update', async () => {
    const details = await claims.getClaimById(filed.claim.claimId)
    assert.equal(details.claim.status, 'submitted')
    assert.equal(details.claim.isSessionCreated, true)

    const list = await claims.getClaims({ sort: 'updated-desc' })
    assert.equal(list.items[0].claimId, filed.claim.claimId)
    assert.equal(list.summary.submitted, 2)
  })

  test('claim IDs increment without collision', async () => {
    const second = await claims.createClaim(lifeClaimValues({ claimedAmount: '10000' }), AGENT)
    assert.equal(Number(second.claim.claimId.slice(-6)), Number(filed.claim.claimId.slice(-6)) + 1)
    assert.equal(second.claim.filedBy.name, 'Arjun Nair', 'agent resolved from the policy')
    assert.match(second.claim.activity[0].note, /on behalf of the policyholder/)
  })

  test('claims officers cannot file claims', async () => {
    await rejectsWith(claims.createClaim(lifeClaimValues(), ADMIN), 403, 'unauthorized-filing')
  })

  test('unknown, unissued and ineligible policies are blocked', async () => {
    await rejectsWith(claims.createClaim(lifeClaimValues({ policyId: 'POL-0000-000000' }), HOLDER), 404, 'policy-not-found')
    await rejectsWith(claims.createClaim(lifeClaimValues({ policyId: 'POL-2025-000031' }), HOLDER), 409, 'policy-not-eligible')
    await rejectsWith(claims.createClaim(lifeClaimValues({ policyId: 'POL-2023-000874' }), HOLDER), 409, 'policy-not-eligible')
    await rejectsWith(claims.createClaim(lifeClaimValues({ policyId: '' }), HOLDER), 422, 'invalid-claim')
  })

  test('invalid forms are rejected with field errors and nothing is stored', async () => {
    const countBefore = (await claims.getClaims()).total

    await assert.rejects(
      claims.createClaim(
        lifeClaimValues({
          claimType: 'hospitalisation',
          incidentDate: dates.addDaysIso(dates.todayIso(), 2),
          claimedAmount: '-5',
          description: 'Too short.',
          documents: {},
        }),
        HOLDER,
      ),
      (error) => {
        assert.equal(error.status, 422)
        const { errors } = error.data
        assert.ok(errors.claimType, 'coverage mismatch')
        assert.ok(errors.incidentDate, 'future incident')
        assert.ok(errors.claimedAmount, 'negative amount')
        assert.ok(errors.description, 'short description')
        return true
      },
    )

    await assert.rejects(claims.createClaim(lifeClaimValues({ documents: {} }), HOLDER), (error) => {
      assert.ok(error.data.errors['document-specialist-report'])
      assert.ok(error.data.errors['document-identity'])
      return true
    })

    await rejectsWith(claims.createClaim(lifeClaimValues({ incidentDate: '2024-01-01' }), HOLDER), 422, 'invalid-claim')

    assert.equal((await claims.getClaims()).total, countBefore)
  })
})

/* ------------------------------------------------------------------ */

describe('workflow through the service', () => {
  let claimId

  before(async () => {
    claimId = (await claims.createClaim(lifeClaimValues({ claimedAmount: '1800000' }), HOLDER)).claim.claimId
  })

  test('invalid jumps are rejected with 409 and change nothing', async () => {
    await rejectsWith(claims.approveClaim(claimId, ADMIN), 409, 'invalid-transition')
    await rejectsWith(claims.settleClaim(claimId, ADMIN), 409, 'invalid-transition')
    await rejectsWith(claims.transitionClaim(claimId, 'settled', ADMIN), 409, 'invalid-transition')
    await rejectsWith(claims.assessClaim(claimId, { assessedAmount: 1000 }, ADMIN), 409, 'invalid-transition')
    assert.equal((await claims.getClaimById(claimId)).claim.status, 'submitted')
  })

  test('unauthorized transitions are rejected with 403', async () => {
    await rejectsWith(claims.transitionClaim(claimId, 'under-review', AGENT), 403, 'unauthorized-transition')
    await rejectsWith(claims.transitionClaim(claimId, 'under-review', HOLDER), 403, 'unauthorized-transition')
    await rejectsWith(claims.transitionClaim(claimId, 'under-review', { role: 'hacker' }), 403, 'invalid-actor')
    await rejectsWith(claims.transitionClaim(claimId, 'under-review', null), 403, 'invalid-actor')
  })

  test('an unknown target status is rejected', async () => {
    await rejectsWith(claims.transitionClaim(claimId, 'paid-out', ADMIN), 422, 'unknown-status')
  })

  test('submitted → under review, assigning the claims officer', async () => {
    const details = await claims.transitionClaim(claimId, 'under-review', ADMIN)
    assert.equal(details.claim.status, 'under-review')
    assert.equal(details.claim.assignedTo.role, 'administrator')
    assert.equal(details.claim.activity.at(-1).actor.name, 'Claims Officer (demo)')
  })

  test('verification cannot be done as a bare status change', async () => {
    await rejectsWith(claims.transitionClaim(claimId, 'verified', ADMIN), 422, 'dedicated-action-required')
  })

  test('verification records checklist outcome, actor, time and marks documents verified', async () => {
    const details = await claims.verifyClaim(claimId, ADMIN, { note: 'Reports consistent.' })
    const { claim } = details
    assert.equal(claim.status, 'verified')
    assert.equal(claim.verification.verifiedBy.role, 'administrator')
    assert.equal(claim.verification.checksTotal, 6)
    assert.ok(claim.verification.verifiedAt)
    assert.ok(claim.documents.every((doc) => doc.status === 'verified'))
    assert.equal(claim.activity.at(-1).note, 'Reports consistent.')
  })

  test('approval before assessment is impossible', async () => {
    await rejectsWith(claims.approveClaim(claimId, ADMIN), 409, 'invalid-transition')
  })

  test('assessment enforces positive, claimed-amount and reduction-note rules, and the role', async () => {
    await rejectsWith(claims.assessClaim(claimId, { assessedAmount: 0 }, ADMIN), 422, 'invalid-assessment')
    await rejectsWith(claims.assessClaim(claimId, { assessedAmount: 1900000 }, ADMIN), 422, 'invalid-assessment')
    // A reduction below the claimed amount needs a note (the limit rule itself is covered in the rules tests).
    await rejectsWith(claims.assessClaim(claimId, { assessedAmount: 1500000 }, ADMIN), 422, 'invalid-assessment')
    await rejectsWith(claims.assessClaim(claimId, { assessedAmount: 1500000 }, AGENT), 403, 'unauthorized-transition')
  })

  test('assessment is recorded with limit and note', async () => {
    const details = await claims.assessClaim(
      claimId,
      { assessedAmount: 1600000, note: 'Adjusted to the certified benefit amount.' },
      ADMIN,
    )
    assert.equal(details.claim.status, 'assessed')
    assert.equal(details.claim.assessment.assessedAmount, 1600000)
    assert.equal(details.claim.assessment.illustrativeLimit, 2000000)
    assert.match(details.claim.activity.at(-1).note, /Assessed at ₹16,00,000/)
    assert.equal(details.decisionSummary.decision, 'pending')
  })

  test('rejection without a reason is refused', async () => {
    await rejectsWith(claims.rejectClaim(claimId, '', ADMIN), 422, 'rejection-reason-required')
    await rejectsWith(claims.rejectClaim(claimId, 'Nope', ADMIN), 422, 'rejection-reason-required')
    assert.equal((await claims.getClaimById(claimId)).claim.status, 'assessed')
  })

  test('approval sets the approved amount and records the decision', async () => {
    const details = await claims.approveClaim(claimId, ADMIN)
    assert.equal(details.claim.status, 'approved')
    assert.equal(details.claim.approvedAmount, 1600000)
    assert.equal(details.claim.decision.outcome, 'approved')
    assert.equal(details.decisionSummary.decision, 'approved')
  })

  test('settlement generates a reference and date, and cannot happen twice', async () => {
    const details = await claims.settleClaim(claimId, ADMIN)
    const { claim } = details
    assert.equal(claim.status, 'settled')
    assert.match(claim.settlement.reference, new RegExp(`^SET-${dates.todayIso().slice(0, 4)}-\\d{6}$`))
    assert.equal(claim.settlement.settledDate, dates.todayIso())
    assert.equal(claim.settlement.amount, 1600000)
    assert.equal(claim.activity.at(-1).note, `Settlement reference ${claim.settlement.reference}.`)

    await rejectsWith(claims.settleClaim(claimId, ADMIN), 409, 'already-settled')
    await rejectsWith(claims.transitionClaim(claimId, 'approved', ADMIN), 409, 'invalid-transition')
  })

  test('every transition left one audit event with previous and new status', async () => {
    const { claim } = await claims.getClaimById(claimId)
    assert.deepEqual(
      claim.activity.map((event) => `${event.fromStatus}>${event.toStatus}`),
      ['draft>submitted', 'submitted>under-review', 'under-review>verified', 'verified>assessed', 'assessed>approved', 'approved>settled'],
    )
    assert.ok(claim.activity.every((event) => event.at && event.actor.name && event.actor.role && event.label))
  })
})

describe('rejection and withdrawal paths', () => {
  test('a claim can be taken to rejection with a reason', async () => {
    const { claimId } = (await claims.createClaim(lifeClaimValues({ claimedAmount: '500000' }), HOLDER)).claim
    await claims.transitionClaim(claimId, 'under-review', ADMIN)
    await claims.verifyClaim(claimId, ADMIN)
    await claims.assessClaim(claimId, { assessedAmount: 500000 }, ADMIN)
    const details = await claims.rejectClaim(claimId, 'Diagnosis does not meet the illustrative terminal illness definition.', ADMIN)

    assert.equal(details.claim.status, 'rejected')
    assert.match(details.claim.rejectionReason, /terminal illness definition/)
    assert.equal(details.workflowStages.at(-1).status, 'terminated')
    await rejectsWith(claims.approveClaim(claimId, ADMIN), 409, 'invalid-transition')
  })

  test('the policyholder can withdraw a submitted claim; an agent cannot', async () => {
    const { claimId } = (await claims.createClaim(lifeClaimValues(), HOLDER)).claim
    await rejectsWith(claims.transitionClaim(claimId, 'cancelled', AGENT), 403, 'unauthorized-transition')
    const details = await claims.transitionClaim(claimId, 'cancelled', HOLDER, { note: 'Filed by mistake.' })
    assert.equal(details.claim.status, 'cancelled')
    assert.equal(details.claim.activity.at(-1).note, 'Filed by mistake.')
    await rejectsWith(claims.transitionClaim(claimId, 'under-review', ADMIN), 409, 'invalid-transition')
  })

  test('concurrent double settlement records exactly one settlement', async () => {
    const { claimId } = (await claims.createClaim(lifeClaimValues({ claimedAmount: '200000' }), HOLDER)).claim
    await claims.transitionClaim(claimId, 'under-review', ADMIN)
    await claims.verifyClaim(claimId, ADMIN)
    await claims.assessClaim(claimId, { assessedAmount: 200000 }, ADMIN)
    await claims.approveClaim(claimId, ADMIN)

    const outcomes = await Promise.allSettled([claims.settleClaim(claimId, ADMIN), claims.settleClaim(claimId, ADMIN)])
    assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
    assert.equal(outcomes.find((outcome) => outcome.status === 'rejected').reason.status, 409)

    const { claim } = await claims.getClaimById(claimId)
    assert.equal(claim.activity.filter((event) => event.toStatus === 'settled').length, 1)
  })

  test('seed claims are advanced through the service without modifying seed data', async () => {
    const seed = (await harness.load('/src/data/claims.js')).claims.find((item) => item.claimId === 'CLM-2026-000044')
    const details = await claims.settleClaim('CLM-2026-000044', ADMIN)
    assert.equal(details.claim.status, 'settled')
    assert.equal(seed.status, 'approved', 'seed record untouched')
  })
})

/* ------------------------------------------------------------------ */

describe('integration with Modules 1 and 2', () => {
  test('a policy issued through Module 1 can be claimed against', async () => {
    const policy = await policies.issuePolicy({
      productId: 'PRD-HLT-001',
      values: {
        fullName: 'Claims Integration Holder',
        customerId: '',
        dateOfBirth: '1988-03-03',
        email: 'claims@example.com',
        phone: '9845012311',
        addressLine1: '2 Test Road',
        addressLine2: '',
        city: 'Chennai',
        state: 'Tamil Nadu',
        postalCode: '600001',
        coverageAmount: '500000',
        startDate: dates.todayIso(),
        durationYears: '1',
        premiumFrequency: 'Annual',
        nomineeName: 'Test Nominee',
        nomineeRelationship: 'Spouse',
        nomineeDateOfBirth: '1990-01-01',
      },
    })

    const context = await claims.getClaimFilingContext(policy.id)
    assert.equal(context.eligibility.eligible, true)
    assert.deepEqual(context.claimTypes.map((type) => type.value).sort(), ['day-care', 'hospitalisation'])

    const filed = await claims.createClaim(
      {
        policyId: policy.id,
        claimType: 'hospitalisation',
        incidentDate: dates.todayIso(),
        claimedAmount: '42000',
        description: 'Admitted overnight for observation after a severe allergic reaction.',
        documents: {
          'discharge-summary': { provided: true, fileName: 'discharge.pdf' },
          'hospital-bill': { provided: true, fileName: 'bill.pdf' },
          identity: { provided: true, fileName: 'id.pdf' },
        },
      },
      HOLDER,
    )
    assert.equal(filed.claim.filedBy.name, 'Claims Integration Holder')
    assert.equal(filed.coverage.limit.limit, 500000)
  })

  test('premium standing in the claim context comes from Module 2', async () => {
    const details = await claims.getClaimById('CLM-2026-000097')
    const account = await premiums.getPremiumScheduleByPolicyId('POL-2024-000519')
    assert.equal(details.premium.standing, account.summary.standing)
    assert.equal(details.premium.overdueAmount, account.summary.overdueAmount)
  })

  test('paying the overdue premium in Module 2 is reflected in the claim context', async () => {
    const beforePayment = await claims.getClaimById('CLM-2026-000097')
    assert.equal(beforePayment.premium.counts.overdue >= 1, true)

    await premiums.recordMockPayment({
      policyId: 'POL-2024-000519',
      installmentId: 'INS-2024-000519-004',
      amount: 1550,
      method: 'upi',
    })

    const afterPayment = await claims.getClaimById('CLM-2026-000097')
    assert.equal(afterPayment.premium.counts.overdue, beforePayment.premium.counts.overdue - 1)
    assert.equal(afterPayment.verificationChecklist.checks.find((check) => check.id === 'premium-standing').outcome, 'pass')
  })

  test('a claim whose policy is missing still opens, with a policy error', async () => {
    // Simulate a broken relationship by saving a claim that points at a missing policy.
    const store = await harness.load('/src/services/mockClaimStore.js')
    const seed = (await harness.load('/src/data/claims.js')).claims.find((item) => item.claimId === 'CLM-2026-000083')
    store.saveClaim({ ...seed, claimId: 'CLM-2026-999999', policyId: 'POL-9999-999999' })

    const details = await claims.getClaimById('CLM-2026-999999')
    assert.equal(details.policy, null)
    assert.equal(details.policyError.status, 404)
    assert.equal(details.verificationChecklist.blocking, true)
    await rejectsWith(claims.verifyClaim('CLM-2026-999999', ADMIN), 422, 'verification-checks-failed')
  })
})

/* ------------------------------------------------------------------ */

describe('persistence', () => {
  test('claims are mirrored to sessionStorage with a versioned envelope', () => {
    const stored = JSON.parse(storage.getItem('ipms.claims.session'))
    assert.equal(stored.version, 1)
    assert.ok(stored.claims.length >= 5)
  })

  test('a fresh page load keeps filed claims and workflow progress', async () => {
    const listBefore = await claims.getClaims()
    const settledSeed = listBefore.items.find((item) => item.claimId === 'CLM-2026-000044')

    const reloaded = await createHarness()
    try {
      const fresh = await reloaded.load('/src/services/mockClaimLedger.js')
      const listAfter = await fresh.getClaims()
      assert.equal(listAfter.total, listBefore.total)
      assert.equal(listAfter.items.find((item) => item.claimId === 'CLM-2026-000044').status, settledSeed.status)

      const nextId = (await fresh.createClaim(lifeClaimValues(), HOLDER)).claim.claimId
      assert.ok(!listBefore.items.some((item) => item.claimId === nextId), 'IDs continue after reload')
    } finally {
      await reloaded.close()
    }
  })

  test('corrupted or foreign storage falls back to seed claims', async () => {
    for (const value of ['{not json', JSON.stringify({ version: 99, claims: [] }), JSON.stringify([{ claimId: 'x' }])]) {
      storage.setItem('ipms.claims.session', value)
      const reloaded = await createHarness()
      try {
        const fresh = await reloaded.load('/src/services/mockClaimLedger.js')
        assert.equal((await fresh.getClaims()).total, 8, `fallback for ${value.slice(0, 20)}`)
      } finally {
        await reloaded.close()
      }
    }
  })

  test('malformed claim records inside valid storage are ignored', async () => {
    storage.setItem('ipms.claims.session', JSON.stringify({ version: 1, claims: [{ claimId: 'CLM-BAD' }] }))
    const reloaded = await createHarness()
    try {
      const fresh = await reloaded.load('/src/services/mockClaimLedger.js')
      const list = await fresh.getClaims()
      assert.equal(list.total, 8)
      assert.ok(!list.items.some((item) => item.claimId === 'CLM-BAD'))
    } finally {
      await reloaded.close()
    }
  })
})
