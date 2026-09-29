/**
 * Module 2 — routes, role gating, component states, accessibility wiring and
 * responsive structure.
 *
 * Components are rendered with data returned by the real service at a fixed
 * `asOf` date, so loaded states are exercised end to end from mock data.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

const AS_OF = '2026-09-15'
const LIFE = 'POL-2024-000226'

let harness
let AppRoutes
let premium
let premiumService
let pages
let lifeAccount
let paAccount
let portfolio
let payments

before(async () => {
  harness = await createHarness()
  AppRoutes = (await harness.load('/src/routes/AppRoutes.jsx')).default
  premium = await harness.load('/src/components/premium/index.js')
  premiumService = await harness.load('/src/services/premiumService.js')
  pages = await harness.load('/src/pages/index.js')

  lifeAccount = await premiumService.getPremiumScheduleByPolicyId(LIFE, { asOf: AS_OF })
  paAccount = await premiumService.getPremiumScheduleByPolicyId('POL-2024-000519', { asOf: AS_OF })
  portfolio = await premiumService.getPremiumSchedules({ asOf: AS_OF })
  payments = (await premiumService.getPayments()).items
})

after(() => harness.close())

const renderRoute = (pathname) => renderInRouter(h(AppRoutes, null), pathname)
const readCss = (relative) => readFileSync(path.join(FRONTEND_ROOT, 'src', relative), 'utf8')

describe('route resolution', () => {
  test('/payments renders the premium overview', () => {
    const html = renderRoute('/payments')
    assert.match(html, /Premiums &amp; payments/)
    assert.match(html, /Loading premium position/)
  })

  test('/payments/history renders history, not a policy called "history"', () => {
    const html = renderRoute('/payments/history')
    assert.match(html, /Payment history/)
    assert.doesNotMatch(html, /Loading premium schedule/)
  })

  test('/payments/history/:paymentId renders the payment details page', () => {
    assert.match(renderRoute('/payments/history/PAY-2024-000102'), /Loading payment/)
  })

  test('/payments/:policyId renders the policy premium page', () => {
    assert.match(renderRoute(`/payments/${LIFE}`), /Loading premium schedule/)
  })

  test('pay routes with and without an instalment render the payment page', () => {
    assert.match(renderRoute(`/payments/${LIFE}/pay`), /Pay premium/)
    assert.match(renderRoute(`/payments/${LIFE}/pay/INS-2024-000226-009`), /Pay premium/)
  })

  test('deeper unknown payment paths fall through to NotFound', () => {
    assert.match(renderRoute(`/payments/${LIFE}/pay/INS-1/extra`), /404/)
  })

  test('primary navigation links to premiums and payments', () => {
    assert.match(renderRoute('/'), /href="\/payments"/)
  })
})

describe('demo role gating for payments', () => {
  const renderPay = (role) =>
    renderPageWithRole({
      page: pages.PremiumPayment,
      role,
      routePath: '/payments/:policyId/pay/:installmentId?',
      pathname: `/payments/${LIFE}/pay`,
    })

  test('agents are read-only and see why', () => {
    assert.match(renderPay('agent'), /Recording payments is not available for this role/)
  })

  test('policyholders and administrators can start a payment', () => {
    for (const role of ['policyholder', 'administrator']) {
      const html = renderPay(role)
      assert.doesNotMatch(html, /not available for this role/)
      assert.match(html, /Loading payable instalments/)
    }
  })

  test('the overview explains each role', () => {
    const renderOverview = (role) =>
      renderPageWithRole({ page: pages.PremiumOverview, role, routePath: '/payments', pathname: '/payments' })

    assert.match(renderOverview('agent'), /Agent view is read-only/)
    assert.match(renderOverview('policyholder'), /Policyholder view/)
  })
})

describe('portfolio summary and account list', () => {
  test('summary shows derived totals for every bucket', () => {
    const html = renderInRouter(h(premium.PortfolioSummary, { portfolio: portfolio.portfolio, asOf: AS_OF }))
    for (const figure of ['10,850', '6,200', '4,650', '4,18,500', '68,750']) {
      assert.ok(html.includes(figure), `expected ${figure}`)
    }
    assert.match(html, /Payable now/)
    assert.match(html, /2 instalments · 2 policies/)
  })

  test('account list renders a table and mobile cards, with overdue rows marked', () => {
    const html = renderInRouter(h(premium.PremiumAccountList, { accounts: portfolio.items }))
    assert.match(html, /<table/)
    assert.match(html, /<caption/)
    assert.match(html, /account-cards/)
    assert.match(html, /account-table__row--overdue/)
    assert.ok(html.includes(`/payments/${LIFE}`))
    assert.equal(countOccurrences(html, 'scope="col"'), 8)
  })
})

describe('policy financial summary', () => {
  test('overdue banner with amount, oldest due date and direct pay action', () => {
    const html = renderInRouter(h(premium.FinancialSummary, { account: lifeAccount, canRecordPayment: true }))
    assert.match(html, /1 instalment overdue/)
    assert.match(html, /72 days ago/)
    assert.ok(html.includes(`/payments/${LIFE}/pay/INS-2024-000226-009`))
    assert.match(html, /Total premium payable/)
    assert.match(html, /4,65,000/)
    assert.match(html, /<progress[^>]*value="8"[^>]*max="100"/)
    assert.match(html, /<label[^>]*for="progress-POL-2024-000226"/)
  })

  test('read-only roles see the overdue banner without a pay action', () => {
    const html = renderInRouter(h(premium.FinancialSummary, { account: lifeAccount, canRecordPayment: false }))
    assert.match(html, /overdue/)
    assert.doesNotMatch(html, /Pay oldest overdue/)
  })
})

describe('premium schedule table', () => {
  test('shows every status with the right action for each', () => {
    const html = renderInRouter(
      h(premium.PremiumScheduleTable, { installments: lifeAccount.installments, policyId: LIFE, canRecordPayment: true }),
    )
    for (const label of ['Paid', 'Due', 'Upcoming', 'Overdue']) assert.ok(html.includes(`>${label}<`), label)

    // Rendered twice: once in the table, once in the mobile cards.
    assert.equal(countOccurrences(html, '>Pay premium<'), 4, 'overdue #9 and due #10')
    assert.equal(countOccurrences(html, '>View payment<'), 16, '8 paid instalments')
    assert.match(html, /72 days overdue/)
    assert.match(html, /Due in 20 days/)
    assert.match(html, /1 failed attempt/)
    assert.match(html, /Not yet payable/)
  })

  test('collapses far-future instalments behind an accessible disclosure button', () => {
    const html = renderInRouter(
      h(premium.PremiumScheduleTable, { installments: lifeAccount.installments, policyId: LIFE, canRecordPayment: true }),
    )
    assert.match(html, /Showing 13 of 100 instalments/)
    assert.match(html, /aria-expanded="false"/)
    assert.match(html, /aria-controls="[^"]+-table [^"]+-cards"/)
    assert.match(html, /Show all 100 instalments/)
  })

  test('read-only roles cannot pay', () => {
    const html = renderInRouter(
      h(premium.PremiumScheduleTable, { installments: lifeAccount.installments, policyId: LIFE, canRecordPayment: false }),
    )
    assert.doesNotMatch(html, /Pay premium/)
    assert.match(html, /Awaiting payment/)
  })

  test('short schedules have no toggle', () => {
    const html = renderInRouter(
      h(premium.PremiumScheduleTable, { installments: paAccount.installments, policyId: paAccount.policyId, canRecordPayment: true }),
    )
    assert.doesNotMatch(html, /Show all/)
  })

  test('an empty schedule renders an explanation', () => {
    assert.match(
      renderInRouter(h(premium.PremiumScheduleTable, { installments: [], policyId: LIFE })),
      /no instalments/,
    )
  })
})

describe('payment history, details and results', () => {
  test('history renders a table and cards, including the failed attempt', () => {
    const html = renderInRouter(h(premium.PaymentHistoryList, { payments }))
    assert.match(html, /<table/)
    assert.match(html, /payment-cards/)
    assert.match(html, /MOCKTXN-8WT3LK6F2P/)
    assert.match(html, />Failed</)
    assert.ok(html.includes('/payments/history/PAY-2024-000102'))
  })

  test('successful payment details show the successful state and mock disclaimer', async () => {
    const record = await premiumService.getPaymentById('PAY-2024-000102', { asOf: AS_OF })
    const html = renderInRouter(h(premium.PaymentDetailsPanel, record))
    assert.match(html, /Successful payment/)
    assert.match(html, /MOCKTXN-2XK8PL5N7V/)
    assert.match(html, /Mock payment record/)
  })

  test('failed payment details show the reason', async () => {
    const record = await premiumService.getPaymentById('PAY-2026-000079', { asOf: AS_OF })
    const html = renderInRouter(h(premium.PaymentDetailsPanel, record))
    assert.match(html, /Failed payment/)
    assert.match(html, /Declined by issuing bank/)
  })

  test('orphaned payments explain the missing policy', async () => {
    const record = await premiumService.getPaymentById('PAY-2024-000102', { asOf: AS_OF })
    const html = renderInRouter(
      h(premium.PaymentDetailsPanel, { ...record, policy: null, isOrphaned: true }),
    )
    assert.match(html, /no longer available in the policy store/)
  })

  test('success result shows payment ID, reference and the balance change', () => {
    const installment = { ...paAccount.installments[3], status: 'paid' }
    const result = {
      payment: { ...payments[0], paymentId: 'PAY-2026-000999', transactionReference: 'MOCKTXN-ABCDEFGHJK', status: 'success', policyId: paAccount.policyId },
      installment,
      previousSummary: paAccount.summary,
      account: { summary: { ...paAccount.summary, totalPaid: 6200, outstanding: 0, payableNow: 0 } },
    }
    const html = renderInRouter(h(premium.PaymentResult, { result, onRetry: () => {} }))
    assert.match(html, /Mock payment successful/)
    assert.match(html, /PAY-2026-000999/)
    assert.match(html, /MOCKTXN-ABCDEFGHJK/)
    assert.match(html, /Updated financial position/)
    assert.match(html, /View payment details/)
    assert.match(html, /No real transaction took place/)
  })

  test('declined result offers a retry and no balance change', () => {
    const result = {
      payment: { ...payments[0], status: 'failed', failureReason: 'Declined (simulated).' },
      installment: paAccount.installments[3],
      previousSummary: paAccount.summary,
      account: { summary: paAccount.summary },
    }
    const html = renderInRouter(h(premium.PaymentResult, { result, onRetry: () => {} }))
    assert.match(html, /Mock payment declined/)
    assert.match(html, /Try again/)
    assert.doesNotMatch(html, /Updated financial position/)
  })
})

describe('payment flow', () => {
  test('first step lists payable instalments oldest first, with the requested one selected', () => {
    const html = renderInRouter(
      h(premium.PaymentFlow, { account: lifeAccount, initialInstallmentId: 'INS-2024-000226-010' }),
    )
    assert.match(html, /aria-label="Mock payment progress"/)
    assert.match(html, /Payable instalments for POL-2024-000226/)
    assert.equal(countOccurrences(html, 'type="radio"'), 2)
    assert.match(html, /checked="" value="INS-2024-000226-010"/)
    assert.ok(html.indexOf('Instalment 9') < html.indexOf('Instalment 10'), 'oldest first')
    assert.match(html, /Payment summary/)
    assert.match(html, />Continue</)
  })

  test('method selector wires its error to the fieldset and collects no payment details', () => {
    const html = renderInRouter(h(premium.PaymentMethodSelector, { value: '', onChange: () => {}, error: 'Select a payment method to continue.' }))
    assert.match(html, /<fieldset[^>]*aria-describedby="[^"]*-error[^"]*"/)
    assert.equal(countOccurrences(html, 'type="radio"'), 3)
    assert.doesNotMatch(html, /type="text"|type="number"|card number|cvv/i)
    assert.match(html, /No payment details are requested or stored/)
  })
})

describe('responsive structure', () => {
  test('every data table has a designed mobile card layout that replaces it', () => {
    const pairs = [
      ['components/premium/PremiumScheduleTable.css', 'schedule-table-wrap', 'schedule-cards'],
      ['components/premium/PremiumAccountList.css', 'account-table-wrap', 'account-cards'],
      ['components/premium/PaymentHistoryList.css', 'payment-table-wrap', 'payment-cards'],
    ]

    for (const [file, table, cards] of pairs) {
      const css = readCss(file)
      const media = css.slice(css.lastIndexOf('@media'))
      assert.match(media, new RegExp(`\\.${table}\\s*{\\s*display:\\s*none`), `${file} hides the table`)
      assert.match(media, new RegExp(`\\.${cards}\\s*{\\s*display:\\s*grid`), `${file} shows the cards`)
    }
  })

  test('the payment flow stacks its summary above the form on narrow screens', () => {
    const css = readCss('components/premium/PaymentFlow.css')
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-areas:\s*'summary'\s*'panel'/)
  })
})
