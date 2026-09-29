/**
 * MIS Reports — CSV export (pure).
 *
 * Builds the CSV text for exactly the rows a report is currently showing:
 * same columns, same order, same filters. Numbers are written unformatted
 * (`1046.25`, not `₹1,046.25`) so a spreadsheet reads them as numbers, and
 * dates stay ISO. Values containing a comma, quote, newline or a leading
 * space are quoted per RFC 4180, with embedded quotes doubled.
 *
 * Nothing here touches the DOM — downloading is a separate browser utility.
 */

const NEEDS_QUOTING = /[",\r\n]/

/** One CSV field: `null`/`undefined` become empty, numbers stay numeric. */
export const toCsvValue = (value) => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  const text = String(value)
  const mustQuote = NEEDS_QUOTING.test(text) || text !== text.trim()
  return mustQuote ? `"${text.replaceAll('"', '""')}"` : text
}

/**
 * CSV text for a report table.
 *
 * @param {{columns: {key: string, label: string}[], rows: object[]}} table
 * @returns {string} header row plus one row per record, CRLF separated
 */
export const buildCsv = ({ columns = [], rows = [] } = {}) => {
  if (!columns.length) return ''

  const header = columns.map((column) => toCsvValue(column.label)).join(',')
  const body = rows.map((row) => columns.map((column) => toCsvValue(row[column.key])).join(','))

  return [header, ...body].join('\r\n')
}

/** `ipms-claims-report_2024-01-01_2026-09-16.csv` — deterministic for a given report and period. */
export const buildReportFilename = (reportId, range) => {
  const from = range?.from ?? 'start'
  const to = range?.to ?? 'today'
  return `ipms-${reportId}-report_${from}_${to}.csv`
}
