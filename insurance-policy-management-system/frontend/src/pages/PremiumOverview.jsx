import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
} from '../components/common'
import { PortfolioSummary, PremiumAccountList } from '../components/premium'
import { getPremiumSchedules } from '../services/premiumService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  DEFAULT_PREMIUM_QUERY,
  PAYMENT_STANDING_OPTIONS,
  PREMIUM_ACCOUNT_SORT_OPTIONS,
  ROLES,
  ROUTES,
} from '../utils/constants'
import './Premiums.css'

const SELECT_FIELDS = [
  {
    name: 'standing',
    label: 'Payment status',
    options: [{ value: 'all', label: 'All statuses' }, ...PAYMENT_STANDING_OPTIONS],
  },
  { name: 'sort', label: 'Sort by', options: PREMIUM_ACCOUNT_SORT_OPTIONS },
]

const SEARCH_FIELD = {
  name: 'search',
  label: 'Search',
  placeholder: 'Policy number, policyholder, customer ID or product',
}

/**
 * Module 2 landing page — the premium position across issued policies.
 *
 * The portfolio summary is loaded once and stays put while the list below is
 * searched and filtered, so the headline figures never flicker.
 */
const PremiumOverview = () => {
  const { role } = useDemoRole()
  const [query, setQuery] = useState(DEFAULT_PREMIUM_QUERY)
  const debouncedSearch = useDebouncedValue(query.search, 300)

  const portfolio = useAsync(() => getPremiumSchedules(), [])

  const accounts = useAsync(
    () => getPremiumSchedules({ ...query, search: debouncedSearch }),
    [debouncedSearch, query.standing, query.sort],
  )

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_PREMIUM_QUERY.search ||
      query.standing !== DEFAULT_PREMIUM_QUERY.standing,
    [query],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_PREMIUM_QUERY), [])

  const items = accounts.data?.items ?? []

  const renderSummary = () => {
    if (portfolio.isLoading) {
      return <LoadingState label="Loading premium position" variant="rows" rows={2} />
    }
    if (portfolio.isError) {
      return (
        <ErrorState
          title="Unable to load the premium position"
          error={portfolio.error}
          onRetry={portfolio.reload}
        />
      )
    }
    return <PortfolioSummary portfolio={portfolio.data.portfolio} asOf={portfolio.data.asOf} />
  }

  const renderAccounts = () => {
    if (accounts.isLoading) {
      return <LoadingState label="Loading premium accounts" variant="rows" rows={4} />
    }

    if (accounts.isError) {
      return (
        <ErrorState
          title="Unable to load premium accounts"
          error={accounts.error}
          onRetry={accounts.reload}
        />
      )
    }

    if (!items.length) {
      return (
        <EmptyState
          icon="⌕"
          title={isFiltered ? 'No policies match your search' : 'No premium schedules yet'}
          description={
            isFiltered
              ? 'Try a different policy number, policyholder or product, or clear the filters.'
              : 'Premium schedules appear here once a policy has been issued.'
          }
          action={
            isFiltered ? (
              <Button variant="secondary" onClick={handleReset}>
                Clear filters
              </Button>
            ) : (
              <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
                Go to policy catalog
              </Button>
            )
          }
        />
      )
    }

    return <PremiumAccountList accounts={items} />
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 2 · Premium Schedule & Payments"
        title="Premiums & payments"
        description="Track premium instalments across issued policies, identify overdue premium, and record mock payments."
        actions={
          <Button variant="secondary" to={ROUTES.PAYMENT_HISTORY}>
            Payment history
          </Button>
        }
      />

      {role === ROLES.POLICYHOLDER && (
        <p className="premiums__role-note">
          <strong>Policyholder view.</strong> Without sign-in, every demo policy is shown. In a
          live system a policyholder would see only their own policies.
        </p>
      )}
      {role === ROLES.AGENT && (
        <p className="premiums__role-note">
          <strong>Agent view is read-only.</strong> Switch the demo role to Policyholder or
          Administrator to record a mock payment.
        </p>
      )}

      {renderSummary()}

      <h2 className="premiums__section-title">Premium accounts</h2>

      <FilterBar
        label="Filter premium accounts"
        query={query}
        onChange={setQuery}
        onReset={handleReset}
        searchField={SEARCH_FIELD}
        selectFields={SELECT_FIELDS}
        resultCount={accounts.isLoading ? null : items.length}
        resultNoun={['policy', 'policies']}
        isFiltered={isFiltered}
        disabled={accounts.isError}
      />

      {renderAccounts()}

      {portfolio.data?.awaitingIssuance > 0 && (
        <p className="premiums__footnote">
          {portfolio.data.awaitingIssuance === 1
            ? '1 policy is awaiting issuance and has no premium schedule yet.'
            : `${portfolio.data.awaitingIssuance} policies are awaiting issuance and have no premium schedule yet.`}
          {' '}Schedules are created only for issued policies.
        </p>
      )}
    </>
  )
}

export default PremiumOverview
