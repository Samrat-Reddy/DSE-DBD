import { useRef, useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import { checkApprovalReadiness, validateRejectionReason } from '../../utils/claimAssessment'
import { formatCurrency } from '../../utils/formatters'
import './ClaimPanels.css'

/**
 * Approve or reject an assessed claim. The decision summary is shown by the
 * page directly above this panel.
 *
 * Approval needs a valid recorded assessment; rejection needs a reason. Both
 * rules are also enforced by the service.
 */
const ClaimDecisionPanel = ({ claim, onApprove, onReject, pending = false }) => {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState(null)
  const [serviceError, setServiceError] = useState(null)
  const rejectRef = useRef(null)

  const readiness = checkApprovalReadiness(claim)

  const handleApprove = async () => {
    setServiceError(null)
    const result = await onApprove()
    if (!result.ok) setServiceError(result.error?.message ?? 'The claim could not be approved.')
  }

  const handleReject = async () => {
    setServiceError(null)
    const error = validateRejectionReason(reason)
    setReasonError(error)
    if (error) {
      rejectRef.current?.querySelector('[name="rejectionReason"]')?.focus()
      return
    }
    const result = await onReject({ reason })
    if (!result.ok) {
      setReasonError(result.error?.data?.errors?.rejectionReason ?? null)
      setServiceError(result.error?.message ?? 'The claim could not be rejected.')
    }
  }

  return (
    <div className="claim-panel">
      {serviceError && (
        <p className="claim-panel__error" role="alert">
          {serviceError}
        </p>
      )}

      <div className="decision-options">
        <section className="decision-option decision-option--approve" aria-labelledby="decision-approve-title">
          <h3 id="decision-approve-title" className="decision-option__title">
            Approve
          </h3>
          <p className="decision-option__text">
            {readiness.ready
              ? `Approve for the assessed amount of ${formatCurrency(claim.assessment.assessedAmount)}.`
              : readiness.reason}
          </p>
          <Button onClick={handleApprove} disabled={pending || !readiness.ready}>
            {pending ? 'Working…' : 'Approve Claim'}
          </Button>
        </section>

        <section
          className="decision-option decision-option--reject"
          aria-labelledby="decision-reject-title"
          ref={rejectRef}
        >
          <h3 id="decision-reject-title" className="decision-option__title">
            Reject
          </h3>
          <FormField
            label="Rejection reason"
            name="rejectionReason"
            as="textarea"
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reasonError}
            hint="Required. Shown to the policyholder and recorded in the activity history."
            maxLength={500}
          />
          <Button variant="danger" onClick={handleReject} disabled={pending}>
            {pending ? 'Working…' : 'Reject Claim'}
          </Button>
        </section>
      </div>
    </div>
  )
}

export default ClaimDecisionPanel
