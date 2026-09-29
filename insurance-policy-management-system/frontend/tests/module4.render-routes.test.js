/**
 * Module 4 — routes, navigation, role-specific controls, component states,
 * accessibility wiring, responsive structure and scope guards.
 *
 * Components render with data returned by the real renewal service. Loaded
 * states for POL-2024-000226 use the simulation clock (moved to 2049), so they
 * do not depend on the run date.
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
const AGENT = { role: 'agent' }
const LIFE = 'POL-2024-000226'

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  pages = await harness.load('/src/pages/index.js')
  ui = await harness.load('/src/components/renewals/index.js')
  service = await harness.load('/src/services/renewalService.js')

  data.list = await service.getRenewalPolicies()
  data.health = await service.getRenewalPolicyById('POL-2024-000148')
  data.home = await service.getRenewalPolicyById('POL-2023-000874')
  data.todayClock = data.list.clock

  await service.advanceRenewalClock('2049-05-05', ADMIN)
  data.lifeDue = await service.getRenewalPolicyById(LIFE)
  data.lifeFailed = (await service.triggerReminder(LIFE, 'd60', ADMIN, { outcome: 'failed' })).details

  await service.advanceRenewalClock('2049-06-04', ADMIN)
  data.check = await service.runReminderCheck(AGENT)
  data.simulatedClock = await service.getRenewalClock()
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)
const readSource = (relative) => readFileSync(path.join(FRONTEND_ROOT, 'src', relative), 'utf8')
const noop = async () => ({ ok: true })

/** The first rendered tag carrying `name="..."`, so attribute order does not matter. */
const tagNamed = (html, name) => {
  const match = html.match(new RegExp(`<(input|select|textarea)\\s[^>]*name="${name}"[^>]*>`))
  assert.ok(match, `element named ${name} is rendered`)
  return match[0]
}

/** Every rendered control has a <label for> pointing at its id. */
const assertLabelled = (html, name) => {
  const id = tagNamed(html, name).match(/id="([^"]+)"/)[1]
  assert.ok(html.includes(`for="${id}"`), `${name} has a label`)
}

const timeline = (details, canManage) =>
  renderInRouter(h(ui.ReminderTimeline, { plan: details.account.plan, canManage, onTrigger: noop, onRetry: noop }))

/* ------------------------------------------------------------------ */

describe('route resolution and navigation', () => {
  test('/renewals renders the renewals overview', () => {
    const html = renderRoute('/renewals')
    assert.match(html, /<h1[^>]*>Renewals<\/h1>/)
    assert.match(html, /Module 4 · Renewal Reminder Engine/)
    assert.match(html, /Loading renewal summary/)
    assert.match(html, /Simulated reminders/)
  })

  test('/renewals/:policyId renders the renewal details page', () => {
    const html = renderRoute('/renewals/POL-2024-000519')
    assert.match(html, /Loading renewal…/)
    assert.match(html, /href="\/renewals"/)
  })

  test('deeper unknown renewal paths fall through to NotFound', () => {
    assert.match(renderRoute('/renewals/POL-2024-000519/extra'), /404/)
  })

  test('primary navigation links to renewals and Module 1–3 routes still resolve', () => {
    const home = renderRoute('/')
    assert.match(home, /href="\/renewals"/)
    assert.match(home, /Module 4 — Renewal Reminder Engine/)
    for (const [pathname, text] of [['/policies', /Policy catalog/], ['/payments', /Premium/], ['/claims', /Claims/]]) {
      assert.match(renderRoute(pathname), text)
    }
  })

  test('the home page lists renewals among the implemented modules', () => {
    const home = renderRoute('/')
    const scope = home.slice(home.indexOf('Official module scope'))
    const renewalsEntry = scope.slice(scope.indexOf('Renewals'), scope.indexOf('Renewals') + 120)
    assert.match(renewalsEntry, /implemented/)
    assert.doesNotMatch(scope.slice(0, scope.indexOf('Architecture')), /planned/)
  })
})

describe('role notes', () => {
  const renderOverview = (role) =>
    renderPageWithRole({ page: pages.RenewalsOverview, role, routePath: '/renewals', pathname: '/renewals' })

  test('each role is told what it can do', () => {
    assert.match(renderOverview('policyholder'), /Policyholder view/)
    assert.match(renderOverview('agent'), /Agent view.*run the reminder check/)
    assert.match(renderOverview('administrator'), /Administrator view/)
  })
})

