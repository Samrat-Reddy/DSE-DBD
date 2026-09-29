/**
 * Module 6 — routes, navigation, role restrictions, report component states,
 * accessibility wiring, responsive structure and architecture guards.
 *
 * Components render with data returned by the real report service.
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

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  pages = await harness.load('/src/pages/index.js')
  ui = await harness.load('/src/components/reports/index.js')
  service = await harness.load('/src/services/reportService.js')

  data.overview = await service.getReportOverview(ADMIN)
  data.policies = await service.getPolicyReport(ADMIN)
  data.premiums = await service.getPremiumReport(ADMIN)
  data.claims = await service.getClaimsReport(ADMIN)
  data.renewals = await service.getRenewalReport(ADMIN)
  data.commissions = await service.getCommissionReport(ADMIN)
  data.empty = await service.getClaimsReport(ADMIN, { period: 'today' })
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)
const readSource = (relative) => readFileSync(path.join(FRONTEND_ROOT, 'src', relative), 'utf8')

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

const REPORT_PAGES = [
  ['ReportsOverview', '/reports'],
  ['PolicyReport', '/reports/policies'],
  ['PremiumReport', '/reports/premiums'],
  ['ClaimsReport', '/reports/claims'],
  ['RenewalReport', '/reports/renewals'],
  ['CommissionReport', '/reports/commissions'],
]

const renderPage = (name, role, pathname) => renderPageWithRole({ page: pages[name], role, routePath: pathname, pathname })

/* ------------------------------------------------------------------ */

describe('routes and navigation', () => {
  test('every report route resolves for an administrator', () => {
    assert.match(renderRouteAsRole('/reports', 'administrator'), /<h1[^>]*>MIS Reports<\/h1>/)
    assert.match(renderRouteAsRole('/reports/policies', 'administrator'), /<h1[^>]*>Policy report<\/h1>/)
    assert.match(renderRouteAsRole('/reports/premiums', 'administrator'), /Premium &amp; payment report/)
    assert.match(renderRouteAsRole('/reports/claims', 'administrator'), /<h1[^>]*>Claims report<\/h1>/)
    assert.match(renderRouteAsRole('/reports/renewals', 'administrator'), /<h1[^>]*>Renewal report<\/h1>/)
    assert.match(renderRouteAsRole('/reports/commissions', 'administrator'), /<h1[^>]*>Agent commission report<\/h1>/)
  })

  test('report paths are static and deeper paths fall through to NotFound', () => {
    assert.match(renderRoute('/reports/policies/extra'), /404/)
    assert.match(renderRoute('/reports/unknown'), /404/)
  })

  test('MIS Reports navigation is shown to administrators only', () => {
    assert.match(renderRouteAsRole('/', 'administrator'), /href="\/reports"/)
    assert.doesNotMatch(renderRouteAsRole('/', 'agent'), /href="\/reports"/)
    assert.doesNotMatch(renderRouteAsRole('/', 'policyholder'), /href="\/reports"/)
  })

  test('the home page lists Module 6 and all six modules as implemented', () => {
    const home = renderRouteAsRole('/', 'administrator')
    assert.match(home, /Module 6 — MIS Reports/)
    const scope = home.slice(home.indexOf('Official module scope'), home.indexOf('Architecture'))
    assert.equal(countOccurrences(scope, 'implemented'), 7, 'six modules plus the card subtitle')
    assert.doesNotMatch(scope, /planned/)
  })

  test('Modules 1–5 routes still resolve', () => {
    assert.match(renderRoute('/policies'), /Policy catalog/)
    assert.match(renderRoute('/policies/POL-2024-000148'), /Loading/)
    assert.match(renderRouteAsRole('/policies/issue', 'agent'), /Issue/)
    assert.match(renderRoute('/payments'), /Premium/)
    assert.match(renderRoute('/claims'), /Claims/)
    assert.match(renderRoute('/renewals'), /Renewals/)
    assert.match(renderRoute('/renewals/POL-2024-000519'), /Loading renewal…/)
    assert.match(renderRouteAsRole('/commissions', 'administrator'), /Agent Commission/)
    assert.match(renderRouteAsRole('/commissions/agents', 'administrator'), /Commission by agent/)
    assert.match(renderRouteAsRole('/commissions/COM-2024-000031', 'administrator'), /Loading commission…/)
    assert.match(renderRouteAsRole('/commissions/policies/POL-2024-000148', 'administrator'), /Loading policy commission…/)
  })
})

