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
import { ReminderCheckPanel, ReminderHistoryList, RenewalClockPanel, RenewalList } from '../components/renewals'
import {
  advanceRenewalClock,
  getRenewalPolicies,
  resetRenewalSimulation,
  runReminderCheck,
} from '../services/renewalService'
import { useAsync, useDebouncedValue, useDemoRole } from '../hooks'
import {
  DEFAULT_RENEWAL_QUERY,
  PAYMENT_STANDING_OPTIONS,
  RENEWAL_CONFIG,
  RENEWAL_SORT_OPTIONS,
  RENEWAL_STATUS_OPTIONS,
  ROLES,
} from '../utils/constants'
import { findNextReminderDate } from '../utils/renewalFormat'
import './Renewals.css'

const SEARCH_FIELD = {
  name: 'search',
  label: 'Search',
  placeholder: 'Policy ID, policyholder or product',
}

const SELECT_FIELDS = [
  { name: 'status', label: 'Renewal status', options: [{ value: 'all', label: 'All statuses' }, ...RENEWAL_STATUS_OPTIONS] },
  {
    name: 'stage',
    label: 'Reminder stage',
    options: [
      { value: 'all', label: 'All stages' },
      ...RENEWAL_CONFIG.stages.map((stage) => ({ value: stage.id, label: stage.label })),
      { value: 'none', label: 'No active stage' },
    ],
  },
  {
    name: 'premium',
    label: 'Premium standing',
    options: [{ value: 'all', label: 'All standings' }, ...PAYMENT_STANDING_OPTIONS, { value: 'none', label: 'No premium schedule' }],
  },
  { name: 'sort', label: 'Sort by', options: RENEWAL_SORT_OPTIONS },
]

const plural = (count, singular, pluralWord = `${singular}s`) => `${count} ${count === 1 ? singular : pluralWord}`

