/**
 * Module 1 — rendering, route resolution and demo-role gating.
 *
 * Ported from the render and route harnesses used when Module 1 shipped.
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import {
  createHarness,
  h,
  renderInRouter,
  renderPageWithRole,
} from './helpers/harness.js'

let harness
let AppRoutes
let policy
let issuance
let common
let ProductStep
let PolicyholderStep
let PolicyDetailsStep
let products
let policies
let EMPTY_FORM

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  policy = await harness.load('/src/components/policy/index.js')
  issuance = await harness.load('/src/components/issuance/index.js')
  common = await harness.load('/src/components/common/index.js')
  ProductStep = (await harness.load('/src/components/issuance/ProductStep.jsx')).default
  PolicyholderStep = (await harness.load('/src/components/issuance/PolicyholderStep.jsx')).default
  PolicyDetailsStep = (await harness.load('/src/components/issuance/PolicyDetailsStep.jsx')).default
  products = (await harness.load('/src/data/policyProducts.js')).policyProducts
  policies = (await harness.load('/src/data/issuedPolicies.js')).issuedPolicies
  EMPTY_FORM = (await harness.load('/src/utils/issuanceValidation.js')).EMPTY_ISSUANCE_FORM
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)

describe('route resolution', () => {
  test('home, catalog, details and issuance resolve to the right pages', () => {
    assert.match(renderRoute('/'), /Project overview/)
    assert.match(renderRoute('/policies'), /Policy catalog/)

    const issue = renderRoute('/policies/issue')
    assert.match(issue, /Issue a policy/)
    assert.doesNotMatch(issue, /Catalog product/)

    const details = renderRoute('/policies/PRD-HLT-001')
    assert.match(details, /Loading policy/)

    assert.match(renderRoute('/policies/issue/PRD-HLT-001'), /Issue a policy/)
  })

  test('unmatched paths fall through to NotFound', () => {
    assert.match(renderRoute('/nonexistent'), /404/)
    assert.match(renderRoute('/policies/issue/extra/segments'), /404/)
  })

  // Reports became Module 6; nothing beyond the six official modules exists.
  test('no routes exist beyond the six official modules', async () => {
    const { ROUTES } = await harness.load('/src/utils/constants.js')
    assert.doesNotMatch(Object.values(ROUTES).join(' ').toLowerCase(), /intelligence|health-score|prediction|forecast|chat/)

    for (const pathname of ['/intelligence', '/policy-health', '/forecasts']) {
      assert.match(renderRoute(pathname), /404/, `${pathname} should not be implemented`)
    }
  })
})

describe('demo role gating for issuance', () => {
  const renderIssuance = async (role) => {
    const PolicyIssuance = (await harness.load('/src/pages/PolicyIssuance.jsx')).default
    return renderPageWithRole({
      page: PolicyIssuance,
      role,
      routePath: '/policies/issue',
      pathname: '/policies/issue',
    })
  }

  test('agents and administrators can reach the workflow', async () => {
    assert.doesNotMatch(await renderIssuance('agent'), /not available for this role/)
    assert.doesNotMatch(await renderIssuance('administrator'), /not available for this role/)
  })

  test('policyholders get an explanatory state', async () => {
    assert.match(await renderIssuance('policyholder'), /Issuance is not available for this role/)
  })
})

describe('policy components', () => {
  test('PolicyCard renders name, details link and issue action', () => {
    const html = renderInRouter(h(policy.PolicyCard, { product: products[0], canIssue: true }))
    assert.match(html, /Secure Health Shield/)
    assert.match(html, /\/policies\/PRD-HLT-001/)
    assert.match(html, /Issue policy/)
  })

  test('inactive PolicyCard shows closed state without an issue action', () => {
    const inactive = products.find((p) => p.status === 'inactive')
    const html = renderInRouter(h(policy.PolicyCard, { product: inactive, canIssue: true }))
    assert.match(html, /Closed to new business/)
    assert.doesNotMatch(html, /Issue policy/)
  })

  test('summary, coverage, customer and documents render, including fallbacks', () => {
    renderInRouter(h(policy.PolicySummary, { record: policies[0] }))
    assert.match(renderInRouter(h(policy.CoverageSection, { product: products[0] })), /Major exclusions/)
    assert.match(renderInRouter(h(policy.CoverageSection, { product: null })), /unavailable/)
    assert.match(
      renderInRouter(h(policy.CustomerSummary, { policyholder: policies[0].policyholder, nominee: policies[0].nominee })),
      /Ananya Krishnan/,
    )
    assert.match(renderInRouter(h(policy.CustomerSummary, { policyholder: null })), /appears once a policy/)
    assert.match(renderInRouter(h(policy.PolicyDocumentList, { documents: [] })), /No documents/)
  })

  test('lifecycle timeline is an ordered list of the four stages', () => {
    const html = renderInRouter(h(policy.LifecycleTimeline, { events: policies[0].lifecycle }))
    assert.match(html, /<ol/)
    for (const stage of ['Application Submitted', 'Underwriting Completed', 'Policy Approved', 'Policy Issued']) {
      assert.ok(html.includes(stage), stage)
    }
    renderInRouter(h(policy.LifecycleTimeline, { events: policies[2].lifecycle }))
  })

  test('issued policy list renders both the table and the mobile cards', () => {
    const html = renderInRouter(h(policy.IssuedPolicyList, { policies }))
    assert.match(html, /<table/)
    assert.match(html, /issued-cards/)
    for (const item of policies) assert.ok(html.includes(`/policies/${item.id}`))
  })
})

describe('issuance components', () => {
  test('step indicator, product step and policy details step render', () => {
    renderInRouter(
      h(issuance.IssuanceStepIndicator, {
        steps: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
        currentStep: 1,
        furthestStep: 2,
      }),
    )
    renderInRouter(h(ProductStep, { products, selectedId: products[0].id, onSelect: () => {} }))
    renderInRouter(
      h(PolicyDetailsStep, {
        product: products[0],
        values: { ...EMPTY_FORM, coverageAmount: '1500000', premiumFrequency: 'Annual' },
        errors: {},
        touched: {},
        onChange: () => {},
        onBlur: () => {},
      }),
    )
  })

  test('field errors are wired to their inputs for assistive technology', () => {
    const html = renderInRouter(
      h(PolicyholderStep, {
        values: EMPTY_FORM,
        errors: { fullName: 'Full name is required.' },
        touched: { fullName: true },
        onChange: () => {},
        onBlur: () => {},
      }),
    )
    assert.match(html, /aria-invalid="true"/)
    assert.match(html, /aria-describedby/)
    assert.match(html, /Full name is required\./)
    assert.ok((html.match(/<label/g) || []).length >= 9)
  })

  test('issuance success shows the policy number and View policy', () => {
    const html = renderInRouter(
      h(issuance.IssuanceSuccess, { policy: policies[0], onIssueAnother: () => {} }),
    )
    assert.ok(html.includes(policies[0].id))
    assert.match(html, /View policy/)
  })
})

describe('common state views', () => {
  test('loading, empty, error and every status badge render', () => {
    assert.match(renderInRouter(h(common.LoadingState, { rows: 2 })), /role="status"/)
    assert.match(renderInRouter(h(common.EmptyState, { title: 'Nothing' })), /Nothing/)
    assert.match(
      renderInRouter(h(common.ErrorState, { error: { message: 'Boom', status: 500 }, onRetry: () => {} })),
      /role="alert"[\s\S]*Boom[\s\S]*Try again/,
    )
    const statuses = ['active', 'inactive', 'pending', 'expired', 'lapsed', 'paid', 'due', 'upcoming', 'overdue', 'success', 'failed', 'up-to-date', 'fully-paid']
    const html = renderInRouter(
      h('div', null, statuses.map((status) => h(common.StatusBadge, { key: status, status }))),
    )
    for (const label of ['Paid', 'Due', 'Upcoming', 'Overdue', 'Successful', 'Failed', 'Up to date', 'Fully paid']) {
      assert.ok(html.includes(label), label)
    }
  })
})
