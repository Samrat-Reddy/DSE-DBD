/**
 * Module 1 — Policy Catalog & Issuance: API service, validation, pricing.
 *
 * `policyService` now talks to the FastAPI backend. These tests run the real
 * service and auth-bridge code against a stubbed `fetch` that plays the
 * backend, and check what the frontend is responsible for: the request it
 * sends (paths, filters, codes, bearer token for the demo role), and the
 * mapping of API responses onto the shape the existing screens render.
 * Business rules, pricing and access control are tested in the backend
 * suite against real MySQL.
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { createHarness, installFakeSessionStorage } from './helpers/harness.js'

// Read by Vite as import.meta.env when the harness loads the app code.
process.env.VITE_DEMO_AUTH_PASSWORD = 'test-demo-password'
const storage = installFakeSessionStorage()

let harness
let svc
let validation
let pricing
let products

/* ------------------------------------------------------------------ */
/* Fake backend                                                        */
/* ------------------------------------------------------------------ */

const API_PRODUCT = {
  code: 'PRD-ACC-004',
  name: 'SafeGuard Personal Accident',
  type: 'personal_accident',
  status: 'active',
  tagline: 'Tagline',
  description: 'Description',
  reference_coverage_amount: '2000000.00',
  min_coverage_amount: '500000.00',
  max_coverage_amount: '10000000.00',
  base_annual_premium: '4800.00',
  default_term_years: 1,
  term_options: [1, 2, 3],
  premium_frequencies: ['quarterly', 'half_yearly', 'annual'],
  min_entry_age: 18,
  max_entry_age: 70,
  eligibility_summary: 'Adults 18-70.',
  eligibility_criteria: ['Criterion'],
  waiting_period: 'None',
  benefits: ['Benefit'],
  coverage_items: [{ name: 'Accidental death', limit: '100% of sum insured' }],
  exclusions: ['Exclusion'],
}

const API_POLICY = {
  policy_number: 'POL-2024-000519',
  status: 'active',
  product: { code: 'PRD-ACC-004', name: 'SafeGuard Personal Accident', type: 'personal_accident' },
  policyholder: {
    customer_code: 'CUS-100630',
    full_name: 'Farhan Qureshi',
    date_of_birth: '1985-01-01',
    email: 'farhan.qureshi@example.com',
    phone: '9845012345',
    address: { line1: '1 Road', line2: null, city: 'Hyderabad', state: 'Telangana', postal_code: '500001' },
  },
  nominee: { name: 'Sana Qureshi', relationship: 'Spouse', date_of_birth: '1987-01-01' },
  agent: { agent_code: 'AGT-2207', full_name: 'Meera Iyer', branch: 'Bengaluru South', email: 'meera.iyer@example.com' },
  coverage_amount: '2500000.00',
  annual_premium: '3100.00',
  instalment_premium: '1550.00',
  premium_frequency: 'half_yearly',
  term_years: 2,
  issue_date: '2024-11-08',
  start_date: '2024-11-10',
  end_date: '2026-11-09',
  lifecycle: [
    { stage: 'Policy issued', date: '2024-11-08', status: 'completed', note: 'Issued.' },
    { stage: 'Cover starts', date: '2024-11-10', status: 'completed', note: 'In force.' },
    { stage: 'Cover ends', date: '2026-11-09', status: 'upcoming', note: 'End of term.' },
  ],
}

let requests
let routes
let tokenCounter

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Minimal backend: /auth/login issues a token per call; other routes come from `routes`. */
const fakeFetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url)
  const path = pathname.replace('/api/v1', '')
  const body = init.body ? JSON.parse(init.body) : null
  const request = { method: init.method, path, params: Object.fromEntries(searchParams), headers: init.headers, body }
  requests.push(request)

  if (path === '/auth/login') {
    tokenCounter += 1
    return json(200, { access_token: `token-${body.email}-${tokenCounter}`, token_type: 'bearer', expires_in: 1800 })
  }
  const handler = routes[`${init.method} ${path}`]
  return handler ? handler(request) : json(404, { detail: 'Not found.', code: 'not_found' })
}

const apiCalls = () => requests.filter((request) => request.path !== '/auth/login')
const logins = () => requests.filter((request) => request.path === '/auth/login')

before(async () => {
  globalThis.fetch = fakeFetch
  harness = await createHarness()
  svc = await harness.load('/src/services/policyService.js')
  validation = await harness.load('/src/utils/issuanceValidation.js')
  pricing = await harness.load('/src/utils/policyPricing.js')
  ;({ policyProducts: products } = await harness.load('/src/data/policyProducts.js'))
})

after(() => harness.close())

