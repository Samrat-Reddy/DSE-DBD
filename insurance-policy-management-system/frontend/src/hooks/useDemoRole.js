import { useOutletContext } from 'react-router-dom'
import {
  DEMO_AGENT_ID,
  ROLES,
  ROLES_ALLOWED_TO_FILE_CLAIM,
  ROLES_ALLOWED_TO_ISSUE,
  ROLES_ALLOWED_TO_MANAGE_COMMISSIONS,
  ROLES_ALLOWED_TO_MANAGE_REMINDERS,
  ROLES_ALLOWED_TO_PAY,
  ROLES_ALLOWED_TO_RUN_REMINDER_CHECK,
  ROLES_ALLOWED_TO_VIEW_REPORTS,
  ROLES_ALLOWED_TO_VIEW_COMMISSIONS,
} from '../utils/constants'

/**
 * Read the demo role supplied by `MainLayout` through the router outlet.
 *
 * This is NOT authentication — it only lets the UI demonstrate how the
 * interface differs for a policyholder, an agent and an administrator.
 */
export const useDemoRole = () => {
  const context = useOutletContext() ?? {}
  const role = context.role ?? null

  return {
    role,
    setRole: context.setRole ?? (() => {}),
    canIssuePolicy: ROLES_ALLOWED_TO_ISSUE.includes(role),
    canRecordPayment: ROLES_ALLOWED_TO_PAY.includes(role),
    canFileClaim: ROLES_ALLOWED_TO_FILE_CLAIM.includes(role),
    // Only claims officers adjudicate. The service enforces this independently.
    canAdjudicateClaims: role === ROLES.ADMINISTRATOR,
    // Module 4 — the renewal service enforces the same rules independently.
    canRunReminderCheck: ROLES_ALLOWED_TO_RUN_REMINDER_CHECK.includes(role),
    canManageReminders: ROLES_ALLOWED_TO_MANAGE_REMINDERS.includes(role),
    // Module 5 — the commission service enforces the same rules independently.
    canViewCommissions: ROLES_ALLOWED_TO_VIEW_COMMISSIONS.includes(role),
    canManageCommissions: ROLES_ALLOWED_TO_MANAGE_COMMISSIONS.includes(role),
    // The registered agent the demo Agent role acts as (no sign-in exists).
    agentId: role === ROLES.AGENT ? DEMO_AGENT_ID : null,
    // Module 6 — the report service enforces the same rule independently.
    canViewReports: ROLES_ALLOWED_TO_VIEW_REPORTS.includes(role),
  }
}

export default useDemoRole
