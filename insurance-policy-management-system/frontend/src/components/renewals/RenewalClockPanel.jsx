import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import { formatDate } from '../../utils/formatters'
import './RenewalPanels.css'

/**
 * The renewal engine's date. It defaults to today; an administrator can move
 * it forward to demonstrate reminder stages without inventing policies, and
 * reset it (which also discards reminders recorded this session).
 *
 * `onAdvance(date)` and `onReset()` resolve to `{ ok, error? }`.
 */
const RenewalClockPanel = ({ clock, canManage = false, nextReminderDate = null, onAdvance, onReset, pending = false }) => {
  const [draftDate, setDraftDate] = useState('')
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [error, setError] = useState(null)

  if (!clock) return null

  const run = async (action) => {
    setError(null)
    const result = await action()
    if (!result.ok) setError(result.error?.message ?? 'The simulation date could not be changed.')
    return result
  }

  const handleAdvance = async (event) => {
    event.preventDefault()
    if (!draftDate) {
      setError('Choose a date to move the engine to.')
      return
    }
    const result = await run(() => onAdvance(draftDate))
    if (result.ok) setDraftDate('')
  }

  return (
    <div className="renewal-panel">
      <div className="renewal-clock__dates">
        <div className="renewal-clock__date">
          <span className="renewal-clock__label">Engine date</span>
          <span className="renewal-clock__value">{formatDate(clock.asOf)}</span>
          <span className={`renewal-clock__mode${clock.isSimulated ? ' renewal-clock__mode--simulated' : ''}`}>
            {clock.isSimulated ? 'Simulated date' : 'Today'}
          </span>
        </div>
        {clock.isSimulated && (
          <div className="renewal-clock__date">
            <span className="renewal-clock__label">Actual date</span>
            <span className="renewal-clock__value renewal-clock__value--muted">{formatDate(clock.today)}</span>
          </div>
        )}
      </div>

      <p className="renewal-panel__intro">
        Renewal status, reminder stages and premium standing are all calculated as of the engine date.
      </p>

      {error && (
        <p className="renewal-panel__error" role="alert">
          {error}
        </p>
      )}

      {canManage ? (
        <>
          <form className="renewal-clock__form" onSubmit={handleAdvance} aria-label="Advance simulation date">
            <FormField
              label="Move engine date to"
              name="simulationDate"
              type="date"
              min={clock.asOf}
              value={draftDate}
              onChange={(event) => setDraftDate(event.target.value)}
              hint="Forward only, so a handled stage can never be re-sent."
              disabled={pending}
            />
            <div className="renewal-panel__actions">
              <Button type="submit" variant="secondary" disabled={pending}>
                Advance date
              </Button>
              {nextReminderDate && (
                <Button variant="secondary" disabled={pending} onClick={() => run(() => onAdvance(nextReminderDate))}>
                  Jump to next reminder ({formatDate(nextReminderDate)})
                </Button>
              )}
            </div>
          </form>

          {!confirmingReset ? (
            <div className="renewal-panel__actions">
              <Button variant="ghost" disabled={pending} onClick={() => setConfirmingReset(true)}>
                Reset simulation
              </Button>
            </div>
          ) : (
            <div className="renewal-panel__confirm">
              <p className="renewal-panel__confirm-title">Reset the renewal simulation?</p>
              <p className="renewal-panel__intro">
                The engine date returns to today and every reminder recorded in this session is discarded. Seed
                reminder history is kept.
              </p>
              <div className="renewal-panel__actions">
                <Button
                  variant="danger"
                  disabled={pending}
                  onClick={async () => {
                    const result = await run(onReset)
                    if (result.ok) setConfirmingReset(false)
                  }}
                >
                  Confirm reset
                </Button>
                <Button variant="secondary" disabled={pending} onClick={() => setConfirmingReset(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="renewal-panel__readonly">Only an administrator can change or reset the simulation date.</p>
      )}
    </div>
  )
}

export default RenewalClockPanel
