/**
 * Session-scoped store for commission records and their audit events.
 *
 * Same strategy as the Module 1–4 stores: seed records come from `src/data`,
 * anything generated in the browser session is held in memory and mirrored to
 * `sessionStorage` so it survives a refresh.
 *
 * Both collections are append-only. A commission record is never edited after
 * it is generated, and a status change is a new event — so nothing in the
 * audit trail can be silently overwritten.
 *
 * This is the only file that touches storage for commission.
 */

import { commissionEvents as seedEvents, commissions as seedCommissions } from '../data/commissions'

const STORAGE_KEY = 'ipms.commissions.session'
const STORAGE_VERSION = 1

let state = null

const isString = (value) => typeof value === 'string' && value.length > 0

const isCommissionRecord = (value) =>
  Boolean(value) &&
  isString(value.commissionId) &&
  isString(value.policyId) &&
  isString(value.agentId) &&
  isString(value.paymentId) &&
  typeof value.amount === 'number' &&
  Number.isFinite(value.amount) &&
  value.amount > 0

const isEventRecord = (value) =>
  Boolean(value) && isString(value.eventId) && isString(value.commissionId) && isString(value.type) && isString(value.at)

const emptyState = () => ({ commissions: [], events: [] })

const readStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()

    const parsed = JSON.parse(raw)
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.commissions) || !Array.isArray(parsed.events)) {
      return emptyState()
    }
    return {
      commissions: parsed.commissions.filter(isCommissionRecord),
      events: parsed.events.filter(isEventRecord),
    }
  } catch {
    // Private browsing, blocked storage or malformed JSON — fall back to seed data.
    return emptyState()
  }
}

const writeStorage = () => {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...state }))
  } catch {
    // Non-fatal: the in-memory copy keeps the session usable.
  }
}

const getState = () => {
  if (state === null) state = readStorage()
  return state
}

/** Seed commission records plus records generated this session. */
export const getAllCommissions = () => [...seedCommissions, ...getState().commissions]

export const findCommissionById = (commissionId) =>
  getAllCommissions().find((record) => record.commissionId === commissionId) ?? null

export const findCommissionByPaymentId = (paymentId) =>
  getAllCommissions().find((record) => record.paymentId === paymentId) ?? null

export const getAllCommissionEvents = () => [...seedEvents, ...getState().events]

export const getEventsForCommission = (commissionId) =>
  getAllCommissionEvents().filter((event) => event.commissionId === commissionId)

/**
 * Append a new commission with its "generated" event. As a last line of
 * defence, a second commission for the same payment is refused here too.
 */
export const addCommission = (record, generatedEvent) => {
  if (findCommissionByPaymentId(record.paymentId)) {
    throw new Error(`A commission already exists for payment ${record.paymentId}.`)
  }
  const current = getState()
  state = { commissions: [...current.commissions, record], events: [...current.events, generatedEvent] }
  writeStorage()
  return record
}

/** Append events (never replaces existing ones). */
export const addCommissionEvents = (events) => {
  const current = getState()
  state = { ...current, events: [...current.events, ...events] }
  writeStorage()
  return events
}

const createSequence = (prefix, existingIds) => {
  let highest = existingIds
    .filter((id) => id.startsWith(prefix))
    .reduce((max, id) => {
      const sequence = Number(id.slice(prefix.length))
      return Number.isNaN(sequence) ? max : Math.max(max, sequence)
    }, 0)
  return () => {
    highest += 1
    return `${prefix}${String(highest).padStart(6, '0')}`
  }
}

/** COM-<year>-<6-digit sequence>, continuing across seed and session records. */
export const createCommissionIdGenerator = (year) =>
  createSequence(`COM-${year}-`, getAllCommissions().map((record) => record.commissionId))

/** CEV-<year>-<6-digit sequence>. */
export const createEventIdGenerator = (year) =>
  createSequence(`CEV-${year}-`, getAllCommissionEvents().map((event) => event.eventId))

// Excludes 0/O and 1/I so references are unambiguous when read aloud.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

/** Simulated payout reference. The prefix can never be mistaken for a bank reference. */
export const generatePayoutReference = () => {
  let suffix = ''
  for (let index = 0; index < 10; index += 1) {
    suffix += REFERENCE_ALPHABET[Math.floor(Math.random() * REFERENCE_ALPHABET.length)]
  }
  return `MOCKPAYOUT-${suffix}`
}

/** Test/demo helper — discards commission generated in this session. */
export const resetCommissionStore = () => {
  state = emptyState()
  writeStorage()
}