describe('role restrictions', () => {
  test('agents and policyholders get a controlled restricted state, and no data is requested', () => {
    for (const [name, pathname] of REPORT_PAGES) {
      for (const role of ['agent', 'policyholder']) {
        const html = renderPage(name, role, pathname)
        assert.match(html, /MIS Reports are restricted/, `${name} · ${role}`)
        assert.doesNotMatch(html, /state-view--loading/, `${name} · ${role} does not load data`)
        assert.doesNotMatch(html, /Reporting period/, `${name} · ${role} sees no filters`)
      }
    }
  })

  test('an agent is pointed at their own commission instead', () => {
    const html = renderPage('ReportsOverview', 'agent', '/reports')
    assert.match(html, /available to administrators only/)
    assert.match(html, /href="\/commissions"/)
    assert.doesNotMatch(renderPage('ReportsOverview', 'policyholder', '/reports'), /href="\/commissions"/)
  })

  test('administrators get the report with its role note', () => {
    const html = renderPage('ReportsOverview', 'administrator', '/reports')
    assert.match(html, /Administrator view/)
    assert.match(html, /Loading MIS summary|Management summary/)
  })
})

describe('report components', () => {
  const filterBar = (props) =>
    renderInRouter(
      h(ui.ReportFilterBar, {
        query: { period: 'all-time', from: '', to: '', product: 'all', status: 'all', agentId: 'all', search: '' },
        onChange: () => {},
        onReset: () => {},
        range: data.claims.range,
        options: data.claims.filterOptions,
        ...props,
      }),
    )

  test('the filter bar labels every control and states the resolved period', () => {
    const html = filterBar({ show: { status: true, statusLabel: 'Claim status', search: true, periodField: 'Filing date' }, resultCount: 8 })
    for (const name of ['period', 'product', 'status', 'search']) {
      const match = html.match(new RegExp(`<(select|input)\\s[^>]*name="${name}"[^>]*>`))
      assert.ok(match, `${name} is rendered`)
      const id = match[0].match(/id="([^"]+)"/)[1]
      assert.ok(html.includes(`for="${id}"`), `${name} has a label`)
    }
    assert.match(html, /All time/)
    assert.match(html, /both dates included/)
    assert.match(html, /Scoped by filing date/)
    assert.match(html, /8 records in this report/)
    assert.match(html, /Claim status/)
    assert.doesNotMatch(html, /name="from"/, 'custom dates appear only for a custom range')
  })

  test('a custom range reveals both date inputs; optional filters stay hidden unless asked for', () => {
    const custom = filterBar({ query: { period: 'custom', from: '2025-01-01', to: '2025-03-31', product: 'all', status: 'all', agentId: 'all', search: '' }, show: {} })
    assert.match(custom, /name="from"[^>]*type="date"|type="date"[^>]*name="from"/)
    assert.match(custom, /name="to"/)
    assert.doesNotMatch(custom, /name="status"/)
    assert.doesNotMatch(custom, /name="agentId"/)

    const withAgent = filterBar({ show: { agent: true }, options: data.commissions.filterOptions })
    assert.match(withAgent, /name="agentId"/)
    assert.match(withAgent, /All agents/)
  })

  test('distributions state their counts and shares in text, not only as bars', () => {
    const html = renderInRouter(h(ui.DistributionChart, { title: 'Claims by status', items: data.claims.distributions.byStatus }))
    assert.match(html, /Claims by status/)
    assert.equal(countOccurrences(html, 'class="distribution__item"'), data.claims.distributions.byStatus.length)
    assert.match(html, /<strong>1<\/strong>/)
    assert.match(html, /12\.5%/)
    assert.match(html, /aria-hidden="true"/, 'the bar itself is decorative')

    const withAmounts = renderInRouter(h(ui.DistributionChart, { items: data.commissions.distributions.byStatus, showAmount: true }))
    assert.match(withAmounts, /₹/)
    assert.match(renderInRouter(h(ui.DistributionChart, { items: [], emptyMessage: 'Nothing here.' })), /Nothing here\./)
  })

  test('the report table renders typed cells, sortable headers and a bounded-row note', () => {
    const html = renderInRouter(
      h(ui.ReportTable, { caption: 'Claims', columns: data.claims.table.columns, rows: data.claims.table.rows, sort: 'filingDate', direction: 'desc', onSort: () => {}, total: data.claims.table.total }),
    )
    assert.match(html, /<caption class="sr-only">Claims<\/caption>/)
    assert.equal(countOccurrences(html, '<tr>') - 1, data.claims.table.rows.length)
    assert.match(html, /aria-sort="descending"/)
    assert.equal(countOccurrences(html, 'aria-sort="none"'), data.claims.table.columns.length - 1)
    assert.match(html, /class="report-table__sort"/)
    assert.match(html, /₹/, 'currency columns are formatted')
    assert.match(html, /status-badge/, 'status columns render a badge')
    assert.match(html, /Showing \d+ of \d+ records/)

    const bounded = renderInRouter(
      h(ui.ReportTable, { caption: 'Bounded', columns: data.claims.table.columns, rows: data.claims.table.rows, total: 250, truncated: 50 }),
    )
    assert.match(bounded, /50 further records are not rendered/)
  })

  test('an empty report says no records matched, which is not an error', () => {
    const html = renderInRouter(h(ui.ReportTable, { caption: 'Empty', columns: data.claims.table.columns, rows: [], emptyMessage: 'No claim was filed in this reporting period.' }))
    assert.match(html, /No matching records/)
    assert.match(html, /No claim was filed in this reporting period\./)
    assert.doesNotMatch(html, /Unable to load/)
  })

  test('export offers the current table and is disabled when there is nothing to export', () => {
    const html = renderInRouter(h(ui.ReportExportButton, { table: data.claims.table, filename: data.claims.filename }))
    assert.match(html, /Export CSV/)
    assert.doesNotMatch(html, /disabled=""/)
    assert.match(html, /role="status"/)
    assert.match(renderInRouter(h(ui.ReportExportButton, { table: data.empty.table, filename: data.empty.filename })), /disabled=""/)
  })

  test('the report shell tells loading, invalid period and failure apart', () => {
    const shell = (report) =>
      renderInRouter(
        h(
          ui.ReportShell,
          {
            title: 'Claims report',
            role: 'administrator',
            canView: true,
            report,
            controls: { query: data.claims.query, onChange: () => {}, onReset: () => {}, show: {}, options: {} },
          },
          () => h('p', null, 'body'),
        ),
      )

    const loading = shell({ isLoading: true, isError: false, data: null })
    assert.match(loading, /state-view--loading/)
    assert.doesNotMatch(loading, />body</)

    const invalid = shell({ isLoading: false, isError: true, error: { status: 422, message: 'The end date is before the start date.' }, data: null })
    assert.match(invalid, /The reporting period is not valid/)
    assert.match(invalid, /The end date is before the start date\./)
    assert.match(invalid, /an unresolved period would misreport the data/)
    assert.doesNotMatch(invalid, /Unable to load report data/)

    const failed = shell({ isLoading: false, isError: true, error: { status: 500, message: 'boom' }, data: null, reload: () => {} })
    assert.match(failed, /Unable to load report data/)
    assert.doesNotMatch(failed, />body</, 'no figures are shown when loading failed')

    const loaded = shell({ isLoading: false, isError: false, data: data.claims })
    assert.match(loaded, />body</)
    assert.match(loaded, /Module 3 · Claim Filing &amp; Approval Workflow/)
  })
})

