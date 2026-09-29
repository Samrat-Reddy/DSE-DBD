/**
 * Pure search / filter / sort / summary helpers for claims.
 *
 * Applied by `claimService`, mirroring `policyQuery` and `premiumQuery`, so
 * they can be replaced by FastAPI query parameters later.
 */

import { CLAIM_STATUS } from './constants'

const normalise = (value) => String(value ?? '').toLowerCase().trim()
const isAll = (value) => !value || value === 'all'

/** Search claim ID, policy ID, policyholder and claim type. */
export const matchesClaimSearch = (row, term) => {
  const query = normalise(term)
  if (!query) return true
  return [row.claimId, row.policyId, row.policyholderName, row.claimTypeLabel, row.claimType].some((field) =>
    normalise(field).includes(query),
  )
}

const CLAIM_SORTS = {
  'updated-desc': (a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)),
  'filed-desc': (a, b) => b.filingDate.localeCompare(a.filingDate) || b.claimId.localeCompare(a.claimId),
  'incident-desc': (a, b) => b.incidentDate.localeCompare(a.incidentDate) || b.claimId.localeCompare(a.claimId),
  'claimed-desc': (a, b) => b.claimedAmount - a.claimedAmount,
  'claim-asc': (a, b) => a.claimId.localeCompare(b.claimId),
}

export const queryClaims = (rows, query = {}) => {
  const { search, status, claimType, sort } = query
  const filtered = rows.filter(
    (row) =>
      matchesClaimSearch(row, search) &&
      (isAll(status) || row.status === status) &&
      (isAll(claimType) || row.claimType === claimType),
  )
  const comparator = CLAIM_SORTS[sort]
  return comparator ? [...filtered].sort(comparator) : filtered
}

/** Counts per status, plus open/closed totals. Always derived from records. */
export const summariseClaims = (claims) => {
  const count = (status) => claims.filter((claim) => claim.status === status).length
  const closed = [CLAIM_STATUS.SETTLED, CLAIM_STATUS.REJECTED, CLAIM_STATUS.CANCELLED]

  return {
    total: claims.length,
    draft: count(CLAIM_STATUS.DRAFT),
    submitted: count(CLAIM_STATUS.SUBMITTED),
    underReview: count(CLAIM_STATUS.UNDER_REVIEW),
    verified: count(CLAIM_STATUS.VERIFIED),
    assessed: count(CLAIM_STATUS.ASSESSED),
    approved: count(CLAIM_STATUS.APPROVED),
    rejected: count(CLAIM_STATUS.REJECTED),
    settled: count(CLAIM_STATUS.SETTLED),
    cancelled: count(CLAIM_STATUS.CANCELLED),
    open: claims.filter((claim) => !closed.includes(claim.status)).length,
  }
}
