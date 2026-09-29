/**
 * Session-scoped store for policies issued during a demo run.
 *
 * WHY THIS EXISTS: there is no backend yet, but a policy issued in the UI has
 * to remain viewable after navigating away or refreshing the page. Seed
 * policies come from `src/data`; anything issued in-session is appended here.
 *
 * This file is the ONLY place that touches browser storage. When the FastAPI
 * backend lands, delete it and point `policyService` at `apiClient`.
 */

import { issuedPolicies as seedPolicies } from '../data/issuedPolicies'

const STORAGE_KEY = 'ipms.issuedPolicies.session'

/** In-memory mirror, so the app still works if storage is unavailable. */
let sessionPolicies = null

const readStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    // Private browsing, blocked storage, or malformed JSON — fall back to memory.
    return []
  }
}

const writeStorage = (policies) => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(policies))
  } catch {
    // Non-fatal: the in-memory mirror keeps the session usable.
  }
}

const getSessionPolicies = () => {
  if (sessionPolicies === null) {
    sessionPolicies = readStorage()
  }
  return sessionPolicies
}

/** Seed book plus anything issued in this session, newest first. */
export const getAllPolicies = () => [...getSessionPolicies(), ...seedPolicies]

export const addPolicy = (policy) => {
  sessionPolicies = [policy, ...getSessionPolicies()]
  writeStorage(sessionPolicies)
  return policy
}

export const findPolicyById = (id) =>
  getAllPolicies().find((policy) => policy.id === id) ?? null

/**
 * Generate the next mock policy number for the current year.
 * Format: POL-<year>-<6-digit sequence>, matching the seed data.
 */
export const generatePolicyId = () => {
  const year = new Date().getFullYear()
  const prefix = `POL-${year}-`

  const highestSequence = getAllPolicies()
    .filter((policy) => policy.id.startsWith(prefix))
    .reduce((highest, policy) => {
      const sequence = Number(policy.id.slice(prefix.length))
      return Number.isNaN(sequence) ? highest : Math.max(highest, sequence)
    }, 0)

  return `${prefix}${String(highestSequence + 1).padStart(6, '0')}`
}

/** Generate a customer ID when the operator does not supply one. */
export const generateCustomerId = () =>
  `CUS-${String(100000 + Math.floor(Math.random() * 899999))}`

/** Test/demo helper — clears session-issued policies. */
export const resetSessionPolicies = () => {
  sessionPolicies = []
  writeStorage(sessionPolicies)
}
