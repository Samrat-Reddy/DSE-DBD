/**
 * Claim workflow state machine — pure functions only.
 *
 * `CLAIM_TRANSITIONS` is the single source of truth for which status can move
 * to which, what the move is called, and which demo role may make it. The UI
 * reads it to decide which actions to offer; `claimService` enforces it on
 * every change, so hiding a button is never the only safeguard.
 *
 * Transitions marked `dedicated` carry extra rules (a verification checklist,
 * an assessed amount, a rejection reason, a settlement reference) and can only
 * be made through the matching service action, never a bare status change.
 */

import { CLAIM_STATUS, CLAIM_STATUS_LABELS, DEMO_ROLE_TITLES, ROLES } from './constants'

const S = CLAIM_STATUS
const { POLICYHOLDER, AGENT, ADMINISTRATOR } = ROLES

export const CLAIM_ACTIONS = {
  SUBMIT: 'submit',
  CANCEL_DRAFT: 'cancel-draft',
  START_REVIEW: 'start-review',
  WITHDRAW: 'withdraw',
  VERIFY: 'verify',
  ASSESS: 'assess',
  APPROVE: 'approve',
  REJECT: 'reject',
  SETTLE: 'settle',
}

export const CLAIM_TRANSITIONS = {
  [S.DRAFT]: {
    [S.SUBMITTED]: { action: CLAIM_ACTIONS.SUBMIT, label: 'Claim submitted', roles: [POLICYHOLDER, AGENT], dedicated: 'filing' },
    [S.CANCELLED]: { action: CLAIM_ACTIONS.CANCEL_DRAFT, label: 'Draft cancelled', roles: [POLICYHOLDER, AGENT] },
  },
  [S.SUBMITTED]: {
    [S.UNDER_REVIEW]: { action: CLAIM_ACTIONS.START_REVIEW, label: 'Review started', roles: [ADMINISTRATOR] },
    [S.CANCELLED]: { action: CLAIM_ACTIONS.WITHDRAW, label: 'Claim withdrawn', roles: [POLICYHOLDER, ADMINISTRATOR] },
  },
  [S.UNDER_REVIEW]: {
    [S.VERIFIED]: { action: CLAIM_ACTIONS.VERIFY, label: 'Claim verified', roles: [ADMINISTRATOR], dedicated: 'verification' },
  },
  [S.VERIFIED]: {
    [S.ASSESSED]: { action: CLAIM_ACTIONS.ASSESS, label: 'Claim assessed', roles: [ADMINISTRATOR], dedicated: 'assessment' },
  },
  [S.ASSESSED]: {
    [S.APPROVED]: { action: CLAIM_ACTIONS.APPROVE, label: 'Claim approved', roles: [ADMINISTRATOR], dedicated: 'decision' },
    [S.REJECTED]: { action: CLAIM_ACTIONS.REJECT, label: 'Claim rejected', roles: [ADMINISTRATOR], dedicated: 'decision' },
  },
  [S.APPROVED]: {
    [S.SETTLED]: { action: CLAIM_ACTIONS.SETTLE, label: 'Claim settled', roles: [ADMINISTRATOR], dedicated: 'settlement' },
  },
  [S.REJECTED]: {},
  [S.SETTLED]: {},
  [S.CANCELLED]: {},
}

/** The main path a successful claim follows, used for the timeline. */
export const CLAIM_HAPPY_PATH = [S.SUBMITTED, S.UNDER_REVIEW, S.VERIFIED, S.ASSESSED, S.APPROVED, S.SETTLED]

/** Error raised for a disallowed move. `code` is stable for callers to map. */
export class ClaimWorkflowError extends Error {
  constructor(message, { code, from = null, to = null, role = null } = {}) {
    super(message)
    this.name = 'ClaimWorkflowError'
    this.code = code
    this.from = from
    this.to = to
    this.role = role
  }
}

export const WORKFLOW_ERROR_CODES = {
  UNKNOWN_STATUS: 'unknown-status',
  INVALID_TRANSITION: 'invalid-transition',
  UNAUTHORIZED_TRANSITION: 'unauthorized-transition',
}

