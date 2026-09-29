import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Run an async service call and expose `{ data, status, error, reload }`.
 *
 * Centralising this keeps loading/error handling identical across pages and
 * stops every page from re-implementing the same useEffect dance.
 *
 * The settled result is stored against the request key that produced it, so
 * "loading" is derived rather than assigned. That keeps state updates inside
 * the async callbacks and avoids the cascading renders that a synchronous
 * setState in an effect body would cause.
 *
 * @param {Function} asyncFn Service function to invoke.
 * @param {Array} deps Values that should trigger a refetch when they change.
 * @param {{enabled?: boolean}} [options]
 */
export const useAsync = (asyncFn, deps = [], options = {}) => {
  const { enabled = true } = options

  const [reloadToken, setReloadToken] = useState(0)
  const [settled, setSettled] = useState({
    key: null,
    status: 'idle',
    data: null,
    error: null,
  })

  /**
   * Identifies the current request; a settled result only counts if it
   * matches. Serialising by value (rather than memoising on a spread array)
   * keeps the key stable across renders even though `deps` is a fresh array
   * each time. Callers pass primitive deps.
   */
  const requestKey = JSON.stringify([deps, reloadToken])

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!enabled) return undefined

    let cancelled = false

    asyncFn()
      .then((result) => {
        if (cancelled || !isMountedRef.current) return
        setSettled({ key: requestKey, status: 'success', data: result, error: null })
      })
      .catch((caught) => {
        if (cancelled || !isMountedRef.current) return
        setSettled({ key: requestKey, status: 'error', data: null, error: caught })
      })

    return () => {
      cancelled = true
    }
    // `asyncFn` is intentionally excluded: callers pass an inline closure, and
    // `requestKey` already encodes everything that changes the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, enabled])

  const reload = useCallback(() => setReloadToken((token) => token + 1), [])

  const isCurrent = settled.key === requestKey
  const status = !enabled ? 'idle' : isCurrent ? settled.status : 'loading'

  return {
    data: isCurrent ? settled.data : null,
    error: isCurrent ? settled.error : null,
    status,
    isLoading: status === 'loading',
    isError: status === 'error',
    isSuccess: status === 'success',
    reload,
  }
}

export default useAsync
