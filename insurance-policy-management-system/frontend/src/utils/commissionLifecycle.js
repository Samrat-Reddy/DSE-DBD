/**
 * Agent Commission — lifecycle (pure).
 *
 *   PENDING ──confirm earned──▶ EARNED ──mark paid──▶ PAID
 *
 *   PENDING  generated from a successful premium payment
 *   EARNED   the earning hold (COMMISSION_CONFIG.earningHoldDays after the
 *            payment) has passed and an administrator confirmed it
 *   PAID     an administrator recorded a simulated payout
 *
 * There are no other transitions: a commission cannot skip EARNED, cannot go
 * backwards, and PAID is final.
 *
 * A commission's status is never stored on the record. It is derived from the
 * record's append-only events, so the audit trail is the source of truth.
 */

import {
  COMMISSION_CONFIG,
  COMMISSION_EVENT_TYPES,
  COMMISSION_STATUS,
  COMMISSION_STATUS_LABELS,
  ROLES_ALLOWED_TO_MANAGE_COMMISSIONS,
} from './constants'
import { addDaysIso, daysBetween, isValidIsoDate } from './dateUtils'
import { formatDate } from './formatters'

const { PENDING, EARNED, PAID } = COMMISSION_STATUS

export const COMMISSION_TRANSITIONS = {
  [PENDING]: [EARNED],
  [EARNED]: [PAID],
  [PAID]: [],
}

export const TRANSITION_CODES = {
  OK: 'ok',
  INVALID_STATUS: 'invalid-status',
  UNAUTHORIZED: 'unauthorized',
  INVALID_TRANSITION: 'invalid-transition',
  EARNING_HOLD_ACTIVE: 'earning-hold-active',
  INVALID_LINKAGE: 'invalid-linkage',
}

const T = TRANSITION_CODES

export const isCommissionStatus = (value) => Object.values(COMMISSION_STATUS).includes(value)

export const getAllowedTransitions = (status) => COMMISSION_TRANSITIONS[status] ?? []

export const canTransition = (from, to) => getAllowedTransitions(from).includes(to)

/** The first date a commission from a payment on `paymentDate` can be earned. */
export const getEarnableFrom = (paymentDate, config = COMMISSION_CONFIG) =>
  isValidIsoDate(paymentDate) ? addDaysIso(paymentDate, config.earningHoldDays) : null

export const isEarningHoldActive = (paymentDate, asOf, config = COMMISSION_CONFIG) => {
  const earnableFrom = getEarnableFrom(paymentDate, config)
  return !earnableFrom || !isValidIsoDate(asOf) || daysBetween(asOf, earnableFrom) > 0
}

const byTime = (a, b) => String(a.at).localeCompare(String(b.at)) || String(a.eventId).localeCompare(String(b.eventId))

/**
 * Replay a commission's events. Events that are not a valid next step are
 * ignored and reported, so a corrupted trail can never produce an impossible
 * status.
 */
export const deriveCommissionState = (events = []) => {
  const ordered = [...events].sort(byTime)
  const state = { status: null, generatedAt: null, earnedAt: null, paidAt: null, payoutReference: null, ignoredEvents: [] }

  for (const event of ordered) {
    if (event.type === COMMISSION_EVENT_TYPES.GENERATED && state.status === null && event.toStatus === PENDING) {
      state.status = PENDING
      state.generatedAt = event.at
    } else if (event.type === COMMISSION_EVENT_TYPES.STATUS_CHANGED && event.fromStatus === state.status && canTransition(state.status, event.toStatus)) {
      state.status = event.toStatus
      if (event.toStatus === EARNED) state.earnedAt = event.at
      if (event.toStatus === PAID) {
        state.paidAt = event.at
        state.payoutReference = event.payoutReference ?? null
      }
    } else {
      state.ignoredEvents.push(event.eventId)
    }
  }

  return { ...state, events: ordered }
}

const allow = () => ({ allowed: true, code: T.OK, message: null })
const deny = (code, message) => ({ allowed: false, code, message })

/**
 * May `role` move a commission from `currentStatus` to `toStatus` as of
 * `asOf`? Checked in this order: target status, role, state machine, payment
 * linkage, earning hold.
 *
 * @param {{currentStatus: string, toStatus: string, role: string,
 *          paymentDate: string|null, asOf: string, linkageValid: boolean}} input
 */
export const checkCommissionTransition = ({ currentStatus, toStatus, role, paymentDate, asOf, linkageValid = true }) => {
  if (!isCommissionStatus(toStatus)) return deny(T.INVALID_STATUS, `"${toStatus}" is not a commission status.`)
  if (!ROLES_ALLOWED_TO_MANAGE_COMMISSIONS.includes(role)) {
    return deny(T.UNAUTHORIZED, 'Only an Administrator can change a commission status.')
  }
  if (!canTransition(currentStatus, toStatus)) {
    const from = COMMISSION_STATUS_LABELS[currentStatus] ?? currentStatus
    const to = COMMISSION_STATUS_LABELS[toStatus]
    const hint =
      currentStatus === PAID
        ? ' Paid is final.'
        : currentStatus === PENDING && toStatus === PAID
          ? ' It must be confirmed as earned first.'
          : ''
    return deny(T.INVALID_TRANSITION, `A commission cannot move from ${from} to ${to}.${hint}`)
  }
  if (!linkageValid) {
    return deny(T.INVALID_LINKAGE, 'The premium payment behind this commission can no longer be verified, so its status cannot change.')
  }
  if (toStatus === EARNED && isEarningHoldActive(paymentDate, asOf)) {
    return deny(
      T.EARNING_HOLD_ACTIVE,
      `This commission can be confirmed as earned from ${formatDate(getEarnableFrom(paymentDate))}, ${COMMISSION_CONFIG.earningHoldDays} days after the premium payment.`,
    )
  }
  return allow()
}
