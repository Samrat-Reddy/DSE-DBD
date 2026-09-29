/**
 * MIS Reports — access rules (pure).
 *
 * MIS Reports are organisation-wide management reports, so only an
 * administrator may read them. An agent has their own scoped views inside
 * Module 5 (their commission) and Modules 1–4; they are never given the
 * organisation-wide report set, and a policyholder has no access at all.
 *
 * The report service calls this on every request; hiding the navigation link
 * is only a convenience.
 */

import { ROLE_OPTIONS, ROLES_ALLOWED_TO_VIEW_REPORTS } from './constants'

export const REPORT_ACCESS_CODES = {
  OK: 'ok',
  UNAUTHORIZED: 'unauthorized',
}

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

/** @returns {{allowed: boolean, code: string, message: string|null}} */
export const checkReportAccess = (actor) => {
  if (!ROLES_ALLOWED_TO_VIEW_REPORTS.includes(actor?.role)) {
    return {
      allowed: false,
      code: REPORT_ACCESS_CODES.UNAUTHORIZED,
      message: `${ROLE_LABELS[actor?.role] ?? 'This role'} cannot view MIS Reports. Only an Administrator can.`,
    }
  }
  return { allowed: true, code: REPORT_ACCESS_CODES.OK, message: null }
}
