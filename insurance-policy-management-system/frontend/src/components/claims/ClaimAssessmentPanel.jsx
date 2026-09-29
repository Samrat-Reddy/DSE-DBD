import { useRef, useState } from 'react'
import Button from '../common/Button'
import DataList from '../common/DataList'
import FormField from '../common/FormField'
import { suggestAssessedAmount, validateAssessment } from '../../utils/claimAssessment'
import { formatCurrency } from '../../utils/formatters'
import './ClaimPanels.css'

/**
 * Assessment of the payable amount against illustrative limits.
 *
 * Rules (shared with the service): positive, not above the claimed amount,
 * not above the illustrative limit, and a note is required when reducing.
 */
const ClaimAssessmentPanel = ({ claim, coverage, onAssess, pending = false }) => {
  const [assessedAmount, setAssessedAmount] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState({})
  const [serviceError, setServiceError] = useState(null)
  const panelRef = useRef(null)

  const limit = coverage?.limit ?? null
  const suggested = limit ? suggestAssessedAmount(claim.claimedAmount, limit.limit) : null

  const focusField = (name) => panelRef.current?.querySelector(`[name="${name}"]`)?.focus()

  const handleAssess = async () => {
    setServiceError(null)
    const nextErrors = validateAssessment({
      assessedAmount,
      claimedAmount: claim.claimedAmount,
      limit: limit?.limit,
      note,
    })
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length) {
      focusField(nextErrors.assessedAmount ? 'assessedAmount' : 'assessmentNote')
      return
    }

    const result = await onAssess({ assessedAmount: Number(assessedAmount), note })
    if (!result.ok) {
      const fieldErrors = result.error?.data?.errors ?? {}
      setErrors(fieldErrors)
      setServiceError(result.error?.message ?? 'The assessment could not be recorded.')
    }
  }

  if (!limit) {
    return (
      <p className="claim-panel__blocked" role="alert">
        The illustrative limit cannot be calculated because the policy or claim type is unavailable, so this claim
        cannot be assessed.
      </p>
    )
  }

  return (
    <div className="claim-panel" ref={panelRef}>
      <DataList
        columns={2}
        items={[
          { label: 'Claimed amount', value: formatCurrency(claim.claimedAmount) },
          { label: 'Sum insured (coverage)', value: formatCurrency(limit.coverageAmount) },
          {
            label: 'Applicable illustrative limit',
            value: (
              <>
                {formatCurrency(limit.limit)}
                <span className="claim-panel__basis">{limit.basis}</span>
              </>
            ),
          },
          {
            label: 'Potential approved amount',
            value: (
              <>
                {formatCurrency(suggested)}
                <span className="claim-panel__basis">Lower of the claimed amount and the limit</span>
              </>
            ),
          },
        ]}
      />

      <div className="claim-panel__notice">
        <strong>Illustrative business rules.</strong> These limits are frontend demonstration rules, not real
        insurance adjudication rules.
      </div>

      <div className="claim-panel__fields">
        <FormField
          label="Assessed amount"
          name="assessedAmount"
          type="number"
          prefix="₹"
          required
          min={1}
          step="0.01"
          value={assessedAmount}
          onChange={(event) => setAssessedAmount(event.target.value)}
          error={errors.assessedAmount}
          hint={`Cannot exceed ${formatCurrency(Math.min(claim.claimedAmount, limit.limit))}.`}
        />
        <div className="claim-panel__suggest">
          <Button variant="ghost" size="sm" onClick={() => setAssessedAmount(String(suggested))}>
            Use potential amount ({formatCurrency(suggested)})
          </Button>
        </div>
        <FormField
          label="Assessment note"
          name="assessmentNote"
          as="textarea"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={errors.note}
          hint="Required when the assessed amount is below the claimed amount."
          maxLength={500}
        />
      </div>

      {serviceError && (
        <p className="claim-panel__error" role="alert">
          {serviceError}
        </p>
      )}

      <div className="claim-panel__actions">
        <Button onClick={handleAssess} disabled={pending}>
          {pending ? 'Recording assessment…' : 'Record Assessment'}
        </Button>
      </div>
    </div>
  )
}

export default ClaimAssessmentPanel
