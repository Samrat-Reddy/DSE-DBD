/**
 * Module 3 — routes, role gating, role-specific workflow actions, component
 * states, accessibility wiring and responsive structure.
 *
 * Components render with details returned by the real claim service.
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
let policyUi
let service
const details = {}

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  pages = await harness.load('/src/pages/index.js')
  ui = await harness.load('/src/components/claims/index.js')
  policyUi = await harness.load('/src/components/policy/index.js')
  service = await harness.load('/src/services/claimService.js')

  const byStatus = {
    submitted: 'CLM-2026-000097',
    underReview: 'CLM-2026-000083',
    verified: 'CLM-2026-000052',
    assessed: 'CLM-2026-000071',
    approved: 'CLM-2026-000044',
    rejected: 'CLM-2024-000087',
    settled: 'CLM-2024-000152',
    cancelled: 'CLM-2026-000084',
  }
  for (const [key, claimId] of Object.entries(byStatus)) {
    details[key] = await service.getClaimById(claimId)
  }
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)
const readSource = (relative) => readFileSync(path.join(FRONTEND_ROOT, 'src', relative), 'utf8')

/** The first rendered tag carrying `name="..."`, so attribute order does not matter. */
const tagNamed = (html, name) => {
  const match = html.match(new RegExp(`<(input|select|textarea)\\s[^>]*name="${name}"[^>]*>`))
  assert.ok(match, `element named ${name} is rendered`)
  return match[0]
}

const renderActions = (key, role) =>
  renderInRouter(
    h(ui.ClaimWorkflowActions, { details: details[key], role, onAction: async () => ({ ok: true }) }),
  )

/* ------------------------------------------------------------------ */

describe('route resolution', () => {
  test('/claims renders the claims register', () => {
    const html = renderRoute('/claims')
    assert.match(html, /<h1[^>]*>Claims<\/h1>/)
    assert.match(html, /Loading claim summary/)
  })

  test('/claims/file is the filing page, not a claim with ID "file"', () => {
    const html = renderRoute('/claims/file')
    assert.match(html, /File a claim/)
    assert.doesNotMatch(html, /Loading claim…/)
  })

  test('/claims/file/:policyId renders the eligibility step', () => {
    assert.match(renderRoute('/claims/file/POL-2024-000226'), /Checking claim eligibility/)
  })

  test('/claims/:claimId renders the claim details page', () => {
    assert.match(renderRoute('/claims/CLM-2026-000097'), /Loading claim…/)
  })

  test('deeper unknown claim paths fall through to NotFound', () => {
    assert.match(renderRoute('/claims/CLM-2026-000097/extra'), /404/)
  })

  test('primary navigation links to claims', () => {
    assert.match(renderRoute('/'), /href="\/claims"/)
  })
})

describe('demo role gating', () => {
  const renderFiling = (role, pathname = '/claims/file') =>
    renderPageWithRole({ page: pages.ClaimFiling, role, routePath: '/claims/file/:policyId?', pathname })

  test('claims officers cannot open the filing flow and are told why', () => {
    assert.match(renderFiling('administrator'), /Claims officers do not file claims/)
    assert.match(renderFiling('administrator', '/claims/file/POL-2024-000226'), /Claims officers do not file claims/)
  })

  test('policyholders and agents can start filing', () => {
    for (const role of ['policyholder', 'agent']) {
      const html = renderFiling(role)
      assert.doesNotMatch(html, /do not file claims/)
      assert.match(html, /Checking policy eligibility/)
    }
  })

  test('the register explains each role and offers filing only to filers', () => {
    const renderList = (role) =>
      renderPageWithRole({ page: pages.ClaimsList, role, routePath: '/claims', pathname: '/claims' })

    const holder = renderList('policyholder')
    assert.match(holder, /Policyholder view/)
    assert.match(holder, /href="\/claims\/file"/)

    assert.match(renderList('agent'), /Agent view/)

    const officer = renderList('administrator')
    assert.match(officer, /Claims officer view/)
    assert.doesNotMatch(officer, /href="\/claims\/file"/)
  })
})

/* ------------------------------------------------------------------ */

