/**
 * Module 3 — claim domain rules: data integrity, eligibility, form
 * validation, the workflow state machine, assessment and decisions.
 *
 * Time-dependent rules are evaluated at a fixed `asOf` date.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'

const AS_OF = '2026-09-15'

let harness
let claims
let claimTypes
let policies
let products
let constants
let workflow
let eligibility
let validation
let assessment
let query
let premiumCalc
let payments
let premiumSchedules

before(async () => {
  harness = await createHarness()
  claims = (await harness.load('/src/data/claims.js')).claims
  claimTypes = (await harness.load('/src/data/claimTypes.js')).claimTypes
  policies = (await harness.load('/src/data/issuedPolicies.js')).issuedPolicies
  products = (await harness.load('/src/data/policyProducts.js')).policyProducts
  constants = await harness.load('/src/utils/constants.js')
  workflow = await harness.load('/src/utils/claimWorkflow.js')
  eligibility = await harness.load('/src/utils/claimEligibility.js')
  validation = await harness.load('/src/utils/claimValidation.js')
  assessment = await harness.load('/src/utils/claimAssessment.js')
  query = await harness.load('/src/utils/claimQuery.js')
  premiumCalc = await harness.load('/src/utils/premiumCalculations.js')
  payments = (await harness.load('/src/data/payments.js')).payments
  premiumSchedules = (await harness.load('/src/data/premiumSchedules.js')).premiumSchedules
})

after(() => harness.close())

const S = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under-review',
  VERIFIED: 'verified',
  ASSESSED: 'assessed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
}

const policyById = (id) => policies.find((policy) => policy.id === id) ?? null
const productFor = (policy) => products.find((product) => product.id === policy?.productId) ?? null
const typeByValue = (value) => claimTypes.find((type) => type.value === value) ?? null

const premiumSummaryFor = (policyId, asOf = AS_OF) => {
  const header = premiumSchedules.find((item) => item.policyId === policyId)
  return header ? premiumCalc.buildPremiumAccount(header, policyById(policyId), payments, asOf).summary : null
}

const evaluate = (policyId, asOf = AS_OF, policyOverride) => {
  const policy = policyOverride === undefined ? policyById(policyId) : policyOverride
  return eligibility.evaluateClaimEligibility({
    policy,
    product: productFor(policy),
    premiumSummary: policy ? premiumSummaryFor(policy.id, asOf) : null,
    claimTypes,
    asOf,
  })
}

/* ------------------------------------------------------------------ */