beforeEach(() => {
  requests = []
  tokenCounter = 0
  storage.setItem('ipms.demoRole', 'agent')
  routes = {
    'GET /products': () => json(200, { items: [API_PRODUCT], total: 1, summary: { total: 7, active: 5, inactive: 2 } }),
    'GET /products/PRD-ACC-004': () => json(200, API_PRODUCT),
    'GET /policies': () => json(200, { items: [API_POLICY], total: 1, limit: 200, offset: 0 }),
    'GET /policies/POL-2024-000519': () => json(200, API_POLICY),
    'POST /policies': () => json(201, API_POLICY),
  }
})

/* ------------------------------------------------------------------ */
/* Catalog                                                             */
/* ------------------------------------------------------------------ */

describe('catalog requests and mapping', () => {
  test('maps an API product onto the shape the catalog screens render', async () => {
    const result = await svc.getPolicyProducts()
    assert.equal(result.total, 1)
    assert.deepEqual(result.summary, { total: 7, active: 5, inactive: 2 })

    const [product] = result.items
    assert.equal(product.id, 'PRD-ACC-004')
    assert.equal(product.type, 'Personal Accident')
    assert.equal(product.coverageAmount, 2000000)
    assert.deepEqual(product.coverageRange, { min: 500000, max: 10000000 })
    assert.equal(product.premium, 4800)
    assert.equal(product.premiumFrequency, 'Annual')
    assert.deepEqual(product.availableFrequencies, ['Quarterly', 'Half-Yearly', 'Annual'])
    assert.deepEqual(product.availableDurations, [1, 2, 3])
    assert.deepEqual(product.eligibility, { minAge: 18, maxAge: 70, summary: 'Adults 18-70.', criteria: ['Criterion'] })
    assert.deepEqual(product.coverageItems, [{ name: 'Accidental death', limit: '100% of sum insured' }])
  })

  test('sends search, filters and sort as API parameters (labels become codes, "all" is omitted)', async () => {
    await svc.getPolicyProducts({ search: '  accident ', type: 'Personal Accident', status: 'all', sort: 'premium-asc' })
    assert.deepEqual(apiCalls()[0].params, { search: 'accident', type: 'personal_accident', sort: 'premium-asc' })

    await svc.getPolicyProducts({ search: '', type: 'all', status: 'inactive', sort: 'name-asc' })
    assert.deepEqual(apiCalls()[1].params, { status: 'inactive', sort: 'name-asc' })
  })

  test('an unknown product is a 404 ApiError', async () => {
    await assert.rejects(svc.getPolicyProductById('PRD-XXX-999'), { name: 'ApiError', status: 404 })
  })
})

/* ------------------------------------------------------------------ */
/* Authentication bridge                                               */
/* ------------------------------------------------------------------ */

describe('demo-role sign-in bridge', () => {
  test('signs in once as the demo role’s account and reuses the bearer token', async () => {
    // The earlier tests signed in as the agent; a new role needs a new sign-in.
    storage.setItem('ipms.demoRole', 'administrator')
    await svc.getPolicyProducts()
    await svc.getIssuedPolicies()

    assert.equal(logins().length, 1)
    assert.deepEqual(logins()[0].body, { email: 'admin@example.com', password: 'test-demo-password' })
    assert.equal(apiCalls().length, 2)
    for (const call of apiCalls()) {
      assert.match(call.headers.Authorization, /^Bearer token-admin@example\.com-\d+$/)
    }
  })

  test('switching the demo role signs in as the matching account', async () => {
    storage.setItem('ipms.demoRole', 'policyholder')
    await svc.getIssuedPolicies()
    assert.equal(logins().at(-1).body.email, 'policyholder@example.com')
    assert.match(apiCalls().at(-1).headers.Authorization, /token-policyholder@example\.com/)

    storage.setItem('ipms.demoRole', 'agent')
    await svc.getIssuedPolicies()
    assert.equal(logins().at(-1).body.email, 'agent@example.com')
    assert.equal(logins().length, 2)
  })

  test('a 401 (expired or revoked token) triggers one fresh sign-in and a retry', async () => {
    await svc.getIssuedPolicies() // establish a session
    let rejected = false
    routes['GET /policies'] = () => {
      if (!rejected) {
        rejected = true
        return json(401, { detail: 'Could not validate credentials.', code: 'unauthorized' })
      }
      return json(200, { items: [], total: 0, limit: 200, offset: 0 })
    }
    const before = logins().length
    const result = await svc.getIssuedPolicies()
    assert.equal(result.total, 0)
    assert.equal(logins().length, before + 1)
  })

  test('a forbidden response is surfaced, not retried', async () => {
    routes['POST /policies'] = () =>
      json(403, { detail: 'You do not have permission to perform this action.', code: 'forbidden' })
    await assert.rejects(svc.issuePolicy({ productId: 'PRD-ACC-004', values: FORM }), { status: 403 })
    assert.equal(apiCalls().filter((call) => call.method === 'POST').length, 1)
  })
})

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

