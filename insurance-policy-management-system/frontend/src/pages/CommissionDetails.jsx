import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  CommissionActions,
  CommissionCalculation,
  CommissionHistory,
  CommissionRestricted,
} from '../components/commissions'
import { getCommissionById, transitionCommission } from '../services/commissionService'
import { useAsync, useDemoRole } from '../hooks'
import {
  buildAgentCommissionPath,
  buildPaymentDetailsPath,
  buildPolicyCommissionPath,
  buildPolicyDetailsPath,
  COMMISSION_STATUS_LABELS,
  ROLES,
  ROUTES,
} from '../utils/constants'
import { formatCurrency, formatDate, formatDateTime } from '../utils/formatters'
import './Commissions.css'

/** One commission: calculation, lifecycle, status actions, payment linkage and audit history. */
const CommissionDetails = () => {
  const { commissionId } = useParams()
  const { role, agentId, canViewCommissions, canManageCommissions } = useDemoRole()
  const actor = useMemo(() => ({ role, agentId }), [role, agentId])
  const record = useAsync(() => getCommissionById(commissionId, actor), [commissionId, role, agentId], { enabled: canViewCommissions })

  const [latest, setLatest] = useState(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const feedbackRef = useRef(null)

  // A result from an action only counts for the same commission and role.
  const details = latest && latest.key === `${commissionId}:${role}` ? latest.details : record.data

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  const handleTransition = useCallback(
    async (toStatus, options) => {
      setPending(true)
      setFeedback(null)
      try {
        const next = await transitionCommission(commissionId, toStatus, actor, options)
        setLatest({ key: `${commissionId}:${role}`, details: next })
        const payout = next.commission.payoutReference ? ` Simulated payout reference ${next.commission.payoutReference}.` : ''
        setFeedback(`${commissionId} is now ${COMMISSION_STATUS_LABELS[next.commission.status]}.${payout}`)
        return { ok: true }
      } catch (error) {
        return { ok: false, error }
      } finally {
        setPending(false)
      }
    },
    [commissionId, actor, role],
  )

  const breadcrumbs = [{ label: 'Agent Commission', to: ROUTES.COMMISSIONS }, { label: commissionId }]

  if (!canViewCommissions) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Commission" />
        <CommissionRestricted />
      </>
    )
  }

  if (!details && (record.isLoading || record.status === 'idle')) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading commission…" />
        <LoadingState label="Loading commission" variant="rows" rows={5} />
      </>
    )
  }

  if (!details && record.isError) {
    const inaccessible = record.error?.status === 403
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title={inaccessible ? 'Commission not available' : 'Commission not found'} />
        <ErrorState
          title={inaccessible ? 'You cannot view this commission' : 'We could not open this commission'}
          error={record.error}
          onRetry={inaccessible ? undefined : record.reload}
        />
        <div className="commissions__centered-action">
          <Button variant="secondary" to={ROUTES.COMMISSIONS}>
            Back to commission
          </Button>
        </div>
      </>
    )
  }

  const { commission, payment, policy, rule } = details

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Commission"
        title={formatCurrency(commission.amount)}
        meta={
          <>
            <span className="commissions__identifier">{commission.commissionId}</span>
            <StatusBadge status={commission.status} size="lg" />
            <span>
              {commission.agentName} · {commission.policyId}
            </span>
          </>
        }
        actions={
          <Button variant="secondary" to={ROUTES.COMMISSIONS}>
            All commission
          </Button>
        }
      />

      {feedback && (
        <p className="commissions__feedback" role="status" tabIndex={-1} ref={feedbackRef}>
          {feedback}
        </p>
      )}

      <div className="commission-detail">
        <div className="commission-detail__main">
          <MockNotice title="Simulated commission">No payout is made and no bank or payment provider is contacted.</MockNotice>

          <SectionCard id="commission-summary" title="Commission summary">
            <DataList
              columns={3}
              items={[
                { label: 'Commission ID', value: commission.commissionId, mono: true },
                { label: 'Status', value: <StatusBadge status={commission.status} /> },
                { label: 'Commission', value: formatCurrency(commission.amount) },
                { label: 'Agent', value: `${commission.agentName} (${commission.agentId})` },
                { label: 'Basis', value: commission.basisLabel },
                { label: 'Policy year', value: commission.policyYear },
                { label: 'Generated', value: formatDateTime(commission.generatedAt) },
                { label: 'Earned', value: commission.earnedAt ? formatDateTime(commission.earnedAt) : `From ${formatDate(commission.earnableFrom)}` },
                { label: 'Paid', value: commission.paidAt ? formatDateTime(commission.paidAt) : 'Not yet paid' },
                ...(commission.payoutReference ? [{ label: 'Payout reference', value: commission.payoutReference, mono: true, span: true }] : []),
              ]}
            />
          </SectionCard>

          <SectionCard id="commission-calculation" title="Calculation" description="Why this commission is this amount.">
            <CommissionCalculation explanation={details.explanation} />
          </SectionCard>

          <SectionCard id="commission-lifecycle" title="Lifecycle" description="Pending → Earned → Paid. Paid is final.">
            <LifecycleTimeline events={details.milestones} emptyMessage="No lifecycle recorded." />
          </SectionCard>

          <SectionCard
            id="commission-actions"
            title="Status actions"
            description={`Acting as ${role === ROLES.ADMINISTRATOR ? 'Administrator' : 'Agent'} (demo role).`}
          >
            <CommissionActions
              status={commission.status}
              actions={details.actions}
              canManage={canManageCommissions}
              onTransition={handleTransition}
              pending={pending}
            />
          </SectionCard>

          <SectionCard id="commission-history" title="Audit history" description="Every event, oldest first. Events are never edited.">
            <CommissionHistory events={details.history} />
          </SectionCard>
        </div>

        <aside className="commission-detail__aside" aria-label="Payment, policy and rule context">
          <SectionCard id="commission-payment" title="Premium payment">
            {!commission.linkage.valid && (
              <p className="commission-panel__error" role="alert">
                <strong>Payment link broken.</strong> {commission.linkage.message}
              </p>
            )}
            <DataList
              columns={1}
              dense
              items={[
                { label: 'Payment ID', value: <Link to={buildPaymentDetailsPath(commission.paymentId)}>{commission.paymentId}</Link> },
                { label: 'Transaction reference', value: payment?.transactionReference ?? null, mono: true },
                { label: 'Instalment', value: commission.installmentId, mono: true },
                { label: 'Amount paid', value: payment ? formatCurrency(payment.amount) : null },
                { label: 'Paid on', value: payment ? formatDate(payment.paymentDate) : null },
                { label: 'Payment status', value: payment ? <StatusBadge status={payment.status} /> : 'Missing' },
              ]}
            />
          </SectionCard>

          <SectionCard id="commission-policy" title="Policy">
            {policy ? (
              <>
                <DataList
                  columns={1}
                  dense
                  items={[
                    { label: 'Policy', value: policy.id, mono: true },
                    { label: 'Product', value: policy.productName },
                    { label: 'Policyholder', value: policy.policyholderName },
                    { label: 'Policy status', value: <StatusBadge status={policy.status} /> },
                    { label: 'Premium', value: `${formatCurrency(policy.premium)} · ${policy.premiumFrequency}` },
                    {
                      label: 'Agent',
                      value: <Link to={buildAgentCommissionPath(commission.agentId)}>{commission.agentName}</Link>,
                    },
                  ]}
                />
                <div className="commissions__inline-action">
                  <Button variant="secondary" size="sm" to={buildPolicyCommissionPath(policy.id)}>
                    Policy commission
                  </Button>
                  <Button variant="ghost" size="sm" to={buildPolicyDetailsPath(policy.id)}>
                    View policy
                  </Button>
                </div>
              </>
            ) : (
              <p className="commission-panel__muted">The policy record could not be found.</p>
            )}
          </SectionCard>

          {rule && (
            <SectionCard id="commission-rule" title="Commission rule">
              <DataList
                columns={1}
                dense
                items={[
                  { label: 'Rule', value: rule.ruleId, mono: true },
                  { label: 'Applies to', value: rule.agentName ? `Agent: ${rule.agentName}` : 'All agents' },
                  { label: 'Rates', value: `${rule.firstYearRatePercent}% first year · ${rule.renewalRatePercent}% renewal` },
                  { label: 'Effective', value: `${formatDate(rule.effectiveFrom)} – ${rule.effectiveTo ? formatDate(rule.effectiveTo) : 'open-ended'}` },
                ]}
              />
            </SectionCard>
          )}
        </aside>
      </div>
    </>
  )
}

export default CommissionDetails