describe('mock data integrity', () => {
  test('every claim references an existing, issued policy', () => {
    for (const claim of claims) {
      const policy = policyById(claim.policyId)
      assert.ok(policy, `${claim.claimId} → ${claim.policyId} must exist`)
      assert.ok(policy.issueDate && policy.status !== 'pending', `${claim.claimId} must be on an issued policy`)
      assert.equal(claim.policyholderId, policy.policyholder.customerId, `${claim.claimId} policyholder`)
    }
  })

  test('claim IDs are unique and correctly formatted', () => {
    const ids = claims.map((claim) => claim.claimId)
    assert.equal(new Set(ids).size, ids.length)
    for (const id of ids) assert.match(id, /^CLM-\d{4}-\d{6}$/)
  })

  test('settlement references are unique and exist only on settled claims', () => {
    const references = claims.filter((claim) => claim.settlement).map((claim) => claim.settlement.reference)
    assert.equal(new Set(references).size, references.length)
    for (const claim of claims) {
      assert.equal(Boolean(claim.settlement), claim.status === S.SETTLED, `${claim.claimId} settlement`)
      if (claim.settlement) {
        assert.match(claim.settlement.reference, /^SET-\d{4}-\d{6}$/)
        assert.equal(claim.settlement.amount, claim.approvedAmount)
      }
    }
  })

  test('every meaningful workflow state is represented', () => {
    const statuses = new Set(claims.map((claim) => claim.status))
    for (const status of [S.SUBMITTED, S.UNDER_REVIEW, S.VERIFIED, S.ASSESSED, S.APPROVED, S.REJECTED, S.SETTLED, S.CANCELLED]) {
      assert.ok(statuses.has(status), `a seed claim in ${status}`)
    }
    assert.ok(new Set(claims.map((claim) => claim.claimType)).size >= 4, 'several claim types')
    assert.ok(new Set(claims.map((claim) => claim.policyId)).size >= 4, 'several policies')
  })

  test('activity histories are legal, chronological and end at the current status', () => {
    for (const claim of claims) {
      const { activity } = claim
      assert.ok(activity.length > 0, `${claim.claimId} has activity`)
      assert.equal(activity[0].fromStatus, S.DRAFT, `${claim.claimId} starts from draft`)
      assert.equal(activity[0].toStatus, S.SUBMITTED, `${claim.claimId} first event submits`)
      assert.equal(activity.at(-1).toStatus, claim.status, `${claim.claimId} ends at its status`)
      assert.equal(claim.updatedAt, activity.at(-1).at, `${claim.claimId} updatedAt matches last event`)

      activity.forEach((event, index) => {
        assert.equal(event.eventId, `${claim.claimId}-E${index + 1}`)
        if (index > 0) {
          assert.equal(event.fromStatus, activity[index - 1].toStatus, `${claim.claimId} E${index + 1} chains`)
          assert.ok(event.at >= activity[index - 1].at, `${claim.claimId} E${index + 1} is chronological`)
        }
        const rule = workflow.getTransitionRule(event.fromStatus, event.toStatus)
        assert.ok(rule, `${claim.claimId} E${index + 1} ${event.fromStatus}→${event.toStatus} is a legal move`)
        assert.equal(event.action, rule.action)
        assert.ok(rule.roles.includes(event.actor.role), `${claim.claimId} E${index + 1} made by a permitted role`)
      })
    }
  })

  test('claim type, incident date and documents are consistent with the policy', () => {
    for (const claim of claims) {
      const policy = policyById(claim.policyId)
      const type = typeByValue(claim.claimType)
      assert.ok(type, `${claim.claimId} claim type exists`)
      assert.equal(type.policyType, policy.type, `${claim.claimId} claim type matches policy type`)
      assert.ok(claim.incidentDate >= policy.startDate && claim.incidentDate <= policy.endDate, `${claim.claimId} incident within cover`)
      assert.ok(claim.incidentDate <= claim.filingDate, `${claim.claimId} incident before filing`)
      assert.equal(
        validation.validateClaimForm(
          {
            policyId: claim.policyId,
            claimType: claim.claimType,
            incidentDate: claim.incidentDate,
            claimedAmount: String(claim.claimedAmount),
            description: claim.description,
            documents: Object.fromEntries(claim.documents.map((doc) => [doc.type, { provided: true, fileName: doc.fileName }])),
          },
          { policy, claimType: type, claimTypes, asOf: claim.filingDate },
        ).description,
        undefined,
        `${claim.claimId} description passes validation`,
      )
      const provided = new Set(claim.documents.map((doc) => doc.type))
      for (const requirement of type.requiredDocuments.filter((item) => item.required)) {
        assert.ok(provided.has(requirement.type), `${claim.claimId} has ${requirement.type}`)
      }
    }
  })

  test('verification, assessment, decision and amounts match the status reached', () => {
    const reached = (claim, status) => claim.activity.some((event) => event.toStatus === status)

    for (const claim of claims) {
      assert.equal(Boolean(claim.verification), reached(claim, S.VERIFIED), `${claim.claimId} verification`)
      assert.equal(Boolean(claim.assessment), reached(claim, S.ASSESSED), `${claim.claimId} assessment`)
      assert.equal(Boolean(claim.approvedAmount), [S.APPROVED, S.SETTLED].includes(claim.status), `${claim.claimId} approvedAmount`)
      assert.equal(Boolean(claim.rejectionReason), claim.status === S.REJECTED, `${claim.claimId} rejectionReason`)

      if (claim.assessment) {
        const policy = policyById(claim.policyId)
        const limit = assessment.calculateIllustrativeLimit(typeByValue(claim.claimType), policy.coverageAmount)
        assert.equal(claim.assessment.illustrativeLimit, limit.limit, `${claim.claimId} limit matches the rule`)
        assert.deepEqual(
          assessment.validateAssessment({
            assessedAmount: claim.assessment.assessedAmount,
            claimedAmount: claim.claimedAmount,
            limit: limit.limit,
            note: claim.assessment.note,
          }),
          {},
          `${claim.claimId} recorded assessment is valid`,
        )
      }
      if (claim.approvedAmount) assert.equal(claim.approvedAmount, claim.assessment.assessedAmount)
      if (claim.rejectionReason) assert.equal(assessment.validateRejectionReason(claim.rejectionReason), null)
    }
  })

  test('every claim type maps to a coverage item that exists on a product of its type', () => {
    for (const type of claimTypes) {
      const coverageNames = products.filter((product) => product.type === type.policyType).flatMap((product) => product.coverageItems.map((item) => item.name))
      assert.ok(coverageNames.includes(type.coverageItem), `${type.value} → ${type.coverageItem}`)
      assert.ok(type.requiredDocuments.some((doc) => doc.required), `${type.value} requires at least one document`)
    }
  })
})

