import { Link } from 'react-router-dom'
import StatusBadge from '../common/StatusBadge'
import { buildRenewalDetailsPath } from '../../utils/constants'
import { formatDate, formatDateTime } from '../../utils/formatters'
import { describeActor, REMINDER_TRIGGER_LABELS } from '../../utils/renewalFormat'
import './ReminderHistoryList.css'

/**
 * Append-only reminder history, newest first. Each entry records the stage,
 * channel, outcome, when it was attempted, the engine date it was evaluated
 * as of, what triggered it, who, and any retry link.
 */
const ReminderHistoryList = ({ events = [], showPolicy = false, emptyMessage = 'No reminders have been recorded.' }) => {
  if (!events.length) {
    return <p className="reminder-history__empty">{emptyMessage}</p>
  }

  return (
    <ol className="reminder-history">
      {events.map((event) => (
        <li key={event.reminderId} className={`reminder-history__item reminder-history__item--${event.status}`}>
          <div className="reminder-history__head">
            <span className="reminder-history__id">{event.reminderId}</span>
            <StatusBadge status={event.status} />
            <span className="reminder-history__tag">Simulated</span>
          </div>

          <p className="reminder-history__title">
            {event.stageLabel} · {event.channelLabel}
            {showPolicy && (
              <>
                {' · '}
                <Link to={buildRenewalDetailsPath(event.policyId)}>{event.policyId}</Link>
                {event.policyholderName && <span className="reminder-history__muted"> ({event.policyholderName})</span>}
              </>
            )}
          </p>

          <dl className="reminder-history__meta">
            <div>
              <dt>Attempted</dt>
              <dd>
                <time dateTime={event.attemptedAt}>{formatDateTime(event.attemptedAt)}</time>
              </dd>
            </div>
            <div>
              <dt>Engine date</dt>
              <dd>{formatDate(event.evaluatedAsOf)}</dd>
            </div>
            <div>
              <dt>Scheduled</dt>
              <dd>{formatDate(event.scheduledFor)}</dd>
            </div>
            <div>
              <dt>Trigger</dt>
              <dd>{REMINDER_TRIGGER_LABELS[event.trigger] ?? event.trigger}</dd>
            </div>
            <div className="reminder-history__wide">
              <dt>Recorded by</dt>
              <dd>{describeActor(event.createdBy)}</dd>
            </div>
            {event.retryOf && (
              <div>
                <dt>Retry of</dt>
                <dd className="reminder-history__mono">{event.retryOf}</dd>
              </div>
            )}
          </dl>

          {event.result && <p className="reminder-history__result">{event.result}</p>}
          {event.note && (
            <p className="reminder-history__note">
              <span className="sr-only">Note: </span>
              {event.note}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

export default ReminderHistoryList