describe('role-specific workflow actions', () => {
  test('submitted: officer can start review or withdraw; policyholder can only withdraw; agent is read-only', () => {
    const officer = renderActions('submitted', 'administrator')
    assert.match(officer, /Move to Under Review/)
    assert.match(officer, /Withdraw claim/)

    const holder = renderActions('submitted', 'policyholder')
    assert.doesNotMatch(holder, /Move to Under Review/)
    assert.match(holder, /Withdraw claim/)

    const agentView = renderActions('submitted', 'agent')
    assert.doesNotMatch(agentView, /<button/)
    assert.match(agentView, /Agents can follow this claim/)
  })

  test('under review: officer sees the verification checklist and Verify Claim', () => {
    const html = renderActions('underReview', 'administrator')
    assert.match(html, /Verify Claim/)
    assert.match(html, /Policy valid on incident date/)
    assert.match(html, /Premium standing/)
    assert.match(html, /aria-label="Verification checks"/)
    assert.doesNotMatch(renderActions('underReview', 'policyholder'), /Verify Claim/)
  })

  test('verified: officer sees the assessment panel with illustrative limits', () => {
    const html = renderActions('verified', 'administrator')
    assert.match(html, /Record Assessment/)
    assert.match(html, /Applicable illustrative limit/)
    assert.match(html, /Potential approved amount/)
    assert.match(html, /Illustrative business rules/)
    assert.match(html, /name="assessedAmount"/)
    assert.doesNotMatch(renderActions('verified', 'agent'), /Record Assessment/)
  })

  test('assessed: officer can approve or reject, with a required rejection reason', () => {
    const html = renderActions('assessed', 'administrator')
    assert.match(html, /Approve Claim/)
    assert.match(html, /Reject Claim/)
    assert.match(tagNamed(html, 'rejectionReason'), /aria-required="true"/)
    assert.doesNotMatch(renderActions('assessed', 'policyholder'), /Approve Claim/)
  })

  test('approved: officer can mark as settled; the panel says no payment is made', () => {
    const html = renderActions('approved', 'administrator')
    assert.match(html, /Mark as Settled/)
    assert.match(html, /No\s+payment is made/)
    assert.doesNotMatch(renderActions('approved', 'agent'), /Mark as Settled/)
  })

  test('terminal claims offer no actions to anyone', () => {
    for (const key of ['settled', 'rejected', 'cancelled']) {
      const html = renderActions(key, 'administrator')
      assert.match(html, /No further workflow actions/)
      assert.doesNotMatch(html, /<button/)
    }
  })
})

/* ------------------------------------------------------------------ */

