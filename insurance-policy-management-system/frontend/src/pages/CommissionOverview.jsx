import { useCallback, useMemo, useState } from 'react'
import {
  Button,
  EmptyState,
  ErrorState,
  FilterBar,
  LoadingState,
  PageHeader,
  SectionCard,
  StatGrid,
} from '../components/common'
import { MockNotice } from '../components/premium'
import {
  AwaitingCommissionPanel,
  CommissionList,
  CommissionRestricted,
  CommissionRulesTable,
} from '../components/commissions'
import {
  confirmEligibleEarnings,
  generateEligibleCommissions,
  getCommissionRules,
  getCommissions,
} from '../services/commissionService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  buildAgentCommissionPath,
  COMMISSION_SORT_OPTIONS,
  COMMISSION_STATUS_OPTIONS,
  DEFAULT_COMMISSION_QUERY,
  ROLES,
  ROUTES,
} from '../utils/constants'
import { describeEarningResult, describeGenerationResult } from '../utils/commissionFormat'
import { formatCurrency } from '../utils/formatters'
import './Commissions.css'

const SEARCH_FIELD = {
  name: 'search',
  label: 'Search',
  placeholder: 'Commission, agent, policy, policyholder, product or payment',
}

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/** Module 5 landing page — commission position, rules, awaiting payments and register. */
const CommissionOverview = () => {
  const { role, agentId, canViewCommissions, canManageCommissions } = useDemoRole()
  const [query, setQuery] = useState(DEFAULT_COMMISSION_QUERY)
  const debouncedSearch = useDebouncedValue(query.search, 300)

  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState(false)
  const [runResult, setRunResult] = useState(null)
  const [runError, setRunError] = useState(null)

  const actor = useMemo(() => ({ role, agentId }), [role, agentId])
  const enabled = canViewCommissions

  // Summary is loaded unfiltered so headline figures stay put while filtering.
  const overview = useAsync(() => getCommissions(actor), [role, agentId, version], { enabled })
  // The agent filter only exists for administrators; an agent always sees their own.
  const agentFilter = canManageCommissions ? query.agentId : 'all'
  const register = useAsync(
    () => getCommissions(actor, { ...query, agentId: agentFilter, search: debouncedSearch }),
    [role, agentId, debouncedSearch, query.status, agentFilter, query.sort, version],
    { enabled },
  )
  const rules = useAsync(() => getCommissionRules(actor), [role, agentId], { enabled })

  // Keep the last loaded overview on screen while a refresh is in flight.
  const [retained, setRetained] = useState(null)
  if (overview.data && overview.data !== retained) setRetained(overview.data)
  const overviewData = overview.data ?? (retained?.scope === (role === ROLES.ADMINISTRATOR ? 'all' : 'own') ? retained : null)

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_COMMISSION_QUERY.search ||
      query.status !== DEFAULT_COMMISSION_QUERY.status ||
      agentFilter !== DEFAULT_COMMISSION_QUERY.agentId,
    [query, agentFilter],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_COMMISSION_QUERY), [])

  const runBulk = useCallback(
    async (action, describe) => {
      setPending(true)
      setRunError(null)
      setRunResult(null)
      try {
        const result = await action({ role, agentId })
        setRunResult(describe(result))
        setVersion((value) => value + 1)
      } catch (error) {
        setRunError(error.message)
      } finally {
        setPending(false)
      }
    },
    [role, agentId],
  )

  const selectFields = useMemo(() => {
    const fields = [{ name: 'status', label: 'Status', options: [{ value: 'all', label: 'All statuses' }, ...COMMISSION_STATUS_OPTIONS] }]
    if (canManageCommissions) {
      fields.push({ name: 'agentId', label: 'Agent', options: [{ value: 'all', label: 'All agents' }, ...(overviewData?.agentOptions ?? [])] })
    }
    fields.push({ name: 'sort', label: 'Sort by', options: COMMISSION_SORT_OPTIONS })
    return fields
  }, [canManageCommissions, overviewData])

  const header = (
    <PageHeader
      eyebrow="Module 5 · Agent Commission"
      title="Agent Commission"
      description="Commission generated from successful premium payments, calculated by explicit rules and tracked from pending to earned to paid."
      actions={
        canViewCommissions ? (
          <Button variant="secondary" to={role === ROLES.AGENT && agentId ? buildAgentCommissionPath(agentId) : ROUTES.COMMISSION_AGENTS}>
            {role === ROLES.AGENT ? 'My agent view' : 'Commission by agent'}
          </Button>
        ) : null
      }
    />
  )

  if (!canViewCommissions) {
    return (
      <>
        {header}
        <CommissionRestricted />
      </>
    )
  }

  const items = register.data?.items ?? []

  const renderSummary = () => {
    if (!overviewData && overview.isLoading) return <LoadingState label="Loading commission summary" variant="rows" rows={2} />
    if (!overviewData && overview.isError) {
      return <ErrorState title="Unable to load the commission summary" error={overview.error} onRetry={overview.reload} />
    }
    const { summary } = overviewData
    return (
      <section className="commissions__summary" aria-labelledby="commission-summary-heading">
        <h2 id="commission-summary-heading" className="commissions__section-title">
          {overviewData.scope === 'all' ? 'Commission position — all agents' : `Commission position — ${overviewData.agent?.name ?? 'your policies'}`}
        </h2>
        <StatGrid
          columns={5}
          items={[
            { id: 'total', tone: 'primary', label: 'Total commission', value: formatCurrency(summary.total), detail: `${plural(summary.records, 'record')} · ${plural(summary.agents, 'agent')}` },
            { id: 'pending', tone: summary.pendingCount ? 'due' : 'neutral', label: 'Pending', value: formatCurrency(summary.pending), detail: plural(summary.pendingCount, 'record') },
            { id: 'earned', tone: 'upcoming', label: 'Earned', value: formatCurrency(summary.earned), detail: `${plural(summary.earnedCount, 'record')} awaiting payout` },
            { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(summary.paid), detail: plural(summary.paidCount, 'record') },
            { id: 'records', tone: 'neutral', label: 'Commission records', value: summary.records, detail: `Across ${summary.policies} ${summary.policies === 1 ? 'policy' : 'policies'}` },
          ]}
        />
      </section>
    )
  }

  const renderRegister = () => {
    if (register.isLoading) return <LoadingState label="Loading commission records" variant="rows" rows={4} />
    if (register.isError) return <ErrorState title="Unable to load commission records" error={register.error} onRetry={register.reload} />
    if (!items.length) {
      return (
        <EmptyState
          icon="⌕"
          title={isFiltered ? 'No commission matches your filters' : 'No commission records yet'}
          description={
            isFiltered
              ? 'Try a different commission ID, agent, policy, policyholder, product or payment, or clear the filters.'
              : 'Commission appears here once a successful premium payment generates it.'
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
    return <CommissionList commissions={items} showAgent={role === ROLES.ADMINISTRATOR} />
  }

  return (
    <>
      {header}

      {role === ROLES.AGENT && (
        <p className="commissions__role-note">
          <strong>Agent view — {overviewData?.agent?.name ?? 'your commission'}.</strong> You see commission on your own
          policies only. Other agents&apos; commission is confidential, and only administrators generate, confirm or pay
          commission.
        </p>
      )}
      {role === ROLES.ADMINISTRATOR && (
        <p className="commissions__role-note">
          <strong>Administrator view.</strong> You see every agent&apos;s commission, generate commission from eligible
          payments, confirm earned commission and record simulated payouts.
        </p>
      )}

      <MockNotice title="Simulated commission">
        No payout is made and no bank, UPI or payment provider is contacted. Commission rates and the earning hold are
        illustrative.
      </MockNotice>

      {renderSummary()}

      <div className="commissions__stack">
        {overviewData && (
          <SectionCard
            id="awaiting-commission"
            title="Payments awaiting commission"
            description={`${plural(overviewData.awaiting.eligible.length, 'eligible payment')} without a commission yet.`}
          >
            <AwaitingCommissionPanel
              awaiting={overviewData.awaiting}
              canManage={canManageCommissions}
              pending={pending}
              result={runResult}
              error={runError}
              onGenerateAll={() => runBulk(generateEligibleCommissions, describeGenerationResult)}
              onConfirmEarnings={() => runBulk(confirmEligibleEarnings, describeEarningResult)}
            />
          </SectionCard>
        )}

        <SectionCard id="commission-rules" title="How commission is calculated">
          <details className="commissions__rules">
            <summary>Commission rules and lifecycle</summary>
            {rules.isLoading && <LoadingState label="Loading commission rules" variant="rows" rows={2} />}
            {rules.isError && <ErrorState title="Unable to load commission rules" error={rules.error} onRetry={rules.reload} />}
            {rules.data && <CommissionRulesTable rules={rules.data.rules} config={rules.data.config} />}
          </details>
        </SectionCard>
      </div>

      <h2 className="commissions__section-title commissions__section-title--spaced">Commission register</h2>

      <FilterBar
        label="Filter commission"
        query={query}
        onChange={setQuery}
        onReset={handleReset}
        searchField={SEARCH_FIELD}
        selectFields={selectFields}
        resultCount={register.isLoading ? null : items.length}
        resultNoun={['record', 'records']}
        isFiltered={isFiltered}
        disabled={register.isError}
      />

      {renderRegister()}

      <p className="commissions__footnote">All commission, rates and payouts are illustrative.</p>
    </>
  )
}

export default CommissionOverview