describe('renewal list', () => {
  test('renders a captioned table and matching cards with links to details', () => {
    const html = renderInRouter(h(ui.RenewalList, { accounts: data.list.items }))
    assert.match(html, /<caption class="sr-only">/)
    assert.equal(countOccurrences(html, '<tr>') - 1, data.list.items.length)
    assert.equal(countOccurrences(html, 'class="renewal-card '), data.list.items.length)
    for (const item of data.list.items) {
      assert.ok(html.includes(`href="/renewals/${item.policyId}"`))
    }
    assert.match(html, /Expired \d+ days ago/)
    assert.match(html, />Expired</)
    assert.match(html, /scope="col"/)
    assert.match(html, /<span class="sr-only"> renewal for POL-/)
  })
})

describe('reminder timeline', () => {
  test('a due stage offers administrators a labelled simulated-outcome form', () => {
    const html = timeline(data.lifeDue, true)
    assert.equal(countOccurrences(html, 'class="reminder-stage '), 7)
    assert.equal(countOccurrences(html, 'aria-current="step"'), 1)
    assert.match(html, /Due now/)
    assert.match(html, /Record simulated reminder/)
    for (const name of ['send-outcome', 'send-channel', 'send-note']) assertLabelled(html, name)
    assert.match(html, /Skip this stage/)
    assert.match(html, /No email, SMS or in-app message is sent/)
  })

  test('agents and policyholders see the due stage without controls', () => {
    const html = timeline(data.lifeDue, false)
    assert.doesNotMatch(html, /<form/)
    assert.match(html, /recorded by the next reminder check, or manually by an administrator/)
  })

  test('a failed stage offers a retry (sent or failed only) to administrators', () => {
    const admin = timeline(data.lifeFailed, true)
    assert.match(admin, /Retry simulated reminder/)
    const retrySelect = admin.slice(admin.indexOf('name="retry-outcome"'), admin.indexOf('</select>', admin.indexOf('name="retry-outcome"')))
    assert.doesNotMatch(retrySelect, /Skip this stage/)
    assert.doesNotMatch(admin, /Record simulated reminder/)

    const agent = timeline(data.lifeFailed, false)
    assert.doesNotMatch(agent, /<form/)
    assert.match(agent, /Only an administrator can retry it/)
  })

  test('an ineligible policy explains why and offers nothing', () => {
    const html = timeline(data.home, true)
    assert.match(html, /No further reminders/)
    assert.match(html, /renewal reminder window closed/)
    assert.doesNotMatch(html, /<form/)
    assert.match(html, />Sent</)
    assert.match(html, />Failed</)
    assert.match(html, />Skipped</)
  })

  test('without an expiry date no schedule is shown', () => {
    const html = renderInRouter(h(ui.ReminderTimeline, { plan: { stages: [] } }))
    assert.match(html, /without a valid expiry date/)
  })
})

