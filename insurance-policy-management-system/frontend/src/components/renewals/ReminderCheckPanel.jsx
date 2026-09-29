import { Link } from 'react-router-dom'
import Button from '../common/Button'
import DataList from '../common/DataList'
import { buildRenewalDetailsPath } from '../../utils/constants'
import { formatDate, formatDateTime } from '../../utils/formatters'
import './RenewalPanels.css'

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

const ResultItems = ({ title, items, describe }) =>
  items.length ? (
    <div className="reminder-check__group">
      <p className="reminder-check__group-title">{title}</p>
      <ul className="reminder-check__items">
        {items.map((item) => (
          <li key={`${item.reminderId ?? ''}-${item.policyId}-${item.stage ?? item.stageId}`}>
            <Link to={buildRenewalDetailsPath(item.policyId)}>{item.policyId}</Link>
            {item.policyholderName && ` (${item.policyholderName})`} · {describe(item)}
          </li>
        ))}
      </ul>
    </div>
  ) : null

/**
 * Manual run of the reminder engine. Every policy is evaluated as of the
 * engine date; only due, unhandled stages get a simulated reminder, so running
 * it twice never creates a duplicate.
 *
 * `onRun()` resolves to `{ ok, error? }`; the page holds `result`.
 */
const ReminderCheckPanel = ({ asOf, canRun = false, onRun, pending = false, result = null, error = null }) => (
  <div className="renewal-panel">
    <p className="renewal-panel__intro">
      Evaluates every policy as of <strong>{asOf ? formatDate(asOf) : 'the engine date'}</strong>, records a
      simulated reminder for each due stage that has not been handled, and records earlier missed stages as skipped.
      Stages already sent or skipped are never repeated, and failed reminders are only retried explicitly.
    </p>

    {canRun ? (
      <div className="renewal-panel__actions">
        <Button onClick={onRun} disabled={pending}>
          {pending ? 'Running check…' : 'Run reminder check'}
        </Button>
      </div>
    ) : (
      <p className="renewal-panel__readonly">
        Policyholders can see renewal status and reminders but cannot run the reminder check.
      </p>
    )}

    {error && (
      <p className="renewal-panel__error" role="alert">
        {error}
      </p>
    )}

    <div role="status" aria-live="polite" className="reminder-check__live">
      {result && (
        <div className="reminder-check__result">
          <p className="reminder-check__headline">
            Reminder check completed as of {formatDate(result.asOf)}:{' '}
            {result.counts.generated
              ? `${plural(result.counts.generated, 'simulated reminder')} recorded.`
              : 'no new reminders were due.'}
          </p>
          <DataList
            columns={3}
            dense
            items={[
              { label: 'Policies evaluated', value: result.counts.evaluated },
              { label: 'Reminders recorded', value: result.counts.generated },
              { label: 'Missed stages skipped', value: result.counts.skipped },
              { label: 'Already handled', value: result.counts.alreadyHandled },
              { label: 'Need a retry', value: result.counts.needsRetry },
              { label: 'Not yet due · not eligible', value: `${result.counts.notYetDue} · ${result.counts.notEligible}` },
            ]}
          />
          <ResultItems
            title="Recorded"
            items={result.generated}
            describe={(item) => `${item.stageLabel} via ${item.channelLabel} (${item.reminderId})`}
          />
          <ResultItems
            title="Skipped as missed"
            items={result.skippedSuperseded}
            describe={(item) => `${item.stageLabel} (${item.reminderId})`}
          />
          <ResultItems
            title="Already handled — not repeated"
            items={result.alreadyHandled}
            describe={(item) => `${item.stageLabel} already ${item.state}`}
          />
          <ResultItems
            title="Failed — retry required"
            items={result.needsRetry}
            describe={(item) => `${item.stageLabel}: retry from the policy page`}
          />
          <p className="renewal-panel__footnote">
            Run by {result.runBy.name} at {formatDateTime(result.runAt)}. No real messages were sent.
          </p>
        </div>
      )}
    </div>
  </div>
)

export default ReminderCheckPanel
