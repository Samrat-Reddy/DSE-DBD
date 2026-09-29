import StatusBadge from '../common/StatusBadge'
import ReminderActionForm from './ReminderActionForm'
import { REMINDER_CHANNEL_LABELS, REMINDER_STAGE_STATE, REMINDER_STAGE_STATE_LABELS } from '../../utils/constants'
import { formatDate, formatDateTime } from '../../utils/formatters'
import './RenewalPanels.css'
import './ReminderTimeline.css'

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * Every reminder stage for a policy in date order: scheduled date, planned
 * channel, derived state, the latest attempt and its result.
 *
 * Administrators see controls on the current stage only — to record the
 * reminder when it is due, or retry it when the latest attempt failed. The
 * renewal service enforces the same rules independently.
 */
const ReminderTimeline = ({ plan, canManage = false, onTrigger, onRetry, pending = false }) => {
  if (!plan?.stages?.length) {
    return <p className="reminder-timeline__empty">No reminder stages can be scheduled without a valid expiry date.</p>
  }

  return (
    <div className="reminder-timeline-wrap">
      {!plan.eligibility.eligible && (
        <p className="renewal-panel__notice">
          <strong>No further reminders.</strong> {plan.eligibility.reason}
        </p>
      )}

      <ol className="reminder-timeline">
        {plan.stages.map((stage) => {
          const latest = stage.latestAttempt
          const needsAdmin = !canManage && (stage.canTrigger || stage.canRetry)

          return (
            <li
              key={stage.id}
              className={`reminder-stage reminder-stage--${stage.state}${stage.isCurrent ? ' reminder-stage--current' : ''}`}
              aria-current={stage.isCurrent ? 'step' : undefined}
            >
              <span className="reminder-stage__marker" aria-hidden="true" />
              <div className="reminder-stage__body">
                <div className="reminder-stage__head">
                  <p className="reminder-stage__label">{stage.label}</p>
                  <StatusBadge status={stage.state} label={REMINDER_STAGE_STATE_LABELS[stage.state]} />
                  {stage.isCurrent && <span className="reminder-stage__current">Current stage</span>}
                </div>

                <dl className="reminder-stage__meta">
                  <div>
                    <dt>Scheduled</dt>
                    <dd>{formatDate(stage.scheduledFor)}</dd>
                  </div>
                  <div>
                    <dt>Channel</dt>
                    <dd>{REMINDER_CHANNEL_LABELS[latest?.channel ?? stage.channel]}</dd>
                  </div>
                  <div>
                    <dt>Actual attempt</dt>
                    <dd>{latest ? formatDateTime(latest.attemptedAt) : '—'}</dd>
                  </div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>{stage.attempts.length ? plural(stage.attempts.length, 'attempt') : 'None'}</dd>
                  </div>
                </dl>

                {latest && <p className="reminder-stage__result">{latest.result}</p>}
                {stage.state === REMINDER_STAGE_STATE.MISSED && (
                  <p className="reminder-stage__result">
                    This stage passed without an attempt. The next reminder check records it as skipped rather than
                    sending a late reminder.
                  </p>
                )}

                {canManage && stage.canTrigger && (
                  <ReminderActionForm
                    key={`send-${stage.id}`}
                    mode="send"
                    stageLabel={stage.label}
                    defaultChannel={stage.channel}
                    pending={pending}
                    onSubmit={(options) => onTrigger(stage.id, options)}
                  />
                )}

                {canManage && stage.canRetry && latest && (
                  <ReminderActionForm
                    key={`retry-${latest.reminderId}`}
                    mode="retry"
                    stageLabel={stage.label}
                    defaultChannel={latest.channel}
                    pending={pending}
                    onSubmit={(options) => onRetry(latest.reminderId, options)}
                  />
                )}

                {needsAdmin && (
                  <p className="renewal-panel__readonly">
                    {stage.canRetry
                      ? 'The latest attempt failed. Only an administrator can retry it.'
                      : 'This reminder is due. It is recorded by the next reminder check, or manually by an administrator.'}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

export default ReminderTimeline
