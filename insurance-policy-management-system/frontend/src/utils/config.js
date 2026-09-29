/**
 * Single source of truth for environment-driven configuration.
 *
 * Nothing else in the application should read `import.meta.env` directly, so
 * that switching environments (local FastAPI, staging, production) is a
 * one-file change.
 */

const DEFAULT_API_BASE_URL = 'http://localhost:8000/api/v1'
const DEFAULT_API_TIMEOUT = 15000

/** Strip any trailing slash so path joining stays predictable. */
const normalizeBaseUrl = (url) => url.replace(/\/+$/, '')

export const config = {
  apiBaseUrl: normalizeBaseUrl(
    import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL,
  ),
  apiTimeout: Number(import.meta.env.VITE_API_TIMEOUT) || DEFAULT_API_TIMEOUT,
  /**
   * Development-only bridge from the demo-role switcher to real backend
   * sign-in (see services/authSession.js). The password of the documented,
   * fake development accounts comes from `.env.development.local`; it is
   * never read in a production build.
   */
  demoAuth: {
    password: import.meta.env.DEV ? import.meta.env.VITE_DEMO_AUTH_PASSWORD || '' : '',
  },
  appName: 'Insurance Policy Management System',
  isDevelopment: import.meta.env.DEV,
  isProduction: import.meta.env.PROD,
}

export default config