/* ------------------------------------------------------------------ */

describe('claim eligibility', () => {
  test('an issued policy with running cover is eligible', () => {
    const result = evaluate('POL-2024-000226')
    assert.equal(result.eligible, true)
    assert.deepEqual(result.checks.map((item) => item.id), ['policy-found', 'policy-issued', 'policy-active', 'coverage', 'premium-standing'])
    assert.deepEqual(result.compatibleClaimTypes, ['terminal-illness'])
    assert.deepEqual(result.incidentWindow, { earliest: '2024-07-05', latest: AS_OF })
  })

  test('an unknown policy is rejected and later checks are skipped', () => {
    const result = evaluate('POL-0000-000000', AS_OF, null)
    assert.equal(result.eligible, false)
    assert.equal(result.checks[0].outcome, 'fail')
    assert.ok(result.checks.slice(1).every((item) => item.outcome === 'skipped'))
  })

  test('an unissued policy is rejected', () => {
    const result = evaluate('POL-2025-000031')
    assert.equal(result.eligible, false)
    assert.match(result.reasons[0], /pending issuance/)
  })

  test('a policy whose cover ended beyond the filing window is rejected', () => {
    const result = evaluate('POL-2023-000874')
    assert.equal(result.eligible, false)
    assert.match(result.reasons[0], /window to file claims closed/)
  })

  test('a policy marked active but past its cover period is judged by the period', () => {
    // POL-2024-000148 is "active" in Module 1 data, but its cover ended in April 2025.
    const result = evaluate('POL-2024-000148')
    assert.equal(result.eligible, false)
    assert.match(result.reasons[0], /Cover ended on/)
  })

  test('recently ended cover remains eligible within the filing window, with a warning', () => {
    // POL-2024-000519 cover ends 9 Nov 2026; 1 Dec 2026 is inside the 90-day window.
    const within = evaluate('POL-2024-000519', '2026-12-01')
    assert.equal(within.eligible, true)
    assert.equal(within.checks.find((item) => item.id === 'policy-active').outcome, 'warning')
    assert.deepEqual(within.incidentWindow, { earliest: '2024-11-10', latest: '2026-11-09' })

    const beyond = evaluate('POL-2024-000519', '2027-03-01')
    assert.equal(beyond.eligible, false)
  })

  test('cover that has not started and lapsed policies are rejected', () => {
    const future = { ...policyById('POL-2024-000226'), startDate: '2027-01-01', endDate: '2028-01-01' }
    assert.match(evaluate(null, AS_OF, future).reasons[0], /has not started/)

    const lapsed = { ...policyById('POL-2024-000226'), status: 'lapsed' }
    assert.match(evaluate(null, AS_OF, lapsed).reasons[0], /lapsed/)
  })

  test('a coverage mismatch is handled: no modelled claimable benefit means ineligible', () => {
    const policy = policyById('POL-2024-000226')
    const result = eligibility.evaluateClaimEligibility({
      policy,
      product: { ...productFor(policy), coverageItems: [{ name: 'Waiver of premium rider', limit: 'Optional' }] },
      premiumSummary: premiumSummaryFor(policy.id),
      claimTypes,
      asOf: AS_OF,
    })
    assert.equal(result.eligible, false)
    assert.equal(result.checks.find((item) => item.id === 'coverage').outcome, 'fail')
  })

  test('an overdue premium is flagged but never blocks filing', () => {
    const result = evaluate('POL-2024-000519')
    const premium = result.checks.find((item) => item.id === 'premium-standing')
    assert.equal(premiumSummaryFor('POL-2024-000519').standing, 'overdue')
    assert.equal(premium.outcome, 'warning')
    assert.match(premium.detail, /Filing is still allowed/)
    assert.equal(result.eligible, true)
  })
})

