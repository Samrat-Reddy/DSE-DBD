import Button from '../common/Button'
import DataList from '../common/DataList'
import StatusBadge from '../common/StatusBadge'
import {
  formatCurrency,
  formatDate,
  formatDuration,
} from '../../utils/formatters'
import { buildPolicyDetailsPath, ROUTES } from '../../utils/constants'
import './IssuanceSuccess.css'

/**
 * Step 5 — confirmation after a successful mock issuance.
 *
 * The generated policy number is the most important element on the screen, so
 * it is given the most visual weight and is selectable for copying.
 */
const IssuanceSuccess = ({ policy, onIssueAnother }) => {
  if (!policy) return null

  return (
    <div className="issuance-success">
      <div className="issuance-success__banner">
        <span className="issuance-success__check" aria-hidden="true">
          ✓
        </span>
        <div>
          <h2 className="issuance-success__title">Policy issued successfully</h2>
          <p className="issuance-success__subtitle">
            The policy has been created and is now visible in the issued policy
            register.
          </p>
        </div>
      </div>

      <div className="issuance-success__number">
        <span className="issuance-success__number-label">Policy number</span>
        <strong className="issuance-success__number-value">{policy.id}</strong>
        <StatusBadge status={policy.status} size="lg" />
      </div>

      <div className="issuance-success__panel">
        <h3 className="issuance-success__panel-title">Issued policy summary</h3>
        <DataList
          items={[
            { label: 'Product', value: policy.productName },
            { label: 'Policy type', value: policy.type },
            { label: 'Policyholder', value: policy.policyholder.name },
            {
              label: 'Customer ID',
              value: policy.policyholder.customerId,
              mono: true,
            },
            {
              label: 'Coverage amount',
              value: formatCurrency(policy.coverageAmount),
            },
            {
              label: 'Premium',
              value: `${formatCurrency(policy.premium)} (${policy.premiumFrequency})`,
            },
            { label: 'Issue date', value: formatDate(policy.issueDate) },
            { label: 'Start date', value: formatDate(policy.startDate) },
            { label: 'End date', value: formatDate(policy.endDate) },
            { label: 'Duration', value: formatDuration(policy.durationYears) },
            { label: 'Nominee', value: policy.nominee.name },
            { label: 'Relationship', value: policy.nominee.relationship },
          ]}
          columns={3}
        />
      </div>

      <div className="issuance-success__actions">
        <Button to={buildPolicyDetailsPath(policy.id)} size="lg">
          View policy
        </Button>
        <Button variant="secondary" onClick={onIssueAnother}>
          Issue another policy
        </Button>
        <Button variant="ghost" to={ROUTES.POLICY_CATALOG}>
          Back to catalog
        </Button>
      </div>

      <p className="issuance-success__note">
        The policy has been saved to the database. Premium schedules, claims,
        renewals and commissions for newly issued policies arrive as those
        modules move to the API.
      </p>
    </div>
  )
}

export default IssuanceSuccess
