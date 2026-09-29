import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import StatusBadge from '../common/StatusBadge'
import { CLAIM_TRANSITIONS } from '../../utils/claimWorkflow'
import { CLAIM_STATUS_LABELS, DEMO_ROLE_TITLES } from '../../utils/constants'
import './ClaimPanels.css'

const STEP_LABELS = {
  filing: 'Filing form',
  verification: 'Verification panel',
  assessment: 'Assessment panel',
  decision: 'Decision panel',
  settlement: 'Settlement panel',
}

/**
 * Explains the transition rules for the current status, and lets any role
 * attempt an arbitrary status change so the service's enforcement can be seen:
 * illegal moves, moves by the wrong role, and moves that skip a required step
 * are all rejected with the reason.
 *
 * Uses native <details>/<summary>, so no custom ARIA or keyboard handling is
 * needed.
 *
 * `onAttempt(toStatus)` must resolve to `{ ok: boolean, error?: ApiError }`.
 */
const ClaimWorkflowRules = ({ status, role, onAttempt, pending = false }) => {
  const [target, setTarget] = useState('')
  const [outcome, setOutcome] = useState(null)

  const rules = Object.entries(CLAIM_TRANSITIONS[status] ?? {})
  const options = Object.keys(CLAIM_TRANSITIONS)
    .filter((candidate) => candidate !== status)
    .map((candidate) => ({ value: candidate, label: CLAIM_STATUS_LABELS[candidate] }))

  const handleAttempt = async () => {
    if (!target) {
      setOutcome({ ok: false, message: 'Choose a status to attempt.' })
      return
    }
    const result = await onAttempt(target)
    setOutcome(
      result.ok
        ? { ok: true, message: `Allowed: the claim moved to ${CLAIM_STATUS_LABELS[target]}.` }
        : { ok: false, message: `Blocked: ${result.error?.message ?? 'The change was rejected.'}` },
    )
  }

  return (
    <details className="workflow-rules">
      <summary className="workflow-rules__summary">Workflow rules and enforcement</summary>

      <div className="workflow-rules__body">
        <p className="claim-panel__muted">
          Current status: <StatusBadge status={status} />
        </p>

        {rules.length ? (
          <div className="workflow-rules__table-wrap">
            <table className="workflow-rules__table">
              <caption className="sr-only">Transitions allowed from the current status</caption>
              <thead>
                <tr>
                  <th scope="col">Next status</th>
                  <th scope="col">Action</th>
                  <th scope="col">Who can do it</th>
                  <th scope="col">Recorded through</th>
                </tr>
              </thead>
              <tbody>
                {rules.map(([toStatus, rule]) => (
                  <tr key={toStatus}>
                    <th scope="row">
                      <StatusBadge status={toStatus} />
                    </th>
                    <td>{rule.label}</td>
                    <td>
                      {rule.roles.map((allowed) => DEMO_ROLE_TITLES[allowed]).join(', ')}
                      {rule.roles.includes(role) ? (
                        <span className="workflow-rules__you">including you</span>
                      ) : (
                        <span className="workflow-rules__not-you">not your role</span>
                      )}
                    </td>
                    <td>{rule.dedicated ? STEP_LABELS[rule.dedicated] : 'Direct status change'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="claim-panel__muted">This is a final status. No further transitions are possible.</p>
        )}

        <div className="workflow-rules__attempt">
          <FormField
            label="Attempt a status change"
            name="attemptStatus"
            as="select"
            placeholder="Choose a status"
            options={options}
            value={target}
            onChange={(event) => {
              setTarget(event.target.value)
              setOutcome(null)
            }}
            hint="Demonstration of enforcement: the service checks the move, your role and any required step."
          />
          <Button variant="secondary" onClick={handleAttempt} disabled={pending}>
            Attempt change
          </Button>
        </div>

        {outcome && (
          <p
            className={`workflow-rules__outcome workflow-rules__outcome--${outcome.ok ? 'allowed' : 'blocked'}`}
            role={outcome.ok ? 'status' : 'alert'}
          >
            {outcome.message}
          </p>
        )}
      </div>
    </details>
  )
}

export default ClaimWorkflowRules