/** Module 4 landing page — renewal position, reminder check and register. */
const RenewalsOverview = () => {
  const { role, canRunReminderCheck, canManageReminders } = useDemoRole()
  const [query, setQuery] = useState(DEFAULT_RENEWAL_QUERY)
  const debouncedSearch = useDebouncedValue(query.search, 300)

  // Bumped after any action that changes reminders or the engine date.
  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState(false)
  const [checkResult, setCheckResult] = useState(null)
  const [checkError, setCheckError] = useState(null)

  // Summary is loaded unfiltered so headline counts stay put while filtering.
  const overview = useAsync(() => getRenewalPolicies(), [version])
  const renewals = useAsync(
    () => getRenewalPolicies({ ...query, search: debouncedSearch }),
    [debouncedSearch, query.status, query.stage, query.premium, query.sort, version],
  )

  // Keep the last loaded overview on screen while a refresh is in flight, so
  // the clock and check panels (and keyboard focus) do not disappear.
  const [retained, setRetained] = useState(null)
  if (overview.data && overview.data !== retained) setRetained(overview.data)
  const overviewData = overview.data ?? retained

  const isFiltered = useMemo(
    () =>
      query.search !== DEFAULT_RENEWAL_QUERY.search ||
      query.status !== DEFAULT_RENEWAL_QUERY.status ||
      query.stage !== DEFAULT_RENEWAL_QUERY.stage ||
      query.premium !== DEFAULT_RENEWAL_QUERY.premium,
    [query],
  )

  const handleReset = useCallback(() => setQuery(DEFAULT_RENEWAL_QUERY), [])

  const handleRunCheck = useCallback(async () => {
    setPending(true)
    setCheckError(null)
    try {
      const result = await runReminderCheck({ role })
      setCheckResult(result)
      setVersion((value) => value + 1)
    } catch (error) {
      setCheckError(error.message)
    } finally {
      setPending(false)
    }
  }, [role])

  const runClockAction = useCallback(async (action) => {
    setPending(true)
    try {
      await action()
      setCheckResult(null)
      setCheckError(null)
      setVersion((value) => value + 1)
      return { ok: true }
    } catch (error) {
      return { ok: false, error }
    } finally {
      setPending(false)
    }
  }, [])

  const handleAdvance = useCallback((date) => runClockAction(() => advanceRenewalClock(date, { role })), [role, runClockAction])
  const handleResetSimulation = useCallback(() => runClockAction(() => resetRenewalSimulation({ role })), [role, runClockAction])

  const items = renewals.data?.items ?? []

  const renderSummary = () => {
    if (!overviewData && overview.isLoading) return <LoadingState label="Loading renewal summary" variant="rows" rows={2} />
    if (!overviewData && overview.isError) {
      return <ErrorState title="Unable to load the renewal summary" error={overview.error} onRetry={overview.reload} />
    }

    const { summary } = overviewData
    return (
      <section className="renewals__summary" aria-labelledby="renewals-summary-heading">
        <h2 id="renewals-summary-heading" className="renewals__section-title">
          Renewal position
        </h2>
        <StatGrid
          columns={6}
          items={[
            {
              id: 'eligible',
              tone: 'primary',
              label: 'Eligible for reminders',
              value: summary.eligible,
              detail: `Of ${plural(summary.total, 'issued policy', 'issued policies')}`,
            },
            { id: 'within60', tone: 'upcoming', label: 'Expiring within 60 days', value: summary.within60, detail: 'Renewal window open' },
            { id: 'within30', tone: summary.within30 ? 'due' : 'neutral', label: 'Expiring within 30 days', value: summary.within30, detail: 'Due soon or sooner' },
            { id: 'within7', tone: summary.within7 ? 'overdue' : 'neutral', label: 'Due within 7 days', value: summary.within7, detail: 'Including expiry day' },
            { id: 'expired', tone: 'neutral', label: 'Expired', value: summary.expired, detail: 'Cover has ended' },
            {
              id: 'pending',
              tone: summary.remindersPending ? 'due' : 'paid',
              label: 'Reminders pending',
              value: summary.remindersPending,
              detail: 'Due now or awaiting retry',
            },
          ]}
        />
      </section>
    )
  }

  const renderRenewals = () => {
    if (renewals.isLoading) return <LoadingState label="Loading renewals" variant="rows" rows={4} />
    if (renewals.isError) {
      return <ErrorState title="Unable to load renewals" error={renewals.error} onRetry={renewals.reload} />
    }
    if (!items.length) {
      return (
        <EmptyState
          icon="⌕"
          title={isFiltered ? 'No policies match your filters' : 'No issued policies to track'}
          description={
            isFiltered
              ? 'Try a different policy ID, policyholder or product, or clear the filters.'
              : 'Issued policies appear here with their renewal status and reminder schedule.'
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
    return <RenewalList accounts={items} />
  }

  return (
    <>
      <PageHeader
        eyebrow="Module 4 · Renewal Reminder Engine"
        title="Renewals"
        description="Track policies approaching expiry, see which renewal reminder is due, and follow every simulated reminder attempt."
      />

      {role === ROLES.POLICYHOLDER && (
        <p className="renewals__role-note">
          <strong>Policyholder view.</strong> You can see renewal dates, reminder schedules and history. Without
          sign-in every demo policy is shown; in a live system you would see only your own.
        </p>
      )}
      {role === ROLES.AGENT && (
        <p className="renewals__role-note">
          <strong>Agent view.</strong> You can follow renewals and run the reminder check. Manual triggers, retries
          and the simulation date are reserved for administrators.
        </p>
      )}
      {role === ROLES.ADMINISTRATOR && (
        <p className="renewals__role-note">
          <strong>Administrator view.</strong> Run the reminder check, move the simulation date, and open a policy to
          record, skip or retry its current reminder.
        </p>
      )}

      <MockNotice title="Simulated reminders">
        No email, SMS or in-app message is sent and no provider is contacted. This module never renews a policy or
        changes its status. Reminder thresholds (60, 30, 15, 7 and 1 days before expiry, expiry day and a follow-up
        7 days after) are illustrative.
      </MockNotice>

      {renderSummary()}

      {overviewData && (
        <div className="renewals__controls">
          <SectionCard id="renewal-clock" title="Engine date" description="The date every renewal rule is evaluated as of.">
            <RenewalClockPanel
              clock={overviewData.clock}
              canManage={canManageReminders}
              nextReminderDate={findNextReminderDate(overviewData.items, overviewData.clock.asOf)}
              onAdvance={handleAdvance}
              onReset={handleResetSimulation}
              pending={pending}
            />
          </SectionCard>
          <SectionCard id="reminder-check" title="Reminder check" description="Simulates one scheduled run of the engine.">
            <ReminderCheckPanel
              asOf={overviewData.clock.asOf}
              canRun={canRunReminderCheck}
              onRun={handleRunCheck}
              pending={pending}
              result={checkResult}
              error={checkError}
            />
          </SectionCard>
        </div>
      )}

      <h2 className="renewals__section-title renewals__section-title--spaced">Renewal register</h2>

      <FilterBar
        label="Filter renewals"
        query={query}
        onChange={setQuery}
        onReset={handleReset}
        searchField={SEARCH_FIELD}
        selectFields={SELECT_FIELDS}
        resultCount={renewals.isLoading ? null : items.length}
        resultNoun={['policy', 'policies']}
        isFiltered={isFiltered}
        disabled={renewals.isError}
      />

      {renderRenewals()}

      {overviewData && (
        <>
          <SectionCard
            id="recent-reminders"
            className="renewals__recent"
            title="Recent reminder activity"
            description="The latest simulated reminder attempts across all policies, newest first."
          >
            <ReminderHistoryList
              events={overviewData.recentReminders}
              showPolicy
              emptyMessage="No reminders have been recorded yet."
            />
          </SectionCard>

          <p className="renewals__footnote">
            {plural(overviewData.total, 'issued policy', 'issued policies')} tracked.
            {overviewData.notIssued > 0 &&
              ` ${plural(overviewData.notIssued, 'policy', 'policies')} pending issuance ${overviewData.notIssued === 1 ? 'is' : 'are'} excluded until issued.`}{' '}
            All dates, reminders and outcomes are illustrative.
          </p>
        </>
      )}
    </>
  )
}

export default RenewalsOverview
