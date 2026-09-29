import { useState } from 'react'
import Button from '../common/Button'
import FormField from '../common/FormField'
import ClaimChecklist from './ClaimChecklist'
import './ClaimPanels.css'

/**
 * Structured verification review. The checklist is produced by the service
 * from the claim, policy, coverage, documents and premium standing; any
 * failed check blocks verification (and the service blocks it too).
 */
const ClaimVerificationPanel = ({ checklist, onVerify, pending = false }) => {
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)

  const handleVerify = async () => {
    setError(null)
    const result = await onVerify({ note })
    if (!result.ok) setError(result.error?.message ?? 'Verification failed.')
  }

  return (
    <div className="claim-panel">
      <p className="claim-panel__intro">
        Review each item below. Verification records who verified the claim, when, and the outcome of these
        checks. No real legal or insurance verification is performed.
      </p>

      <ClaimChecklist checks={checklist.checks} label="Verification checks" />

      <p className="claim-panel__tally" role="status">
        {checklist.passed} passed · {checklist.warnings} need attention · {checklist.failures} failed
      </p>

      {checklist.blocking && (
        <p className="claim-panel__blocked" role="alert">
          This claim cannot be verified until every failed check is resolved.
        </p>
      )}

      <FormField
        label="Verification note"
        name="verificationNote"
        as="textarea"
        hint="Optional. Recorded in the activity history."
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={500}
      />

      {error && (
        <p className="claim-panel__error" role="alert">
          {error}
        </p>
      )}

      <div className="claim-panel__actions">
        <Button onClick={handleVerify} disabled={pending || checklist.blocking}>
          {pending ? 'Verifying…' : 'Verify Claim'}
        </Button>
      </div>
    </div>
  )
}

export default ClaimVerificationPanel