describe('reminder history, check, clock and readiness', () => {
  test('history shows IDs, outcomes, triggers, retry links and the simulated tag', () => {
    const html = renderInRouter(h(ui.ReminderHistoryList, { events: data.health.history }))
    assert.equal(countOccurrences(html, 'class="reminder-history__item '), 8)
    assert.match(html, /RMD-2025-000041/)
    assert.match(html, /Retry of/)
    assert.match(html, /RMD-2025-000040/)
    assert.match(html, /Reminder check/)
    assert.equal(countOccurrences(html, '>Simulated<'), 8)
    assert.match(html, /<time dateTime="/i)

    const empty = renderInRouter(h(ui.ReminderHistoryList, { events: [], emptyMessage: 'Nothing yet.' }))
    assert.match(empty, /Nothing yet\./)
  })

  test('history with policy links for the overview', () => {
    const html = renderInRouter(h(ui.ReminderHistoryList, { events: data.list.recentReminders, showPolicy: true }))
    assert.match(html, /href="\/renewals\/POL-/)
  })

  test('the reminder check button is shown only to roles that may run it', () => {
    const agent = renderInRouter(h(ui.ReminderCheckPanel, { asOf: '2049-06-04', canRun: true, onRun: () => {} }))
    assert.match(agent, /Run reminder check/)
    assert.match(agent, /role="status"/)

    const holder = renderInRouter(h(ui.ReminderCheckPanel, { asOf: '2049-06-04', canRun: false, onRun: () => {} }))
    assert.doesNotMatch(holder, /<button/)
    assert.match(holder, /cannot run the reminder check/)
  })

  test('a completed check summarises what was recorded, skipped, handled and needs retry', () => {
    const html = renderInRouter(h(ui.ReminderCheckPanel, { asOf: data.check.asOf, canRun: true, result: data.check, onRun: () => {} }))
    assert.match(html, /Reminder check completed as of/)
    assert.match(html, /Policies evaluated/)
    assert.match(html, /Failed — retry required|Recorded/)
    assert.match(html, /No real messages were sent/)
    const errored = renderInRouter(h(ui.ReminderCheckPanel, { canRun: true, error: 'Nope.', onRun: () => {} }))
    assert.match(errored, /role="alert"[^>]*>Nope\./)
  })

  test('the clock offers forward-only controls to administrators only', () => {
    const admin = renderInRouter(
      h(ui.RenewalClockPanel, { clock: data.simulatedClock, canManage: true, nextReminderDate: '2049-06-19', onAdvance: noop, onReset: noop }),
    )
    assert.match(admin, /Simulated date/)
    assert.match(admin, /Actual date/)
    const input = tagNamed(admin, 'simulationDate')
    assert.match(input, /type="date"/)
    assert.match(input, /min="2049-06-04"/)
    assertLabelled(admin, 'simulationDate')
    assert.match(admin, /Advance date/)
    assert.match(admin, /Jump to next reminder/)
    assert.match(admin, /Reset simulation/)

    const agent = renderInRouter(h(ui.RenewalClockPanel, { clock: data.todayClock, canManage: false }))
    assert.doesNotMatch(agent, /<input/)
    assert.match(agent, /Only an administrator can change or reset/)
    assert.match(agent, />Today</)
  })

  test('readiness shows the verdict and each check with a text outcome', () => {
    const html = renderInRouter(h(ui.RenewalReadinessPanel, { readiness: data.lifeDue.account.readiness }))
    assert.match(html, /Action required/)
    assert.match(html, /aria-label="Renewal readiness checks"/)
    assert.match(html, /Needs attention/)
    assert.match(html, /Informational only/)
    assert.equal(countOccurrences(html, 'class="checklist__item '), 6)

    const blocked = renderInRouter(h(ui.RenewalReadinessPanel, { readiness: data.home.account.readiness }))
    assert.match(blocked, /Not eligible/)
    assert.match(blocked, /Blocked/)
  })
})

describe('accessibility, responsive structure and scope', () => {
  const renewalSources = () => {
    const dir = path.join(FRONTEND_ROOT, 'src', 'components', 'renewals')
    return readdirSync(dir)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      .concat(['pages/RenewalsOverview.jsx', 'pages/RenewalDetails.jsx'].map(readSource))
  }

  test('no ARIA widget roles that would require custom keyboard handling', () => {
    for (const source of renewalSources()) {
      assert.doesNotMatch(source, /role="(tab|tablist|tabpanel|menu|menuitem|listbox|combobox|grid|dialog)"/)
    }
  })

  test('the renewal table becomes cards on small screens and layouts collapse', () => {
    const listCss = readSource('components/renewals/RenewalList.css')
    const media = listCss.slice(listCss.lastIndexOf('@media'))
    assert.match(media, /\.renewal-table-wrap\s*{\s*display:\s*none/)
    assert.match(media, /\.renewal-cards\s*{\s*display:\s*grid/)
    assert.match(readSource('pages/Renewals.css'), /@media \(max-width: 1080px\)[\s\S]*\.renewal-detail,\s*\.renewals__controls\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(readSource('components/renewals/ReminderTimeline.css'), /@media \(max-width: 640px\)[\s\S]*\.reminder-action__fields\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
  })

  test('the renewal service makes no network calls and exposes no renewal processing', () => {
    const source = readSource('services/renewalService.js')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|apiClient\.|axios/)
    assert.deepEqual(Object.keys(service).filter((key) => key !== 'default').sort(), [
      'advanceRenewalClock',
      'getReminderHistory',
      'getReminderPlan',
      'getReminderRecords',
      'getRenewalClock',
      'getRenewalPolicies',
      'getRenewalPolicyById',
      'resetRenewalSimulation',
      'retryReminder',
      'runReminderCheck',
      'triggerReminder',
    ])
  })

  test('only the renewal store touches storage for renewals', () => {
    for (const file of ['services/renewalService.js', 'utils/renewalEngine.js', 'utils/reminderRules.js', 'utils/renewalQuery.js']) {
      assert.doesNotMatch(readSource(file), /sessionStorage|localStorage/, file)
    }
    for (const source of renewalSources()) assert.doesNotMatch(source, /sessionStorage|localStorage/)
  })

  test('the renewal engine is pure: it never reads the clock', () => {
    const code = readSource('utils/renewalEngine.js')
    assert.doesNotMatch(code, /new Date\(|Date\.now|todayIso/)
  })

  test('claim checklists still render through the shared checklist', async () => {
    const claimsUi = await harness.load('/src/components/claims/index.js')
    const html = renderInRouter(
      h(claimsUi.ClaimChecklist, { label: 'Checks', checks: [{ id: 'a', label: 'A', outcome: 'pass' }] }),
    )
    assert.match(html, /class="checklist"/)
    assert.match(html, /Passed/)
  })
})
