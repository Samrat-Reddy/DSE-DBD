import { ErrorState, LoadingState } from '../common/StateViews'
import PageHeader from '../common/PageHeader'
import ReportFilterBar from './ReportFilterBar'
import ReportsRestricted from './ReportsRestricted'
import { ROUTES } from '../../utils/constants'
import { formatDateTime } from '../../utils/formatters'
import './Reports.css'

/**
 * The frame every MIS report shares: header, filters, and the four states a
 * report must tell apart —
 *
 *   restricted       the role may not read MIS Reports
 *   loading          the report is being assembled
 *   invalid filter   the reporting period cannot be resolved (422), shown
 *                    beside the filters so it can be corrected, never as "0"
 *   failed           the data could not be loaded at all
 *
 * The report body is a render prop, so pages display figures the report
 * service produced and never calculate anything themselves.
 */
const ReportShell = ({ title, description, role, canView, report, controls, children }) => {
  const data = report.data
  const breadcrumbs = [{ label: 'MIS Reports', to: ROUTES.REPORTS }, { label: title }]

  if (!canView) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} eyebrow="Module 6 · MIS Reports" title={title} />
        <ReportsRestricted role={role} />
      </>
    )
  }

  const invalidPeriod = report.isError && report.error?.status === 422
  const failed = report.isError && !invalidPeriod

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Module 6 · MIS Reports"
        title={title}
        description={description}
        meta={
          data ? (
            <>
              <span className="reports__source">{data.source}</span>
              <span>Generated {formatDateTime(data.generatedAt)}</span>
            </>
          ) : null
        }
      />

      <ReportFilterBar {...controls} range={data?.range} resultCount={data?.table?.total ?? null} disabled={failed} />

      {invalidPeriod && (
        <p className="reports__invalid" role="alert">
          <strong>The reporting period is not valid.</strong> {report.error.message} No figures are shown, because an
          unresolved period would misreport the data.
        </p>
      )}

      {report.isLoading && <LoadingState label={`Loading ${title.toLowerCase()}`} variant="rows" rows={4} />}

      {failed && (
        <ErrorState title="Unable to load report data" error={report.error} onRetry={report.reload} />
      )}

      {data && !report.isLoading && <div className="reports__body">{children(data)}</div>}
    </>
  )
}

export default ReportShell
