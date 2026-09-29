import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  DataList,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/common'
import { LifecycleTimeline } from '../components/policy'
import { MockNotice } from '../components/premium'
import {
  ReminderHistoryList,
  ReminderTimeline,
  RenewalClockPanel,
  RenewalReadinessPanel,
} from '../components/renewals'
import {
  advanceRenewalClock,
  getRenewalPolicyById,
  resetRenewalSimulation,
  retryReminder,
  triggerReminder,
} from '../services/renewalService'
import { useAsync, useDemoRole } from '../hooks'
import {
  buildPolicyDetailsPath,
  buildPolicyPremiumsPath,
  REMINDER_CHANNEL_LABELS,
  REMINDER_EVENT_STATUS,
  REMINDER_STAGE_STATE_LABELS,
  ROLES,
  ROUTES,
} from '../utils/constants'
import { formatCurrency, formatDate } from '../utils/formatters'
import { describeDaysRemaining, describeNextReminder } from '../utils/renewalFormat'
import './Renewals.css'

const OUTCOME_TEXT = {
  [REMINDER_EVENT_STATUS.SENT]: 'recorded as delivered',
  [REMINDER_EVENT_STATUS.FAILED]: 'recorded as a failed delivery. It can now be retried',
  [REMINDER_EVENT_STATUS.SKIPPED]: 'recorded as skipped',
}

