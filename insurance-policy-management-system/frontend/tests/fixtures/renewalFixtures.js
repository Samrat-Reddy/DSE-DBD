/**
 * TEST FIXTURES ONLY — Module 4.
 *
 * Renewal rules depend on dates, but the demo book has few policies near a
 * reminder window. These helpers derive test policies from a real seed policy
 * by overriding only its identifier and dates, so every other field stays
 * realistic. Nothing here is imported by the application.
 */

/** Clone a seed policy with a test ID and different dates or status. */
export const derivePolicy = (base, overrides = {}) => ({
  ...structuredClone(base),
  id: overrides.id ?? `${base.id}-T`,
  ...overrides,
})

let sequence = 0

/** A reminder event in the stored shape. */
export const reminderEvent = ({
  policyId,
  stage,
  status = 'sent',
  scheduledFor = '2026-01-01',
  attemptedAt,
  channel = 'email',
  retryOf = null,
  trigger = 'reminder-check',
}) => {
  sequence += 1
  const at = attemptedAt ?? `2026-01-01T09:00:${String(sequence % 60).padStart(2, '0')}.${String(sequence).padStart(3, '0')}Z`
  return {
    reminderId: `RMD-TEST-${String(sequence).padStart(6, '0')}`,
    policyId,
    stage,
    scheduledFor,
    attemptedAt: at,
    evaluatedAsOf: at.slice(0, 10),
    sentAt: status === 'sent' ? at : null,
    channel,
    status,
    result: `Test ${status}`,
    trigger,
    createdBy: { name: 'Test', role: 'system' },
    retryOf,
    note: null,
  }
}

/** Minimal premium summary in the shape `evaluateRenewalReadiness` reads. */
export const premiumSummary = (standing, overrides = {}) => ({
  standing,
  overdueAmount: standing === 'overdue' ? 4500 : 0,
  oldestOverdueDate: standing === 'overdue' ? '2026-08-01' : null,
  ...overrides,
})