describe('policy register and details', () => {
  test('maps an API policy onto the shape the register and details render', async () => {
    const { items, total } = await svc.getIssuedPolicies()
    assert.equal(total, 1)
    assert.deepEqual(apiCalls()[0].params, { limit: '200' })

    const [policy] = items
    assert.equal(policy.id, 'POL-2024-000519')
    assert.equal(policy.productId, 'PRD-ACC-004')
    assert.equal(policy.type, 'Personal Accident')
    assert.equal(policy.premium, 1550, '`premium` is the per-instalment amount')
    assert.equal(policy.annualPremium, 3100)
    assert.equal(policy.premiumFrequency, 'Half-Yearly')
    assert.equal(policy.durationYears, 2)
    assert.equal(policy.policyholder.customerId, 'CUS-100630')
    assert.equal(policy.policyholder.address.line2, '')
    assert.equal(policy.policyholder.address.postalCode, '500001')
    assert.deepEqual(policy.agent, { id: 'AGT-2207', name: 'Meera Iyer', branch: 'Bengaluru South', email: 'meera.iyer@example.com' })
    assert.deepEqual(policy.documents, [])
    assert.equal(policy.lifecycle.length, 3)
  })

  test('a policy without a servicing agent maps to agent: null', async () => {
    routes['GET /policies/POL-2024-000519'] = () => json(200, { ...API_POLICY, agent: null })
    assert.equal((await svc.getIssuedPolicyById('POL-2024-000519')).agent, null)
  })

  test('getPolicyRecordById resolves products, policies (with their product) and unknown IDs', async () => {
    const product = await svc.getPolicyRecordById('PRD-ACC-004')
    assert.equal(product.kind, 'product')
    assert.equal(product.policy, null)

    const policy = await svc.getPolicyRecordById('POL-2024-000519')
    assert.equal(policy.kind, 'policy')
    assert.equal(policy.policy.id, 'POL-2024-000519')
    assert.equal(policy.product.id, 'PRD-ACC-004')

    // Unknown and out-of-scope policies both come back from the API as 404.
    await assert.rejects(svc.getPolicyRecordById('POL-2099-000001'), {
      status: 404,
      message: /No policy or product found/,
    })
  })
})

/* ------------------------------------------------------------------ */
/* Issuance                                                            */
/* ------------------------------------------------------------------ */

const START_DATE = (() => {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date.toISOString().slice(0, 10)
})()

const FORM = {
  fullName: 'Test Policyholder',
  customerId: '',
  dateOfBirth: '1992-05-14',
  email: 'test.user@example.com',
  phone: '9845012399',
  addressLine1: '12 Test Street',
  addressLine2: '   ',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  coverageAmount: '1500000',
  startDate: START_DATE,
  durationYears: '2',
  premiumFrequency: 'Half-Yearly',
  nomineeName: 'Test Nominee',
  nomineeRelationship: 'Spouse',
  nomineeDateOfBirth: '1993-08-02',
}

describe('issuance', () => {
  test('a complete form passes the full client-side validation gate', () => {
    const product = products.find((item) => item.id === 'PRD-ACC-004')
    assert.equal(validation.isIssuanceFormValid(FORM, product), true)
  })

  test('sends the wizard values as an API request (codes, numbers, blanks as null) and maps the result', async () => {
    const issued = await svc.issuePolicy({ productId: 'PRD-ACC-004', values: FORM })
    const post = apiCalls().find((call) => call.method === 'POST')

    assert.equal(post.path, '/policies')
    assert.deepEqual(post.body, {
      product_code: 'PRD-ACC-004',
      policyholder: {
        customer_code: null,
        full_name: 'Test Policyholder',
        date_of_birth: '1992-05-14',
        email: 'test.user@example.com',
        phone: '9845012399',
        address_line1: '12 Test Street',
        address_line2: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        postal_code: '560001',
      },
      coverage_amount: '1500000',
      start_date: START_DATE,
      term_years: 2,
      premium_frequency: 'half_yearly',
      nominee: { name: 'Test Nominee', relationship: 'Spouse', date_of_birth: '1993-08-02' },
    })
    assert.equal('premium' in post.body, false, 'the client never sends a premium')
    assert.equal(issued.id, 'POL-2024-000519')
  })

  test('backend rule violations surface with readable field details', async () => {
    routes['POST /policies'] = () =>
      json(422, {
        detail: "The policy details do not meet this product's rules.",
        code: 'unprocessable',
        errors: [{ field: 'body.term_years', message: 'Not offered for this product.', type: 'business_rule' }],
      })
    await assert.rejects(svc.issuePolicy({ productId: 'PRD-ACC-004', values: FORM }), {
      status: 422,
      message: "The policy details do not meet this product's rules. Policy duration: Not offered for this product.",
    })
  })

  test('a duplicate proposal is reported as 409 with the backend message', async () => {
    routes['POST /policies'] = () =>
      json(409, { detail: 'This policyholder already has a policy for this product starting on 2030-01-01.', code: 'conflict' })
    await assert.rejects(svc.issuePolicy({ productId: 'PRD-ACC-004', values: FORM }), {
      status: 409,
      message: /already has a policy/,
    })
  })

  test('issuing without a selected product rejects with 400 before any request', async () => {
    await assert.rejects(svc.issuePolicy({ productId: null, values: FORM }), { status: 400 })
    assert.equal(apiCalls().length, 0)
  })
})

