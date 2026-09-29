import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Button,
  Checklist,
  DataList,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatGrid,
  StatusBadge,
} from '../components/common'
import {
  CommissionList,
  CommissionPaymentList,
  CommissionRestricted,
  CommissionRulesTable,
} from '../components/commissions'
import { generateCommissionForPayment, getPolicyCommissions } from '../services/commissionService'
import { useAsync, useDemoRole } from '../hooks'
import {
  buildAgentCommissionPath,
  buildPolicyDetailsPath,
  buildPolicyPremiumsPath,
  ROUTES,
} from '../utils/constants'
import { formatCurrency, formatDate } from '../utils/formatters'
import './Commissions.css'

/** Policy-wise commission: eligibility, applicable rules, every payment's outcome and commission records. */
const PolicyCommission = () => {
  const { policyId } = useParams()
  const { role, agentId, canViewCommissions, canManageCommissions } = useDemoRole()
  const actor = useMemo(() => ({ role, agentId }), [role, agentId])

  const [version, setVersion] = useState(0)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [actionError, setActionError] = useState(null)
  const feedbackRef = useRef(null)

  const record = useAsync(() => getPolicyCommissions(policyId, actor), [policyId, role, agentId, version], { enabled: canViewCommissions })

  const [retained, setRetained] = useState(null)
  if (record.data && record.data !== retained) setRetained(record.data)
  const data = record.data ?? (retained?.policy.id === policyId ? retained : null)

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  const handleGenerate = useCallback(
    async (paymentId) => {
      setPending(true)
      setFeedback(null)
      setActionError(null)
      try {
        const next = await generateCommissionForPayment(paymentId, actor)
        setFeedback(`Commission ${next.commission.commissionId} generated from ${paymentId}: ${next.explanation.formula}. Status: Pending.`)
        setVersion((value) => value + 1)
      } catch (error) {
        setActionError(error.message)
      } finally {
        setPending(false)
      }
    },
    [actor],
  )

  const breadcrumbs = [{ label: 'Agent Commission', to: ROUTES.COMMISSIONS }, { label: `Policy ${policyId}` }]

  if (!canViewCommissions) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Policy commission" />
        <CommissionRestricted />
      </>
    )
  }

  if (!data && (record.isLoading || record.status === 'idle')) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading policy commission…" />
        <LoadingState label="Loading policy commission" variant="rows" rows={5} />
      </>
    )
  }

  if (!data && record.isError) {
    const inaccessible = record.error?.status === 403
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title={inaccessible ? 'Policy commission not available' : 'Policy not found'} />
        <ErrorState
          title={inaccessible ? 'You cannot view commission on this policy' : 'We could not open this policy'}
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

  const { policy, agent, eligibility, rules, payments, items, summary } = data

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Policy commission"
        title={policy.productName}
        meta={
          <>
            <span className="commissions__identifier">{policy.id}</span>
            <StatusBadge status={policy.status} size="lg" />
            <span>{policy.policyholderName ?? 'Policyholder unavailable'}</span>
          </>
        }
        actions={
          <Button variant="secondary" to={buildPolicyDetailsPath(policy.id)}>
            View policy
          </Button>
        }
      />

      {feedback && (
        <p className="commissions__feedback" role="status" tabIndex={-1} ref={feedbackRef}>
          {feedback}
        </p>
      )}
      {actionError && (
        <p className="commission-panel__error" role="alert">
          {actionError}
        </p>
      )}

      <section className="commissions__summary" aria-labelledby="policy-commission-summary">
        <h2 id="policy-commission-summary" className="commissions__section-title">
          Commission on this policy
        </h2>
        <StatGrid
          columns={4}
          items={[
            { id: 'total', tone: 'primary', label: 'Total commission', value: formatCurrency(summary.total), detail: `${summary.records} ${summary.records === 1 ? 'record' : 'records'}` },
            { id: 'pending', tone: summary.pendingCount ? 'due' : 'neutral', label: 'Pending', value: formatCurrency(summary.pending) },
            { id: 'earned', tone: 'upcoming', label: 'Earned', value: formatCurrency(summary.earned) },
            { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(summary.paid) },
          ]}
        />
      </section>

      <div className="commission-detail">
        <div className="commission-detail__main">
          <SectionCard
            id="policy-payments"
            title="Premium payments and commission"
            description="Each successful payment generates one commission. Failed payments never do."
          >
            <CommissionPaymentList payments={payments} canManage={canManageCommissions} onGenerate={handleGenerate} pending={pending} />
          </SectionCard>

          <SectionCard id="policy-records" title="Commission records">
            {items.length ? (
              <CommissionList commissions={items} showAgent={false} />
            ) : (
              <p className="commission-panel__muted">No commission has been generated for this policy.</p>
            )}
          </SectionCard>

          <SectionCard id="policy-rules" title="Applicable commission rules">
            {rules.length ? (
              <CommissionRulesTable rules={rules} />
            ) : (
              <p className="commission-panel__muted">No commission rule applies to this policy&apos;s product.</p>
            )}
          </SectionCard>
        </div>

        <aside className="commission-detail__aside" aria-label="Policy and eligibility context">
          <SectionCard id="policy-context" title="Policy">
            <DataList
              columns={1}
              dense
              items={[
                { label: 'Policy', value: policy.id, mono: true },
                { label: 'Product', value: policy.productName },
                { label: 'Policyholder', value: policy.policyholderName },
                { label: 'Cover', value: `${formatDate(policy.startDate)} – ${formatDate(policy.endDate)}` },
                { label: 'Premium', value: `${formatCurrency(policy.premium)} · ${policy.premiumFrequency}` },
                {
                  label: 'Agent',
                  value: agent ? <Link to={buildAgentCommissionPath(agent.id)}>{`${agent.name} (${agent.id})`}</Link> : 'No agent recorded',
                },
              ]}
            />
            <div className="commissions__inline-action">
              <Button variant="ghost" size="sm" to={buildPolicyPremiumsPath(policy.id)}>
                Premium schedule
              </Button>
            </div>
          </SectionCard>

          <SectionCard id="policy-eligibility" title="Commission eligibility" description="Policy-level checks.">
            <p className="commission-panel__intro">
              <StatusBadge status={eligibility.eligible ? 'active' : 'inactive'} label={eligibility.eligible ? 'Eligible' : 'Not eligible'} />{' '}
              {eligibility.eligible
                ? eligibility.currentRule
                  ? `Rule ${eligibility.currentRule.ruleId} is in force today.`
                  : 'No rule is in force today, so new payments would not generate commission.'
                : eligibility.reason}
            </p>
            <Checklist label="Policy commission eligibility checks" checks={eligibility.checks} />
          </SectionCard>
        </aside>
      </div>
    </>
  )
}

export default PolicyCommission
