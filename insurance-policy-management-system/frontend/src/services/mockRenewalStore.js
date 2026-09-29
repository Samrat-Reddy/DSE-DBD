/**
 * Session-scoped store for renewal reminders and the simulation date.
 *
 * Same strategy as the Module 1–3 stores: seed records from `src/data`,
 * session changes held in memory and mirrored to `sessionStorage`.
 *
 * Reminder attempts are append-only: a retry is a new, linked event, so the
 * history is a faithful audit of every simulated attempt.
 *
 * The simulation date lets the engine be demonstrated across reminder
 * windows without inventing policies. It lives here, in the store, because it
 * is state; the rule that it may only move forward lives in the service.
 *
 * This is the only file that touches storage for renewals.
 */

import { reminderHistory as seedReminders } from '../data/reminderHistory'
import { isValidIsoDate } from '../utils/dateUtils'

const STORAGE_KEY = 'ipms.renewals.session'
const STORAGE_VERSION = 1

let state = null

const isReminderRecord = (value) =>
  Boolean(value) &&
  typeof value.reminderId === 'string' &&
  typeof value.policyId === 'string' &&
  typeof value.stage === 'string' &&
  typeof value.status === 'string' &&
  typeof value.attemptedAt === 'string'

const emptyState = () => ({ reminders: [], simulationDate: null })

const readStorage = () => {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyState()

    const parsed = JSON.parse(raw)
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.reminders)) return emptyState()

    return {
      reminders: parsed.reminders.filter(isReminderRecord),
      simulationDate: isValidIsoDate(parsed.simulationDate) ? parsed.simulationDate : null,
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

/** Seed reminders plus reminders recorded this session. */
export const getAllReminders = () => [...seedReminders, ...getState().reminders]

export const findReminderById = (reminderId) =>
  getAllReminders().find((reminder) => reminder.reminderId === reminderId) ?? null

/** Append reminder events (never replaces existing ones). */
export const addReminders = (events) => {
  const current = getState()
  state = { ...current, reminders: [...current.reminders, ...events] }
  writeStorage()
  return events
}

/** RMD-<year>-<6-digit sequence>, continuing across seed and session records. */
export const createReminderIdGenerator = (year) => {
  const prefix = `RMD-${year}-`
  let highest = getAllReminders()
    .filter((reminder) => reminder.reminderId.startsWith(prefix))
    .reduce((max, reminder) => {
      const sequence = Number(reminder.reminderId.slice(prefix.length))
      return Number.isNaN(sequence) ? max : Math.max(max, sequence)
    }, 0)

  return () => {
    highest += 1
    return `${prefix}${String(highest).padStart(6, '0')}`
  }
}

export const getSimulationDate = () => getState().simulationDate

export const setSimulationDate = (date) => {
  state = { ...getState(), simulationDate: date }
  writeStorage()
  return date
}

/** Discard session reminders and the simulation date. */
export const resetRenewalStore = () => {
  state = emptyState()
  writeStorage()
}
