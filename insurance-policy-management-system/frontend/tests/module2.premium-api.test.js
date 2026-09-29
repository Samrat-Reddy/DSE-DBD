/**
 * Module 2 — Premium Schedule & Payments: the API-backed service.
 *
 * Runs the real `premiumService` and auth bridge against a stubbed `fetch`
 * that plays the FastAPI backend, and checks what the frontend owns: the
 * requests it sends and the mapping onto the shapes the screens render.
 * Financial rules, locking and access control are tested in the backend
 * suite against real MySQL.
 */

import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { createHarness, h, installFakeSessionStorage, renderInRouter } from './helpers/harness.js'

process.env.VITE_DEMO_AUTH_PASSWORD = 'test-demo-password'
const storage = installFakeSessionStorage()

let harness
let svc
let validation

const AS_OF = '2026-09-29'

const POLICY = {
  policy_number: 'POL-2024-000519',
  status: 'active',
  product_code: 'PRD-ACC-004',
  product_name: 'SafeGuard Personal Accident',
  product_type: 'personal_accident',
  policyholder_name: 'Farhan Qureshi',
  customer_code: 'CUS-100630',
  start_date: '2024-11-10',
  end_date: '2026-11-09',
  term_years: 2,
}

const SUMMARY = {
  installment_count: 4,
  counts: { paid: 3, overdue: 1, due: 0, upcoming: 0, partially_paid: 1 },
  total_premium: '6200.00',
  total_paid: '5150.00',
  outstanding: '1050.00',
  overdue_amount: '1050.00',
  due_amount: '0.00',
  upcoming_amount: '0.00',
  payable_now: '1050.00',
  next_due: { id: 44, installment_number: 4, due_date: '2026-05-10', amount_outstanding: '1050.00' },
  oldest_overdue: { id: 44, installment_number: 4, due_date: '2026-05-10', amount_outstanding: '1050.00' },
  oldest_overdue_days: 142,
  standing: 'overdue',
}

const SCHEDULE = {
  policy: POLICY,
  frequency: 'half_yearly',
  annual_premium: '3100.00',
  installment_count: 4,
  regular_installment_amount: '1550.00',
  total_premium: '6200.00',
  first_due_date: '2024-11-10',
  last_due_date: '2026-05-10',
  summary: SUMMARY,
  as_of: AS_OF,
}

const installment = (overrides) => ({
  id: 41,
  policy_number: 'POL-2024-000519',
  installment_number: 1,
  due_date: '2024-11-10',
  amount_due: '1550.00',
  amount_paid: '1550.00',
  amount_outstanding: '0.00',
  status: 'paid',
  payable: false,
  payable_from: '2024-10-11',
  pending_payment_number: null,
  failed_attempts: 0,
  last_paid_at: '2024-11-08T10:00:00',
  last_payment_number: 'PAY-2024-000131',
  ...overrides,
})

const INSTALLMENTS = {
  as_of: AS_OF,
  items: [
    installment({}),
    installment({
      id: 44,
      installment_number: 4,
      due_date: '2026-05-10',
      amount_paid: '500.00',
      amount_outstanding: '1050.00',
      status: 'overdue',
      payable: true,
      payable_from: '2026-04-10',
      last_paid_at: '2026-09-29T08:00:00',
      last_payment_number: 'PAY-2026-000080',
    }),
    installment({
      id: 45,
      installment_number: 5,
      due_date: '2026-10-20',
      amount_paid: '0.00',
      amount_outstanding: '1550.00',
      status: 'pending',
      payable: true,
      payable_from: '2026-09-20',
      last_paid_at: null,
      last_payment_number: null,
    }),
    installment({
      id: 46,
      installment_number: 6,
      due_date: '2027-05-10',
      amount_paid: '0.00',
      amount_outstanding: '1550.00',
      status: 'pending',
      payable: false,
      payable_from: '2027-04-10',
      last_paid_at: null,
      last_payment_number: null,
    }),
  ],
}

