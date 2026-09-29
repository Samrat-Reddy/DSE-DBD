/**
 * Pure search / filter / sort helpers for renewal accounts.
 *
 * Applied by `renewalService`, mirroring the Module 1–3 query utilities.
 */

import { RENEWAL_STATUS } from './constants'

const normalise = (value) => String(value ?? '').toLowerCase().trim()
const isAll = (value) => !value || value === 'all'

/** Most urgent first; used by the "renewal status" sort. */
const STATUS_URGENCY = [
  RENEWAL_STATUS.EXPIRING_TODAY,
  RENEWAL_STATUS.DUE,
  RENEWAL_STATUS.DUE_SOON,
  RENEWAL_STATUS.UPCOMING,
  RENEWAL_STATUS.EXPIRED,
  RENEWAL_STATUS.NOT_DUE,
  RENEWAL_STATUS.UNKNOWN,
]

/** Search policy ID, policyholder, customer ID and product. */
export const matchesRenewalSearch = (row, term) => {
  const query = normalise(term)
  if (!query) return true
  return [row.policyId, row.policy?.policyholderName, row.policy?.customerId, row.policy?.productName].some((field) =>
    normalise(field).includes(query),
  )
}

/** `none` matches accounts with no current reminder stage. */
export const matchesStage = (row, stage) => {
  if (isAll(stage)) return true
  if (stage === 'none') return row.currentStageId === null
  return row.currentStageId === stage
}

/** `none` matches accounts with no premium schedule. */
export const matchesPremium = (row, premium) => {
  if (isAll(premium)) return true
  if (premium === 'none') return row.premiumStanding === null
  return row.premiumStanding === premium
}

/** Unknown expiries sort last in date and day orderings. */
const nullsLast = (a, b, compare) => {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return compare(a, b)
}

const SORTS = {
  'expiry-asc': (a, b) =>
    nullsLast(a.daysUntilExpiry, b.daysUntilExpiry, (x, y) => x - y) || a.policyId.localeCompare(b.policyId),
  'days-asc': (a, b) => {
    // Days remaining for policies not yet expired, then expired ones.
    const rank = (row) => (row.daysUntilExpiry === null ? null : row.daysUntilExpiry < 0 ? 1e9 - row.daysUntilExpiry : row.daysUntilExpiry)
    return nullsLast(rank(a), rank(b), (x, y) => x - y) || a.policyId.localeCompare(b.policyId)
  },
  status: (a, b) =>
    STATUS_URGENCY.indexOf(a.status) - STATUS_URGENCY.indexOf(b.status) ||
    nullsLast(a.daysUntilExpiry, b.daysUntilExpiry, (x, y) => x - y),
  'policyholder-asc': (a, b) =>
    normalise(a.policy?.policyholderName).localeCompare(normalise(b.policy?.policyholderName)),
}

export const queryRenewals = (rows, query = {}) => {
  const { search, status, stage, premium, sort } = query
  const filtered = rows.filter(
    (row) =>
      matchesRenewalSearch(row, search) &&
      (isAll(status) || row.status === status) &&
      matchesStage(row, stage) &&
      matchesPremium(row, premium),
  )
  const comparator = SORTS[sort]
  return comparator ? [...filtered].sort(comparator) : filtered
}