export const isKnownClaimStatus = (status) =>
  Object.prototype.hasOwnProperty.call(CLAIM_TRANSITIONS, status)

export const getAllowedTransitions = (status) =>
  isKnownClaimStatus(status) ? Object.keys(CLAIM_TRANSITIONS[status]) : []

export const getTransitionRule = (from, to) =>
  (isKnownClaimStatus(from) && CLAIM_TRANSITIONS[from][to]) || null

export const canTransition = (from, to) => Boolean(getTransitionRule(from, to))

export const canRoleTransition = (from, to, role) =>
  Boolean(getTransitionRule(from, to)?.roles.includes(role))

/** A terminal status has no outgoing transitions. */
export const isTerminalClaimStatus = (status) =>
  isKnownClaimStatus(status) && getAllowedTransitions(status).length === 0

/** Transitions a role may make from a status, with their rules attached. */
export const getAvailableTransitions = (status, role) =>
  getAllowedTransitions(status)
    .map((toStatus) => ({ toStatus, ...getTransitionRule(status, toStatus) }))
    .filter((rule) => rule.roles.includes(role))

const statusLabel = (status) => CLAIM_STATUS_LABELS[status] ?? status

/**
 * Throw a `ClaimWorkflowError` unless `role` may move a claim from `from` to
 * `to`. Validity is checked before authority, so an impossible move is always
 * reported as invalid regardless of who attempts it.
 */
export const assertTransition = (from, to, role) => {
  if (!isKnownClaimStatus(from) || !isKnownClaimStatus(to)) {
    throw new ClaimWorkflowError(`"${to}" is not a recognised claim status.`, {
      code: WORKFLOW_ERROR_CODES.UNKNOWN_STATUS,
      from,
      to,
      role,
    })
  }

  const rule = getTransitionRule(from, to)

  if (!rule) {
    const allowed = getAllowedTransitions(from).map(statusLabel)
    throw new ClaimWorkflowError(
      `A claim cannot move from ${statusLabel(from)} to ${statusLabel(to)}. ${
        allowed.length
          ? `From ${statusLabel(from)} it can only move to: ${allowed.join(', ')}.`
          : `${statusLabel(from)} is a final status.`
      }`,
      { code: WORKFLOW_ERROR_CODES.INVALID_TRANSITION, from, to, role },
    )
  }

  if (!rule.roles.includes(role)) {
    const allowedRoles = rule.roles.map((allowedRole) => DEMO_ROLE_TITLES[allowedRole]).join(' or ')
    throw new ClaimWorkflowError(
      `${DEMO_ROLE_TITLES[role] ?? 'This role'} cannot move a claim from ${statusLabel(from)} to ${statusLabel(
        to,
      )}. Only a ${allowedRoles} can.`,
      { code: WORKFLOW_ERROR_CODES.UNAUTHORIZED_TRANSITION, from, to, role },
    )
  }

  return rule
}

/**
 * Apply a transition and append its activity event. Returns a new claim;
 * the input is never mutated.
 *
 * @param {object} claim
 * @param {string} toStatus
 * @param {{name: string, role: string}} actor
 * @param {{at: string, note?: string|null, patch?: object}} options
 *   `at` is an ISO timestamp supplied by the caller so this stays pure.
 */
export const applyTransition = (claim, toStatus, actor, { at, note = null, patch = {} }) => {
  const rule = assertTransition(claim.status, toStatus, actor?.role)
  const activity = claim.activity ?? []

  const event = {
    eventId: `${claim.claimId}-E${activity.length + 1}`,
    at,
    action: rule.action,
    label: rule.label,
    fromStatus: claim.status,
    toStatus,
    actor: { name: actor.name, role: actor.role },
    note: note || null,
  }

  return {
    ...claim,
    ...patch,
    status: toStatus,
    updatedAt: at,
    activity: [...activity, event],
  }
}

