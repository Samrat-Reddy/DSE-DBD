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
import { PaymentHistoryList } from '../components/premium'
import { getPayments } from '../services/premiumService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  DEFAULT_PAYMENT_QUERY,
  PAYMENT_METHOD_OPTIONS,
  PAYMENT_SORT_OPTIONS,
  PAYMENT_STATUS_OPTIONS,
  ROUTES,
} from '../utils/constants'
import { formatCurrency } from '../utils/formatters'
import './Premiums.css'

const SEARCH_FIELD = {
  name: 'search',
  label: 'Search',
  placeholder: 'Payment ID, policy, transaction reference or policyholder',
}

const SELECT_FIELDS = [
  {
    name: 'status',
    label: 'Status',
    options: [{ value: 'all', label: 'All statuses' }, ...PAYMENT_STATUS_OPTIONS],
  },
  {
    name: 'method',
    label: 'Method',
    options: [
      { value: 'all', label: 'All methods' },
      ...PAYMENT_METHOD_OPTIONS.map(({ value, label }) => ({ value, label })),
    ],
  },
  { name: 'sort', label: 'Sort by', options: PAYMENT_SORT_OPTIONS },
]

/** Every payment attempt in the signed-in account's scope, searchable and filterable. */
const PaymentHistory = () => {
  const { role } = useDemoRole()
  const [query, setQuery] = useState(DEFAULT_PAYMENT_QUERY)
  const debouncedSearch = useDebouncedValue(query.search, 300)

  // Keyed on the role: each demo role signs in as a different account and scope.
  const payments = useAsync(
    () => getPayments({ ...query, search: debouncedSearch }),
    [debouncedSearch, query.status, query.method, query.sort, role],
  )

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_PAYMENT_QUERY.search ||
      query.status !== DEFAULT_PAYMENT_QUERY.status ||
      query.method !== DEFAULT_PAYMENT_QUERY.method,
    [query],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_PAYMENT_QUERY), [])

  const items = payments.data?.items ?? []
  const summary = payments.data?.summary

  const renderList = () => {
    if (payments.isLoading) {
      return <LoadingState label="Loading payment history" variant="rows" rows={5} />
    }

    if (payments.isError) {
      return (
        <ErrorState
          title="Unable to load payment history"
          error={payments.error}
          onRetry={payments.reload}
        />
      )
    }

    if (!items.length) {
      return (
        <EmptyState
          icon="▤"
          title={isFiltered ? 'No payments match your filters' : 'No payments recorded yet'}
          description={
            isFiltered
              ? 'Try a different payment ID, policy or reference, or clear the filters.'
              : 'Payments recorded against premium instalments will appear here.'
          }
          action={
            isFiltered ? (
              <Button variant="secondary" onClick={handleReset}>
                Clear filters
              </Button>
            ) : (
              <Button variant="secondary" to={ROUTES.PREMIUMS}>
                View premium accounts
              </Button>
            )
          }
        />
      )
    }

    return <PaymentHistoryList payments={items} />
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Premiums & payments', to: ROUTES.PREMIUMS },
          { label: 'Payment history' },
        ]}
        eyebrow="Module 2 · Premium Schedule & Payments"
        title="Payment history"
        description="Every payment attempt recorded against a premium instalment."
      />

      {summary && (
        <div className="premiums__summary">
          <StatGrid
            columns={4}
            items={[
              {
                id: 'collected',
                tone: 'paid',
                label: 'Collected',
                value: formatCurrency(summary.collected),
                detail: 'From successful payments',
              },
              {
                id: 'success',
                tone: 'paid',
                label: 'Successful',
                value: summary.success,
                detail: 'Payment records',
              },
              {
                id: 'failed',
                tone: summary.failed > 0 ? 'overdue' : 'neutral',
                label: 'Failed',
                value: summary.failed,
                detail: 'Did not mark an instalment paid',
              },
              {
                id: 'pending',
                tone: 'due',
                label: 'Pending',
                value: summary.pending,
                detail: 'Awaiting confirmation',
              },
            ]}
          />
        </div>
      )}

      <FilterBar
        label="Filter payment history"
        query={query}
        onChange={setQuery}
        onReset={handleReset}
        searchField={SEARCH_FIELD}
        selectFields={SELECT_FIELDS}
        resultCount={payments.isLoading ? null : items.length}
        resultNoun={['payment', 'payments']}
        isFiltered={isFiltered}
        disabled={payments.isError}
      />

      {renderList()}
    </>
  )
}

export default PaymentHistory
