import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader, SectionCard, StatGrid, StatusBadge } from '../components/common'
import { CommissionList, CommissionRestricted } from '../components/commissions'
import { getAgentCommissions } from '../services/commissionService'
import { useAsync, useDemoRole } from '../hooks'
import { buildPolicyCommissionPath, ROLES, ROUTES } from '../utils/constants'
import { formatCurrency } from '../utils/formatters'
import '../components/commissions/CommissionList.css'
import './Commissions.css'

/** One agent: summary, associated policies with commission eligibility, and commission records. */
const AgentCommissionDetails = () => {
  const { agentId: requestedAgentId } = useParams()
  const { role, agentId, canViewCommissions } = useDemoRole()
  const actor = useMemo(() => ({ role, agentId }), [role, agentId])
  const record = useAsync(() => getAgentCommissions(requestedAgentId, actor), [requestedAgentId, role, agentId], {
    enabled: canViewCommissions,
  })

  const breadcrumbs = [
    { label: 'Agent Commission', to: ROUTES.COMMISSIONS },
    ...(role === ROLES.ADMINISTRATOR ? [{ label: 'By agent', to: ROUTES.COMMISSION_AGENTS }] : []),
    { label: requestedAgentId },
  ]

  if (!canViewCommissions) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Agent commission" />
        <CommissionRestricted />
      </>
    )
  }

  if (record.isLoading || record.status === 'idle') {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading agent commission…" />
        <LoadingState label="Loading agent commission" variant="rows" rows={5} />
      </>
    )
  }

  if (record.isError) {
    const inaccessible = record.error?.status === 403
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title={inaccessible ? 'Agent commission not available' : 'Agent not found'} />
        <ErrorState
          title={inaccessible ? 'You cannot view this agent’s commission' : 'We could not open this agent'}
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

  const { agent, summary, policies, items, awaiting } = record.data

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Agent commission"
        title={agent.name}
        meta={
          <>
            <span className="commissions__identifier">{agent.id}</span>
            <StatusBadge status={agent.status} />
            <span>{agent.branch}</span>
          </>
        }
      />

      {role === ROLES.AGENT && (
        <p className="commissions__role-note">
          <strong>Your commission.</strong> Commission is confirmed and paid by an administrator.
        </p>
      )}

      <section className="commissions__summary" aria-labelledby="agent-summary-heading">
        <h2 id="agent-summary-heading" className="commissions__section-title">
          Commission position
        </h2>
        <StatGrid
          columns={5}
          items={[
            { id: 'total', tone: 'primary', label: 'Total commission', value: formatCurrency(summary.total), detail: `${summary.records} ${summary.records === 1 ? 'record' : 'records'}` },
            { id: 'pending', tone: summary.pendingCount ? 'due' : 'neutral', label: 'Pending', value: formatCurrency(summary.pending) },
            { id: 'earned', tone: 'upcoming', label: 'Earned', value: formatCurrency(summary.earned) },
            { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(summary.paid) },
            { id: 'policies', tone: 'neutral', label: 'Policies', value: summary.policyCount, detail: `${awaiting.eligible.length} ${awaiting.eligible.length === 1 ? 'payment' : 'payments'} awaiting commission` },
          ]}
        />
      </section>

      <div className="commissions__stack">
        <SectionCard id="agent-policies" title="Associated policies" description="Policy-level commission eligibility and totals.">
          {policies.length ? (
            <div className="commissions__table-scroll">
              <table className="commission-table commission-table--compact">
                <caption className="sr-only">Policies associated with {agent.name}, with commission eligibility and totals</caption>
                <thead>
                  <tr>
                    <th scope="col">Policy</th>
                    <th scope="col">Policy status</th>
                    <th scope="col">Commission eligibility</th>
                    <th scope="col" className="commission-table__numeric">Records</th>
                    <th scope="col" className="commission-table__numeric">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map((policy) => (
                    <tr key={policy.policyId}>
                      <th scope="row">
                        <Link className="commission-list__primary" to={buildPolicyCommissionPath(policy.policyId)}>
                          {policy.policyId}
                        </Link>
                        <span className="commission-list__secondary">
                          {policy.policyholderName ?? '—'} · {policy.productName}
                        </span>
                      </th>
                      <td>
                        <StatusBadge status={policy.policyStatus} />
                      </td>
                      <td>{policy.eligible ? 'Eligible' : policy.eligibilityReason}</td>
                      <td className="commission-table__numeric">{policy.records}</td>
                      <td className="commission-table__numeric commission-list__amount">{formatCurrency(policy.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="commission-panel__muted">No policies are associated with this agent.</p>
          )}
        </SectionCard>

        <SectionCard id="agent-records" title="Commission records" description="Newest payment first.">
          {items.length ? (
            <CommissionList commissions={items} showAgent={false} />
          ) : (
            <p className="commission-panel__muted">No commission has been generated for this agent yet.</p>
          )}
        </SectionCard>
      </div>
    </>
  )
}

export default AgentCommissionDetails
