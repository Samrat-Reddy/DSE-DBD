import { useEffect, useRef } from 'react'
import Button from '../common/Button'
import DataList from '../common/DataList'
import StatusBadge from '../common/StatusBadge'
import { buildClaimDetailsPath, buildClaimFilingPath, ROUTES } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './ClaimFiling.css'

/** Confirmation after a claim is filed, with the generated claim ID. */
const ClaimFilingSuccess = ({ details }) => {
  const headingRef = useRef(null)
  const { claim } = details

  // Move focus to the confirmation so the outcome is announced.
  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <div className="claim-success">
      <div className="claim-success__banner">
        <span className="claim-success__icon" aria-hidden="true">
          ✓
        </span>
        <div>
          <h2 className="claim-success__title" tabIndex={-1} ref={headingRef}>
            Claim submitted
          </h2>
          <p className="claim-success__subtitle">
            The claim is now waiting for a claims officer to start the review.
          </p>
        </div>
      </div>

      <div className="claim-success__reference">
        <span className="claim-success__reference-label">Claim ID</span>
        <strong className="claim-success__reference-value">{claim.claimId}</strong>
        <StatusBadge status={claim.status} size="lg" />
      </div>

      <DataList
        columns={3}
        items={[
          { label: 'Policy', value: claim.policyId, mono: true },
          { label: 'Claim type', value: claim.claimTypeLabel },
          { label: 'Incident date', value: formatDate(claim.incidentDate) },
          { label: 'Claimed amount', value: formatCurrency(claim.claimedAmount) },
          { label: 'Filing date', value: formatDate(claim.filingDate) },
          { label: 'Documents recorded', value: claim.documents.length },
        ]}
      />

      <div className="claim-success__actions">
        <Button to={buildClaimDetailsPath(claim.claimId)} size="lg">
          View Claim
        </Button>
        <Button variant="secondary" to={buildClaimFilingPath()}>
          File another claim
        </Button>
        <Button variant="ghost" to={ROUTES.CLAIMS}>
          All claims
        </Button>
      </div>
    </div>
  )
}

export default ClaimFilingSuccess