/* ------------------------------------------------------------------ */
/* Client-side validation and preview pricing (unchanged utilities)    */
/* ------------------------------------------------------------------ */

describe('issuance validation', () => {
  const product = () => products.find((item) => item.id === 'PRD-HLT-001')

  test('a blank form reports every required policyholder field', () => {
    const errors = validation.validatePolicyholderStep(validation.EMPTY_ISSUANCE_FORM, product())
    for (const field of ['fullName', 'dateOfBirth', 'email', 'phone', 'addressLine1', 'city', 'state', 'postalCode']) {
      assert.ok(errors[field], `expected an error for ${field}`)
    }
    assert.equal(errors.customerId, undefined, 'customer ID is optional')
  })

  test('email, phone, PIN code and customer ID formats', () => {
    const check = (patch) => validation.validatePolicyholderStep({ ...validation.EMPTY_ISSUANCE_FORM, ...patch }, product())
    assert.ok(check({ email: 'not-an-email' }).email)
    assert.equal(check({ email: 'a.b@example.co.in' }).email, undefined)
    assert.ok(check({ phone: '12345' }).phone)
    assert.equal(check({ phone: '9845012377' }).phone, undefined)
    assert.ok(check({ postalCode: '12' }).postalCode)
    assert.ok(check({ customerId: 'XYZ' }).customerId)
  })

  test('date of birth must be in the past and within the entry age', () => {
    const form = validation.EMPTY_ISSUANCE_FORM
    assert.ok(validation.validatePolicyholderStep({ ...form, dateOfBirth: '2015-01-01' }, product()).dateOfBirth)
    assert.ok(validation.validatePolicyholderStep({ ...form, dateOfBirth: '2099-01-01' }, product()).dateOfBirth)
  })

  test('coverage band, start date, duration and frequency rules', () => {
    const check = (patch, p = product()) => validation.validatePolicyDetailsStep({ ...validation.EMPTY_ISSUANCE_FORM, ...patch }, p)
    assert.ok(check({ coverageAmount: '-500' }).coverageAmount)
    assert.ok(check({ coverageAmount: '999999999' }).coverageAmount)
    assert.equal(check({ coverageAmount: '1000000' }).coverageAmount, undefined)
    assert.ok(check({ startDate: '2020-01-01' }).startDate)
    assert.ok(check({ durationYears: '99' }).durationYears)
    const motor = products.find((item) => item.id === 'PRD-MOT-003')
    assert.ok(check({ premiumFrequency: 'Monthly' }, motor).premiumFrequency, 'Motor is annual only')
  })
})

describe('pricing preview helpers', () => {
  test('premium scales with coverage and splits into instalments (same formula as the backend)', () => {
    const product = products.find((item) => item.id === 'PRD-HLT-001')
    assert.equal(pricing.calculateAnnualPremium(product, 1500000), 27750)
    assert.equal(pricing.calculateInstalmentPremium(27750, 'Monthly'), 2313)
  })

  test('end date is start plus duration minus one day', () => {
    assert.equal(pricing.calculateEndDate('2026-01-01', 1), '2026-12-31')
    assert.equal(pricing.calculateEndDate(null, 1), null)
  })
})

describe('scope guard', () => {
  test('no API endpoints exist beyond the six official modules', async () => {
    const { ENDPOINTS } = await harness.load('/src/services/endpoints.js')
    const keys = Object.keys(ENDPOINTS).join(' ').toLowerCase()
    assert.doesNotMatch(keys, /intelligence|healthscore|prediction|forecast|chat/)
  })
})
