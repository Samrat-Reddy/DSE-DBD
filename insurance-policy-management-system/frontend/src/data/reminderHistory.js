/**
 * Mock renewal reminder history.
 *
 * ILLUSTRATIVE DATA ONLY — a record of SIMULATED reminder attempts. No email,
 * SMS or in-app message was ever sent, and no provider exists.
 *
 * Every event belongs to an issued policy in `issuedPolicies.js` and to a
 * stage in `RENEWAL_CONFIG`, and `scheduledFor` equals that stage's date for
 * the policy's expiry (the test suite checks both). Only policies whose
 * reminder windows have already passed carry seed history, so the demo starts
 * with real work for the engine: POL-2024-000519 enters its 60-day stage on
 * 10 Sep 2026 and has no reminder yet.
 *
 *   POL-2023-000874 (expired 19 Sep 2024)
 *     sent, skipped, sent, failed (never retried), sent, sent, sent
 *   POL-2024-000148 (expired 14 Apr 2025)
 *     sent, sent, failed then retried successfully, sent, sent, sent, sent
 */

import { REMINDER_CHANNELS, REMINDER_EVENT_STATUS, REMINDER_TRIGGERS, ROLES } from '../utils/constants'

const { EMAIL, SMS, IN_APP } = REMINDER_CHANNELS
const { SENT, FAILED, SKIPPED } = REMINDER_EVENT_STATUS

const SCHEDULED_RUN = { name: 'Scheduled reminder check', role: 'system' }
const RENEWALS_DESK = { name: 'P. Shah', role: ROLES.ADMINISTRATOR }

const RESULTS = {
  [SENT]: (channel) => `Delivered to the simulated ${channel} channel. No real message was sent.`,
  [FAILED]: (reason) => `Simulated delivery failure: ${reason}. No real provider was contacted.`,
}

/** One simulated reminder attempt. */
const reminder = ({
  reminderId,
  policyId,
  stage,
  scheduledFor,
  attemptedAt,
  channel,
  status,
  result,
  trigger = REMINDER_TRIGGERS.CHECK,
  createdBy = SCHEDULED_RUN,
  retryOf = null,
  note = null,
}) => ({
  reminderId,
  policyId,
  stage,
  scheduledFor,
  attemptedAt,
  evaluatedAsOf: attemptedAt.slice(0, 10),
  sentAt: status === SENT ? attemptedAt : null,
  channel,
  status,
  result,
  trigger,
  createdBy,
  retryOf,
  note,
})

export const reminderHistory = [
  // ------------------------------------------------ POL-2023-000874 (Home)
  reminder({ reminderId: 'RMD-2024-000031', policyId: 'POL-2023-000874', stage: 'd60', scheduledFor: '2024-07-21', attemptedAt: '2024-07-21T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email') }),
  reminder({
    reminderId: 'RMD-2024-000044',
    policyId: 'POL-2023-000874',
    stage: 'd30',
    scheduledFor: '2024-08-20',
    attemptedAt: '2024-08-20T03:30:00.000Z',
    channel: EMAIL,
    status: SKIPPED,
    result: 'Skipped: the policyholder had already confirmed renewal intent by phone.',
    trigger: REMINDER_TRIGGERS.MANUAL,
    createdBy: RENEWALS_DESK,
    note: 'Policyholder called the branch on 18 Aug 2024.',
  }),
  reminder({ reminderId: 'RMD-2024-000052', policyId: 'POL-2023-000874', stage: 'd15', scheduledFor: '2024-09-04', attemptedAt: '2024-09-04T03:30:00.000Z', channel: SMS, status: SENT, result: RESULTS[SENT]('SMS') }),
  reminder({ reminderId: 'RMD-2024-000058', policyId: 'POL-2023-000874', stage: 'd7', scheduledFor: '2024-09-12', attemptedAt: '2024-09-12T03:30:00.000Z', channel: SMS, status: FAILED, result: RESULTS[FAILED]('handset unreachable') }),
  reminder({ reminderId: 'RMD-2024-000061', policyId: 'POL-2023-000874', stage: 'd1', scheduledFor: '2024-09-18', attemptedAt: '2024-09-18T03:30:00.000Z', channel: IN_APP, status: SENT, result: RESULTS[SENT]('in-app') }),
  reminder({ reminderId: 'RMD-2024-000063', policyId: 'POL-2023-000874', stage: 'd0', scheduledFor: '2024-09-19', attemptedAt: '2024-09-19T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email') }),
  reminder({ reminderId: 'RMD-2024-000070', policyId: 'POL-2023-000874', stage: 'post', scheduledFor: '2024-09-26', attemptedAt: '2024-09-26T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email'), note: 'Policy was not renewed before expiry.' }),

  // ---------------------------------------------- POL-2024-000148 (Health)
  reminder({ reminderId: 'RMD-2025-000012', policyId: 'POL-2024-000148', stage: 'd60', scheduledFor: '2025-02-13', attemptedAt: '2025-02-13T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email') }),
  reminder({ reminderId: 'RMD-2025-000029', policyId: 'POL-2024-000148', stage: 'd30', scheduledFor: '2025-03-15', attemptedAt: '2025-03-15T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email') }),
  reminder({ reminderId: 'RMD-2025-000040', policyId: 'POL-2024-000148', stage: 'd15', scheduledFor: '2025-03-30', attemptedAt: '2025-03-30T03:30:00.000Z', channel: SMS, status: FAILED, result: RESULTS[FAILED]('carrier rejected the message') }),
  reminder({
    reminderId: 'RMD-2025-000041',
    policyId: 'POL-2024-000148',
    stage: 'd15',
    scheduledFor: '2025-03-30',
    attemptedAt: '2025-03-31T05:10:00.000Z',
    channel: EMAIL,
    status: SENT,
    result: RESULTS[SENT]('email'),
    trigger: REMINDER_TRIGGERS.RETRY,
    createdBy: RENEWALS_DESK,
    retryOf: 'RMD-2025-000040',
    note: 'Retried by email after the SMS failed.',
  }),
  reminder({ reminderId: 'RMD-2025-000047', policyId: 'POL-2024-000148', stage: 'd7', scheduledFor: '2025-04-07', attemptedAt: '2025-04-07T03:30:00.000Z', channel: SMS, status: SENT, result: RESULTS[SENT]('SMS') }),
  reminder({ reminderId: 'RMD-2025-000052', policyId: 'POL-2024-000148', stage: 'd1', scheduledFor: '2025-04-13', attemptedAt: '2025-04-13T03:30:00.000Z', channel: IN_APP, status: SENT, result: RESULTS[SENT]('in-app') }),
  reminder({ reminderId: 'RMD-2025-000054', policyId: 'POL-2024-000148', stage: 'd0', scheduledFor: '2025-04-14', attemptedAt: '2025-04-14T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email') }),
  reminder({ reminderId: 'RMD-2025-000061', policyId: 'POL-2024-000148', stage: 'post', scheduledFor: '2025-04-21', attemptedAt: '2025-04-21T03:30:00.000Z', channel: EMAIL, status: SENT, result: RESULTS[SENT]('email'), note: 'Policy was not renewed before expiry.' }),
]

export default reminderHistory
