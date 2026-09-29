import { useState } from 'react'
import Button from '../common/Button'
import DataList from '../common/DataList'
import { CLAIM_STATUS, DEMO_ROLE_TITLES } from '../../utils/constants'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'
import './ClaimPanels.css'

/**
 * Settlement state. For an approved claim, records settlement; for a settled
 * claim, shows the record. This never makes a payment and never touches the
 * premium or payment module.
 */
const ClaimSettlementPanel = ({ claim, onSettle, pending = false }) => {
  const [error, setError] = useState(null)

  if (claim.status === CLAIM_STATUS.SETTLED && claim.settlement) {
    const { settlement } = claim
    return (
      <DataList
        columns={2}
        items={[
          { label: 'Settlement reference', value: settlement.reference, mono: true },
          { label: 'Settlement date', value: formatDate(settlement.settledDate) },
          { label: 'Settled amount', value: formatCurrency(settlement.amount) },
          {
            label: 'Recorded by',
            value: `${settlement.settledBy?.name} (${DEMO_ROLE_TITLES[settlement.settledBy?.role] ?? settlement.settledBy?.role})`,
          },
          { label: 'Recorded at', value: formatDateTime(settlement.settledAt) },
          { label: 'Note', value: settlement.note, span: true },
        ]}
      />
    )
  }

  const handleSettle = async () => {
    setError(null)
    const result = await onSettle()
    if (!result.ok) setError(result.error?.message ?? 'Settlement could not be recorded.')
  }

  return (
    <div className="claim-panel">
      <DataList
        columns={2}
        items={[
          { label: 'Approved amount', value: formatCurrency(claim.approvedAmount) },
          { label: 'Approved on', value: formatDate(claim.decision?.decidedAt) },
        ]}
      />
      <div className="claim-panel__notice">
        <strong>Workflow state only.</strong> Marking as settled records a settlement reference and date. No
        payment is made and no bank or payment system is contacted.
      </div>
      {error && (
        <p className="claim-panel__error" role="alert">
          {error}
        </p>
      )}
      <div className="claim-panel__actions">
        <Button onClick={handleSettle} disabled={pending}>
          {pending ? 'Recording settlement…' : 'Mark as Settled'}
        </Button>
      </div>
    </div>
  )
}

export default ClaimSettlementPanel
