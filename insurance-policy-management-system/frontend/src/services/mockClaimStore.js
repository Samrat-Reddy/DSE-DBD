/**
 * Session-scoped store for claims.
 *
 * Same strategy as `mockPolicyStore` and `mockPaymentStore`: seed records from
 * `src/data`, session changes held in memory and mirrored to `sessionStorage`
 * so they survive a refresh.
 *
 * Unlike payments, claims change over time (their workflow advances). The
 * session layer therefore stores full claim records keyed by claim ID; a
 * session record replaces the seed record with the same ID. Seed data itself
 * is never modified.
 *
 * This is the only file that touches storage for claims. When FastAPI lands,
 * delete it and point `claimService` at `apiClient`.
 */

import { claims as seedClaims } from '../data/claims'

const STORAGE_KEY = 'ipms.claims.session'
const STORAGE_VERSION = 1

/** claimId → claim, for claims created or changed this session. */
let sessionClaims = null

const isClaimRecord = (value) =>
  Boolean(value) &&
  typeof value.claimId === 'string' &&
  typeof value.status === 'string' &&
  Array.isArray(value.activity)

const readStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()

    const parsed = JSON.parse(raw)
    // Ignore anything that is not the expected shape rather than crashing.
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.claims)) return new Map()

    return new Map(parsed.claims.filter(isClaimRecord).map((claim) => [claim.claimId, claim]))
  } catch {
    // Private browsing, blocked storage, or malformed JSON — fall back to seed data.
    return new Map()
  }
}

const writeStorage = () => {
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: STORAGE_VERSION, claims: [...sessionClaims.values()] }),
    )
  } catch {
    // Non-fatal: the in-memory copy keeps the session usable.
  }
}

const getSessionClaims = () => {
  if (sessionClaims === null) sessionClaims = readStorage()
  return sessionClaims
}

/** Seed claims with session versions applied, plus claims created this session. */
export const getAllClaims = () => {
  const session = getSessionClaims()
  const seedIds = new Set(seedClaims.map((claim) => claim.claimId))
  const created = [...session.values()].filter((claim) => !seedIds.has(claim.claimId))
  const seeded = seedClaims.map((claim) => session.get(claim.claimId) ?? claim)
  return [...created, ...seeded]
}

export const findClaimById = (claimId) =>
  getAllClaims().find((claim) => claim.claimId === claimId) ?? null

/** Insert or replace a claim record. */
export const saveClaim = (claim) => {
  getSessionClaims().set(claim.claimId, claim)
  writeStorage()
  return claim
}

const nextSequence = (values, prefix) =>
  values
    .filter((value) => value?.startsWith(prefix))
    .reduce((highest, value) => {
      const sequence = Number(value.slice(prefix.length))
      return Number.isNaN(sequence) ? highest : Math.max(highest, sequence)
    }, 0) + 1

/** CLM-<year>-<6-digit sequence>, matching the seed data. */
export const generateClaimId = (year = new Date().getFullYear()) => {
  const prefix = `CLM-${year}-`
  const sequence = nextSequence(getAllClaims().map((claim) => claim.claimId), prefix)
  return `${prefix}${String(sequence).padStart(6, '0')}`
}

/** SET-<year>-<6-digit sequence>. A recorded reference, not a payment. */
export const generateSettlementReference = (year = new Date().getFullYear()) => {
  const prefix = `SET-${year}-`
  const sequence = nextSequence(getAllClaims().map((claim) => claim.settlement?.reference), prefix)
  return `${prefix}${String(sequence).padStart(6, '0')}`
}

/** Test/demo helper — discards session claims. */
export const resetSessionClaims = () => {
  sessionClaims = new Map()
  writeStorage()
}
