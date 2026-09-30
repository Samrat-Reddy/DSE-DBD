/**
 * Module 3 — Claim Filing & Approval Workflow: the API-backed service.
 *
 * Runs the real `claimService` and auth bridge against a stubbed `fetch` that
 * plays the FastAPI backend, and checks what the frontend owns: the request
 * each screen action sends (one endpoint per workflow action), and the mapping
 * of API responses and errors onto the shapes the existing screens render.
 * The state machine, eligibility, locking and access control are tested in the
 * backend suite against real MySQL.
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'

process.env.VITE_DEMO_AUTH_PASSWORD = 'test-demo-password'
const storage = installFakeSessionStorage()

let harness
let svc

const ACTOR = { name: 'Dev Administrator', role: 'administrator' }

const DETAIL = {
  claim: {
    claim_number: 'CLM-2026-000071',
    policy_number: 'POL-2024-000519',
    policyholder_name: 'Farhan Qureshi',
    customer_code: 'CUS-100630',
    product_name: 'SafeGuard Personal Accident',
    claim_type: 'permanent-disability',
    claim_type_label: 'Accident — permanent disability',
    incident_date: '2026-04-12',
    filing_date: '2026-08-05',
    claimed_amount: '500000.00',
    approved_amount: null,
    status: 'assessed',
    filed_by: { name: 'Meera Iyer', role: 'agent' },
    assigned_to: ACTOR,
    created_at: '2026-08-05T10:00:00',
    updated_at: '2026-08-20T10:00:00',
  },
  description: 'Permanent partial loss of use of the left hand after the April accident.',
  rejection_reason: null,
  claim_type: {
    code: 'permanent-disability',
    label: 'Accident — permanent disability',
    product_type: 'personal_accident',
    coverage_item: 'Permanent partial disability',
    percent_of_coverage: 50,
    max_amount: null,
    limit_basis: 'Illustrative ceiling of 50% of sum insured (benefit table)',
    description: 'Lump sum for permanent partial disability.',
    documents: [
      { doc_type: 'incident-report', label: 'FIR / incident report', suggested_name: 'incident-report.pdf', required: true },
      { doc_type: 'disability-certificate', label: 'Disability certificate', suggested_name: 'disability-certificate.pdf', required: true },
    ],
  },
  policy: {
    policy_number: 'POL-2024-000519',
    product_code: 'PRD-ACC-004',
    product_name: 'SafeGuard Personal Accident',
    product_type: 'personal_accident',
    status: 'active',
    coverage_amount: '2500000.00',
    issue_date: '2024-11-08',
    start_date: '2024-11-10',
    end_date: '2026-11-09',
    policyholder_name: 'Farhan Qureshi',
    customer_code: 'CUS-100630',
    agent_name: 'Meera Iyer',
  },
  limit: {
    limit: '1250000.00',
    coverage_amount: '2500000.00',
    percent_of_coverage: 50,
    max_amount: null,
    basis: 'Illustrative ceiling of 50% of sum insured (benefit table)',
    capped_by_maximum: false,
  },
  coverage_item: { name: 'Permanent partial disability', limit: 'As per benefit table' },
  premium: { standing: 'overdue', overdue_count: 1, overdue_amount: '1550.00', oldest_overdue_date: '2026-05-10' },
  documents: [
    { doc_type: 'incident-report', label: 'FIR / incident report', file_name: 'fir.pdf', required: true, status: 'verified', submitted_at: '2026-08-05T10:00:00' },
  ],
  verification_checklist: { checks: [], passed: 6, warnings: 0, failures: 0, blocking: false },
  verification: {
    checks_passed: 5, checks_total: 6, warnings: 1, note: null, verified_at: '2026-08-12T10:00:00', verified_by: ACTOR,
  },
  assessment: {
    assessed_amount: '375000.00', illustrative_limit: '1250000.00', limit_basis: 'Benefit table', note: 'Partial loss per table.',
    assessed_at: '2026-08-20T10:00:00', assessed_by: ACTOR,
  },
  decision: {
    claimed_amount: '500000.00', illustrative_limit: '1250000.00', limit_basis: 'Benefit table',
    assessed_amount: '375000.00', approved_amount: null, decision: 'pending', decision_label: 'Awaiting decision',
    reasons: ['Assessed ₹1,25,000 below the claimed amount: Partial loss per table.', 'Awaiting an approval or rejection decision by a claims officer.'],
    decided_at: null, decided_by: null,
  },
  settlement: null,
  events: [
    { sequence_no: 1, action: 'submit', label: 'Claim submitted', from_status: 'draft', to_status: 'submitted', actor: { name: 'Meera Iyer', role: 'agent' }, note: null, occurred_at: '2026-08-05T10:00:00' },
    { sequence_no: 2, action: 'start_review', label: 'Review started', from_status: 'submitted', to_status: 'under_review', actor: ACTOR, note: null, occurred_at: '2026-08-06T10:00:00' },
    { sequence_no: 3, action: 'verify', label: 'Claim verified', from_status: 'under_review', to_status: 'verified', actor: ACTOR, note: null, occurred_at: '2026-08-12T10:00:00' },
    { sequence_no: 4, action: 'assess', label: 'Claim assessed', from_status: 'verified', to_status: 'assessed', actor: ACTOR, note: 'Assessed at ₹3,75,000.', occurred_at: '2026-08-20T10:00:00' },
  ],
  allowed_actions: [],
  as_of: '2026-09-29',
}

let requests
let routes

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fakeFetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url)
  const path = pathname.replace('/api/v1', '')
  const body = init.body ? JSON.parse(init.body) : null
  requests.push({ method: init.method, path, params: Object.fromEntries(searchParams), headers: init.headers, body })
  if (path === '/auth/login') {
    return json(200, { access_token: `token-${body.email}`, token_type: 'bearer', expires_in: 1800 })
  }
  const handler = routes[`${init.method} ${path}`]
  return handler ? handler(requests.at(-1)) : json(404, { detail: 'No claim found.', code: 'not_found' })
}

const apiCalls = () => requests.filter((r) => r.path !== '/auth/login')

before(async () => {
  globalThis.fetch = fakeFetch
  harness = await createHarness()
  svc = await harness.load('/src/services/claimService.js')
})

after(() => harness.close())

beforeEach(() => {
  requests = []
  storage.setItem('ipms.demoRole', 'administrator')
  routes = {
    'GET /claims': () =>
      json(200, {
        items: [DETAIL.claim],
        total: 1,
        limit: 200,
        offset: 0,
        summary: { total: 8, draft: 0, submitted: 1, under_review: 1, verified: 1, assessed: 1, approved: 1, rejected: 1, settled: 1, cancelled: 1, open: 5 },
      }),
    'GET /claim-types': () => json(200, { items: [DETAIL.claim_type] }),
    'GET /claims/CLM-2026-000071': () => json(200, DETAIL),
  }
  for (const action of ['start-review', 'withdraw', 'cancel', 'verify', 'assess', 'approve', 'reject', 'settle']) {
    routes[`POST /claims/CLM-2026-000071/${action}`] = () => json(200, DETAIL)
  }
})

describe('claims list', () => {
  test('sends filters as API codes and maps rows, counts and claim-type options', async () => {
    const result = await svc.getClaims({ search: ' farhan ', status: 'under-review', claimType: 'all', sort: 'claimed-desc' })
    const list = apiCalls().find((r) => r.path === '/claims')
    assert.deepEqual(list.params, { search: 'farhan', status: 'under_review', sort: 'claimed-desc', limit: '200' })

    const [row] = result.items
    assert.equal(row.claimId, 'CLM-2026-000071')
    assert.equal(row.status, 'assessed')
    assert.equal(row.claimedAmount, 500000)
    assert.deepEqual(row.filedBy, { name: 'Meera Iyer', role: 'agent' })
    assert.equal(result.summary.underReview, 1)
    assert.equal(result.summary.open, 5)
    assert.deepEqual(result.claimTypeOptions, [{ value: 'permanent-disability', label: 'Accident — permanent disability' }])
  })
})

describe('claim detail', () => {
  test('maps the claim, its history (kebab-case codes) and the decision explanation', async () => {
    const details = await svc.getClaimById('CLM-2026-000071')
    assert.equal(details.claim.status, 'assessed')
    assert.deepEqual(
      details.claim.activity.map((e) => [e.action, e.fromStatus, e.toStatus]),
      [
        ['submit', 'draft', 'submitted'],
        ['start-review', 'submitted', 'under-review'],
        ['verify', 'under-review', 'verified'],
        ['assess', 'verified', 'assessed'],
      ],
    )
    assert.equal(details.claim.assessment.assessedAmount, 375000)
    assert.equal(details.claim.verification.checksTotal, 6)
    assert.equal(details.claimType.policyType, 'Personal Accident')
    assert.deepEqual(details.claimType.requiredDocuments.map((d) => d.type), ['incident-report', 'disability-certificate'])
    assert.equal(details.policy.id, 'POL-2024-000519')
    assert.deepEqual(details.coverage.coverageItem, { name: 'Permanent partial disability', limit: 'As per benefit table' })
    assert.equal(details.coverage.limit.limit, 1250000)
    assert.equal(details.premium.standing, 'overdue')
    assert.equal(details.premium.counts.overdue, 1)
    assert.equal(details.decisionSummary.decisionLabel, 'Awaiting decision')
    assert.equal(details.decisionSummary.reasons.length, 2)
    // Display helpers derived from the same state machine the backend enforces.
    assert.deepEqual(details.allowedTransitions.map((t) => t.toStatus).sort(), ['approved', 'rejected'])
    assert.equal(details.workflowStages.find((s) => s.status === 'current').stage, 'Approved')
  })

  test('an out-of-scope claim is a 404 ApiError', async () => {
    await assert.rejects(svc.getClaimById('CLM-2099-000001'), { name: 'ApiError', status: 404 })
  })
})

describe('filing', () => {
  const values = {
    policyId: 'POL-2024-000519',
    claimType: 'permanent-disability',
    incidentDate: '2026-09-01',
    claimedAmount: ' 50000 ',
    description: '  Lost partial use of the left hand after a fall at a construction site.  ',
    documents: {
      'incident-report': { provided: true, fileName: '  fir.pdf ' },
      'disability-certificate': { provided: false, fileName: 'ignored.pdf' },
    },
  }

  test('sends only provided documents, trimmed, and never a status or number', async () => {
    routes['POST /claims'] = () => json(201, DETAIL)
    await svc.createClaim(values, { role: 'agent' })
    const post = apiCalls().find((r) => r.method === 'POST')
    assert.deepEqual(post.body, {
      policy_number: 'POL-2024-000519',
      claim_type: 'permanent-disability',
      incident_date: '2026-09-01',
      claimed_amount: '50000',
      description: 'Lost partial use of the left hand after a fall at a construction site.',
      documents: { 'incident-report': 'fir.pdf' },
    })
  })

  test('API field errors come back keyed by the form fields', async () => {
    routes['POST /claims'] = () =>
      json(422, {
        detail: 'The claim has validation errors.',
        code: 'unprocessable',
        errors: [
          { field: 'body.incident_date', message: 'The incident date cannot be in the future.', type: 'business_rule' },
          { field: 'body.documents.disability-certificate', message: 'Disability certificate is required.', type: 'business_rule' },
        ],
      })
    await assert.rejects(svc.createClaim(values, { role: 'agent' }), (error) => {
      assert.equal(error.status, 422)
      assert.deepEqual(error.data.errors, {
        incidentDate: 'The incident date cannot be in the future.',
        'document-disability-certificate': 'Disability certificate is required.',
      })
      return true
    })
  })
})

describe('workflow actions: one endpoint each', () => {
  const lastPost = () => apiCalls().filter((r) => r.method === 'POST').at(-1)

  test('status moves route to their dedicated endpoints', async () => {
    await svc.transitionClaim('CLM-2026-000071', 'under-review', { role: 'administrator' })
    assert.equal(lastPost().path, '/claims/CLM-2026-000071/start-review')
    await svc.transitionClaim('CLM-2026-000071', 'cancelled', { role: 'policyholder' }, { note: 'No longer needed.' })
    assert.equal(lastPost().path, '/claims/CLM-2026-000071/withdraw')
    assert.deepEqual(lastPost().body, { note: 'No longer needed.' })
    await svc.transitionClaim('CLM-2026-000071', 'cancelled', { role: 'agent' }, { action: 'cancel-draft' })
    assert.equal(lastPost().path, '/claims/CLM-2026-000071/cancel')
    await assert.rejects(svc.transitionClaim('CLM-2026-000071', 'approved', {}), { status: 422 })
  })

  test('verify, assess, approve, reject and settle send only what the user decides', async () => {
    await svc.verifyClaim('CLM-2026-000071', {}, { note: 'All good.' })
    assert.deepEqual([lastPost().path, lastPost().body], ['/claims/CLM-2026-000071/verify', { note: 'All good.' }])
    await svc.assessClaim('CLM-2026-000071', { assessedAmount: '375000', note: ' Partial loss per table. ' })
    assert.deepEqual(lastPost().body, { assessed_amount: '375000', note: 'Partial loss per table.' })
    await svc.approveClaim('CLM-2026-000071', {})
    assert.deepEqual(lastPost().body, { note: null }, 'no amount: the backend approves the assessed amount')
    await svc.rejectClaim('CLM-2026-000071', 'Condition predates the policy.')
    assert.deepEqual(lastPost().body, { reason: 'Condition predates the policy.' })
    await svc.settleClaim('CLM-2026-000071', {})
    assert.equal(lastPost().path, '/claims/CLM-2026-000071/settle')
    assert.equal(lastPost().body, null, 'no amount: the backend settles the approved amount')
    assert.match(lastPost().headers.Authorization, /^Bearer token-admin@example\.com$/)
  })

  test('workflow conflicts surface the backend message; field errors map to the panels', async () => {
    routes['POST /claims/CLM-2026-000071/settle'] = () =>
      json(409, { detail: 'Claim CLM-2026-000071 is already settled under reference SET-2026-000001. It cannot be settled twice.', code: 'conflict' })
    await assert.rejects(svc.settleClaim('CLM-2026-000071', {}), { status: 409, message: /already settled/ })

    routes['POST /claims/CLM-2026-000071/assess'] = () =>
      json(422, {
        detail: 'Explain why the assessed amount is below the claimed amount (at least 10 characters).',
        code: 'unprocessable',
        errors: [{ field: 'body.note', message: 'Explain why…', type: 'business_rule' }],
      })
    await assert.rejects(svc.assessClaim('CLM-2026-000071', { assessedAmount: '1' }), (error) => {
      assert.deepEqual(error.data.errors, { note: 'Explain why…' })
      return true
    })

    routes['POST /claims/CLM-2026-000071/reject'] = () =>
      json(422, {
        detail: 'Give a clearer rejection reason (at least 15 characters).',
        code: 'unprocessable',
        errors: [{ field: 'body.reason', message: 'Give a clearer rejection reason (at least 15 characters).', type: 'business_rule' }],
      })
    await assert.rejects(svc.rejectClaim('CLM-2026-000071', 'short'), (error) => {
      assert.ok(error.data.errors.rejectionReason)
      return true
    })
  })
})
