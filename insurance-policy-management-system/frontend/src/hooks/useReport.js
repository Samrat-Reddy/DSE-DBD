import { useCallback, useMemo, useState } from 'react'
import { useAsync } from './useAsync'
import { useDebouncedValue } from './useDebouncedValue'
import { DEFAULT_REPORT_QUERY, REPORT_SORT_DIRECTIONS } from '../utils/constants'

/**
 * Query state for one MIS report: period, filters, search and sort, plus the
 * service call that produces the report.
 *
 * Every report page uses this, so a filter always reaches the report service
 * — no page filters rows on its own, and no page calculates a figure.
 *
 * @param {(actor: object, query: object) => Promise<object>} loader report service function
 * @param {{role: string, enabled?: boolean, defaults?: object}} options
 */
export const useReport = (loader, { role, enabled = true, defaults } = {}) => {
  const [query, setQuery] = useState({ ...DEFAULT_REPORT_QUERY, ...defaults })
  const debouncedSearch = useDebouncedValue(query.search, 300)
  const actor = useMemo(() => ({ role }), [role])

  const report = useAsync(
    () => loader(actor, { ...query, search: debouncedSearch }),
    [
      role,
      query.period,
      query.from,
      query.to,
      query.product,
      query.status,
      query.agentId,
      query.sort,
      query.direction,
      debouncedSearch,
    ],
    { enabled },
  )

  const reset = useCallback(() => setQuery({ ...DEFAULT_REPORT_QUERY, ...defaults }), [defaults])

  /** Clicking a column sorts by it, and clicking it again reverses the order. */
  const sortBy = useCallback(
    (key) =>
      setQuery((current) => ({
        ...current,
        sort: key,
        direction:
          current.sort === key && current.direction === REPORT_SORT_DIRECTIONS.DESC
            ? REPORT_SORT_DIRECTIONS.ASC
            : REPORT_SORT_DIRECTIONS.DESC,
      })),
    [],
  )

  const isFiltered = useMemo(() => {
    const base = { ...DEFAULT_REPORT_QUERY, ...defaults }
    return ['period', 'from', 'to', 'product', 'status', 'agentId', 'search'].some((key) => query[key] !== base[key])
  }, [query, defaults])

  return { query, setQuery, reset, sortBy, isFiltered, report }
}

export default useReport