/* ------------------------------------------------------------------ */

describe('claim form validation', () => {
  const policy = () => policyById('POL-2024-000519')
  const type = () => typeByValue('temporary-disablement')

  const validForm = () => ({
    policyId: 'POL-2024-000519',
    claimType: 'temporary-disablement',
    incidentDate: '2026-09-01',
    claimedAmount: '25000',
    description: 'Fell from a ladder at home and fractured a wrist; advised one week of rest.',
    documents: {
      'incident-report': { provided: true, fileName: 'report.pdf' },
      'medical-certificate': { provided: true, fileName: 'certificate.pdf' },
      identity: { provided: true, fileName: 'id.pdf' },
    },
  })

  const run = (patch = {}, context = {}) =>
    validation.validateClaimForm(
      { ...validForm(), ...patch },
      { policy: policy(), claimType: type(), claimTypes, asOf: AS_OF, ...context },
    )

  test('a complete form is valid', () => {
    assert.deepEqual(run(), {})
  })

  test('missing policy and unknown policy', () => {
    assert.match(run({ policyId: '' }, { policy: null }).policyId, /Select the policy/)
    assert.match(run({ policyId: 'POL-X' }, { policy: null }).policyId, /could not be found/)
  })

  test('missing claim type and a claim type the policy does not cover', () => {
    assert.match(run({ claimType: '' }, { claimType: null }).claimType, /Select a claim type/)
    assert.match(run({ claimType: 'hospitalisation' }, { claimType: typeByValue('hospitalisation') }).claimType, /not covered by a Personal Accident policy/)
  })

  test('incident date: required, not in the future, within the cover period', () => {
    assert.match(run({ incidentDate: '' }).incidentDate, /Enter the date/)
    assert.match(run({ incidentDate: '2026-09-16' }).incidentDate, /cannot be in the future/)
    assert.match(run({ incidentDate: '2024-11-09' }).incidentDate, /within the policy cover period/)
    assert.equal(run({ incidentDate: '2024-11-10' }).incidentDate, undefined, 'first day of cover is valid')
  })

  test('claimed amount: required, numeric, positive, at most two decimals', () => {
    assert.match(run({ claimedAmount: '' }).claimedAmount, /Enter the amount/)
    assert.match(run({ claimedAmount: '0' }).claimedAmount, /greater than zero/)
    assert.match(run({ claimedAmount: '-500' }).claimedAmount, /greater than zero/)
    assert.match(run({ claimedAmount: 'abc' }).claimedAmount, /must be a number/)
    assert.match(run({ claimedAmount: '10.555' }).claimedAmount, /two decimal places/)
    assert.equal(run({ claimedAmount: '0.29' }).claimedAmount, undefined, 'no floating-point false positive')
  })

  test('description: required and a reasonable minimum length', () => {
    assert.match(run({ description: '   ' }).description, /Describe what happened/)
    assert.match(run({ description: 'Hurt my wrist.' }).description, /at least 30 characters/)
  })

  test('required document metadata must be present and named', () => {
    const missing = run({ documents: { identity: { provided: true, fileName: 'id.pdf' } } })
    assert.ok(missing['document-incident-report'])
    assert.ok(missing['document-medical-certificate'])
    assert.equal(missing['document-identity'], undefined)

    const unnamed = run({ documents: { ...validForm().documents, identity: { provided: true, fileName: ' ' } } })
    assert.match(unnamed['document-identity'], /Enter a document name/)
  })

  test('document records are metadata for provided documents only', () => {
    const records = validation.buildDocumentRecords('CLM-T', type(), validForm().documents, '2026-09-15T00:00:00.000Z')
    assert.equal(records.length, 3)
    assert.ok(records.every((doc) => doc.status === 'submitted' && doc.fileName && !('content' in doc)))
  })
})

