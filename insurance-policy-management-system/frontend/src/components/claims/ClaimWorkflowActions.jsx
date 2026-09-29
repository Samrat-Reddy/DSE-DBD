import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import ClaimAssessmentPanel from './ClaimAssessmentPanel'
import ClaimDecisionPanel from './ClaimDecisionPanel'
import ClaimSettlementPanel from './ClaimSettlementPanel'
import ClaimVerificationPanel from './ClaimVerificationPanel'
import {
  describeNextStep,
  getAvailableTransitions,
  isTerminalClaimStatus,
} from '../../utils/claimWorkflow'
import { CLAIM_STATUS, DEMO_ROLE_TITLES, ROLES } from '../../utils/constants'
import './ClaimPanels.css'

const S = CLAIM_STATUS

/**
 * The actions the current demo role can take on this claim right now.
 *
 * Which actions appear comes from the workflow transition table for the
 * claim's status and the role. The service independently enforces the same
 * table, so this panel is a convenience, not the safeguard.
 *
 * `onAction(kind, payload)` must resolve to `{ ok: boolean, error?: ApiError }`.
 */
const ClaimWorkflowActions = ({ details, role, onAction, pending = false }) => {
  const { claim } = details
  const available = getAvailableTransitions(claim.status, role)
  const availableTo = new Set(available.map((item) => item.toStatus))

  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false)
  const [withdrawNote, setWithdrawNote] = useState('')
  const [error, setError] = useState(null)

  const run = async (kind, payload) => {
    setError(null)
    const result = await onAction(kind, payload)
    if (!result.ok) setError(result.error?.message ?? 'The action could not be completed.')
    return result
  }

  const nextStep = <p className="workflow-actions__next">{describeNextStep(claim.status)}</p>

  if (isTerminalClaimStatus(claim.status)) {
    return (
      <div className="workflow-actions">
        {nextStep}
        <p className="workflow-actions__readonly">No further workflow actions are possible for this claim.</p>
      </div>
    )
  }

  if (!available.length) {
    return (
      <div className="workflow-actions">
        {nextStep}
        <p className="workflow-actions__readonly">
          {role === ROLES.AGENT
            ? 'Agents can follow this claim and help the policyholder with information, but cannot move it through review or make decisions.'
            : role === ROLES.POLICYHOLDER
              ? 'No action is needed from you at this stage. You will see each update in the timeline and activity history.'
              : `No workflow action is available to ${DEMO_ROLE_TITLES[role] ?? 'this role'} at this stage.`}
        </p>
      </div>
    )
  }

  return (
    <div className="workflow-actions">
      {nextStep}

      {error && (
        <p className="claim-panel__error" role="alert">
          {error}
        </p>
      )}

      {claim.status === S.SUBMITTED && (
        <div className="workflow-actions__row">
          {availableTo.has(S.UNDER_REVIEW) && (
            <Button onClick={() => run('start-review')} disabled={pending}>
              {pending ? 'Working…' : 'Move to Under Review'}
            </Button>
          )}

          {availableTo.has(S.CANCELLED) && !confirmingWithdraw && (
            <Button variant="secondary" onClick={() => setConfirmingWithdraw(true)} disabled={pending}>
              Withdraw claim
            </Button>
          )}
        </div>
      )}

      {claim.status === S.SUBMITTED && availableTo.has(S.CANCELLED) && confirmingWithdraw && (
        <div className="workflow-actions__confirm">
          <p className="workflow-actions__confirm-title">Withdraw this claim?</p>
          <p className="claim-panel__muted">
            A withdrawn claim is closed and cannot be reopened. You can file a new claim later if needed.
          </p>
          <FormField
            label="Reason for withdrawal"
            name="withdrawNote"
            as="textarea"
            hint="Optional. Recorded in the activity history."
            value={withdrawNote}
            onChange={(event) => setWithdrawNote(event.target.value)}
            maxLength={300}
          />
          <div className="workflow-actions__row">
            <Button
              variant="danger"
              disabled={pending}
              onClick={async () => {
                const result = await run('withdraw', { note: withdrawNote })
                if (result.ok) setConfirmingWithdraw(false)
              }}
            >
              Confirm withdrawal
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingWithdraw(false)} disabled={pending}>
              Keep claim
            </Button>
          </div>
        </div>
      )}

      {claim.status === S.UNDER_REVIEW && availableTo.has(S.VERIFIED) && (
        <ClaimVerificationPanel
          checklist={details.verificationChecklist}
          onVerify={(payload) => onAction('verify', payload)}
          pending={pending}
        />
      )}

      {claim.status === S.VERIFIED && availableTo.has(S.ASSESSED) && (
        <ClaimAssessmentPanel
          claim={claim}
          coverage={details.coverage}
          onAssess={(payload) => onAction('assess', payload)}
          pending={pending}
        />
      )}

      {claim.status === S.ASSESSED && (availableTo.has(S.APPROVED) || availableTo.has(S.REJECTED)) && (
        <ClaimDecisionPanel
          claim={claim}
          onApprove={() => onAction('approve')}
          onReject={(payload) => onAction('reject', payload)}
          pending={pending}
        />
      )}

      {claim.status === S.APPROVED && availableTo.has(S.SETTLED) && (
        <ClaimSettlementPanel claim={claim} onSettle={() => onAction('settle')} pending={pending} />
      )}
    </div>
  )
}

export default ClaimWorkflowActions
