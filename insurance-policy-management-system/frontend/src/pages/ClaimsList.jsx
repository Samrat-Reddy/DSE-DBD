import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  StatGrid,
} from '../components/common'
import { ClaimList } from '../components/claims'
import { getClaims } from '../services/claimService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  buildClaimFilingPath,
  CLAIM_SORT_OPTIONS,
  CLAIM_STATUS_OPTIONS,
  DEFAULT_CLAIM_QUERY,
  ROLES,
} from '../utils/constants'
import './Claims.css'

const SEARCH_FIELD = {
  name: 'search',
  label: 'Search',
  placeholder: 'Claim ID, policy, policyholder or claim type',
}

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/** Module 3 landing page — the claims register. */
const ClaimsList = () => {
  const { role, canFileClaim } = useDemoRole()
  const [query, setQuery] = useState(DEFAULT_CLAIM_QUERY)
  const debouncedSearch = useDebouncedValue(query.search, 300)

  // Summary is loaded once so headline counts stay put while filtering.
  const overview = useAsync(() => getClaims(), [])
  const claims = useAsync(
    () => getClaims({ ...query, search: debouncedSearch }),
    [debouncedSearch, query.status, query.claimType, query.sort],
  )

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_CLAIM_QUERY.search ||
      query.status !== DEFAULT_CLAIM_QUERY.status ||
      query.claimType !== DEFAULT_CLAIM_QUERY.claimType,
    [query],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_CLAIM_QUERY), [])

  const selectFields = useMemo(
    () => [
      { name: 'status', label: 'Status', options: [{ value: 'all', label: 'All statuses' }, ...CLAIM_STATUS_OPTIONS] },
      {
        name: 'claimType',
        label: 'Claim type',
        options: [{ value: 'all', label: 'All claim types' }, ...(overview.data?.claimTypeOptions ?? [])],
      },
      { name: 'sort', label: 'Sort by', options: CLAIM_SORT_OPTIONS },
    ],
    [overview.data],
  )

  const items = claims.data?.items ?? []

  const renderSummary = () => {
    if (overview.isLoading) return <LoadingState label="Loading claim summary" variant="rows" rows={2} />
    if (overview.isError) {
      return <ErrorState title="Unable to load the claim summary" error={overview.error} onRetry={overview.reload} />
    }

    const summary = overview.data.summary
    return (
      <section className="claims__summary" aria-labelledby="claims-summary-heading">
        <h2 id="claims-summary-heading" className="claims__section-title">
          Claim position
        </h2>
        <StatGrid
          columns={6}
          items={[
            {
              id: 'total',
              tone: 'primary',
              label: 'Total claims',
              value: summary.total,
              detail: `${summary.open} open · ${summary.cancelled} withdrawn`,
            },
            { id: 'submitted', tone: 'upcoming', label: 'Submitted', value: summary.submitted, detail: 'Awaiting review' },
            {
              id: 'under-review',
              tone: 'due',
              label: 'Under review',
              value: summary.underReview,
              detail: `Plus ${summary.verified} verified, ${summary.assessed} assessed`,
            },
            { id: 'approved', tone: 'paid', label: 'Approved', value: summary.approved, detail: 'Awaiting settlement' },
            { id: 'rejected', tone: summary.rejected ? 'overdue' : 'neutral', label: 'Rejected', value: summary.rejected, detail: 'Closed' },
            { id: 'settled', tone: 'paid', label: 'Settled', value: summary.settled, detail: 'Closed' },
          ]}
        />
      </section>
    )
  }

  const renderClaims = () => {
    if (claims.isLoading) return <LoadingState label="Loading claims" variant="rows" rows={5} />
    if (claims.isError) {
      return <ErrorState title="Unable to load claims" error={claims.error} onRetry={claims.reload} />
    }
    if (!items.length) {
      return (
        <EmptyState
          icon="⌕"
          title={isFiltered ? 'No claims match your filters' : 'No claims yet'}
          description={
            isFiltered
              ? 'Try a different claim ID, policy, policyholder or claim type, or clear the filters.'
              : 'Claims filed against issued policies will appear here.'
          }
          action={
            isFiltered ? (
              <Button variant="secondary" onClick={handleReset}>
                Clear filters
              </Button>
            ) : canFileClaim ? (
              <Button to={buildClaimFilingPath()}>File a claim</Button>
            ) : null
          }
        />
      )
    }
    return <ClaimList claims={items} />
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 3 · Claim Filing & Approval Workflow"
        title="Claims"
        description="File claims against issued policies and follow each claim through review, assessment, decision and settlement."
        actions={canFileClaim ? <Button to={buildClaimFilingPath()}>File a claim</Button> : null}
      />

      {role === ROLES.POLICYHOLDER && (
        <p className="claims__role-note">
          <strong>Policyholder view.</strong> Without sign-in, every demo claim is shown. In a live system you would
          see only claims on your own policies.
        </p>
      )}
      {role === ROLES.AGENT && (
        <p className="claims__role-note">
          <strong>Agent view.</strong> You can file claims on a policyholder&apos;s behalf and follow their progress.
          Review and decisions are made by claims officers.
        </p>
      )}
      {role === ROLES.ADMINISTRATOR && (
        <p className="claims__role-note">
          <strong>Claims officer view.</strong> Open a claim to review, verify, assess, decide and record settlement.
          Claims officers do not file claims.
        </p>
      )}

      {renderSummary()}

      <h2 className="claims__section-title claims__section-title--spaced">Claims register</h2>

      <FilterBar
        label="Filter claims"
        query={query}
        onChange={setQuery}
        onReset={handleReset}
        searchField={SEARCH_FIELD}
        selectFields={selectFields}
        resultCount={claims.isLoading ? null : items.length}
        resultNoun={['claim', 'claims']}
        isFiltered={isFiltered}
        disabled={claims.isError}
      />

      {renderClaims()}

      {overview.data && (
        <p className="claims__footnote">
          {plural(overview.data.summary.total, 'claim')} in this demonstration. All claims, amounts and decisions are
          illustrative.
        </p>
      )}
    </>
  )
}

export default ClaimsList
