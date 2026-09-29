import { SectionCard, StatGrid } from '../components/common'
import { DistributionChart, ReportExportButton, ReportShell, ReportTable } from '../components/reports'
import { getClaimsReport } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { formatCurrency } from '../utils/formatters'
import './Reports.css'

/** Claims report — Module 3 claims scoped by filing date, counted in the module's own workflow states. */
const ClaimsReport = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, sortBy, isFiltered, report } = useReport(getClaimsReport, { role, enabled: canViewReports })

  return (
    <ReportShell
      title="Claims report"
      description="Claims filed inside the reporting period, across the submission-to-settlement workflow, with claimed and approved amounts."
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
          statusLabel: 'Claim status',
          search: true,
          searchPlaceholder: 'Claim, policy, policyholder or claim type',
          periodField: 'Filing date',
        },
        resultNoun: ['claim', 'claims'],
      }}
    >
      {(data) => (
        <>
          <section className="reports__summary" aria-labelledby="claims-report-summary">
            <h2 id="claims-report-summary" className="reports__section-title">
              Claims filed · {data.range.label}
            </h2>
            <StatGrid
              columns={5}
              items={[
                { id: 'total', tone: 'primary', label: 'Claims filed', value: data.metrics.total, detail: `${data.metrics.open} open · ${data.metrics.closed} closed` },
                { id: 'review', tone: 'due', label: 'In review', value: data.metrics.underReview + data.metrics.verified + data.metrics.assessed, detail: `${data.metrics.submitted} awaiting first review` },
                { id: 'approved', tone: 'paid', label: 'Approved', value: data.metrics.approved, detail: `${data.metrics.settled} settled · ${data.metrics.rejected} rejected` },
                { id: 'claimed', tone: 'neutral', label: 'Amount claimed', value: formatCurrency(data.metrics.claimedAmount), detail: 'Across all filed claims' },
                { id: 'settled', tone: 'upcoming', label: 'Amount settled', value: formatCurrency(data.metrics.settledAmount), detail: `${formatCurrency(data.metrics.approvedAmount)} approved` },
              ]}
            />
          </section>

          <div className="reports__split">
            <SectionCard id="claims-by-status" title="Claims by workflow status">
              <DistributionChart items={data.distributions.byStatus} />
            </SectionCard>
            <SectionCard id="claims-by-type" title="Claims by type">
              <DistributionChart items={data.distributions.byType} showAmount />
            </SectionCard>
            <SectionCard id="claims-by-product" title="Claims by product">
              <DistributionChart items={data.distributions.byProduct} showAmount />
            </SectionCard>
          </div>

          <SectionCard
            id="claims-records"
            title="Claim records"
            description="Search applies to this table; the period, product and status filters scope the whole report."
            actions={<ReportExportButton table={data.table} filename={data.filename} />}
          >
            <ReportTable
              caption="Claims filed in the reporting period with policy, type, status and amounts"
              columns={data.table.columns}
              rows={data.table.rows}
              sort={data.table.sort}
              direction={data.table.direction}
              onSort={sortBy}
              total={data.table.total}
              truncated={data.table.truncated}
              emptyMessage="No claim was filed in this reporting period under these filters."
            />

            {data.excluded.count > 0 && (
              <p className="reports__excluded">
                {data.excluded.count} {data.excluded.count === 1 ? 'claim is' : 'claims are'} excluded: {data.excluded.reason}
              </p>
            )}
          </SectionCard>
        </>
      )}
    </ReportShell>
  )
}

export default ClaimsReport
