import { SectionCard, StatGrid } from '../components/common'
import { DistributionChart, ReportExportButton, ReportShell, ReportTable } from '../components/reports'
import { getCommissionReport } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { formatCurrency } from '../utils/formatters'
import './Reports.css'

const AGENT_COLUMNS = [
  { key: 'label', label: 'Agent', type: 'text' },
  { key: 'records', label: 'Records', type: 'number' },
  { key: 'total', label: 'Total commission', type: 'currency' },
  { key: 'pending', label: 'Pending', type: 'currency' },
  { key: 'earned', label: 'Earned', type: 'currency' },
  { key: 'paid', label: 'Paid', type: 'currency' },
]

/** Agent commission report — Module 5 records scoped by generation date, by agent, product and status. */
const CommissionReport = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, sortBy, isFiltered, report } = useReport(getCommissionReport, { role, enabled: canViewReports })

  return (
    <ReportShell
      title="Agent commission report"
      description="Commission generated inside the reporting period, with the pending, earned and paid position each agent holds."
      role={role}
      canView={canViewReports}
      report={report}
      controls={{
        query,
        onChange: setQuery,
        onReset: reset,
        isFiltered,
        options: report.data?.filterOptions,
        show: {
          status: true,
          statusLabel: 'Commission status',
          agent: true,
          search: true,
          searchPlaceholder: 'Commission, agent, policy, product or payment',
          periodField: 'Generated date',
        },
        resultNoun: ['commission record', 'commission records'],
      }}
    >
      {(data) => (
        <>
          <section className="reports__summary" aria-labelledby="commission-report-summary">
            <h2 id="commission-report-summary" className="reports__section-title">
              Commission generated · {data.range.label}
            </h2>
            <StatGrid
              columns={5}
              items={[
                { id: 'total', tone: 'primary', label: 'Total commission', value: formatCurrency(data.metrics.total), detail: `${data.metrics.records} ${data.metrics.records === 1 ? 'record' : 'records'} · ${data.metrics.agents} ${data.metrics.agents === 1 ? 'agent' : 'agents'}` },
                { id: 'pending', tone: data.metrics.pendingCount ? 'due' : 'neutral', label: 'Pending', value: formatCurrency(data.metrics.pending), detail: `${data.metrics.pendingCount} records` },
                { id: 'earned', tone: 'upcoming', label: 'Earned', value: formatCurrency(data.metrics.earned), detail: `${data.metrics.earnedCount} awaiting payout` },
                { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(data.metrics.paid), detail: `${data.metrics.paidCount} records` },
                { id: 'policies', tone: 'neutral', label: 'Policies earning', value: data.metrics.policies, detail: 'Distinct policies in period' },
              ]}
            />
          </section>

          <div className="reports__split">
            <SectionCard id="commission-by-status" title="Commission by status">
              <DistributionChart items={data.distributions.byStatus} showAmount />
            </SectionCard>
            <SectionCard id="commission-by-agent" title="Commission by agent">
              <DistributionChart items={data.distributions.byAgent} showAmount />
            </SectionCard>
            <SectionCard id="commission-by-product" title="Commission by product">
              <DistributionChart items={data.distributions.byProduct} showAmount />
            </SectionCard>
          </div>

          <SectionCard id="commission-agent-table" className="reports__stack" title="Agent position" description="Totals per agent inside the reporting period.">
            <ReportTable
              caption="Commission per agent with record count and pending, earned and paid totals"
              columns={AGENT_COLUMNS}
              rows={data.byAgent.map((agent) => ({ ...agent, id: agent.key }))}
              total={data.byAgent.length}
              emptyMessage="No commission was generated in this reporting period under these filters."
            />
          </SectionCard>

          <SectionCard
            id="commission-records"
            title="Commission records"
            description="Search applies to this table; the period, product, status and agent filters scope the whole report."
            actions={<ReportExportButton table={data.table} filename={data.filename} />}
          >
            <ReportTable
              caption="Commission records generated in the reporting period with agent, policy, payment, rate and status"
              columns={data.table.columns}
              rows={data.table.rows}
              sort={data.table.sort}
              direction={data.table.direction}
              onSort={sortBy}
              total={data.table.total}
              truncated={data.table.truncated}
              emptyMessage="No commission was generated in this reporting period under these filters."
            />

            {data.excluded.count > 0 && (
              <p className="reports__excluded">
                {data.excluded.count} {data.excluded.count === 1 ? 'commission is' : 'commissions are'} excluded: {data.excluded.reason}
              </p>
            )}
          </SectionCard>
        </>
      )}
    </ReportShell>
  )
}

export default CommissionReport
