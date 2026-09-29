/**
 * Calendar-date helpers for `YYYY-MM-DD` strings.
 *
 * Premium schedules deal in calendar dates, not instants. All arithmetic runs
 * in UTC on the date components so results never shift by a day because of
 * the viewer's timezone (a real risk in IST, which is UTC+05:30).
 */

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 24 * 60 * 60 * 1000

const pad = (value) => String(value).padStart(2, '0')

/** Parse an ISO date to a UTC timestamp, or `null` if it is not a real date. */
export const parseIsoDate = (iso) => {
  if (typeof iso !== 'string' || !ISO_DATE_PATTERN.test(iso)) return null

  const [year, month, day] = iso.split('-').map(Number)
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)

  // Reject rollovers such as 2026-02-31 becoming 3 March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return timestamp
}

export const isValidIsoDate = (iso) => parseIsoDate(iso) !== null

const fromUtcTimestamp = (timestamp) => {
  const date = new Date(timestamp)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/** Convert a local `Date` to its local calendar date. */
export const toIsoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/** Today's calendar date in the viewer's local timezone. */
export const todayIso = () => toIsoDate(new Date())

export const addDaysIso = (iso, days) => {
  const timestamp = parseIsoDate(iso)
  if (timestamp === null) return null
  return fromUtcTimestamp(timestamp + days * MS_PER_DAY)
}

/**
 * Add whole months, clamping to the end of the target month.
 * 31 Jan + 1 month = 28/29 Feb, never 2/3 March.
 */
export const addMonthsIso = (iso, months) => {
  const timestamp = parseIsoDate(iso)
  if (timestamp === null) return null

  const start = new Date(timestamp)
  const targetMonthIndex = start.getUTCMonth() + months
  const targetYear = start.getUTCFullYear() + Math.floor(targetMonthIndex / 12)
  const normalisedMonth = ((targetMonthIndex % 12) + 12) % 12
  const lastDayOfTarget = new Date(Date.UTC(targetYear, normalisedMonth + 1, 0)).getUTCDate()
  const day = Math.min(start.getUTCDate(), lastDayOfTarget)

  return fromUtcTimestamp(Date.UTC(targetYear, normalisedMonth, day))
}

/** Whole days from `fromIso` to `toIso` (negative when `toIso` is earlier). */
export const daysBetween = (fromIso, toIso) => {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (from === null || to === null) return null
  return Math.round((to - from) / MS_PER_DAY)
}

/** Lexical comparison is correct for zero-padded ISO dates. */
export const compareIsoDates = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
