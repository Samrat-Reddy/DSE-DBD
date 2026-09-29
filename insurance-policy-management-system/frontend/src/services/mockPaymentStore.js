/**
 * Session-scoped store for mock payments recorded during a demo run.
 *
 * Follows exactly the same strategy as `mockPolicyStore.js` (Module 1): seed
 * records come from `src/data`, anything recorded in the browser session is
 * held in memory and mirrored to `sessionStorage` so it survives a refresh.
 *
 * This file and `mockPolicyStore.js` are the ONLY places that touch browser
 * storage. When the FastAPI backend lands, delete this file and point
 * `premiumService` at `apiClient`.
 */

import { payments as seedPayments } from '../data/payments'

const STORAGE_KEY = 'ipms.payments.session'

/** In-memory mirror, so the app still works if storage is unavailable. */
let sessionPayments = null

const readStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    // Private browsing, blocked storage, or malformed JSON — fall back to memory.
    return []
  }
}

const writeStorage = (payments) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payments))
  } catch {
    // Non-fatal: the in-memory mirror keeps the session usable.
  }
}

const getSessionPayments = () => {
  if (sessionPayments === null) {
    sessionPayments = readStorage()
  }
  return sessionPayments
}

/** Seed payments plus anything recorded in this session. */
export const getAllPayments = () => [...getSessionPayments(), ...seedPayments]

export const addPayment = (payment) => {
  sessionPayments = [payment, ...getSessionPayments()]
  writeStorage(sessionPayments)
  return payment
}

export const findPaymentById = (paymentId) =>
  getAllPayments().find((payment) => payment.paymentId === paymentId) ?? null

/**
 * Next mock payment number for a year.
 * Format: PAY-<year>-<6-digit sequence>, matching the seed data.
 */
export const generatePaymentId = (year = new Date().getFullYear()) => {
  const prefix = `PAY-${year}-`

  const highestSequence = getAllPayments()
    .filter((payment) => payment.paymentId.startsWith(prefix))
    .reduce((highest, payment) => {
      const sequence = Number(payment.paymentId.slice(prefix.length))
      return Number.isNaN(sequence) ? highest : Math.max(highest, sequence)
    }, 0)

  return `${prefix}${String(highestSequence + 1).padStart(6, '0')}`
}

// Excludes 0/O and 1/I so references are unambiguous when read aloud.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/**
 * Mock transaction reference. The `MOCKTXN-` prefix makes it impossible to
 * mistake for a real bank or payment-gateway reference.
 */
export const generateTransactionReference = () => {
  let suffix = ''
  for (let index = 0; index < 10; index += 1) {
    suffix += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)]
  }
  return `MOCKTXN-${suffix}`
}

/** Test/demo helper — clears session-recorded payments. */
export const resetSessionPayments = () => {
  sessionPayments = []
  writeStorage(sessionPayments)
}
