/**
 * Module 5 — routes, navigation, role restrictions, component states,
 * accessibility wiring, responsive structure and architecture guards.
 *
 * Components render with data returned by the real commission service.
 */

import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  FRONTEND_ROOT,
  countOccurrences,
  createHarness,
  h,
  renderInRouter,
  renderPageWithRole,
} from './helpers/harness.js'

let harness
let AppRoutes
let pages
let ui
let service
const data = {}

const ADMIN = { role: 'administrator' }
const MEERA = { role: 'agent', agentId: 'AGT-2207' }

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  pages = await harness.load('/src/pages/index.js')
  ui = await harness.load('/src/components/commissions/index.js')
  service = await harness.load('/src/services/commissionService.js')
  const premiums = await harness.load('/src/services/mockPremiumLedger.js')

  data.all = await service.getCommissions(ADMIN)
  data.meera = await service.getCommissions(MEERA)
  data.paid = await service.getCommissionById('COM-2025-000003', ADMIN)
  data.pendingReady = await service.getCommissionById('COM-2026-000002', ADMIN)
  data.agents = await service.getAgentCommissionSummaries(ADMIN)
  data.policyAdmin = await service.getPolicyCommissions('POL-2024-000226', ADMIN)
  data.rules = await service.getCommissionRules(ADMIN)

  const payment = await premiums.recordMockPayment({
    policyId: 'POL-2024-000519',
    installmentId: 'INS-2024-000519-004',
    amount: 1550,
    method: 'upi',
  })
  data.held = await service.generateCommissionForPayment(payment.payment.paymentId, ADMIN)
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)
const readSource = (relative) => readFileSync(path.join(FRONTEND_ROOT, 'src', relative), 'utf8')
const noop = async () => ({ ok: true })

/** Render the app shell with a stored demo role, as the browser would after a switch. */
const renderRouteAsRole = (pathname, role) => {
  const previous = globalThis.window
  globalThis.window = { sessionStorage: { getItem: () => role, setItem: () => {}, removeItem: () => {} } }
  try {
    return renderRoute(pathname)
  } finally {
    globalThis.window = previous
  }
}

const COMMISSION_PAGES = [
  ['CommissionOverview', '/commissions', '/commissions'],
  ['CommissionAgents', '/commissions/agents', '/commissions/agents'],
  ['AgentCommissionDetails', '/commissions/agents/:agentId', '/commissions/agents/AGT-2207'],
  ['PolicyCommission', '/commissions/policies/:policyId', '/commissions/policies/POL-2024-000148'],
  ['CommissionDetails', '/commissions/:commissionId', '/commissions/COM-2024-000031'],
]

/* ------------------------------------------------------------------ */

