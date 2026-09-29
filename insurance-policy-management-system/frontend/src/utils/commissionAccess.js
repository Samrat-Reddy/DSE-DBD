/**
 * Agent Commission — access rules (pure).
 *
 *   Policyholder   no access to commission information
 *   Agent          only commission on their own policies
 *   Administrator  everything, and may change status
 *
 * Commission is confidential between an agent and the insurer, so an agent
 * who asks for another agent's record is refused rather than shown it.
 */

import { ROLE_OPTIONS, ROLES, ROLES_ALLOWED_TO_MANAGE_COMMISSIONS, ROLES_ALLOWED_TO_VIEW_COMMISSIONS } from './constants'

export const ACCESS_CODES = {
  OK: 'ok',
  UNAUTHORIZED: 'unauthorized',
  AGENT_NOT_IDENTIFIED: 'agent-not-identified',
  INACCESSIBLE: 'commission-inaccessible',
}

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

const allow = () => ({ allowed: true, code: ACCESS_CODES.OK, message: null })
const deny = (code, message) => ({ allowed: false, code, message })

/** Can this actor see commission information at all? */
export const checkCommissionViewAccess = (actor) => {
  if (!ROLES_ALLOWED_TO_VIEW_COMMISSIONS.includes(actor?.role)) {
    return deny(
      ACCESS_CODES.UNAUTHORIZED,
      `${ROLE_LABELS[actor?.role] ?? 'This role'} cannot view agent commission. Only agents (their own) and administrators can.`,
    )
  }
  if (actor.role === ROLES.AGENT && !actor.agentId) {
    return deny(ACCESS_CODES.AGENT_NOT_IDENTIFIED, 'The agent could not be identified, so no commission can be shown.')
  }
  return allow()
}

/** Can this actor see records belonging to `agentId`? */
export const checkAgentRecordAccess = (actor, agentId) => {
  const view = checkCommissionViewAccess(actor)
  if (!view.allowed) return view
  if (actor.role === ROLES.AGENT && actor.agentId !== agentId) {
    return deny(ACCESS_CODES.INACCESSIBLE, 'This commission information belongs to another agent and is confidential.')
  }
  return allow()
}

/** Can this actor generate commission or change its status? */
export const checkCommissionManageAccess = (actor, action = 'manage commission') => {
  if (!ROLES_ALLOWED_TO_MANAGE_COMMISSIONS.includes(actor?.role)) {
    return deny(ACCESS_CODES.UNAUTHORIZED, `${ROLE_LABELS[actor?.role] ?? 'This role'} cannot ${action}. Only an Administrator can.`)
  }
  return allow()
}

/** Records this actor may see (assumes view access was already checked). */
export const filterVisibleToActor = (records, actor) =>
  actor?.role === ROLES.ADMINISTRATOR ? records : records.filter((record) => record.agentId === actor?.agentId)
