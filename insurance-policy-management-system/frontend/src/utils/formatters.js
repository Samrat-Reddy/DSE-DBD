/**
 * Generic display formatters. Keep these free of business rules so any
 * feature module can reuse them.
 */

export const formatCurrency = (value, currency = 'INR', locale = 'en-IN') => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '—'
  }

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(value))
}

/**
 * Abbreviated currency for dense layouts (cards, table cells).
 * Uses the Indian lakh/crore convention, which is what the mock data reflects.
 */
export const formatCompactCurrency = (value, currency = 'INR') => {
  const numeric = Number(value)
  if (value === null || value === undefined || Number.isNaN(numeric)) return '—'

  const symbol = currency === 'INR' ? '₹' : ''
  const abs = Math.abs(numeric)

  const trim = (amount) =>
    Number(amount.toFixed(2)).toLocaleString('en-IN', {
      maximumFractionDigits: 2,
    })

  if (abs >= 10000000) return `${symbol}${trim(numeric / 10000000)} Cr`
  if (abs >= 100000) return `${symbol}${trim(numeric / 100000)} L`

  return formatCurrency(numeric, currency)
}

export const formatDate = (value, locale = 'en-IN') => {
  if (!value) return '—'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

/** Date and time of an ISO timestamp, in the viewer's local timezone. */
export const formatDateTime = (value, locale = 'en-IN') => {
  if (!value) return '—'

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Duration in whole years, correctly pluralised. */
export const formatDuration = (years) => {
  const numeric = Number(years)
  if (!numeric || Number.isNaN(numeric)) return '—'
  return `${numeric} ${numeric === 1 ? 'year' : 'years'}`
}

/** Format a 10-digit Indian mobile number as `+91 98450 12377`. */
export const formatPhone = (value) => {
  if (!value) return '—'

  const digits = String(value).replace(/\D/g, '').slice(-10)
  if (digits.length !== 10) return String(value)

  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
}

/** Join an address object into displayable lines, skipping blanks. */
export const formatAddressLines = (address) => {
  if (!address) return []

  const { line1, line2, city, state, postalCode } = address
  const cityLine = [city, state].filter(Boolean).join(', ')
  const finalLine = [cityLine, postalCode].filter(Boolean).join(' - ')

  return [line1, line2, finalLine].filter(Boolean)
}

export const titleCase = (value) =>
  typeof value === 'string'
    ? value
        .toLowerCase()
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    : ''