/* ------------------------------------------------------------------ */

describe('workflow state machine', () => {
  const ADMIN = 'administrator'
  const HOLDER = 'policyholder'
  const AGENT = 'agent'

  test('the transition table allows exactly the documented moves', () => {
    const expected = {
      [S.DRAFT]: [S.SUBMITTED, S.CANCELLED],
      [S.SUBMITTED]: [S.UNDER_REVIEW, S.CANCELLED],
      [S.UNDER_REVIEW]: [S.VERIFIED],
      [S.VERIFIED]: [S.ASSESSED],
      [S.ASSESSED]: [S.APPROVED, S.REJECTED],
      [S.APPROVED]: [S.SETTLED],
      [S.REJECTED]: [],
      [S.SETTLED]: [],
      [S.CANCELLED]: [],
    }
    for (const [status, allowed] of Object.entries(expected)) {
      assert.deepEqual(workflow.getAllowedTransitions(status).sort(), [...allowed].sort(), status)
    }
  })

  test('invalid jumps are blocked', () => {
    for (const [from, to] of [
      [S.SUBMITTED, S.SETTLED],
      [S.SUBMITTED, S.APPROVED],
      [S.VERIFIED, S.SUBMITTED],
      [S.REJECTED, S.APPROVED],
      [S.SETTLED, S.APPROVED],
      [S.UNDER_REVIEW, S.ASSESSED],
      [S.APPROVED, S.REJECTED],
    ]) {
      assert.equal(workflow.canTransition(from, to), false, `${from} → ${to}`)
      assert.throws(() => workflow.assertTransition(from, to, ADMIN), { code: 'invalid-transition' })
    }
  })

  test('terminal states have no way out', () => {
    for (const status of [S.REJECTED, S.SETTLED, S.CANCELLED]) {
      assert.equal(workflow.isTerminalClaimStatus(status), true)
    }
    for (const status of [S.SUBMITTED, S.UNDER_REVIEW, S.VERIFIED, S.ASSESSED, S.APPROVED]) {
      assert.equal(workflow.isTerminalClaimStatus(status), false)
    }
  })

  test('role restrictions: only claims officers review, verify, assess, decide and settle', () => {
    for (const [from, to] of [
      [S.SUBMITTED, S.UNDER_REVIEW],
      [S.UNDER_REVIEW, S.VERIFIED],
      [S.VERIFIED, S.ASSESSED],
      [S.ASSESSED, S.APPROVED],
      [S.ASSESSED, S.REJECTED],
      [S.APPROVED, S.SETTLED],
    ]) {
      assert.equal(workflow.canRoleTransition(from, to, ADMIN), true, `${from}→${to} admin`)
      assert.equal(workflow.canRoleTransition(from, to, AGENT), false, `${from}→${to} agent`)
      assert.equal(workflow.canRoleTransition(from, to, HOLDER), false, `${from}→${to} policyholder`)
      assert.throws(() => workflow.assertTransition(from, to, AGENT), { code: 'unauthorized-transition' })
    }
  })

  test('policyholders can withdraw a submitted claim; agents cannot', () => {
    assert.equal(workflow.canRoleTransition(S.SUBMITTED, S.CANCELLED, HOLDER), true)
    assert.equal(workflow.canRoleTransition(S.SUBMITTED, S.CANCELLED, AGENT), false)
  })

  test('available actions per role for each status', () => {
    assert.deepEqual(workflow.getAvailableTransitions(S.SUBMITTED, HOLDER).map((item) => item.toStatus), [S.CANCELLED])
    assert.deepEqual(workflow.getAvailableTransitions(S.SUBMITTED, AGENT), [])
    assert.deepEqual(workflow.getAvailableTransitions(S.ASSESSED, ADMIN).map((item) => item.action).sort(), ['approve', 'reject'])
    assert.deepEqual(workflow.getAvailableTransitions(S.SETTLED, ADMIN), [])
  })

  test('applyTransition appends an audit event and never mutates the input', () => {
    const claim = claims.find((item) => item.status === S.SUBMITTED)
    const snapshot = JSON.stringify(claim)
    const actor = { name: 'Claims Officer (demo)', role: ADMIN }

    const next = workflow.applyTransition(claim, S.UNDER_REVIEW, actor, { at: '2026-09-15T05:00:00.000Z', note: 'Picked up' })

    assert.equal(JSON.stringify(claim), snapshot, 'input untouched')
    assert.equal(next.status, S.UNDER_REVIEW)
    assert.equal(next.updatedAt, '2026-09-15T05:00:00.000Z')
    assert.deepEqual(next.activity.at(-1), {
      eventId: `${claim.claimId}-E${claim.activity.length + 1}`,
      at: '2026-09-15T05:00:00.000Z',
      action: 'start-review',
      label: 'Review started',
      fromStatus: S.SUBMITTED,
      toStatus: S.UNDER_REVIEW,
      actor,
      note: 'Picked up',
    })
  })

  test('unknown statuses are rejected', () => {
    assert.throws(() => workflow.assertTransition(S.SUBMITTED, 'paid-out', ADMIN), { code: 'unknown-status' })
  })

  test('timeline stages distinguish completed, current, upcoming and terminated', () => {
    const assessed = claims.find((item) => item.status === S.ASSESSED)
    assert.deepEqual(
      workflow.getWorkflowStages(assessed).map((stage) => stage.status),
      ['completed', 'completed', 'completed', 'completed', 'current', 'upcoming'],
    )

    const rejected = claims.find((item) => item.status === S.REJECTED)
    const rejectedStages = workflow.getWorkflowStages(rejected)
    assert.equal(rejectedStages.at(-1).status, 'terminated')
    assert.equal(rejectedStages.at(-1).stateLabel, 'Rejected')
    assert.ok(!rejectedStages.some((stage) => stage.stage === 'Settled'), 'no future stages after rejection')

    const cancelled = claims.find((item) => item.status === S.CANCELLED)
    assert.deepEqual(workflow.getWorkflowStages(cancelled).map((stage) => stage.status), ['completed', 'terminated'])

    const settled = claims.find((item) => item.status === S.SETTLED)
    assert.ok(workflow.getWorkflowStages(settled).every((stage) => stage.status === 'completed'))
  })

  test('actors are resolved from the role and policy, not supplied names', () => {
    const policy = policyById('POL-2024-000519')
    assert.deepEqual(workflow.resolveActor('policyholder', policy), { name: 'Farhan Qureshi', role: 'policyholder' })
    assert.deepEqual(workflow.resolveActor('agent', policy), { name: 'Meera Iyer', role: 'agent' })
    assert.equal(workflow.resolveActor('administrator', policy).name, 'Claims Officer (demo)')
  })
})

