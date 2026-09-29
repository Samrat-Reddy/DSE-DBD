import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import { REMINDER_CHANNEL_OPTIONS, REMINDER_EVENT_STATUS } from '../../utils/constants'

const SEND_OUTCOMES = [
  { value: REMINDER_EVENT_STATUS.SENT, label: 'Delivered (simulated)' },
  { value: REMINDER_EVENT_STATUS.FAILED, label: 'Delivery failed (simulated)' },
  { value: REMINDER_EVENT_STATUS.SKIPPED, label: 'Skip this stage' },
]

const RETRY_OUTCOMES = SEND_OUTCOMES.filter((option) => option.value !== REMINDER_EVENT_STATUS.SKIPPED)

/**
 * Records one simulated reminder attempt for a stage, or a retry of a failed
 * attempt. The outcome is chosen explicitly (default: delivered) so failure
 * and retry can be demonstrated deterministically. Nothing is sent.
 *
 * `onSubmit(options)` must resolve to `{ ok: boolean, error?: ApiError }`.
 */
const ReminderActionForm = ({ mode = 'send', stageLabel, defaultChannel, onSubmit, pending = false }) => {
  const [outcome, setOutcome] = useState(REMINDER_EVENT_STATUS.SENT)
  const [channel, setChannel] = useState(defaultChannel)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  const isRetry = mode === 'retry'

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError(null)
    const result = await onSubmit({ outcome, channel, note: note.trim() || undefined })
    if (!result.ok) setError(result.error?.message ?? 'The reminder could not be recorded.')
  }

  return (
    <form className="reminder-action" onSubmit={handleSubmit} aria-label={`${isRetry ? 'Retry' : 'Record'} ${stageLabel} reminder`}>
      <p className="reminder-action__title">{isRetry ? 'Retry the failed reminder' : 'Record the reminder for this stage'}</p>

      {error && (
        <p className="renewal-panel__error" role="alert">
          {error}
        </p>
      )}

      <div className="reminder-action__fields">
        <FormField
          label="Simulated outcome"
          name={`${mode}-outcome`}
          as="select"
          placeholder="Select an outcome"
          options={isRetry ? RETRY_OUTCOMES : SEND_OUTCOMES}
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          required
          disabled={pending}
        />
        <FormField
          label="Channel"
          name={`${mode}-channel`}
          as="select"
          placeholder="Select a channel"
          options={REMINDER_CHANNEL_OPTIONS}
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          required
          disabled={pending}
        />
        <FormField
          label="Note"
          name={`${mode}-note`}
          as="textarea"
          hint="Optional. Recorded in the reminder history."
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={200}
          disabled={pending}
          wrapperClassName="reminder-action__note"
        />
      </div>

      <div className="renewal-panel__actions">
        <Button type="submit" disabled={pending || !outcome || !channel}>
          {pending ? 'Recording…' : isRetry ? 'Retry simulated reminder' : 'Record simulated reminder'}
        </Button>
      </div>
      <p className="renewal-panel__footnote">Simulation only. No email, SMS or in-app message is sent.</p>
    </form>
  )
}

export default ReminderActionForm
