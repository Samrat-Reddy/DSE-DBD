import { SectionCard, StatGrid } from '../components/common'
import { DistributionChart, ReportExportButton, ReportShell, ReportTable } from '../components/reports'
import { getRenewalReport } from '../services/reportService'
import { useDemoRole, useReport } from '../hooks'
import { formatDate } from '../utils/formatters'
import './Reports.css'

/** Renewal report — Module 4 pipeline as of today, with reminder activity inside the period. */
const RenewalReport = () => {
  const { role, canViewReports } = useDemoRole()
  const { query, setQuery, reset, sortBy, isFiltered, report } = useReport(getRenewalReport, { role, enabled: canViewReports })

  return (
    <ReportShell
      title="Renewal report"
      description="Where every policy stands in the renewal pipeline today, and the reminder attempts recorded inside the reporting period."
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
          statusLabel: 'Renewal status',
          search: true,
          searchPlaceholder: 'Policy, product, policyholder or agent',
          periodField: 'Reminder date',
        },
        resultNoun: ['policy', 'policies'],
      }}
    >
      {(data) => (
        <>
          <section className="reports__summary" aria-labelledby="renewal-pipeline-heading">
            <h2 id="renewal-pipeline-heading" className="reports__section-title">
              Renewal pipeline · as of {formatDate(data.asOf)}
            </h2>
            <p className="reports__note">{data.positionNote}</p>
            <StatGrid
              columns={6}
              items={[
                { id: 'total', tone: 'primary', label: 'Policies tracked', value: data.pipeline.total, detail: `${data.pipeline.eligible} eligible for reminders` },
                { id: 'within60', tone: 'upcoming', label: 'Expiring within 60 days', value: data.pipeline.within60, detail: 'Renewal window open' },
                { id: 'within30', tone: data.pipeline.within30 ? 'due' : 'neutral', label: 'Within 30 days', value: data.pipeline.within30, detail: 'Due soon or sooner' },
                { id: 'within7', tone: data.pipeline.within7 ? 'overdue' : 'neutral', label: 'Due within 7 days', value: data.pipeline.within7, detail: 'Including expiry day' },
                { id: 'expired', tone: 'neutral', label: 'Expired', value: data.pipeline.expired, detail: 'Cover has ended' },
                { id: 'pending', tone: data.pipeline.remindersPending ? 'due' : 'paid', label: 'Reminders pending', value: data.pipeline.remindersPending, detail: 'Due now or awaiting retry' },
              ]}
            />
          </section>

          <section className="reports__summary" aria-labelledby="renewal-activity-heading">
            <h2 id="renewal-activity-heading" className="reports__section-title reports__section-title--spaced">
              Reminder activity · {data.range.label}
            </h2>
            <StatGrid
              columns={4}
              items={[
                { id: 'attempts', tone: 'primary', label: 'Reminder attempts', value: data.reminderActivity.total, detail: `Across ${data.reminderActivity.policies} ${data.reminderActivity.policies === 1 ? 'policy' : 'policies'}` },
                { id: 'sent', tone: 'paid', label: 'Sent', value: data.reminderActivity.sent, detail: 'Simulated deliveries' },
                { id: 'failed', tone: data.reminderActivity.failed ? 'overdue' : 'neutral', label: 'Failed', value: data.reminderActivity.failed, detail: 'Needed an explicit retry' },
                { id: 'skipped', tone: 'neutral', label: 'Skipped', value: data.reminderActivity.skipped, detail: 'Handled without sending' },
              ]}
            />
          </section>

          <div className="reports__split">
            <SectionCard id="renewal-by-status" title="Pipeline by renewal status">
              <DistributionChart items={data.distributions.byStatus} />
            </SectionCard>
            <SectionCard id="renewal-by-readiness" title="Renewal readiness">
              <DistributionChart items={data.distributions.byReadiness} />
            </SectionCard>
            <SectionCard id="renewal-by-stage" title="Reminder attempts by stage (period)">
              <DistributionChart items={data.reminderActivity.byStage} emptyMessage="No reminder was attempted in this reporting period." />
            </SectionCard>
          </div>

          <SectionCard
            id="renewal-records"
            title="Renewal pipeline records"
            description="Search applies to this table; the product and renewal-status filters scope the whole report."
            actions={<ReportExportButton table={data.table} filename={data.filename} />}
          >
            <ReportTable
              caption="Policies in the renewal pipeline with expiry, renewal status, reminder stage and readiness"
              columns={data.table.columns}
              rows={data.table.rows}
              sort={data.table.sort}
              direction={data.table.direction}
              onSort={sortBy}
              total={data.table.total}
              truncated={data.table.truncated}
              emptyMessage="No policy matches these filters."
            />

            {data.excluded.count > 0 && (
              <p className="reports__excluded">
                {data.excluded.count} {data.excluded.count === 1 ? 'reminder is' : 'reminders are'} excluded: {data.excluded.reason}
              </p>
            )}
          </SectionCard>
        </>
      )}
    </ReportShell>
  )
}

export default RenewalReport
