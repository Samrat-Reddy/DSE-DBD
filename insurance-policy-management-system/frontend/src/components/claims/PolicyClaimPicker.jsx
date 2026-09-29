import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildClaimFilingPath } from '../../utils/constants'
import { formatDate } from '../../utils/formatters'
import './ClaimFiling.css'

/**
 * Step one of filing: choose a policy. Every policy is listed with its
 * eligibility, so an ineligible policy explains itself instead of vanishing.
 */
const PolicyClaimPicker = ({ items = [] }) => (
  <ul className="policy-picker">
    {items.map(({ policy, eligibility }) => {
      const firstReason = eligibility.reasons[0]
      return (
        <li
          key={policy.id}
          className={`policy-picker__item policy-picker__item--${eligibility.eligible ? 'eligible' : 'blocked'}`}
        >
          <div className="policy-picker__main">
            <div className="policy-picker__top">
              <span className="policy-picker__id">{policy.id}</span>
              <StatusBadge status={policy.status} />
            </div>
            <p className="policy-picker__product">{policy.productName}</p>
            <p className="policy-picker__meta">
              {policy.policyholderName} · Cover {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
            </p>
            <p className={`policy-picker__verdict policy-picker__verdict--${eligibility.eligible ? 'eligible' : 'blocked'}`}>
              <span aria-hidden="true">{eligibility.eligible ? '✓' : '×'}</span>{' '}
              {eligibility.eligible
                ? `Eligible to file${eligibility.warnings.length ? ' · premium or cover notice' : ''}`
                : `Not eligible: ${firstReason}`}
            </p>
          </div>
          <div className="policy-picker__action">
            {eligibility.eligible ? (
              <Button to={buildClaimFilingPath(policy.id)}>
                Start claim<span className="sr-only"> for {policy.id}</span>
              </Button>
            ) : (
              <Button to={buildClaimFilingPath(policy.id)} variant="secondary">
                View eligibility<span className="sr-only"> for {policy.id}</span>
              </Button>
            )}
          </div>
        </li>
      )
    })}
  </ul>
)

export default PolicyClaimPicker
