import StatusBadge from '../common/StatusBadge'
import { ROLE_OPTIONS } from '../../utils/constants'
import { formatDateTime } from '../../utils/formatters'
import './CommissionHistory.css'

const ROLE_LABELS = Object.fromEntries(ROLE_OPTIONS.map((option) => [option.value, option.label]))

/**
 * Append-only audit trail for a commission, oldest first: event ID, what
 * happened, the status change, when, who, and any note or payout reference.
 */
const CommissionHistory = ({ events = [] }) => {
  if (!events.length) {
    return <p className="commission-history__empty">No events have been recorded for this commission.</p>
  }

  return (
    <ol className="commission-history">
      {events.map((event) => (
        <li key={event.eventId} className="commission-history__item">
          <div className="commission-history__when">
            <time dateTime={event.at}>{formatDateTime(event.at)}</time>
            <span className="commission-history__id">{event.eventId}</span>
          </div>

          <div className="commission-history__body">
            <p className="commission-history__action">{event.label}</p>
            <p className="commission-history__transition">
              {event.fromStatus ? <StatusBadge status={event.fromStatus} /> : <span className="commission-history__muted">New</span>}
              <span className="commission-history__arrow" aria-hidden="true">
                →
              </span>
              <span className="sr-only"> to </span>
              <StatusBadge status={event.toStatus} />
            </p>
            <p className="commission-history__actor">
              <span className="commission-history__muted">Actor:</span> {event.actor?.name}{' '}
              <span className="commission-history__role">{ROLE_LABELS[event.actor?.role] ?? event.actor?.role}</span>
            </p>
            {event.payoutReference && (
              <p className="commission-history__actor">
                <span className="commission-history__muted">Payout reference:</span>{' '}
                <span className="commission-history__mono">{event.payoutReference}</span>
              </p>
            )}
            {event.note && <p className="commission-history__note">{event.note}</p>}
          </div>
        </li>
      ))}
    </ol>
  )
}

export default CommissionHistory