describe('claim display components', () => {
  test('claim list renders a captioned table and mobile cards', async () => {
    const { items } = await service.getClaims()
    const html = renderInRouter(h(ui.ClaimList, { claims: items }))
    assert.match(html, /<table/)
    assert.match(html, /<caption/)
    assert.match(html, /claim-cards/)
    assert.equal(countOccurrences(html, 'scope="col"'), 9)
    for (const item of items) assert.ok(html.includes(`/claims/${item.claimId}`))
    for (const label of ['Submitted', 'Under review', 'Approved', 'Rejected', 'Settled', 'Cancelled']) {
      assert.ok(html.includes(`>${label}<`), label)
    }
  })

  test('workflow timeline shows completed, current and upcoming stages', () => {
    const html = renderInRouter(h(policyUi.LifecycleTimeline, { events: details.assessed.workflowStages }))
    assert.match(html, /<ol/)
    assert.equal(countOccurrences(html, 'lifecycle__item--completed'), 4)
    assert.equal(countOccurrences(html, 'lifecycle__item--current'), 1)
    assert.equal(countOccurrences(html, 'lifecycle__item--upcoming'), 1)
    assert.match(html, /Awaiting an approval or rejection decision/)
  })

  test('workflow timeline ends rejected and cancelled claims with a terminated stage', () => {
    const rejected = renderInRouter(h(policyUi.LifecycleTimeline, { events: details.rejected.workflowStages }))
    assert.match(rejected, /lifecycle__item--terminated/)
    assert.match(rejected, /lifecycle__state--terminated">Rejected</)
    assert.doesNotMatch(rejected, />Settled</)

    const cancelled = renderInRouter(h(policyUi.LifecycleTimeline, { events: details.cancelled.workflowStages }))
    assert.match(cancelled, /lifecycle__state--terminated">Cancelled</)
  })

  test('activity log lists every event with time, transition, actor and role', () => {
    const html = renderInRouter(h(ui.ClaimActivityLog, { activity: details.settled.claim.activity }))
    assert.equal(countOccurrences(html, 'activity-log__item'), 6)
    assert.equal(countOccurrences(html, '<time dateTime='), 6)
    assert.match(html, /Claims Officer/)
    assert.match(html, /Agent/)
    assert.match(html, /Settlement reference SET-2024-000118/)
    assert.match(renderInRouter(h(ui.ClaimActivityLog, { activity: [] })), /No activity/)
  })

  test('decision summary shows figures and rule-based reasons, not a score', () => {
    const html = renderInRouter(h(ui.ClaimDecisionSummary, { summary: details.assessed.decisionSummary }))
    for (const label of ['Claimed amount', 'Illustrative coverage limit', 'Assessment', 'Decision', 'Reason']) {
      assert.ok(html.includes(label), label)
    }
    assert.match(html, /5,00,000/)
    assert.match(html, /12,50,000/)
    assert.match(html, /3,75,000/)
    assert.match(html, /involves no automated scoring/)
    assert.doesNotMatch(html, /\bAI\b|score:/)
    assert.match(renderInRouter(h(ui.ClaimDecisionSummary, { summary: null })), /appears once the claim has been assessed/)
  })

  test('settlement record shows the reference and date', () => {
    const html = renderInRouter(h(ui.ClaimSettlementPanel, { claim: details.settled.claim }))
    assert.match(html, /SET-2024-000118/)
    assert.match(html, /02 Dec 2024/)
  })

  test('documents list metadata only, and flags missing required documents', () => {
    const { claim, claimType } = details.underReview
    const html = renderInRouter(h(ui.ClaimDocumentList, { documents: claim.documents, claimType }))
    assert.match(html, /office-incident-report\.pdf/)
    assert.match(html, /No file is uploaded, stored or available to open/)
    assert.doesNotMatch(html, /<a /, 'no download links')

    const missing = renderInRouter(h(ui.ClaimDocumentList, { documents: claim.documents.slice(0, 1), claimType }))
    assert.match(missing, /claim-docs__item--missing/)
    assert.match(missing, /Not provided/)
  })

  test('policy context shows coverage, limit and premium standing, or an error state', () => {
    const { policy, policyError, coverage, premium, claimType } = details.assessed
    const html = renderInRouter(h(ui.ClaimPolicyContext, { policy, policyError, coverage, premium, claimType }))
    assert.match(html, /Permanent partial disability/)
    assert.match(html, /Illustrative limit/)
    assert.match(html, /href="\/payments\/POL-2024-000519"/)
    assert.match(html, /does not block this claim/)

    const broken = renderInRouter(
      h(ui.ClaimPolicyContext, { policy: null, policyError: { status: 404, message: 'The policy POL-X for this claim could not be found.' } }),
    )
    assert.match(broken, /role="alert"/)
    assert.match(broken, /could not be found/)
  })
})

/* ------------------------------------------------------------------ */

describe('eligibility and filing components', () => {
  test('eligible verdict with checklist and premium warning', async () => {
    const context = await service.getClaimFilingContext('POL-2024-000519', { asOf: '2026-09-15' })
    const html = renderInRouter(h(ui.ClaimEligibilityPanel, { eligibility: context.eligibility }))
    for (const label of ['Policy found', 'Policy issued', 'Policy active', 'Coverage available', 'Premium status checked']) {
      assert.ok(html.includes(label), label)
    }
    assert.match(html, /role="status"[^>]*>[\s\S]*Eligible to file a claim/)
    assert.match(html, /Needs attention/)
  })

  test('blocked verdict explains the reason', async () => {
    const context = await service.getClaimFilingContext('POL-2023-000874', { asOf: '2026-09-15' })
    const html = renderInRouter(h(ui.ClaimEligibilityPanel, { eligibility: context.eligibility }))
    assert.match(html, /A claim cannot currently be filed/)
    assert.match(html, /Reason:[\s\S]*window to file claims closed/)
  })

  test('policy picker offers Start claim for eligible and View eligibility for blocked policies', async () => {
    const { items } = await service.getEligiblePoliciesForClaim({ asOf: '2026-09-15' })
    const html = renderInRouter(h(ui.PolicyClaimPicker, { items }))
    assert.equal(countOccurrences(html, '>Start claim<'), 2)
    assert.equal(countOccurrences(html, '>View eligibility<'), 3)
    assert.match(html, /Not eligible: The policy is still pending issuance/)
  })

  test('filing form: labelled fields, native radio group, documents deferred until a type is chosen', async () => {
    const context = await service.getClaimFilingContext('POL-2024-000519', { asOf: '2026-09-15' })
    const html = renderInRouter(h(ui.ClaimFilingForm, { context, role: 'agent', onFiled: () => {} }))

    assert.match(html, /<form[^>]*novalidate=""/i)
    assert.match(html, /<legend[^>]*>Claim type/)
    assert.equal(countOccurrences(html, 'type="radio"'), 2)
    for (const name of ['incidentDate', 'claimedAmount', 'description']) {
      assert.match(tagNamed(html, name), /aria-required="true"/, name)
    }
    assert.match(html, /min="2024-11-10"/)
    assert.match(html, /filing as the agent on behalf of the policyholder/)
    assert.match(html, /Choose a claim type to see which documents are required/)
    assert.doesNotMatch(html, /problems? to fix/, 'no error summary before submitting')
    assert.match(html, />Submit Claim</)
  })

  test('document input associates errors with the checkbox and collects no files', () => {
    const requirements = [
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'fir.pdf', required: true },
      { type: 'other', label: 'Other supporting document', suggestedName: 'other.pdf', required: false },
    ]
    const html = renderInRouter(
      h(ui.ClaimDocumentsInput, {
        requirements,
        value: { other: { provided: true, fileName: 'other.pdf' } },
        onChange: () => {},
        errors: { 'document-incident-report': 'FIR / incident report is required.' },
      }),
    )
    const checkbox = tagNamed(html, 'document-incident-report')
    assert.match(checkbox, /type="checkbox"/)
    assert.match(checkbox, /aria-invalid="true"/)
    const describedBy = checkbox.match(/aria-describedby="([^"]+)"/)[1]
    assert.ok(html.includes(`id="${describedBy}"`), 'described-by points at a rendered element')
    assert.match(html.slice(html.indexOf(`id="${describedBy}"`)), /^[^<]*>[^<]*<span[^>]*>⚠<\/span> FIR \/ incident report is required\./)
    assert.match(html, /FIR \/ incident report is required\./)
    assert.match(html, /name="documentName-other"/)
    assert.doesNotMatch(html, /type="file"/)
    assert.match(html, /no file is uploaded or stored/)
  })

  test('filing success shows the claim ID, status and View Claim', () => {
    const html = renderInRouter(h(ui.ClaimFilingSuccess, { details: details.submitted }))
    assert.match(html, /Claim submitted/)
    assert.match(html, /CLM-2026-000097/)
    assert.match(html, />Submitted</)
    assert.match(html, /href="\/claims\/CLM-2026-000097"[^>]*>View Claim/)
  })

  test('workflow rules use native details/summary and show who may act', () => {
    const html = renderInRouter(
      h(ui.ClaimWorkflowRules, { status: 'submitted', role: 'agent', onAttempt: async () => ({ ok: false }) }),
    )
    assert.match(html, /<details/)
    assert.match(html, /<summary/)
    assert.match(html, /not your role/)
    assert.match(html, /<select[^>]*name="attemptStatus"/)
    assert.match(
      renderInRouter(h(ui.ClaimWorkflowRules, { status: 'settled', role: 'administrator', onAttempt: async () => ({ ok: false }) })),
      /final status/,
    )
  })
})