describe('route resolution and navigation', () => {
  test('each commission route resolves to its page', () => {
    assert.match(renderRoute('/commissions'), /<h1[^>]*>Agent Commission<\/h1>/)
    assert.match(renderRoute('/commissions'), /Module 5 · Agent Commission/)
    assert.match(renderRoute('/commissions/agents'), /<h1[^>]*>Commission by agent<\/h1>/)
    assert.match(renderRoute('/commissions/agents/AGT-2207'), /Loading agent commission…/)
    assert.match(renderRoute('/commissions/policies/POL-2024-000148'), /Loading policy commission…/)
    assert.match(renderRoute('/commissions/COM-2024-000031'), /Loading commission…/)
  })

  test('static segments are not captured as commission IDs; deeper paths are 404', () => {
    assert.doesNotMatch(renderRoute('/commissions/agents'), /Loading commission…/)
    assert.doesNotMatch(renderRoute('/commissions/policies/POL-2024-000148'), /Loading commission…/)
    assert.match(renderRoute('/commissions/COM-2024-000031/extra'), /404/)
    assert.match(renderRoute('/commissions/policies'), /Loading commission…/, 'a bare segment is treated as an ID and reported not found at runtime')
  })

  test('navigation shows Agent commission to agents and administrators only', () => {
    assert.match(renderRouteAsRole('/', 'agent'), /href="\/commissions"/)
    assert.match(renderRouteAsRole('/', 'administrator'), /href="\/commissions"/)
    assert.doesNotMatch(renderRouteAsRole('/', 'policyholder'), /href="\/commissions"/)
  })

  test('the home page lists Module 5 as implemented', () => {
    const home = renderRoute('/')
    assert.match(home, /Module 5 — Agent Commission/)
    const scope = home.slice(home.indexOf('Official module scope'), home.indexOf('Architecture'))
    assert.match(scope, /Agent Commission/)
    assert.doesNotMatch(scope, /planned/)
  })

  test('Modules 1–4 routes still resolve', () => {
    assert.match(renderRoute('/policies'), /Policy catalog/)
    assert.match(renderRoute('/policies/POL-2024-000148'), /Loading/)
    assert.match(renderRouteAsRole('/policies/issue', 'agent'), /Issue/)
    assert.match(renderRoute('/payments'), /Premium/)
    assert.match(renderRoute('/claims'), /Claims/)
    assert.match(renderRoute('/renewals'), /Renewals/)
    assert.match(renderRoute('/renewals/POL-2024-000519'), /Loading renewal…/)
  })
})

