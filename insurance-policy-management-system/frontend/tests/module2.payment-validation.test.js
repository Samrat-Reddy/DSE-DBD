/**
 * Module 2 — payment validation rules (pure).
 */

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createHarness } from './helpers/harness.js'

let harness
let validation

before(async () => {
  harness = await createHarness()
  validation = await harness.load('/src/utils/paymentValidation.js')
})

after(() => harness.close())

const installment = (overrides = {}) => ({
  installmentId: 'INS-2024-000519-004',
  installmentNumber: 4,
  dueDate: '2026-05-10',
  amount: 1550,
  status: 'overdue',
  paidDate: null,
  paymentId: null,
  pendingPaymentId: null,
  ...overrides,
})

const request = (overrides = {}) => ({
  installment: installment(),
  amount: 1550,
  method: 'upi',
  ...overrides,
})

describe('instalment payability', () => {
  test('DUE and OVERDUE instalments are payable', () => {
    assert.equal(validation.checkInstallmentPayable(installment({ status: 'due' })).payable, true)
    assert.equal(validation.checkInstallmentPayable(installment({ status: 'overdue' })).payable, true)
  })

  test('a missing instalment is invalid', () => {
    const result = validation.checkInstallmentPayable(null)
    assert.equal(result.payable, false)
    assert.equal(result.reason, validation.PAYABILITY_REASON.NOT_FOUND)
  })

  test('a PAID instalment cannot be paid again', () => {
    const result = validation.checkInstallmentPayable(
      installment({ status: 'paid', paidDate: '2026-05-09', paymentId: 'PAY-2026-000001' }),
    )
    assert.equal(result.payable, false)
    assert.equal(result.reason, validation.PAYABILITY_REASON.ALREADY_PAID)
    assert.match(result.message, /already paid/)
  })

  test('an UPCOMING instalment cannot be paid yet and says when it becomes payable', () => {
    const result = validation.checkInstallmentPayable(
      installment({ status: 'upcoming', dueDate: '2036-10-05' }),
    )
    assert.equal(result.payable, false)
    assert.equal(result.reason, validation.PAYABILITY_REASON.NOT_YET_DUE)
    assert.match(result.message, /not due yet/)
  })

  test('a pending payment prevents a duplicate payment', () => {
    const result = validation.checkInstallmentPayable(installment({ pendingPaymentId: 'PAY-2026-000090' }))
    assert.equal(result.payable, false)
    assert.equal(result.reason, validation.PAYABILITY_REASON.PAYMENT_PENDING)
  })
})

describe('payment request validation', () => {
  test('a complete request for a payable instalment is valid', () => {
    assert.deepEqual(validation.validatePaymentRequest(request()), {})
    assert.equal(validation.isPaymentRequestValid(request()), true)
  })

  test('a missing payment method is rejected', () => {
    assert.match(validation.validatePaymentRequest(request({ method: '' })).method, /Select a payment method/)
  })

  test('an unknown payment method is rejected', () => {
    assert.ok(validation.validatePaymentRequest(request({ method: 'bitcoin' })).method)
  })

  test('an invalid instalment is rejected', () => {
    assert.ok(validation.validatePaymentRequest(request({ installment: null })).installment)
  })

  test('PAID and UPCOMING instalments are rejected at request level too', () => {
    assert.ok(validation.validatePaymentRequest(request({ installment: installment({ status: 'paid', paymentId: 'P' }) })).installment)
    assert.ok(validation.validatePaymentRequest(request({ installment: installment({ status: 'upcoming' }) })).installment)
  })

  test('zero, negative, blank and non-numeric amounts are rejected', () => {
    for (const amount of [0, -1550, '', null, 'abc']) {
      assert.ok(validation.validatePaymentRequest(request({ amount })).amount, `amount ${String(amount)}`)
    }
  })

  test('partial or excess amounts are rejected', () => {
    assert.match(validation.validatePaymentRequest(request({ amount: 1000 })).amount, /must equal/)
    assert.match(validation.validatePaymentRequest(request({ amount: 2000 })).amount, /must equal/)
  })
})
