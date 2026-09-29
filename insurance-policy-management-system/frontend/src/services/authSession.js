/**
 * DEVELOPMENT-ONLY bridge between the demo-role switcher and real backend
 * authentication.
 *
 * The UI has no login screen yet, but the FastAPI endpoints require a JWT.
 * Rather than weakening the backend, this module signs in as the documented
 * development account that matches the current demo role:
 *
 *   administrator -> admin@example.com
 *   agent         -> agent@example.com         (linked to agent AGT-2207)
 *   policyholder  -> policyholder@example.com  (linked to customer CUS-100241)
 *
 * The backend still authenticates every request and decides what each account
 * may see; switching the demo role simply switches which account is used.
 * The password comes from VITE_DEMO_AUTH_PASSWORD (frontend/.env.development.local)
 * and is never read in production builds, where calls fail with 401 until the
 * real login screen replaces this module.
 */

import { apiClient, ApiError } from './apiClient'
import { ENDPOINTS } from './endpoints'
import { config } from '../utils/config'
import { ROLES } from '../utils/constants'
import { readStoredDemoRole } from '../utils/demoRole'

const DEMO_ACCOUNTS = {
  [ROLES.ADMINISTRATOR]: 'admin@example.com',
  [ROLES.AGENT]: 'agent@example.com',
  [ROLES.POLICYHOLDER]: 'policyholder@example.com',
}

/** Renew a little before the backend's expiry so a request never races it. */
const EXPIRY_MARGIN_MS = 30_000

/** Kept in memory only: a reload signs in again. */
let session = null // { role, token, expiresAt }
let pending = null // { role, promise }

const signIn = (role) => {
  if (!config.demoAuth.password) {
    return Promise.reject(
      new ApiError(
        'Demo sign-in is not configured. Set VITE_DEMO_AUTH_PASSWORD in frontend/.env.development.local.',
        { status: 401 },
      ),
    )
  }

  const promise = apiClient
    .post(ENDPOINTS.authLogin, {
      email: DEMO_ACCOUNTS[role],
      password: config.demoAuth.password,
    })
    .then((response) => {
      session = {
        role,
        token: response.access_token,
        expiresAt: Date.now() + response.expires_in * 1000 - EXPIRY_MARGIN_MS,
      }
      return session.token
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null
    })

  pending = { role, promise }
  return promise
}

const getToken = () => {
  const role = readStoredDemoRole()
  if (session?.role === role && Date.now() < session.expiresAt) {
    return Promise.resolve(session.token)
  }
  // Concurrent requests share one sign-in per role.
  if (pending?.role === role) return pending.promise
  return signIn(role)
}

/** Run `call(token)`; on 401 (expired or revoked token) sign in once more and retry. */
const withToken = async (call) => {
  try {
    return await call(await getToken())
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !session) throw error
    session = null
    return call(await getToken())
  }
}

const bearer = (options, token) => ({
  ...options,
  headers: { ...options.headers, Authorization: `Bearer ${token}` },
})

/** `apiClient` with the current demo account's bearer token attached. */
export const authApi = {
  get: (endpoint, options = {}) =>
    withToken((token) => apiClient.get(endpoint, bearer(options, token))),
  post: (endpoint, body, options = {}) =>
    withToken((token) => apiClient.post(endpoint, body, bearer(options, token))),
}

export default authApi
