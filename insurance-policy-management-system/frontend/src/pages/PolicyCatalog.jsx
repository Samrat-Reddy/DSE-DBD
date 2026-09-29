import { useCallback, useMemo, useRef, useState } from 'react'
import { PageHeader, Button, EmptyState, ErrorState, LoadingState } from '../components/common'
import { PolicyCard, PolicyFilters, IssuedPolicyList } from '../components/policy'
import { getIssuedPolicies, getPolicyProducts } from '../services/policyService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  buildIssuancePath,
  DEFAULT_CATALOG_QUERY,
  ROLES,
} from '../utils/constants'
import './PolicyCatalog.css'

const TABS = [
  { id: 'catalog', label: 'Product catalog' },
  { id: 'issued', label: 'Issued policies' },
]

/**
 * Module 1 landing screen.
 *
 * Two views share this page: the product catalog a user browses, and the
 * register of issued policies used to open a policy record (including one
 * just created by the issuance workflow).
 */
const PolicyCatalog = () => {
  const { role, canIssuePolicy } = useDemoRole()
  const [activeTab, setActiveTab] = useState('catalog')
  const [query, setQuery] = useState(DEFAULT_CATALOG_QUERY)

  // Debounced so typing does not hit the service layer on every keystroke.
  const debouncedSearch = useDebouncedValue(query.search, 300)

  const effectiveQuery = useMemo(
    () => ({ ...query, search: debouncedSearch }),
    [query, debouncedSearch],
  )

  const products = useAsync(
    () => getPolicyProducts(effectiveQuery),
    [debouncedSearch, query.type, query.status, query.sort],
  )

  // Keyed on the role: switching demo role signs in as a different account,
  // which sees a different set of policies.
  const policies = useAsync(() => getIssuedPolicies(), [role], {
    enabled: activeTab === 'issued',
  })

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_CATALOG_QUERY.search ||
      query.type !== DEFAULT_CATALOG_QUERY.type ||
      query.status !== DEFAULT_CATALOG_QUERY.status,
    [query],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_CATALOG_QUERY), [])

  const tabRefs = useRef([])

  /**
   * Arrow-key navigation, as the ARIA tabs pattern requires. Without this the
   * tablist roles would promise keyboard behaviour the page does not deliver.
   */
  const handleTabKeyDown = useCallback((event) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === event.currentTarget.id.replace('tab-', ''))
    let nextIndex = null

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = TABS.length - 1

    if (nextIndex === null) return

    event.preventDefault()
    setActiveTab(TABS[nextIndex].id)
    tabRefs.current[nextIndex]?.focus()
  }, [])

  const summary = products.data?.summary
  const items = products.data?.items ?? []

  const renderCatalog = () => {
    if (products.isLoading) {
      return <LoadingState label="Loading policy products" rows={6} />
    }

    if (products.isError) {
      return (
        <ErrorState
          title="Unable to load the policy catalog"
          error={products.error}
          onRetry={products.reload}
        />
      )
    }

    if (!items.length) {
      return (
        <EmptyState
          icon="⌕"
          title="No policy products match your search"
          description={
            isFiltered
              ? 'Try a different product name or ID, or clear the filters to see the full catalog.'
              : 'There are no policy products in the catalog yet.'
          }
          action={
            isFiltered ? (
              <Button variant="secondary" onClick={handleReset}>
                Clear filters
              </Button>
            ) : null
          }
        />
      )
    }

    return (
      <div className="catalog__grid">
        {items.map((product) => (
          <PolicyCard
            key={product.id}
            product={product}
            canIssue={canIssuePolicy}
          />
        ))}
      </div>
    )
  }

  const renderIssued = () => {
    if (policies.isLoading) {
      return <LoadingState label="Loading issued policies" variant="rows" rows={5} />
    }

    if (policies.isError) {
      return (
        <ErrorState
          title="Unable to load issued policies"
          error={policies.error}
          onRetry={policies.reload}
        />
      )
    }

    const issued = policies.data?.items ?? []

    if (!issued.length) {
      return (
        <EmptyState
          icon="▤"
          title="No policies have been issued yet"
          description="Issue a policy from the catalog and it will appear in this register."
          action={
            canIssuePolicy ? (
              <Button to={buildIssuancePath()}>Start issuance</Button>
            ) : null
          }
        />
      )
    }

    return (
      <div className="catalog__panel">
        <IssuedPolicyList policies={issued} />
      </div>
    )
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 1 · Policy Catalog & Issuance"
        title="Policy catalog"
        description="Browse the available insurance products, review their coverage, and issue a policy against an active product."
        meta={
          summary ? (
            <>
              <span>
                <strong>{summary.total}</strong> products
              </span>
              <span>
                <strong>{summary.active ?? 0}</strong> active
              </span>
              <span>
                <strong>{summary.inactive ?? 0}</strong> inactive
              </span>
            </>
          ) : null
        }
        actions={
          canIssuePolicy ? (
            <Button to={buildIssuancePath()}>Issue a policy</Button>
          ) : null
        }
      />

      {role === ROLES.POLICYHOLDER && (
        <p className="catalog__role-note">
          You are viewing this as a <strong>policyholder</strong>. Issuance
          actions are available to agents and administrators.
        </p>
      )}

      <div className="catalog__tabs" role="tablist" aria-label="Policy views">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            ref={(element) => {
              tabRefs.current[index] = element
            }}
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            // Roving tabindex: only the selected tab is in the tab order.
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`catalog__tab${activeTab === tab.id ? ' catalog__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={handleTabKeyDown}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'catalog' ? (
        <div role="tabpanel" id="panel-catalog" aria-labelledby="tab-catalog" tabIndex={-1}>
          <PolicyFilters
            query={query}
            onChange={setQuery}
            onReset={handleReset}
            resultCount={products.isLoading ? null : items.length}
            isFiltered={isFiltered}
            disabled={products.isError}
          />
          {renderCatalog()}
        </div>
      ) : (
        <div role="tabpanel" id="panel-issued" aria-labelledby="tab-issued" tabIndex={-1}>
          {renderIssued()}
        </div>
      )}
    </>
  )
}

export default PolicyCatalog