/** The name recorded for an action taken under a demo role on a policy. */
export const resolveActor = (role, policy) => {
  if (role === POLICYHOLDER) {
    return { name: policy?.policyholder?.name ?? DEMO_ROLE_TITLES[POLICYHOLDER], role }
  }
  if (role === AGENT) {
    return { name: policy?.agent?.name ?? `${DEMO_ROLE_TITLES[AGENT]} (demo)`, role }
  }
  if (role === ADMINISTRATOR) {
    return { name: `${DEMO_ROLE_TITLES[ADMINISTRATOR]} (demo)`, role }
  }
  return { name: 'Unknown', role }
}

const STAGE_LABELS = {
  [S.SUBMITTED]: 'Claim submitted',
  [S.UNDER_REVIEW]: 'Under review',
  [S.VERIFIED]: 'Verified',
  [S.ASSESSED]: 'Assessed',
  [S.APPROVED]: 'Approved',
  [S.SETTLED]: 'Settled',
}

const STAGE_WAITING_NOTES = {
  [S.UNDER_REVIEW]: 'Awaiting a claims officer to start the review.',
  [S.VERIFIED]: 'Awaiting verification of policy, coverage and documents.',
  [S.ASSESSED]: 'Awaiting assessment of the payable amount.',
  [S.APPROVED]: 'Awaiting an approval or rejection decision.',
  [S.SETTLED]: 'Awaiting settlement.',
}

/**
 * Timeline stages for display, compatible with `LifecycleTimeline`.
 *
 * Reached milestones are `completed`; the next milestone is `current`;
 * later ones are `upcoming`. A rejected or cancelled claim ends with a
 * `terminated` stage and no further milestones.
 */
export const getWorkflowStages = (claim) => {
  const reachedAt = new Map()
  for (const event of claim.activity ?? []) {
    if (!reachedAt.has(event.toStatus)) reachedAt.set(event.toStatus, event)
  }

  const terminalEvent =
    claim.status === S.REJECTED || claim.status === S.CANCELLED ? reachedAt.get(claim.status) : null

  const stages = []
  let currentAssigned = false

  for (const status of CLAIM_HAPPY_PATH) {
    const event = reachedAt.get(status)

    if (event) {
      stages.push({ stage: STAGE_LABELS[status], status: 'completed', date: event.at, note: event.note ?? `By ${event.actor.name}` })
      continue
    }

    // A rejected or cancelled claim stops here: no future milestones are shown.
    if (terminalEvent) break

    if (!currentAssigned) {
      currentAssigned = true
      stages.push({ stage: STAGE_LABELS[status], status: 'current', date: null, note: STAGE_WAITING_NOTES[status] })
    } else {
      stages.push({ stage: STAGE_LABELS[status], status: 'upcoming', date: null, note: null })
    }
  }

  if (terminalEvent) {
    stages.push({
      stage: claim.status === S.REJECTED ? 'Rejected' : 'Cancelled',
      status: 'terminated',
      stateLabel: claim.status === S.REJECTED ? 'Rejected' : 'Cancelled',
      date: terminalEvent.at,
      note: claim.status === S.REJECTED ? claim.rejectionReason : terminalEvent.note,
    })
  }

  return stages
}

/** Plain-language description of what happens next, per status. */
export const describeNextStep = (status) =>
  ({
    [S.DRAFT]: 'The claim has not been submitted yet.',
    [S.SUBMITTED]: 'Waiting for a claims officer to start the review.',
    [S.UNDER_REVIEW]: 'A claims officer is verifying the policy, coverage and documents.',
    [S.VERIFIED]: 'Verified. Waiting for the payable amount to be assessed.',
    [S.ASSESSED]: 'Assessed. Waiting for an approval or rejection decision.',
    [S.APPROVED]: 'Approved. Waiting for settlement to be recorded.',
    [S.SETTLED]: 'Settled. The workflow is complete.',
    [S.REJECTED]: 'Rejected. The workflow is complete.',
    [S.CANCELLED]: 'Withdrawn. The workflow is complete.',
  })[status] ?? 'Status unknown.'
