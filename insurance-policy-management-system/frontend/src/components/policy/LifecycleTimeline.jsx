import { formatDate } from '../../utils/formatters'
import './LifecycleTimeline.css'

/**
 * Chronological policy lifecycle.
 *
 * Rendered as an ordered list so the sequence is conveyed structurally, not
 * just visually. Each stage carries one of three states:
 *   completed — done, with a date
 *   current   — the stage the policy is sitting in
 *   upcoming  — not yet reached
 *
 * This is the seed for the lifecycle-oriented Policy 360 view later.
 *
 * Module 3 reuses it for the claim workflow, which adds a fourth state:
 *   terminated — a final stage that ended the flow early (rejected, cancelled)
 * and may supply `stateLabel` to override the state wording.
 */
const DEFAULT_STATE_LABELS = {
  completed: 'Completed',
  current: 'In progress',
  upcoming: 'Pending',
  terminated: 'Ended',
}

const MARKERS = { completed: '✓', terminated: '×' }

const LifecycleTimeline = ({
  events = [],
  emptyMessage = 'No lifecycle activity has been recorded for this policy yet.',
}) => {
  if (!events.length) {
    return (
      <p className="lifecycle__empty">
        {emptyMessage}
      </p>
    )
  }

  return (
    <ol className="lifecycle">
      {events.map((event, index) => {
        const state = event.status ?? 'completed'

        return (
          <li className={`lifecycle__item lifecycle__item--${state}`} key={event.stage}>
            <div className="lifecycle__marker" aria-hidden="true">
              <span className="lifecycle__dot">
                {MARKERS[state] ?? index + 1}
              </span>
              {index < events.length - 1 && <span className="lifecycle__line" />}
            </div>

            <div className="lifecycle__content">
              <div className="lifecycle__heading">
                <h3 className="lifecycle__stage">{event.stage}</h3>
                <span className={`lifecycle__state lifecycle__state--${state}`}>
                  {event.stateLabel ?? DEFAULT_STATE_LABELS[state] ?? 'Pending'}
                </span>
              </div>

              <p className="lifecycle__date">
                {event.date ? formatDate(event.date) : 'Date not yet recorded'}
              </p>

              {event.note && <p className="lifecycle__note">{event.note}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export default LifecycleTimeline