/* ------------------------------------------------------------------ */

describe('assessment, rejection and decision summary', () => {
  const pa = () => policyById('POL-2024-000519')

  test('illustrative limits follow the percentage and cap rules', () => {
    assert.equal(assessment.calculateIllustrativeLimit(typeByValue('temporary-disablement'), pa().coverageAmount).limit, 2500000)
    assert.equal(assessment.calculateIllustrativeLimit(typeByValue('permanent-disability'), pa().coverageAmount).limit, 1250000)
    const life = assessment.calculateIllustrativeLimit(typeByValue('terminal-illness'), 7500000)
    assert.equal(life.limit, 2000000)
    assert.equal(life.cappedByMaximum, true)
    assert.equal(assessment.calculateIllustrativeLimit(typeByValue('contents-burglary'), 2800000).limit, 560000)
  })

  test('assessed amount must be positive', () => {
    for (const assessedAmount of ['', '0', '-1', 'abc']) {
      assert.ok(assessment.validateAssessment({ assessedAmount, claimedAmount: 50000, limit: 100000 }).assessedAmount, assessedAmount)
    }
  })

  test('assessed amount cannot exceed the claimed amount', () => {
    assert.match(assessment.validateAssessment({ assessedAmount: 60000, claimedAmount: 50000, limit: 100000 }).assessedAmount, /claimed amount/)
  })

  test('assessed amount cannot exceed the illustrative coverage limit', () => {
    assert.match(assessment.validateAssessment({ assessedAmount: 90000, claimedAmount: 100000, limit: 80000 }).assessedAmount, /illustrative coverage limit/)
  })

  test('a reduced assessment needs an explanatory note', () => {
    assert.ok(assessment.validateAssessment({ assessedAmount: 40000, claimedAmount: 50000, limit: 100000, note: '' }).note)
    assert.deepEqual(assessment.validateAssessment({ assessedAmount: 40000, claimedAmount: 50000, limit: 100000, note: 'Excluded consumables.' }), {})
    assert.deepEqual(assessment.validateAssessment({ assessedAmount: 50000, claimedAmount: 50000, limit: 100000 }), {})
  })

  test('assessment is required before approval', () => {
    const verified = claims.find((item) => item.status === S.VERIFIED)
    assert.equal(assessment.checkApprovalReadiness(verified).ready, false)

    const assessedWithoutRecord = { ...claims.find((item) => item.status === S.ASSESSED), assessment: null }
    assert.match(assessment.checkApprovalReadiness(assessedWithoutRecord).reason, /no valid assessment/)

    assert.equal(assessment.checkApprovalReadiness(claims.find((item) => item.status === S.ASSESSED)).ready, true)
  })

  test('rejection reason is required and must be meaningful', () => {
    assert.match(assessment.validateRejectionReason(''), /required/)
    assert.match(assessment.validateRejectionReason('No.'), /clearer/)
    assert.equal(assessment.validateRejectionReason('Loss falls under the undeclared valuables exclusion.'), null)
  })

  test('decision summary is rule-based and explains itself', () => {
    const assessed = assessment.buildDecisionSummary(claims.find((item) => item.claimId === 'CLM-2026-000071'))
    assert.equal(assessed.decision, 'pending')
    assert.equal(assessed.claimedAmount, 500000)
    assert.equal(assessed.assessedAmount, 375000)
    assert.match(assessed.reasons[0], /below the claimed amount: Disability assessed at 15%/)

    const approvedFull = assessment.buildDecisionSummary(claims.find((item) => item.status === S.APPROVED))
    assert.equal(approvedFull.decision, S.APPROVED)
    assert.equal(approvedFull.reasons[0], 'The claimed amount is within the illustrative coverage limit.')

    const capped = assessment.buildDecisionSummary({
      status: S.ASSESSED,
      claimedAmount: 900000,
      approvedAmount: null,
      assessment: { assessedAmount: 560000, illustrativeLimit: 560000, limitBasis: '20%', note: null },
    })
    assert.match(capped.reasons[0], /exceeds the illustrative limit/)

    const rejected = assessment.buildDecisionSummary(claims.find((item) => item.status === S.REJECTED))
    assert.equal(rejected.decision, S.REJECTED)
    assert.ok(rejected.reasons.some((reason) => reason.startsWith('Rejected:')))

    assert.equal(assessment.buildDecisionSummary(claims.find((item) => item.status === S.SUBMITTED)), null)
  })

  test('verification checklist blocks on failures and only warns on premium standing', () => {
    const claim = claims.find((item) => item.status === S.UNDER_REVIEW)
    const policy = policyById(claim.policyId)
    const type = typeByValue(claim.claimType)
    const input = {
      claim,
      policy,
      product: productFor(policy),
      claimType: type,
      premiumSummary: premiumSummaryFor(policy.id),
      limit: assessment.calculateIllustrativeLimit(type, policy.coverageAmount),
    }

    const ok = assessment.buildVerificationChecklist(input)
    assert.equal(ok.blocking, false)
    assert.equal(ok.checks.find((item) => item.id === 'premium-standing').outcome, 'warning')

    const missingDocs = assessment.buildVerificationChecklist({ ...input, claim: { ...claim, documents: [] } })
    assert.equal(missingDocs.blocking, true)
    assert.match(missingDocs.checks.find((item) => item.id === 'documents').detail, /Missing:/)

    const orphan = assessment.buildVerificationChecklist({ ...input, policy: null })
    assert.equal(orphan.blocking, true)
  })
})

