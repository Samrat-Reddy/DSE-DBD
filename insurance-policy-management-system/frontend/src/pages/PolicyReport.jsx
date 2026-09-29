import { SectionCard, StatGrid } from '../components/common'
import { DistributionChart, ReportExportButton, ReportShell, ReportTable } from '../components/reports'
import { getPolicyReport } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { formatCurrency } from '../utils/formatters'
import './Reports.css'

/** Policy report — Module 1 issuance scoped by issue date, with Module 2 premium position. */
const PolicyReport = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, sortBy, isFiltered, report } = useReport(getPolicyReport, { role, enabled: canViewReports })

  return (
    <ReportShell
      title="Policy report"
      description="Policies issued inside the reporting period, by product, status and type, with the premium each one has scheduled and paid."
      role={role}
      canView={canViewReports}
      report={report}
      controls={{
        query,
        onChange: setQuery,
        onReset: reset,
        isFiltered,
        options: report.data?.filterOptions,
        show: { status: true, statusLabel: 'Policy status', search: true, searchPlaceholder: 'Policy, product, policyholder or agent', periodField: 'Issue date' },
        resultNoun: ['policy', 'policies'],
      }}
    >
      {(data) => (
        <>
          <section className="reports__summary" aria-labelledby="policy-report-summary">
            <h2 id="policy-report-summary" className="reports__section-title">
              Policies issued · {data.range.label}
            </h2>
            <StatGrid
              columns={5}
              items={[
                { id: 'total', tone: 'primary', label: 'Policies issued', value: data.metrics.total, detail: data.range.description },
                { id: 'active', tone: 'paid', label: 'Active', value: data.metrics.active, detail: `${data.metrics.expired} expired · ${data.metrics.lapsed} lapsed` },
                { id: 'cover', tone: 'neutral', label: 'Sum insured', value: formatCurrency(data.metrics.coverageTotal), detail: 'Total cover issued' },
                { id: 'scheduled', tone: 'upcoming', label: 'Scheduled premium', value: formatCurrency(data.metrics.scheduledPremium), detail: 'Whole schedule, Module 2' },
                {
                  id: 'collected',
                  tone: data.metrics.premiumOutstanding ? 'due' : 'paid',
                  label: 'Premium collected',
                  value: formatCurrency(data.metrics.premiumCollected),
                  detail: `${formatCurrency(data.metrics.premiumOutstanding)} outstanding`,
                },
              ]}
            />
          </section>

          <div className="reports__split">
            <SectionCard id="policy-by-product" title="Policies by product">
              <DistributionChart items={data.distributions.byProduct} />
            </SectionCard>
            <SectionCard id="policy-by-status" title="Policies by status">
              <DistributionChart items={data.distributions.byStatus} />
            </SectionCard>
            <SectionCard id="policy-by-type" title="Policies by type">
              <DistributionChart items={data.distributions.byType} />
            </SectionCard>
          </div>

          <SectionCard
            id="policy-records"
            title="Policy records"
            description="Search applies to this table; the period, product and status filters scope the whole report."
            actions={<ReportExportButton table={data.table} filename={data.filename} />}
          >
            <ReportTable
              caption="Policies issued in the reporting period with product, status, dates and premium position"
              columns={data.table.columns}
              rows={data.table.rows}
              sort={data.table.sort}
              direction={data.table.direction}
              onSort={sortBy}
              total={data.table.total}
              truncated={data.table.truncated}
              emptyMessage="No policy was issued in this reporting period under these filters."
            />

            {data.excluded.count > 0 && (
              <p className="reports__excluded">
                {data.excluded.count} {data.excluded.count === 1 ? 'policy is' : 'policies are'} excluded from this
                report: {data.excluded.reason}
              </p>
            )}
          </SectionCard>
        </>
      )}
    </ReportShell>
  )
}

export default PolicyReport
