/**
 * Display text for renewal data (Module 4). Pure, so it is unit tested.
 */

import { REMINDER_STAGE_STATE_LABELS, REMINDER_TRIGGERS, ROLE_OPTIONS } from './constants'
import { daysBetween, isValidIsoDate } from './dateUtils'
import { formatDate } from './formatters'

const plural = (count, singular, pluralWord = `${singular}s`) => `${count} ${count === 1 ? singular : pluralWord}`

/** "55 days left", "1 day left", "Expires today", "Expired 3 days ago". */
export const describeDaysRemaining = (days) => {
  if (days === null || days === undefined || Number.isNaN(days)) return 'Expiry date unknown'
  if (days === 0) return 'Expires today'
  if (days > 0) return `${plural(days, 'day')} left`
  return `Expired ${plural(Math.abs(days), 'day')} ago`
}

export const REMINDER_TRIGGER_LABELS = {
  [REMINDER_TRIGGERS.CHECK]: 'Reminder check',
  [REMINDER_TRIGGERS.MANUAL]: 'Manual trigger',
  [REMINDER_TRIGGERS.RETRY]: 'Retry',
  [REMINDER_TRIGGERS.SEED]: 'Seed record',
}

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

/** "Renewals Administrator (demo) · Administrator", or the system name. */
export const describeActor = (createdBy) => {
  if (!createdBy) return 'Unknown'
  const role = ROLE_LABELS[createdBy.role]
  return role ? `${createdBy.name} · ${role}` : createdBy.name
}

/** Current stage text for a renewal account, e.g. "60 days · Due now". */
export const describeCurrentStage = (account) => {
  const stage = account?.plan?.currentStage
  if (!stage) return null
  return { label: stage.shortLabel ?? stage.label, state: stage.state, stateLabel: REMINDER_STAGE_STATE_LABELS[stage.state] }
}

/** Next reminder text: "Due now", "On 10 Oct 2026", or none. */
export const describeNextReminder = (nextReminder) => {
  if (!nextReminder) return { when: 'None scheduled', stage: null, dueNow: false }
  if (nextReminder.dueNow) {
    return {
      when: nextReminder.action === 'retry' ? 'Retry needed now' : 'Due now',
      stage: nextReminder.label,
      dueNow: true,
    }
  }
  return { when: formatDate(nextReminder.date), stage: nextReminder.label, dueNow: false }
}

/**
 * The earliest future reminder date across accounts, after `asOf`. Used to
 * offer a "jump to next reminder date" shortcut in the simulation.
 */
export const findNextReminderDate = (accounts = [], asOf) => {
  if (!isValidIsoDate(asOf)) return null
  return (
    accounts
      .map((account) => account?.nextReminder)
      .filter((next) => next && !next.dueNow && isValidIsoDate(next.date) && daysBetween(asOf, next.date) > 0)
      .map((next) => next.date)
      .sort((a, b) => daysBetween(b, a))[0] ?? null
  )
}