const PAYMENT = {
  payment_number: 'PAY-2025-000134',
  payment_reference: 'MOCKTXN-9KC2VB7M3J',
  installment_id: 43,
  installment_number: 3,
  policy_number: 'POL-2024-000519',
  policyholder_name: 'Farhan Qureshi',
  customer_code: 'CUS-100630',
  product_name: 'SafeGuard Personal Accident',
  amount: '1550.00',
  status: 'successful',
  payment_method: 'net_banking',
  paid_at: '2025-11-07T10:00:00',
  failure_reason: null,
}

let requests
let routes

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fakeFetch = async (url, init = {}) => {
  const { pathname, searchParams } = new URL(url)
  const path = pathname.replace('/api/v1', '')
  const body = init.body ? JSON.parse(init.body) : null
  const request = { method: init.method, path, params: Object.fromEntries(searchParams), headers: init.headers, body }
  requests.push(request)
  if (path === '/auth/login') {
    return json(200, { access_token: `token-${body.email}`, token_type: 'bearer', expires_in: 1800 })
  }
  const handler = routes[`${init.method} ${path}`]
  return handler ? handler(request) : json(404, { detail: 'Not found.', code: 'not_found' })
}

const apiCalls = () => requests.filter((request) => request.path !== '/auth/login')

before(async () => {
  globalThis.fetch = fakeFetch
  harness = await createHarness()
  svc = await harness.load('/src/services/premiumService.js')
  validation = await harness.load('/src/utils/paymentValidation.js')
})

after(() => harness.close())

beforeEach(() => {
  requests = []
  storage.setItem('ipms.demoRole', 'administrator')
  routes = {
    'GET /premium-schedules': () =>
      json(200, {
        items: [SCHEDULE],
        total: 1,
        limit: 200,
        offset: 0,
        portfolio: {
          policies: 4,
          total_paid: '68750.00',
          paid_count: 13,
          due_amount: '4650.00',
          due_count: 1,
          overdue_amount: '6200.00',
          overdue_count: 2,
          upcoming_amount: '400200.00',
          upcoming_count: 90,
          payable_now: '10850.00',
          policies_overdue: 2,
        },
        awaiting_issuance: 1,
        as_of: AS_OF,
      }),
    'GET /policies/POL-2024-000519/premium-schedule': () => json(200, SCHEDULE),
    'GET /policies/POL-2024-000519/installments': () => json(200, INSTALLMENTS),
    'GET /payments': () =>
      json(200, {
        items: [PAYMENT],
        total: 1,
        limit: 200,
        offset: 0,
        summary: { total: 14, successful: 13, failed: 1, pending: 0, collected: '68750.00' },
      }),
    'GET /payments/PAY-2025-000134': () => json(200, PAYMENT),
    'GET /installments/43': () => json(200, installment({ id: 43, installment_number: 3 })),
    'POST /installments/44/payments': (request) =>
      json(201, {
        payment: {
          ...PAYMENT,
          payment_number: 'PAY-2026-000081',
          payment_reference: request.body.payment_reference,
          installment_id: 44,
          installment_number: 4,
          amount: request.body.amount,
          payment_method: request.body.payment_method,
          status: request.body.outcome,
          paid_at: '2026-09-29T09:00:00',
        },
        installment: { ...INSTALLMENTS.items[1], amount_paid: '1550.00', amount_outstanding: '0.00', status: 'paid', payable: false },
      }),
  }
})

