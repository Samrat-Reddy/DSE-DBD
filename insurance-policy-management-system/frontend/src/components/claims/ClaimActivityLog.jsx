import StatusBadge from '../common/StatusBadge'
import { DEMO_ROLE_TITLES } from '../../utils/constants'
import { formatDateTime } from '../../utils/formatters'
import './ClaimActivityLog.css'

/**
 * Chronological audit trail: one entry per workflow transition, recording
 * when, what, the status change, who and in which role, and any note.
 *
 * Shaped so a backend audit table can map onto it directly.
 */
const ClaimActivityLog = ({ activity = [] }) => {
  if (!activity.length) {
    return <p className="activity-log__empty">No activity has been recorded for this claim.</p>
  }

  return (
    <ol className="activity-log">
      {activity.map((event) => (
        <li key={event.eventId} className="activity-log__item">
          <div className="activity-log__when">
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
          </div>

          <div className="activity-log__body">
            <p className="activity-log__action">{event.label}</p>

            <p className="activity-log__transition">
              <StatusBadge status={event.fromStatus} />
              <span className="activity-log__arrow" aria-hidden="true">→</span>
              <span className="sr-only"> to </span>
              <StatusBadge status={event.toStatus} />
            </p>

            <p className="activity-log__actor">
              <span className="activity-log__actor-label">Actor:</span> {event.actor?.name}{' '}
              <span className="activity-log__role">{DEMO_ROLE_TITLES[event.actor?.role] ?? event.actor?.role}</span>
            </p>

            {event.note && <p className="activity-log__note">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default ClaimActivityLog