/* ------------------------------------------------------------------ */

describe('claim search, filters and summary', () => {
  const rows = () =>
    claims.map((claim) => ({
      ...claim,
      policyholderName: policyById(claim.policyId)?.policyholder.name,
      claimTypeLabel: typeByValue(claim.claimType)?.label,
    }))

  test('search by claim ID, policy ID, policyholder and claim type', () => {
    assert.deepEqual(query.queryClaims(rows(), { search: 'CLM-2026-000097' }).map((row) => row.claimId), ['CLM-2026-000097'])
    assert.equal(query.queryClaims(rows(), { search: 'POL-2024-000519' }).length, 5)
    assert.deepEqual(query.queryClaims(rows(), { search: 'ananya' }).map((row) => row.claimId), ['CLM-2024-000152'])
    assert.equal(query.queryClaims(rows(), { search: 'terminal illness' }).length, 1)
  })

  test('status and claim type filters combine', () => {
    assert.equal(query.queryClaims(rows(), { status: S.SETTLED }).length, 1)
    assert.equal(query.queryClaims(rows(), { claimType: 'temporary-disablement' }).length, 4)
    assert.equal(query.queryClaims(rows(), { claimType: 'temporary-disablement', status: S.APPROVED }).length, 1)
  })

  test('sorting by claimed amount and last update', () => {
    const byAmount = query.queryClaims(rows(), { sort: 'claimed-desc' })
    assert.equal(byAmount[0].claimId, 'CLM-2026-000052')
    const byUpdate = query.queryClaims(rows(), { sort: 'updated-desc' })
    assert.equal(byUpdate[0].claimId, 'CLM-2026-000097')
  })

  test('summary counts are derived from the records', () => {
    assert.deepEqual(query.summariseClaims(claims), {
      total: 8,
      draft: 0,
      submitted: 1,
      underReview: 1,
      verified: 1,
      assessed: 1,
      approved: 1,
      rejected: 1,
      settled: 1,
      cancelled: 1,
      open: 5,
    })
    assert.equal(constants.CLAIM_STATUS_OPTIONS.some((option) => option.value === S.DRAFT), false)
  })
})