describe('premium accounts', () => {
  test('maps the portfolio and accounts, sending standing as an API code', async () => {
    const result = await svc.getPremiumSchedules({ search: ' farhan ', standing: 'up-to-date', sort: 'overdue-desc' })
    assert.deepEqual(apiCalls()[0].params, { search: 'farhan', standing: 'up_to_date', sort: 'overdue-desc', limit: '200' })

    assert.equal(result.awaitingIssuance, 1)
    assert.equal(result.portfolio.totalPaid, 68750)
    assert.equal(result.portfolio.policiesOverdue, 2)
    const [account] = result.items
    assert.equal(account.policyId, 'POL-2024-000519')
    assert.equal(account.frequency, 'Half-Yearly')
    assert.equal(account.premiumAmount, 1550)
    assert.equal(account.policy.type, 'Personal Accident')
    assert.equal(account.summary.standing, 'overdue')
    assert.equal(account.summary.outstanding, 1050)
    assert.equal(account.summary.oldestOverdueInstallmentId, 'INS-2024-000519-004')
    assert.equal(account.summary.partiallyPaidCount, 1)
  })

  test('"all" standing is not sent', async () => {
    await svc.getPremiumSchedules({ standing: 'all', sort: 'next-due-asc' })
    assert.deepEqual(apiCalls()[0].params, { sort: 'next-due-asc', limit: '200' })
  })
})

describe('policy account detail', () => {
  test('combines schedule, instalments and payments; derives display statuses', async () => {
    const account = await svc.getPremiumScheduleByPolicyId('POL-2024-000519')
    assert.deepEqual(
      apiCalls().map((call) => call.path).sort(),
      ['/payments', '/policies/POL-2024-000519/installments', '/policies/POL-2024-000519/premium-schedule'],
    )
    assert.equal(apiCalls().find((call) => call.path === '/payments').params.policy_number, 'POL-2024-000519')

    const [paid, partial, due, upcoming] = account.installments
    assert.equal(paid.status, 'paid')
    assert.equal(paid.paymentId, 'PAY-2024-000131', 'a paid instalment links to its payment')
    assert.equal(paid.paidDate, '2024-11-08')
    assert.equal(partial.status, 'overdue')
    assert.equal(partial.isPartiallyPaid, true)
    assert.equal(partial.amount, 1550)
    assert.equal(partial.amountPaid, 500)
    assert.equal(partial.outstanding, 1050)
    assert.equal(partial.installmentId, 'INS-2024-000519-004')
    assert.equal(partial.id, 44)
    assert.equal(due.status, 'due', 'payable window has opened')
    assert.equal(upcoming.status, 'upcoming')
    assert.equal(upcoming.daysUntilDue, 223)

    assert.equal(account.payments[0].paymentMethod, 'net-banking')
    assert.equal(account.payments[0].status, 'success')
    assert.equal(account.payments[0].transactionReference, 'MOCKTXN-9KC2VB7M3J')
    assert.equal(account.payments[0].isMock, false)
  })

  test('an out-of-scope or unknown policy rejects with 404', async () => {
    await assert.rejects(svc.getPremiumScheduleByPolicyId('POL-2099-000001'), { status: 404 })
  })
})

describe('payment history', () => {
  test('sends filters as API codes and maps the summary', async () => {
    const result = await svc.getPayments({ search: 'PAY', status: 'success', method: 'net-banking', sort: 'amount-desc' })
    assert.deepEqual(apiCalls()[0].params, {
      search: 'PAY',
      status: 'successful',
      method: 'net_banking',
      sort: 'amount-desc',
      limit: '200',
    })
    assert.deepEqual(result.summary, { total: 14, success: 13, failed: 1, pending: 0, collected: 68750 })
  })

  test('payment detail joins the payment, its instalment and policy', async () => {
    const record = await svc.getPaymentById('PAY-2025-000134')
    assert.equal(record.payment.paymentId, 'PAY-2025-000134')
    assert.equal(record.installment.installmentNumber, 3)
    assert.equal(record.policy.id, 'POL-2024-000519')
    await assert.rejects(svc.getPaymentById('PAY-2099-000001'), { status: 404, message: /No payment found/ })
  })
})

