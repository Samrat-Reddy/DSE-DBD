/**
 * TEST FIXTURES ONLY — Module 5.
 *
 * Builders that derive test policies, payments and events from real seed
 * records by overriding only what a test needs, so every other field stays
 * realistic. Nothing here is imported by the application.
 */

/** Clone a seed record with overrides. */
export const derive = (base, overrides = {}) => ({ ...structuredClone(base), ...overrides })

/** A payment in the Module 2 stored shape. */
export const paymentFor = (policyId, installmentNumber, overrides = {}) => ({
  paymentId: `PAY-TEST-${String(installmentNumber).padStart(6, '0')}`,
  policyId,
  installmentId: `INS-${policyId.replace(/^POL-/, '')}-${String(installmentNumber).padStart(3, '0')}`,
  amount: 4650,
  paymentDate: '2025-07-05',
  paymentMethod: 'upi',
  status: 'success',
  transactionReference: 'MOCKTXN-TESTREF001',
  ...overrides,
})

let eventSequence = 0

/** A commission event in the stored shape. */
export const commissionEvent = (commissionId, type, fromStatus, toStatus, at, extra = {}) => {
  eventSequence += 1
  return {
    eventId: `CEV-TEST-${String(eventSequence).padStart(6, '0')}`,
    commissionId,
    type,
    fromStatus,
    toStatus,
    at,
    actor: { name: 'Test', role: 'administrator' },
    note: null,
    payoutReference: null,
    ...extra,
  }
}
