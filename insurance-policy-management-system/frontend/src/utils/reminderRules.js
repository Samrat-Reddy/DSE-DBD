/**
 * Validation for manual reminder triggers and retries — pure.
 *
 * Used by `renewalService` (the enforcement boundary) and by the UI to decide
 * which controls to offer. Each rule returns `{ allowed, code, message }`;
 * the service maps `code` to an HTTP-style status.
 */

import {
  REMINDER_CHANNELS,
  REMINDER_EVENT_STATUS,
  REMINDER_STAGE_STATE,
} from './constants'
import { getStageDefinition } from './renewalEngine'
import { formatDate } from './formatters'

export const REMINDER_RULE_CODES = {
  OK: 'ok',
  INVALID_STAGE: 'invalid-stage',
  INVALID_OUTCOME: 'invalid-outcome',
  INVALID_CHANNEL: 'invalid-channel',
  NOT_ELIGIBLE: 'not-eligible',
  ALREADY_SENT: 'already-sent',
  ALREADY_HANDLED: 'already-handled',
  RETRY_REQUIRED: 'retry-required',
  NOT_DUE: 'reminder-not-due',
  STAGE_CLOSED: 'stage-closed',
  REMINDER_NOT_FOUND: 'reminder-not-found',
  INVALID_RETRY: 'invalid-retry',
}

/** Outcomes an administrator may choose for a simulated reminder. */
export const TRIGGER_OUTCOMES = [REMINDER_EVENT_STATUS.SENT, REMINDER_EVENT_STATUS.FAILED, REMINDER_EVENT_STATUS.SKIPPED]
/** A retry either succeeds or fails again; skipping is not a retry. */
export const RETRY_OUTCOMES = [REMINDER_EVENT_STATUS.SENT, REMINDER_EVENT_STATUS.FAILED]

const VALID_CHANNELS = Object.values(REMINDER_CHANNELS)
const C = REMINDER_RULE_CODES

const allow = () => ({ allowed: true, code: C.OK, message: null })
const deny = (code, message) => ({ allowed: false, code, message })

/**
 * May a reminder be triggered manually for `stageId` right now?
 *
 * @param {{plan: object, stageId: string, outcome: string, channel?: string}} input
 */
export const checkReminderTrigger = ({ plan, stageId, outcome, channel }) => {
  const definition = getStageDefinition(stageId)
  if (!definition) return deny(C.INVALID_STAGE, `"${stageId}" is not a reminder stage.`)
  if (!TRIGGER_OUTCOMES.includes(outcome)) return deny(C.INVALID_OUTCOME, 'Choose sent, failed or skipped as the simulated outcome.')
  if (channel !== undefined && !VALID_CHANNELS.includes(channel)) return deny(C.INVALID_CHANNEL, 'Choose email, SMS or in-app as the simulated channel.')
  if (!plan.eligibility.eligible) return deny(C.NOT_ELIGIBLE, plan.eligibility.reason)

  const stage = plan.stages.find((item) => item.id === stageId)

  switch (stage.state) {
    case REMINDER_STAGE_STATE.SENT:
      return deny(C.ALREADY_SENT, `The ${definition.label} reminder has already been sent. A duplicate will not be created.`)
    case REMINDER_STAGE_STATE.SKIPPED:
      return deny(C.ALREADY_HANDLED, `The ${definition.label} reminder was already handled (skipped). A duplicate will not be created.`)
    case REMINDER_STAGE_STATE.FAILED:
      return deny(C.RETRY_REQUIRED, `The ${definition.label} reminder failed. Retry the failed attempt instead of triggering a new one.`)
    case REMINDER_STAGE_STATE.SCHEDULED:
      return deny(C.NOT_DUE, `The ${definition.label} reminder is not due until ${formatDate(stage.scheduledFor)}.`)
    case REMINDER_STAGE_STATE.MISSED:
      return deny(C.STAGE_CLOSED, `The ${definition.label} stage has passed; the policy is now in a later stage.`)
    default:
      return allow()
  }
}

/**
 * May `reminder` be retried right now?
 *
 * @param {{reminder: object|null, plan: object|null, outcome: string, channel?: string}} input
 */
export const checkReminderRetry = ({ reminder, plan, outcome, channel }) => {
  if (!reminder) return deny(C.REMINDER_NOT_FOUND, 'The reminder could not be found.')
  if (reminder.status !== REMINDER_EVENT_STATUS.FAILED) {
    return deny(C.INVALID_RETRY, `Only failed reminders can be retried; ${reminder.reminderId} was ${reminder.status}.`)
  }
  if (!RETRY_OUTCOMES.includes(outcome)) return deny(C.INVALID_OUTCOME, 'Choose sent or failed as the simulated retry outcome.')
  if (channel !== undefined && !VALID_CHANNELS.includes(channel)) return deny(C.INVALID_CHANNEL, 'Choose email, SMS or in-app as the simulated channel.')

  const stage = plan?.stages.find((item) => item.id === reminder.stage)
  const definition = getStageDefinition(reminder.stage)

  if (stage?.state === REMINDER_STAGE_STATE.SENT) {
    return deny(C.ALREADY_SENT, `The ${definition.label} reminder has since been sent. Retrying would create a duplicate.`)
  }
  if (stage?.latestAttempt && stage.latestAttempt.reminderId !== reminder.reminderId) {
    return deny(C.INVALID_RETRY, `${reminder.reminderId} is not the latest attempt for this stage; retry ${stage.latestAttempt.reminderId} instead.`)
  }
  if (!plan.eligibility.eligible) return deny(C.NOT_ELIGIBLE, plan.eligibility.reason)
  if (!stage?.canRetry) {
    return deny(C.STAGE_CLOSED, `The ${definition.label} stage is no longer current, so its failed reminder can no longer be retried.`)
  }
  return allow()
}
