import { Link } from 'react-router-dom'
import DataList from '../common/DataList'
import StatusBadge from '../common/StatusBadge'
import { ErrorState } from '../common/StateViews'
import { buildPolicyDetailsPath, buildPolicyPremiumsPath } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './ClaimPanels.css'

/**
 * The issued policy behind a claim: identity, cover, the coverage this claim
 * relies on, and premium standing from Module 2.
 */
const ClaimPolicyContext = ({ policy, policyError, coverage, premium, claimType }) => {
  if (!policy) {
    return (
      <ErrorState
        title="Policy record unavailable"
        description={policyError?.message ?? 'The policy for this claim could not be found.'}
        error={policyError}
      />
    )
  }

  return (
    <DataList
      columns={2}
      items={[
        {
          label: 'Policy',
          value: <Link to={buildPolicyDetailsPath(policy.id)}>{policy.id}</Link>,
          mono: true,
        },
        { label: 'Product', value: policy.productName },
        {
          label: 'Policyholder',
          value: `${policy.policyholderName} (${policy.customerId})`,
        },
        { label: 'Policy status', value: <StatusBadge status={policy.status} /> },
        {
          label: 'Cover period',
          value: `${formatDate(policy.startDate)} – ${formatDate(policy.endDate)}`,
        },
        { label: 'Sum insured', value: formatCurrency(policy.coverageAmount) },
        {
          label: 'Coverage relevant to this claim',
          span: true,
          value: coverage?.coverageItem ? (
            <>
              {coverage.coverageItem.name} — {coverage.coverageItem.limit}
              {coverage.limit && (
                <span className="claim-context__limit">
                  Illustrative limit: <strong>{formatCurrency(coverage.limit.limit)}</strong> ({coverage.limit.basis})
                </span>
              )}
            </>
          ) : (
            `${claimType?.label ?? 'This claim type'} is not matched to a coverage item on this product.`
          ),
        },
        {
          label: 'Premium standing',
          span: true,
          value: premium ? (
            <>
              <StatusBadge status={premium.standing} />{' '}
              <span className="claim-context__premium">
                {premium.counts.overdue > 0
                  ? `${formatCurrency(premium.overdueAmount)} overdue since ${formatDate(premium.oldestOverdueDate)}. Shown for context; it does not block this claim.`
                  : 'No premium is overdue.'}{' '}
                <Link to={buildPolicyPremiumsPath(policy.id)}>View premium schedule</Link>
              </span>
            </>
          ) : (
            'No premium schedule is available for this policy.'
          ),
        },
      ]}
    />
  )
}

export default ClaimPolicyContext
