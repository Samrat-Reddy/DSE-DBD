/**
 * Thin fetch wrapper shared by every service module.
 *
 * Feature services must go through this client rather than calling `fetch`
 * directly, so base URL, timeouts, headers and error shaping stay in one
 * place when the FastAPI backend is wired up.
 */

import { config } from '../utils/config'
import { HTTP_METHODS } from '../utils/constants'

/** Error type carrying the HTTP status and any parsed response body. */
export class ApiError extends Error {
  constructor(message, { status = 0, data = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
  }
}

const buildUrl = (endpoint, params) => {
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  const url = new URL(`${config.apiBaseUrl}${path}`)

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.append(key, value)
    }
  })

  return url.toString()
}

const parseBody = async (response) => {
  if (response.status === 204) return null

  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json')
    ? response.json()
    : response.text()
}

/**
 * Perform a request against the configured API.
 *
 * @param {string} endpoint Path relative to the API base URL, e.g. `/policies`.
 * @param {object} [options]
 * @param {string} [options.method] HTTP verb.
 * @param {object} [options.body] JSON-serialisable payload.
 * @param {object} [options.params] Query-string parameters.
 * @param {object} [options.headers] Extra headers.
 * @param {AbortSignal} [options.signal] Caller-controlled cancellation.
 * @returns {Promise<unknown>} Parsed response body.
 */
export const request = async (
  endpoint,
  { method = HTTP_METHODS.GET, body, params, headers, signal } = {},
) => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), config.apiTimeout)

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(buildUrl(endpoint, params), {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })

    const data = await parseBody(response)

    if (!response.ok) {
      // FastAPI reports validation and business errors under `detail`.
      const message =
        (data && (data.detail || data.message)) ||
        `Request failed with status ${response.status}`
      throw new ApiError(message, { status: response.status, data })
    }

    return data
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error.name === 'AbortError') {
      throw new ApiError('The request timed out.', { status: 408 })
    }
    throw new ApiError(error.message || 'Network request failed.')
  } finally {
    clearTimeout(timeoutId)
  }
}

export const apiClient = {
  get: (endpoint, options) =>
    request(endpoint, { ...options, method: HTTP_METHODS.GET }),
  post: (endpoint, body, options) =>
    request(endpoint, { ...options, method: HTTP_METHODS.POST, body }),
  put: (endpoint, body, options) =>
    request(endpoint, { ...options, method: HTTP_METHODS.PUT, body }),
  patch: (endpoint, body, options) =>
    request(endpoint, { ...options, method: HTTP_METHODS.PATCH, body }),
  delete: (endpoint, options) =>
    request(endpoint, { ...options, method: HTTP_METHODS.DELETE }),
}

export default apiClient
