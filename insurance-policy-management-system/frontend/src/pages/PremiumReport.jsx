import { SectionCard, StatGrid } from '../components/common'
import { DistributionChart, ReportExportButton, ReportShell, ReportTable } from '../components/reports'
import { getPremiumReport } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { formatCurrency, formatDate } from '../utils/formatters'
import './Reports.css'

/** Premium & payment report — Module 2 book position today, plus payment activity in the period. */
const PremiumReport = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, sortBy, isFiltered, report } = useReport(getPremiumReport, { role, enabled: canViewReports })

  return (
    <ReportShell
      title="Premium & payment report"
      description="The premium book as it stands today, and the payments recorded inside the reporting period."
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
          statusLabel: 'Payment status',
          search: true,
          searchPlaceholder: 'Payment, policy, policyholder or reference',
          periodField: 'Payment date',
        },
        resultNoun: ['payment', 'payments'],
      }}
    >
      {(data) => (
        <>
          <section className="reports__summary" aria-labelledby="premium-position-heading">
            <h2 id="premium-position-heading" className="reports__section-title">
              Premium position · as of {formatDate(data.asOf)}
            </h2>
            <p className="reports__note">{data.positionNote}</p>
            <StatGrid
              columns={5}
              items={[
                { id: 'total', tone: 'primary', label: 'Scheduled premium', value: formatCurrency(data.position.totalPremium), detail: `${data.position.policies} premium accounts` },
                { id: 'paid', tone: 'paid', label: 'Paid', value: formatCurrency(data.position.paidAmount), detail: `${data.position.counts.paid} instalments` },
                { id: 'overdue', tone: data.position.overdueAmount ? 'overdue' : 'neutral', label: 'Overdue', value: formatCurrency(data.position.overdueAmount), detail: `${data.position.counts.overdue} instalments · ${data.position.policiesOverdue} policies` },
                { id: 'due', tone: 'due', label: 'Due', value: formatCurrency(data.position.dueAmount), detail: `${data.position.counts.due} instalments` },
                { id: 'upcoming', tone: 'upcoming', label: 'Upcoming', value: formatCurrency(data.position.upcomingAmount), detail: `${data.position.counts.upcoming} instalments` },
              ]}
            />
          </section>

          <section className="reports__summary" aria-labelledby="premium-activity-heading">
            <h2 id="premium-activity-heading" className="reports__section-title reports__section-title--spaced">
              Payment activity · {data.range.label}
            </h2>
            <StatGrid
              columns={4}
              items={[
                { id: 'collected', tone: 'paid', label: 'Collected in period', value: formatCurrency(data.activity.collected), detail: `${data.activity.success} successful payments` },
                { id: 'attempts', tone: 'primary', label: 'Payments recorded', value: data.activity.total, detail: `${data.activity.failed} failed · ${data.activity.pending} pending` },
                { id: 'outstanding', tone: 'due', label: 'Outstanding on the book', value: formatCurrency(data.position.outstandingAmount), detail: 'Scheduled premium not yet paid' },
                { id: 'payable', tone: 'overdue', label: 'Payable now', value: formatCurrency(data.position.payableNow), detail: 'Overdue plus due instalments' },
              ]}
            />
          </section>

          <div className="reports__split">
            <SectionCard id="premium-instalments" title="Instalments by status (today)">
              <DistributionChart items={data.distributions.byInstalmentStatus} emptyMessage="No instalments in scope." />
            </SectionCard>
            <SectionCard id="premium-by-status" title="Payments by status (period)">
              <DistributionChart items={data.activity.byStatus} showAmount />
            </SectionCard>
            <SectionCard id="premium-by-method" title="Payments by method (period)">
              <DistributionChart items={data.activity.byMethod} showAmount />
            </SectionCard>
          </div>

          <SectionCard
            id="premium-records"
            title="Payments in the period"
            description="Search applies to this table; the period, product and status filters scope the payment figures above."
            actions={<ReportExportButton table={data.table} filename={data.filename} />}
          >
            <ReportTable
              caption="Payments recorded in the reporting period with policy, instalment, method, status and amount"
              columns={data.table.columns}
              rows={data.table.rows}
              sort={data.table.sort}
              direction={data.table.direction}
              onSort={sortBy}
              total={data.table.total}
              truncated={data.table.truncated}
              emptyMessage="No payment was recorded in this reporting period under these filters. The premium position above still reflects the whole book."
            />

            {data.excluded.count > 0 && (
              <p className="reports__excluded">
                {data.excluded.count} {data.excluded.count === 1 ? 'payment is' : 'payments are'} excluded: {data.excluded.reason}
              </p>
            )}
          </SectionCard>
        </>
      )}
    </ReportShell>
  )
}

export default PremiumReport
