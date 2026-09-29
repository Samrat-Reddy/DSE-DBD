import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import { COMMISSION_STATUS } from '../../utils/constants'
import './CommissionPanels.css'

const ACTION_TEXT = {
  [COMMISSION_STATUS.EARNED]: {
    button: 'Confirm as earned',
    confirm: 'Confirm this commission as earned?',
    detail: 'The earning hold has passed. Once earned, the commission can be included in a payout.',
  },
  [COMMISSION_STATUS.PAID]: {
    button: 'Mark as paid',
    confirm: 'Record a simulated payout for this commission?',
    detail: 'A mock payout reference is generated. No money moves and no bank is contacted. Paid is final.',
  },
}

/**
 * Status actions for one commission.
 *
 * The next status and whether it is allowed come from the service (which
 * applies the lifecycle rules and enforces them again on submit). A blocked
 * action shows why instead of disappearing.
 *
 * `onTransition(toStatus, { note })` must resolve to `{ ok, error? }`.
 */
const CommissionActions = ({ status, actions = [], canManage = false, onTransition, pending = false }) => {
  const [confirming, setConfirming] = useState(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  if (!canManage) {
    return (
      <p className="commission-panel__readonly">
        {status === COMMISSION_STATUS.PAID
          ? 'This commission has been paid. No further changes are possible.'
          : 'Only an administrator can confirm commission as earned or mark it as paid.'}
      </p>
    )
  }

  if (!actions.length) {
    return <p className="commission-panel__readonly">This commission has been paid. Paid is final, so no further changes are possible.</p>
  }

  const submit = async (toStatus) => {
    setError(null)
    const result = await onTransition(toStatus, { note: note.trim() || undefined })
    if (result.ok) {
      setConfirming(null)
      setNote('')
    } else {
      setError(result.error?.message ?? 'The status could not be changed.')
    }
  }

  return (
    <div className="commission-panel">
      {error && (
        <p className="commission-panel__error" role="alert">
          {error}
        </p>
      )}

      {actions.map((action) => {
        const text = ACTION_TEXT[action.toStatus]
        if (!action.allowed) {
          return (
            <div key={action.toStatus} className="commission-panel__blocked-action">
              <Button variant="secondary" disabled>
                {text.button}
              </Button>
              <p className="commission-panel__notice">
                <strong>Not yet possible.</strong> {action.message}
              </p>
            </div>
          )
        }

        if (confirming !== action.toStatus) {
          return (
            <div key={action.toStatus} className="commission-panel__actions">
              <Button onClick={() => setConfirming(action.toStatus)} disabled={pending}>
                {text.button}
              </Button>
            </div>
          )
        }

        return (
          <div key={action.toStatus} className="commission-panel__confirm">
            <p className="commission-panel__confirm-title">{text.confirm}</p>
            <p className="commission-panel__intro">{text.detail}</p>
            <FormField
              label="Note"
              name="transitionNote"
              as="textarea"
              hint="Optional. Recorded in the audit history."
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
              disabled={pending}
            />
            <div className="commission-panel__actions">
              <Button onClick={() => submit(action.toStatus)} disabled={pending}>
                {pending ? 'Saving…' : text.button}
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(null)} disabled={pending}>
                Cancel
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default CommissionActions