/* ------------------------------------------------------------------ */

describe('accessibility and responsive structure', () => {
  test('no ARIA widget roles that would require custom keyboard handling', () => {
    const dir = path.join(FRONTEND_ROOT, 'src', 'components', 'claims')
    const sources = readdirSync(dir)
      .filter((file) => file.endsWith('.jsx'))
      .map((file) => readFileSync(path.join(dir, file), 'utf8'))
      .concat(['pages/ClaimsList.jsx', 'pages/ClaimDetails.jsx', 'pages/ClaimFiling.jsx'].map(readSource))

    for (const source of sources) {
      assert.doesNotMatch(source, /role="(tab|tablist|tabpanel|menu|menuitem|listbox|combobox|grid|dialog)"/)
    }
  })

  test('the claims table is replaced by cards on small screens', () => {
    const css = readSource('components/claims/ClaimList.css')
    const media = css.slice(css.lastIndexOf('@media'))
    assert.match(media, /\.claim-table-wrap\s*{\s*display:\s*none/)
    assert.match(media, /\.claim-cards\s*{\s*display:\s*grid/)
  })

  test('details, activity log and decision layouts collapse to one column', () => {
    assert.match(readSource('pages/Claims.css'), /@media \(max-width: 1080px\)[\s\S]*\.claim-detail\s*{\s*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(readSource('components/claims/ClaimActivityLog.css'), /@media \(max-width: 620px\)[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
    assert.match(readSource('components/claims/ClaimPanels.css'), /@media \(max-width: 640px\)[\s\S]*\.decision-options/)
    assert.match(readSource('components/claims/ClaimFiling.css'), /@media \(max-width: 700px\)[\s\S]*\.claim-form__grid/)
  })
})
