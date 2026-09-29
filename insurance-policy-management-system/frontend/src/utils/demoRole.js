/**
 * The current demo role, shared by `MainLayout` (which owns the switcher) and
 * `services/authSession` (which signs in to the backend as the matching
 * development account), so both always agree on the role.
 *
 * `storeDemoRole` must run in the switcher's change handler, BEFORE the React
 * state update: React runs a page's data-loading effects before the layout's
 * effects, so persisting in an effect would let pages fetch as the old role.
 */

import { ROLES } from './constants'

export const DEMO_ROLE_STORAGE_KEY = 'ipms.demoRole'

/** In-memory copy, so the role is still known when storage is blocked. */
let currentRole = null

/** Read the current demo role, tolerating blocked storage. */
export const readStoredDemoRole = () => {
  if (currentRole) return currentRole
  try {
    const stored = window.sessionStorage.getItem(DEMO_ROLE_STORAGE_KEY)
    return Object.values(ROLES).includes(stored) ? stored : ROLES.AGENT
  } catch {
    return ROLES.AGENT
  }
}

/** Record a new demo role (memory first, then storage so it survives a reload). */
export const storeDemoRole = (role) => {
  currentRole = role
  try {
    window.sessionStorage.setItem(DEMO_ROLE_STORAGE_KEY, role)
  } catch {
    // Storage unavailable: the role simply resets on reload.
  }
}
