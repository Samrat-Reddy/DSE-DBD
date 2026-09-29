import { Link } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader, SectionCard, StatGrid } from '../components/common'
import { ReportFilterBar, ReportsRestricted } from '../components/reports'
import { getReportOverview } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { ROUTES } from '../utils/constants'
import { formatCurrency, formatDateTime } from '../utils/formatters'
import './Reports.css'

const plural = (count, singular, pluralWord = `${singular}s`) => `${count} ${count === 1 ? singular : pluralWord}`

/** Module 6 landing page — management summary across Modules 1–5, and the report index. */
const ReportsOverview = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, isFiltered, report } = useReport(getReportOverview, { role, enabled: canViewReports })

  const header = (
    <PageHeader
      eyebrow="Module 6 · MIS Reports"
      title="MIS Reports"
      description="Management information derived from the policy, premium, claim, renewal and commission records already held in Modules 1 to 5."
      actions={canViewReports ? <Button variant="secondary" to={ROUTES.POLICY_REPORT}>Open policy report</Button> : null}
    />
  )

  if (!canViewReports) {
    return (
      <>
        {header}
        <ReportsRestricted role={role} />
      </>
    )
  }

  const data = report.data
  const invalidPeriod = report.isError && report.error?.status === 422
  const failed = report.isError && !invalidPeriod

  return (
    <>
      {header}

      <p className="reports__role-note">
        <strong>Administrator view.</strong> MIS Reports cover the whole book. Agents and policyholders have no access;
        the report service refuses them regardless of navigation.
      </p>

      <ReportFilterBar
        query={query}
        onChange={setQuery}
        onReset={reset}
        isFiltered={isFiltered}
        range={data?.range}
        resultCount={data ? data.coverage.policies : null}
        resultNoun={['policy on the book', 'policies on the book']}
        show={{ periodField: 'Record date in each module' }}
        disabled={failed}
      />

      {invalidPeriod && (
        <p className="reports__invalid" role="alert">
          <strong>The reporting period is not valid.</strong> {report.error.message}
        </p>
      )}

      {report.isLoading && <LoadingState label="Loading MIS summary" variant="rows" rows={4} />}
      {failed && <ErrorState title="Unable to load report data" error={report.error} onRetry={report.reload} />}

      {data && !report.isLoading && (
        <>
          <section className="reports__summary" aria-labelledby="mis-summary-heading">
            <h2 id="mis-summary-heading" className="reports__section-title">
              Management summary · {data.range.label}
            </h2>
            <StatGrid
              columns={5}
              items={[
                {
                  id: 'policies',
                  tone: 'primary',
                  label: 'Policies issued in period',
                  value: data.summary.policies.issuedInPeriod,
                  detail: `${data.summary.policies.active} active of ${plural(data.summary.policies.totalOnBook, 'policy', 'policies')} on the book`,
                },
                {
                  id: 'premium',
                  tone: data.summary.premiums.overdueAmount ? 'overdue' : 'paid',
                  label: 'Premium collected in period',
                  value: formatCurrency(data.summary.premiums.collectedInPeriod),
                  detail: `${formatCurrency(data.summary.premiums.overdueAmount)} overdue · ${formatCurrency(data.summary.premiums.dueAmount)} due`,
                },
                {
                  id: 'claims',
                  tone: 'due',
                  label: 'Claims filed in period',
                  value: data.summary.claims.filedInPeriod,
                  detail: `${data.summary.claims.open} open · ${data.summary.claims.settled} settled`,
                },
                {
                  id: 'renewals',
                  tone: 'upcoming',
                  label: 'Renewals eligible today',
                  value: data.summary.renewals.eligible,
                  detail: `${data.summary.renewals.within30} within 30 days · ${data.summary.renewals.expired} expired`,
                },
                {
                  id: 'commission',
                  tone: 'neutral',
                  label: 'Commission generated in period',
                  value: formatCurrency(data.summary.commissions.generatedInPeriod),
                  detail: `${formatCurrency(data.summary.commissions.pending)} pending · ${formatCurrency(data.summary.commissions.paid)} paid`,
                },
              ]}
            />
          </section>

          <SectionCard
            id="report-index"
            title="Available reports"
            description="Each report reads its module's own records and definitions."
          >
            <ul className="reports__index">
              {data.reports.map((definition) => (
                <li className="reports__index-item" key={definition.id}>
                  <h3 className="reports__index-title">
                    <Link to={definition.to}>{definition.title}</Link>
                  </h3>
                  <p className="reports__index-description">{definition.description}</p>
                  <p className="reports__index-source">
                    {definition.source} · Period field: {definition.periodField}
                  </p>
                  <Button variant="secondary" size="sm" to={definition.to}>
                    Open {definition.title.toLowerCase()}
                  </Button>
                </li>
              ))}
            </ul>

            <ul className="reports__coverage">
              <li>{plural(data.coverage.policies, 'policy', 'policies')}</li>
              <li>{plural(data.coverage.premiumAccounts, 'premium account')}</li>
              <li>{plural(data.coverage.payments, 'payment')}</li>
              <li>{plural(data.coverage.claims, 'claim')}</li>
              <li>{plural(data.coverage.reminders, 'renewal reminder')}</li>
              <li>{plural(data.coverage.commissions, 'commission record')}</li>
            </ul>
          </SectionCard>

          <p className="reports__footnote">
            Figures are read live from Modules 1–5, including anything recorded in this browser session. Generated{' '}
            {formatDateTime(data.generatedAt)}.
          </p>
        </>
      )}
    </>
  )
}

export default ReportsOverview
