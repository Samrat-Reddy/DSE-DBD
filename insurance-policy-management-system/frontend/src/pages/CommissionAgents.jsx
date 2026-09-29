import { useMemo } from 'react'
import { ErrorState, LoadingState, PageHeader, SectionCard, StatGrid } from '../components/common'
import { AgentCommissionTable, CommissionRestricted } from '../components/commissions'
import { getAgentCommissionSummaries } from '../services/commissionService'
import { useAsync, useDemoRole } from '../hooks'
import { ROLES, ROUTES } from '../utils/constants'
import { formatCurrency } from '../utils/formatters'
import './Commissions.css'

/** Agent-wise commission: every registered agent for administrators, only themselves for an agent. */
const CommissionAgents = () => {
  const { role, agentId, canViewCommissions } = useDemoRole()
  const actor = useMemo(() => ({ role, agentId }), [role, agentId])
  const agents = useAsync(() => getAgentCommissionSummaries(actor), [role, agentId], { enabled: canViewCommissions })

  const breadcrumbs = [{ label: 'Agent Commission', to: ROUTES.COMMISSIONS }, { label: 'By agent' }]

  const header = (
    <PageHeader
      breadcrumbs={breadcrumbs}
      eyebrow="Module 5 · Agent Commission"
      title="Commission by agent"
      description="Associated policies and commission totals for each agent, derived from commission records."
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

  const renderContent = () => {
    if (agents.isLoading || agents.status === 'idle') return <LoadingState label="Loading agent commission" variant="rows" rows={4} />
    if (agents.isError) return <ErrorState title="Unable to load agent commission" error={agents.error} onRetry={agents.reload} />

    const { items, summary } = agents.data
    return (
      <>
        <section className="commissions__summary" aria-labelledby="agents-summary-heading">
          <h2 id="agents-summary-heading" className="commissions__section-title">
            {role === ROLES.ADMINISTRATOR ? 'All agents' : 'Your commission'}
          </h2>
          <StatGrid
            columns={4}
            items={[
              { id: 'total', tone: 'primary', label: 'Total commission', value: formatCurrency(summary.total), detail: `${items.length} ${items.length === 1 ? 'agent' : 'agents'}` },
              { id: 'pending', tone: 'due', label: 'Pending', value: formatCurrency(summary.pending) },
              { id: 'earned', tone: 'upcoming', label: 'Earned', value: formatCurrency(summary.earned) },
              { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(summary.paid) },
            ]}
          />
        </section>

        <SectionCard
          id="agent-commission"
          title="Agents"
          description={
            role === ROLES.ADMINISTRATOR
              ? 'Agents with policies but no commission yet are included.'
              : 'Only your own commission is shown. Other agents’ commission is confidential.'
          }
        >
          <AgentCommissionTable agents={items} />
        </SectionCard>
      </>
    )
  }

  return (
    <>
      {header}
      {renderContent()}
    </>
  )
}

export default CommissionAgents