describe('recording a payment', () => {
  test('posts to the instalment with codes, a decimal-string amount and the attempt reference', async () => {
    const account = await svc.getPremiumScheduleByPolicyId('POL-2024-000519')
    requests = []
    const reference = svc.createPaymentReference()
    const result = await svc.recordPayment({
      installment: account.installments[1],
      amount: '1050',
      method: 'net-banking',
      outcome: svc.PAYMENT_OUTCOMES.APPROVE,
      reference,
      account,
    })

    const post = apiCalls().find((call) => call.method === 'POST')
    assert.equal(post.path, '/installments/44/payments')
    assert.deepEqual(post.body, {
      amount: '1050',
      payment_method: 'net_banking',
      payment_reference: reference,
      outcome: 'successful',
    })
    assert.match(post.headers.Authorization, /^Bearer token-admin@example\.com$/)
    assert.equal(result.payment.transactionReference, reference)
    assert.equal(result.installment.status, 'paid')
    assert.equal(result.previousSummary, account.summary)
    assert.equal(result.account.policyId, 'POL-2024-000519')
  })

  test('the backend’s rejection message is surfaced as-is', async () => {
    routes['POST /installments/44/payments'] = () =>
      json(409, { detail: 'A payment with reference PAY-REF-X was already recorded.', code: 'conflict' })
    await assert.rejects(
      svc.recordPayment({ installment: { id: 44 }, amount: '1', method: 'upi', reference: 'PAY-REF-X' }),
      { status: 409, message: /already recorded/ },
    )
  })

  test('payment references are unique and match the backend format', () => {
    const references = new Set(Array.from({ length: 50 }, () => svc.createPaymentReference()))
    assert.equal(references.size, 50)
    for (const reference of references) {
      assert.match(reference, /^[A-Z0-9][A-Z0-9-]{4,38}[A-Z0-9]$/)
    }
  })
})

describe('payment result screen', () => {
  const result = (installmentStatus, outstanding) => ({
    payment: { paymentId: 'PAY-2026-000080', transactionReference: 'PAY-REF-X', status: 'success', amount: 500, paymentDate: '2026-09-29', paymentMethod: 'upi', policyId: 'POL-2024-000519' },
    installment: { installmentNumber: 4, dueDate: '2026-05-10', status: installmentStatus, outstanding },
    account: { policyId: 'POL-2024-000519', summary: { totalPaid: 5150, outstanding: 1050, payableNow: 1050 } },
    previousSummary: { totalPaid: 4650, outstanding: 1550, payableNow: 1550 },
  })

  test('a part payment is not reported as paying the instalment', async () => {
    const { default: PaymentResult } = await harness.load('/src/components/premium/PaymentResult.jsx')
    const partial = renderInRouter(h(PaymentResult, { result: result('overdue', 1050), onRetry: () => {} }))
    assert.match(partial, /Part payment applied/)
    assert.match(partial, /₹1,050\.00 is still outstanding on instalment 4/)
    assert.doesNotMatch(partial, /now marked as paid/)

    const full = renderInRouter(h(PaymentResult, { result: result('paid', 0), onRetry: () => {} }))
    assert.match(full, /Instalment 4 is now marked as paid/)
  })
})

describe('payment request validation', () => {
  const partial = { status: 'overdue', amount: 1550, outstanding: 1050, installmentNumber: 4 }

  test('the API-backed flow accepts part payments up to the remaining balance', () => {
    const check = (amount) =>
      validation.validatePaymentRequest({ installment: partial, amount, method: 'upi', allowPartial: true })
    assert.deepEqual(check('500'), {})
    assert.deepEqual(check('1050'), {})
    assert.match(check('1050.01').amount, /remaining balance/)
    assert.match(check('10.005').amount, /2 decimal places/)
    assert.match(check('0').amount, /greater than zero/)
  })

  test('without allowPartial the legacy exact-amount rule is unchanged', () => {
    const errors = validation.validatePaymentRequest({ installment: partial, amount: '500', method: 'upi' })
    assert.match(errors.amount, /Partial payments are not supported/)
  })
})