describe('role restrictions on every commission page', () => {
  test('policyholders see a confidentiality notice and no data is requested', () => {
    for (const [name, routePath, pathname] of COMMISSION_PAGES) {
      const html = renderPageWithRole({ page: pages[name], role: 'policyholder', routePath, pathname })
      assert.match(html, /Agent commission is confidential/, name)
      assert.doesNotMatch(html, /state-view--loading/, `${name} does not load`)
    }
  })

  test('agents and administrators get the page with a role note', () => {
    const overview = (role) => renderPageWithRole({ page: pages.CommissionOverview, role, routePath: '/commissions', pathname: '/commissions' })
    assert.match(overview('agent'), /Agent view/)
    assert.match(overview('agent'), /Other agents(&#x27;|')? commission is confidential/)
    assert.match(overview('administrator'), /Administrator view/)
    assert.match(overview('administrator'), /Simulated commission/)
  })
})

describe('commission components', () => {
  test('the register renders a captioned table and matching cards with links', () => {
    const html = renderInRouter(h(ui.CommissionList, { commissions: data.all.items }))
    assert.match(html, /<caption class="sr-only">/)
    assert.equal(countOccurrences(html, '<tr>') - 1, 12)
    assert.equal(countOccurrences(html, 'class="commission-card '), 12)
    assert.match(html, /href="\/commissions\/COM-2025-000003"/)
    assert.match(html, /href="\/commissions\/agents\/AGT-1184"/)
    assert.match(html, /href="\/commissions\/policies\/POL-2024-000226"/)
    assert.match(html, /href="\/payments\/history\/PAY-2025-000007"/)
    assert.match(html, /₹4,650\.00 × 22\.5%/)
    assert.match(html, />₹1,046\.25</)
    assert.match(html, />Pending</)
    assert.match(html, />Earned</)
    assert.match(html, />Paid</)

    const own = renderInRouter(h(ui.CommissionList, { commissions: data.meera.items, showAgent: false }))
    assert.doesNotMatch(own, /<th scope="col">Agent<\/th>/)
    assert.doesNotMatch(own, /Arjun Nair/)
  })

  test('the calculation explains amount, rate, result, basis and rule', () => {
    const html = renderInRouter(h(ui.CommissionCalculation, { explanation: data.paid.explanation }))
    assert.match(html, /Commissionable amount/)
    assert.match(html, /₹4,650\.00/)
    assert.match(html, /22\.5%/)
    assert.match(html, /₹1,046\.25/)
    assert.match(html, /₹4,650\.00 × 22\.5% = ₹1,046\.25/)
    assert.match(html, /policy year 1, so the first-year rate applies/)
    assert.match(html, /CR-LIF-002-AGT-1184/)
  })

  test('status actions: allowed, blocked with a reason, final, and read-only', () => {
    const allowed = renderInRouter(h(ui.CommissionActions, { status: 'pending', actions: data.pendingReady.actions, canManage: true, onTransition: noop }))
    assert.match(allowed, /Confirm as earned/)
    assert.doesNotMatch(allowed, /disabled=""/)

    const blocked = renderInRouter(h(ui.CommissionActions, { status: 'pending', actions: data.held.actions, canManage: true, onTransition: noop }))
    assert.match(blocked, /Not yet possible/)
    assert.match(blocked, /30 days after the premium payment/)
    assert.match(blocked, /disabled=""/)

    assert.match(renderInRouter(h(ui.CommissionActions, { status: 'paid', actions: [], canManage: true })), /Paid is final/)
    const agent = renderInRouter(h(ui.CommissionActions, { status: 'earned', actions: [], canManage: false }))
    assert.match(agent, /Only an administrator can confirm commission as earned or mark it as paid/)
    assert.doesNotMatch(agent, /<button/)
  })

  test('audit history shows events, status changes, actors and payout references', () => {
    const html = renderInRouter(h(ui.CommissionHistory, { events: data.paid.history }))
    assert.equal(countOccurrences(html, 'class="commission-history__item"'), 3)
    assert.match(html, /Commission generated/)
    assert.match(html, /Confirmed as earned/)
    assert.match(html, /Marked as paid \(simulated payout\)/)
    assert.match(html, /MOCKPAYOUT-2025-02-1184/)
    assert.match(html, /<span class="sr-only"> to <\/span>/)
    assert.match(html, /CEV-2025-\d{6}/)
    assert.match(renderInRouter(h(ui.CommissionHistory, { events: [] })), /No events have been recorded/)
  })

  test('agent-wise table lists every agent with totals', () => {
    const html = renderInRouter(h(ui.AgentCommissionTable, { agents: data.agents.items }))
    assert.equal(countOccurrences(html, '<tr>') - 1, 5)
    assert.equal(countOccurrences(html, 'class="commission-card '), 5)
    assert.match(html, /₹4,719\.75/)
    assert.match(html, /href="\/commissions\/agents\/AGT-3390"/)
  })

  test('policy payments show generation for administrators only, and reasons for refusals', () => {
    const admin = renderInRouter(h(ui.CommissionPaymentList, { payments: data.policyAdmin.payments, canManage: true, onGenerate: () => {} }))
    assert.match(admin, /Generate commission/)
    assert.match(admin, /Would generate ₹255\.75/)
    assert.match(admin, /Only successful premium payments earn commission/)
    assert.match(admin, /href="\/commissions\/COM-2026-000002"/)

    const readOnly = renderInRouter(h(ui.CommissionPaymentList, { payments: data.policyAdmin.payments, canManage: false }))
    assert.doesNotMatch(readOnly, /Generate commission/)
    assert.match(renderInRouter(h(ui.CommissionPaymentList, { payments: [] })), /No premium payments have been recorded/)
  })

  test('the awaiting panel offers bulk actions to administrators and announces results', () => {
    const admin = renderInRouter(
      h(ui.AwaitingCommissionPanel, { awaiting: data.all.awaiting, canManage: true, result: 'Generated 1 commission.', onGenerateAll: noop, onConfirmEarnings: noop }),
    )
    assert.match(admin, /Generate eligible commission \(1\)/)
    assert.match(admin, /Confirm eligible earnings/)
    assert.match(admin, /role="status"[^>]*>.*Generated 1 commission\./)
    assert.match(admin, /PAY-2026-000036/)

    const agent = renderInRouter(h(ui.AwaitingCommissionPanel, { awaiting: data.meera.awaiting, canManage: false }))
    assert.doesNotMatch(agent, /<button/)
    assert.match(agent, /No eligible payment is waiting/)
    assert.match(agent, /generated and confirmed by an administrator/)
  })

  test('the rules table shows products, scope, rates and effective periods', () => {
    const html = renderInRouter(h(ui.CommissionRulesTable, { rules: data.rules.rules, config: data.rules.config }))
    assert.equal(countOccurrences(html, '<tr>') - 1, 7)
    assert.match(html, /Agent: Arjun Nair/)
    assert.match(html, /22\.5%/)
    assert.match(html, /open-ended/)
    assert.match(html, /Not in force today/)
    assert.match(html, /30 days after the payment/)
  })
})

describe('accessibility, responsive structure and architecture', () => {
  const commissionSources = () => {
    const dir = path.join(FRONTEND_ROOT, 'src', 'components', 'commissions')
    return readdirSync(dir)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')])
      .concat(
        ['pages/CommissionOverview.jsx', 'pages/CommissionAgents.jsx', 'pages/AgentCommissionDetails.jsx', 'pages/PolicyCommission.jsx', 'pages/CommissionDetails.jsx'].map(
          (file) => [file, readSource(file)],
        ),
      )
  }

  test('no ARIA widget roles that would require custom keyboard handling', () => {
    for (const [file, source] of commissionSources()) {
      assert.doesNotMatch(source, /role="(tab|tablist|tabpanel|menu|menuitem|listbox|combobox|grid|dialog)"/, file)
    }
  })

  test('components and pages never calculate commission, touch storage or call the network', () => {
    for (const [file, source] of commissionSources()) {
      assert.doesNotMatch(source, /sessionStorage|localStorage|fetch\(|XMLHttpRequest|apiClient/, file)
      assert.doesNotMatch(source, /ratePercent\s*[*/]|[*/]\s*[\w.]*ratePercent|toPaise|calculateCommission\(/, file)
    }
  })

  test('the service makes no network calls and only the commission store touches storage', () => {
    const code = readSource('services/commissionService.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|apiClient\.|axios|sessionStorage/)
    for (const file of ['utils/commissionCalculation.js', 'utils/commissionEligibility.js', 'utils/commissionLifecycle.js', 'utils/commissionAccess.js', 'utils/commissionSummary.js']) {
      const source = readSource(file)
      assert.doesNotMatch(source, /sessionStorage|localStorage|new Date\(|Date\.now|todayIso/, `${file} is pure`)
    }
    assert.match(readSource('services/mockCommissionStore.js'), /sessionStorage/)
  })

  test('the service exposes exactly the commission API', () => {
    assert.deepEqual(Object.keys(service).filter((key) => key !== 'default').sort(), [
      'confirmEligibleEarnings',
      'generateCommissionForPayment',
      'generateEligibleCommissions',
      'getAgentCommissionSummaries',
      'getAgentCommissions',
      'getCommissionById',
      'getCommissionHistory',
      'getCommissionRules',
      'getCommissions',
      'getPolicyCommissions',
      'transitionCommission',
    ])
  })

  test('tables become cards on small screens and detail layouts collapse', () => {
    const listCss = readSource('components/commissions/CommissionList.css')
    const media = listCss.slice(listCss.indexOf('@media (max-width: 900px)'))
    assert.match(media, /\.commission-table-wrap\s*{\s*display:\s*none/)
    assert.match(media, /\.commission-cards\s*{\s*display:\s*grid/)
    assert.match(readSource('pages/Commissions.css'), /@media \(max-width: 1080px\)[\s\S]*\.commission-detail\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(readSource('components/commissions/CommissionHistory.css'), /@media \(max-width: 620px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(readSource('components/commissions/CommissionPanels.css'), /\.commission-rules-wrap\s*{\s*overflow-x:\s*auto/)
  })

  test('commission pages do not depend on Module 6', () => {
    for (const [file, source] of commissionSources()) {
      assert.doesNotMatch(source, /reportService|reportAggregations/, file)
    }
  })
})