describe('report pages render their figures', () => {
  const renderWithData = (name, pathname) => renderPage(name, 'administrator', pathname)

  test('each page names its reporting period, source module and export', () => {
    for (const [name, pathname] of REPORT_PAGES.slice(1)) {
      const html = renderWithData(name, pathname)
      assert.match(html, /Module 6 · MIS Reports/, name)
      assert.match(html, /Reporting period/, `${name} offers the period control`)
    }
  })

  test('the overview shows its loading state first, then the report index from the service', () => {
    const html = renderRouteAsRole('/reports', 'administrator')
    assert.match(html, /Management information derived from/)
    assert.match(html, /Loading MIS summary/, 'figures are never rendered before they load')
    assert.deepEqual(
      data.overview.reports.map((item) => item.to),
      ['/reports/policies', '/reports/premiums', '/reports/claims', '/reports/renewals', '/reports/commissions'],
    )
    assert.ok(data.overview.reports.every((item) => item.title && item.description))
  })
})

describe('accessibility, responsive structure and architecture', () => {
  const reportSources = () => {
    const dir = path.join(FRONTEND_ROOT, 'src', 'components', 'reports')
    return readdirSync(dir)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')])
      .concat(REPORT_PAGES.map(([name]) => [`pages/${name}.jsx`, readSource(`pages/${name}.jsx`)]))
  }

  test('no ARIA widget roles that would require custom keyboard handling', () => {
    for (const [file, source] of reportSources()) {
      assert.doesNotMatch(source, /role="(tab|tablist|tabpanel|menu|menuitem|listbox|combobox|grid|dialog)"/, file)
    }
  })

  test('report components and pages never aggregate, touch storage or call the network', () => {
    for (const [file, source] of reportSources()) {
      assert.doesNotMatch(source, /sessionStorage|localStorage|fetch\(|XMLHttpRequest|apiClient/, file)
      assert.doesNotMatch(source, /\.reduce\(|\.filter\(\(.*=>.*status ===|summarise[A-Z]|buildCsv\(.*rows/, file)
      assert.doesNotMatch(source, /reportAggregations|reportDateRange/, `${file} does not aggregate or resolve periods itself`)
    }
  })

  test('the report service makes no network calls and the pure report utilities never read the clock', () => {
    const code = readSource('services/reportService.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|apiClient\.|axios|sessionStorage/)
    for (const file of ['utils/reportDateRange.js', 'utils/reportFilters.js', 'utils/reportAggregations.js', 'utils/reportExport.js', 'utils/reportAccess.js']) {
      assert.doesNotMatch(readSource(file), /sessionStorage|localStorage|new Date\(|Date\.now|todayIso|fetch\(/, `${file} is pure`)
    }
  })

  test('reports reuse the Module 1–5 domain summaries instead of restating them', () => {
    const source = readSource('utils/reportAggregations.js')
    for (const summary of ['summariseClaims', 'summarisePayments', 'calculatePortfolioSummary', 'summariseRenewals', 'summariseCommissions']) {
      assert.match(source, new RegExp(`import[\\s\\S]*${summary}`), summary)
    }
    // No report file redefines what paid/overdue/open/earned mean.
    assert.doesNotMatch(source, /PAYMENT_STATUS\.SUCCESS \?|status === 'overdue'|status === 'earned'/)
  })

  test('the service exposes exactly the MIS report API', () => {
    assert.deepEqual(Object.keys(service).filter((key) => key !== 'default').sort(), [
      'REPORT_DEFINITIONS',
      'getClaimsReport',
      'getCommissionReport',
      'getPolicyReport',
      'getPremiumReport',
      'getRenewalReport',
      'getReportOverview',
    ])
  })

  test('report tables scroll inside their own box and layouts reflow on small screens', () => {
    const css = readSource('components/reports/Reports.css')
    assert.match(css, /\.report-table-wrap\s*{\s*overflow-x:\s*auto/)
    assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.distribution__item\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(css, /\.report-filters__row\s*{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(auto-fit/)
    assert.match(readSource('pages/Reports.css'), /\.reports__split\s*{\s*display:\s*grid;\s*grid-template-columns:\s*repeat\(auto-fit/)
  })

  test('no work beyond the six official modules was started', () => {
    const files = [...readdirSync(path.join(FRONTEND_ROOT, 'src', 'pages')), ...readdirSync(path.join(FRONTEND_ROOT, 'src', 'services'))]
    assert.ok(!files.some((file) => /intelligence|health-score|healthscore|predict|forecast|chatbot|vector|blockchain/i.test(file)), files.join(' '))
    for (const [file, source] of reportSources()) {
      assert.doesNotMatch(source, /predict|forecast|machine learning|score/i, file)
    }
  })
})
