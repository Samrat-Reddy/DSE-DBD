/**
 * MIS Reports — filtering, searching and sorting of report rows (pure).
 *
 * Report rows are already-derived records handed over by the Module 1–5
 * services; nothing here re-derives a business figure. Filters are declared
 * per report, so a report only ever receives filters that make sense for it
 * (claim status filters claims, commission status filters commission).
 */

import { REPORT_SORT_DIRECTIONS } from './constants'

const normalise = (value) => String(value ?? '').toLowerCase().trim()
const isAll = (value) => !value || value === 'all'

/** Case-insensitive match across the named fields of a row. */
export const matchesSearch = (row, term, fields = []) => {
  const query = normalise(term)
  if (!query) return true
  return fields.some((field) => normalise(row[field]).includes(query))
}

/**
 * Apply a report's declared filters to its rows.
 *
 * @param {object[]} rows
 * @param {object} query           the report query (search, product, status, agentId…)
 * @param {{searchFields?: string[], filters?: Record<string, string>}} config
 *        `filters` maps a query key to the row field it filters on.
 */
export const filterReportRows = (rows = [], query = {}, config = {}) => {
  const { searchFields = [], filters = {} } = config

  return rows.filter((row) => {
    if (!matchesSearch(row, query.search, searchFields)) return false
    return Object.entries(filters).every(([queryKey, rowField]) => {
      const selected = query[queryKey]
      return isAll(selected) || String(row[rowField] ?? '') === String(selected)
    })
  })
}

const isEmpty = (value) => value === null || value === undefined || value === ''

const compareValues = (a, b, type) => {
  if (type === 'number' || type === 'currency') return Number(a) - Number(b)
  return String(a).localeCompare(String(b))
}

/**
 * Sort rows by a column. Unknown columns leave the order untouched, so a stale
 * sort key can never scramble a report. Rows with no value in the sort column
 * always sort last, in both directions, so "top by amount" never opens with a
 * row that has no amount. Ties break on the first column, so repeated reads
 * are identical.
 *
 * @param {object[]} rows
 * @param {{key: string, type?: string}[]} columns
 * @param {string} sortKey
 * @param {'asc'|'desc'} direction
 */
export const sortReportRows = (rows = [], columns = [], sortKey, direction = REPORT_SORT_DIRECTIONS.DESC) => {
  const column = columns.find((item) => item.key === sortKey)
  if (!column) return [...rows]

  const factor = direction === REPORT_SORT_DIRECTIONS.ASC ? 1 : -1
  const tieBreak = columns[0]?.key

  const compareSortColumn = (a, b) => {
    const left = a[column.key]
    const right = b[column.key]
    if (isEmpty(left) || isEmpty(right)) {
      if (isEmpty(left) && isEmpty(right)) return 0
      return isEmpty(left) ? 1 : -1
    }
    return factor * compareValues(left, right, column.type)
  }

  return [...rows].sort((a, b) => compareSortColumn(a, b) || compareValues(a[tieBreak] ?? '', b[tieBreak] ?? '', columns[0]?.type))
}

/** Cap the rendered rows, reporting how many were left out. */
export const boundRows = (rows = [], limit) =>
  rows.length > limit ? { rows: rows.slice(0, limit), truncated: rows.length - limit } : { rows, truncated: 0 }

/** Distinct `{ value, label }` options taken from the rows themselves. */
export const optionsFromRows = (rows = [], valueField, labelField = valueField) => {
  const seen = new Map()
  for (const row of rows) {
    const value = row[valueField]
    if (value && !seen.has(value)) seen.set(value, String(row[labelField] ?? value))
  }
  return [...seen.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}