/** One policy's renewal position, reminder schedule, readiness and history. */
const RenewalDetails = () => {
  const { policyId } = useParams()
  const { role, canManageReminders } = useDemoRole()
  const record = useAsync(() => getRenewalPolicyById(policyId), [policyId])

  // Details returned by an action, so the page updates in place.
  const [latest, setLatest] = useState(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const feedbackRef = useRef(null)

  const details = latest?.policy.id === policyId ? latest : record.data

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  const runReminderAction = useCallback(async (action) => {
    setPending(true)
    setFeedback(null)
    try {
      const { reminder, details: next } = await action()
      setLatest(next)
      setFeedback({
        tone: reminder.status === REMINDER_EVENT_STATUS.FAILED ? 'warning' : 'success',
        message: `${reminder.reminderId}: ${reminder.stageLabel} reminder via ${reminder.channelLabel} ${OUTCOME_TEXT[reminder.status]}. Simulation only — nothing was sent.`,
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, error }
    } finally {
      setPending(false)
    }
  }, [])

  const handleTrigger = useCallback(
    (stageId, options) => runReminderAction(() => triggerReminder(policyId, stageId, { role }, options)),
    [policyId, role, runReminderAction],
  )

  const handleRetry = useCallback(
    (reminderId, options) => runReminderAction(() => retryReminder(reminderId, { role }, options)),
    [role, runReminderAction],
  )

  const runClockAction = useCallback(
    async (action, message) => {
      setPending(true)
      try {
        const clock = await action()
        setLatest(await getRenewalPolicyById(policyId))
        setFeedback({ tone: 'success', message: message(clock) })
        return { ok: true }
      } catch (error) {
        return { ok: false, error }
      } finally {
        setPending(false)
      }
    },
    [policyId],
  )

  const handleAdvance = useCallback(
    (date) =>
      runClockAction(
        () => advanceRenewalClock(date, { role }),
        (clock) => `Engine date moved to ${formatDate(clock.asOf)}.`,
      ),
    [role, runClockAction],
  )

  const handleResetSimulation = useCallback(
    () =>
      runClockAction(
        () => resetRenewalSimulation({ role }),
        () => 'Simulation reset. The engine date is today and session reminders were discarded.',
      ),
    [role, runClockAction],
  )

  const breadcrumbs = [{ label: 'Renewals', to: ROUTES.RENEWALS }, { label: policyId }]

  if (!details && record.isLoading) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading renewal…" />
        <LoadingState label="Loading renewal" variant="rows" rows={5} />
      </>
    )
  }

  if (!details && record.isError) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Renewal not found" />
        <ErrorState title="We could not open this renewal" error={record.error} onRetry={record.reload} />
        <div className="renewals__centered-action">
          <Button variant="secondary" to={ROUTES.RENEWALS}>
            Back to renewals
          </Button>
        </div>
      </>
    )
  }

  const { policy, account, premium, clock } = details
  const { plan } = account
  const currentStage = plan.currentStage
  const next = describeNextReminder(account.nextReminder)
  const nextReminderDate = account.nextReminder && !account.nextReminder.dueNow ? account.nextReminder.date : null

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Renewal"
        title={policy.productName}
        meta={
          <>
            <span className="renewals__identifier">{policy.id}</span>
            {details.issued && <StatusBadge status={account.status} size="lg" />}
            <span>{policy.policyholderName ?? 'Policyholder unavailable'}</span>
          </>
        }
        actions={
          <Button variant="secondary" to={ROUTES.RENEWALS}>
            All renewals
          </Button>
        }
      />

      {role === ROLES.POLICYHOLDER && (
        <p className="renewals__role-note">
          <strong>Policyholder view.</strong> Renewal status and reminders are shown for information only.
        </p>
      )}
      {role === ROLES.AGENT && (
        <p className="renewals__role-note">
          <strong>Agent view.</strong> You can follow this renewal and run the reminder check from the renewals
          overview. Manual triggers and retries are reserved for administrators.
        </p>
      )}
      {role === ROLES.ADMINISTRATOR && (
        <p className="renewals__role-note">
          <strong>Administrator view.</strong> Record, skip or retry the reminder for the current stage below.
        </p>
      )}

      {feedback && (
        <p
          className={`renewals__feedback${feedback.tone === 'warning' ? ' renewals__feedback--warning' : ''}`}
          role="status"
          tabIndex={-1}
          ref={feedbackRef}
        >
          {feedback.message}
        </p>
      )}

      <div className="renewal-detail">
        <div className="renewal-detail__main">
          <MockNotice title="Simulated reminders">
            Reminder outcomes are chosen for demonstration. No message is sent and this policy is not renewed or
            changed.
          </MockNotice>

          {details.issued ? (
            <>
              <SectionCard id="renewal-summary" title="Renewal summary" description={`As of ${formatDate(account.asOf)}.`}>
                <DataList
                  columns={3}
                  items={[
                    { label: 'Renewal status', value: <StatusBadge status={account.status} /> },
                    { label: 'Expiry date', value: formatDate(policy.endDate) },
                    { label: 'Days remaining', value: describeDaysRemaining(account.daysUntilExpiry) },
                    {
                      label: 'Current reminder stage',
                      value: currentStage ? (
                        <span className="renewals__stage-value">
                          {currentStage.label}
                          <StatusBadge status={currentStage.state} label={REMINDER_STAGE_STATE_LABELS[currentStage.state]} />
                        </span>
                      ) : (
                        'No active stage'
                      ),
                    },
                    {
                      label: 'Last reminder',
                      value: account.lastReminder ? (
                        <span className="renewals__stage-value">
                          {formatDate(account.lastReminder.evaluatedAsOf)} ·{' '}
                          {REMINDER_CHANNEL_LABELS[account.lastReminder.channel]}
                          <StatusBadge status={account.lastReminder.status} />
                        </span>
                      ) : (
                        'None recorded'
                      ),
                    },
                    { label: 'Next reminder', value: next.stage ? `${next.when} · ${next.stage}` : next.when },
                    {
                      label: 'Reminder window',
                      value: plan.window ? `${formatDate(plan.window.opensOn)} – ${formatDate(plan.window.closesOn)}` : null,
                    },
                    {
                      label: 'Reminder eligibility',
                      value: account.eligibility.eligible ? 'Eligible' : account.eligibility.reason,
                      span: !account.eligibility.eligible,
                    },
                  ]}
                />
              </SectionCard>

              <SectionCard
                id="reminder-schedule"
                title="Reminder schedule"
                description="Illustrative thresholds. Each stage is sent at most once; failures need an explicit retry."
              >
                <ReminderTimeline
                  plan={plan}
                  canManage={canManageReminders}
                  onTrigger={handleTrigger}
                  onRetry={handleRetry}
                  pending={pending}
                />
              </SectionCard>
            </>
          ) : (
            <SectionCard id="renewal-summary" title="Renewal summary">
              <p className="renewal-panel__notice">
                <strong>Not issued.</strong> This policy is still pending issuance, so it has no renewal status and no
                reminders are scheduled.
              </p>
            </SectionCard>
          )}

          <SectionCard id="reminder-history" title="Reminder history" description="Every simulated attempt, newest first.">
            <ReminderHistoryList events={details.history} emptyMessage="No reminders have been recorded for this policy." />
          </SectionCard>

          {details.issued && (
            <SectionCard id="renewal-milestones" title="Renewal milestones">
              <LifecycleTimeline events={details.milestones} emptyMessage="No renewal milestones available." />
            </SectionCard>
          )}
        </div>

        <aside className="renewal-detail__aside" aria-label="Policy, readiness and premium context">
          <SectionCard id="renewal-policy" title="Policy summary">
            <DataList
              columns={1}
              dense
              items={[
                { label: 'Policy ID', value: policy.id, mono: true },
                { label: 'Product', value: policy.productName },
                { label: 'Policyholder', value: policy.policyholderName },
                { label: 'Customer ID', value: policy.customerId, mono: true },
                { label: 'Policy status', value: <StatusBadge status={policy.status} /> },
                { label: 'Cover period', value: `${formatDate(policy.startDate)} – ${formatDate(policy.endDate)}` },
                { label: 'Agent', value: policy.agentName },
              ]}
            />
            <div className="renewals__centered-action">
              <Button variant="secondary" size="sm" to={buildPolicyDetailsPath(policy.id)}>
                View policy
              </Button>
            </div>
          </SectionCard>

          <SectionCard id="renewal-readiness" title="Renewal readiness">
            <RenewalReadinessPanel readiness={account.readiness} />
          </SectionCard>

          <SectionCard id="renewal-premium" title="Premium standing" description={`From premium records, as of ${formatDate(account.asOf)}.`}>
            {premium ? (
              <>
                <DataList
                  columns={1}
                  dense
                  items={[
                    { label: 'Standing', value: <StatusBadge status={premium.standing} /> },
                    { label: 'Overdue', value: premium.overdueCount ? `${formatCurrency(premium.overdueAmount)} (${premium.overdueCount})` : 'None' },
                    { label: 'Outstanding', value: formatCurrency(premium.outstanding) },
                    {
                      label: 'Next due',
                      value: premium.nextDueDate ? `${formatCurrency(premium.nextDueAmount)} on ${formatDate(premium.nextDueDate)}` : 'Nothing scheduled',
                    },
                  ]}
                />
                <div className="renewals__centered-action">
                  <Button variant="secondary" size="sm" to={buildPolicyPremiumsPath(policy.id)}>
                    View premium schedule
                  </Button>
                </div>
              </>
            ) : (
              <p className="renewals__muted">No premium schedule was found for this policy.</p>
            )}
          </SectionCard>

          <SectionCard id="renewal-clock" title="Engine date">
            <RenewalClockPanel
              clock={clock}
              canManage={canManageReminders}
              nextReminderDate={nextReminderDate}
              onAdvance={handleAdvance}
              onReset={handleResetSimulation}
              pending={pending}
            />
          </SectionCard>
        </aside>
      </div>
    </>
  )
}

export default RenewalDetails
