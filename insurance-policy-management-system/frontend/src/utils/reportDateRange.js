/**
 * MIS Reports — reporting periods (pure).
 *
 * A reporting period is resolved to an inclusive `[from, to]` pair of ISO
 * dates. Both ends are INCLUSIVE: a record dated exactly on `from` or exactly
 * on `to` is inside the period.
 *
 * Nothing here reads the clock: `today` is always passed in, so a resolved
 * range is deterministic and testable. `all-time` needs the earliest dated
 * record in the data set, which the caller supplies.
 *
 * Records with no usable date are never guessed at — `partitionByDate` returns
 * them separately so a report can say how many rows it had to leave out.
 */

import { REPORT_PERIODS } from './constants'
import { addDaysIso, addMonthsIso, daysBetween, isValidIsoDate } from './dateUtils'
import { formatDate } from './formatters'

export const RANGE_ERROR_CODES = {
  INVALID_DATE: 'invalid-date',
  RANGE_REVERSED: 'range-reversed',
  FUTURE_DATE: 'future-date',
  NO_DATA: 'no-dated-records',
}

const firstOfMonth = (iso) => `${iso.slice(0, 7)}-01`

const invalid = (code, message) => ({ valid: false, code, message, from: null, to: null })

/** The earliest valid ISO date in a list, or `null`. */
export const earliestDate = (dates = []) =>
  dates.filter(isValidIsoDate).sort((a, b) => a.localeCompare(b))[0] ?? null

/**
 * Resolve a period selection to an inclusive range.
 *
 * @param {{period: string, from?: string, to?: string, today: string, earliest?: string|null}} input
 * @returns {{valid: boolean, periodId: string, label: string, from: string|null,
 *            to: string|null, inclusiveEnd: true, code?: string, message?: string}}
 */
export const resolveReportPeriod = ({ period, from, to, today, earliest = null } = {}) => {
  const base = { periodId: period, inclusiveEnd: true }

  if (!isValidIsoDate(today)) {
    return { ...base, ...invalid(RANGE_ERROR_CODES.INVALID_DATE, 'The current date could not be determined.') }
  }

  const ok = (start, end, label) => ({ ...base, valid: true, from: start, to: end, label, code: null, message: null })

  switch (period) {
    case REPORT_PERIODS.TODAY:
      return ok(today, today, 'Today')

    case REPORT_PERIODS.LAST_7:
      return ok(addDaysIso(today, -6), today, 'Last 7 days')

    case REPORT_PERIODS.LAST_30:
      return ok(addDaysIso(today, -29), today, 'Last 30 days')

    case REPORT_PERIODS.THIS_MONTH:
      // Period to date: a report never counts days that have not happened.
      return ok(firstOfMonth(today), today, 'Current month to date')

    case REPORT_PERIODS.LAST_MONTH: {
      const start = firstOfMonth(addMonthsIso(firstOfMonth(today), -1))
      return ok(start, addDaysIso(firstOfMonth(today), -1), 'Previous month')
    }

    case REPORT_PERIODS.CUSTOM: {
      if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
        return { ...base, ...invalid(RANGE_ERROR_CODES.INVALID_DATE, 'Enter a valid start and end date for the custom range.') }
      }
      if (daysBetween(from, to) < 0) {
        return { ...base, ...invalid(RANGE_ERROR_CODES.RANGE_REVERSED, 'The end date is before the start date.') }
      }
      if (daysBetween(today, from) > 0 || daysBetween(today, to) > 0) {
        return {
          ...base,
          ...invalid(RANGE_ERROR_CODES.FUTURE_DATE, `A reporting period cannot end after today (${formatDate(today)}).`),
        }
      }
      return ok(from, to, `${formatDate(from)} – ${formatDate(to)}`)
    }

    case REPORT_PERIODS.ALL_TIME:
    default: {
      if (!earliest) {
        // No dated record exists yet: an empty but valid range ending today.
        return { ...ok(today, today, 'All time'), periodId: REPORT_PERIODS.ALL_TIME, code: RANGE_ERROR_CODES.NO_DATA }
      }
      return { ...ok(earliest, today, 'All time'), periodId: REPORT_PERIODS.ALL_TIME }
    }
  }
}

/** Is an ISO date inside an inclusive range? `null`/invalid dates are never inside. */
export const isWithinRange = (date, range) => {
  if (!range?.valid || !isValidIsoDate(date)) return false
  return daysBetween(range.from, date) >= 0 && daysBetween(date, range.to) >= 0
}

/**
 * Split rows into those dated inside the range and those with no usable date,
 * so a report can report the exclusion instead of silently dropping rows.
 *
 * @param {object[]} rows
 * @param {(row: object) => string|null} getDate
 * @param {object} range
 */
export const partitionByDate = (rows = [], getDate, range) => {
  const inRange = []
  const outOfRange = []
  const undated = []

  for (const row of rows) {
    const date = getDate(row)
    if (!isValidIsoDate(date)) undated.push(row)
    else if (isWithinRange(date, range)) inRange.push(row)
    else outOfRange.push(row)
  }

  return { inRange, outOfRange, undated }
}

/** "01 Jan 2024 – 16 Sept 2026 (both dates included)". */
export const describeRange = (range) =>
  range?.valid ? `${formatDate(range.from)} – ${formatDate(range.to)} (both dates included)` : 'No valid reporting period'

/** Days covered by an inclusive range. */
export const rangeLengthInDays = (range) => (range?.valid ? daysBetween(range.from, range.to) + 1 : 0)
