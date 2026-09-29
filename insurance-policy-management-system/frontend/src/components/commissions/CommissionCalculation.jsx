import { formatRate } from '../../utils/commissionCalculation'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './CommissionPanels.css'

/**
 * Answers "why is the commission this amount?" from the explanation the
 * service returns: commissionable amount × rate = commission, then why that
 * rate and that rule applied.
 */
const CommissionCalculation = ({ explanation }) => {
  if (!explanation) return null

  return (
    <div className="commission-panel">
      <dl className="commission-calc" aria-label="Commission calculation">
        <div className="commission-calc__row">
          <dt>Commissionable amount</dt>
          <dd>{formatCurrency(explanation.commissionableAmount)}</dd>
        </div>
        <div className="commission-calc__row">
          <dt>
            <span aria-hidden="true">× </span>Commission rate
          </dt>
          <dd>{formatRate(explanation.ratePercent)}</dd>
        </div>
        <div className="commission-calc__row commission-calc__row--total">
          <dt>
            <span aria-hidden="true">= </span>Commission
          </dt>
          <dd>{formatCurrency(explanation.amount)}</dd>
        </div>
      </dl>

      <p className="commission-calc__formula">
        <span className="sr-only">Formula: </span>
        {explanation.formula}
      </p>

      <ul className="commission-calc__reasons">
        <li>
          <strong>Basis:</strong> {explanation.basisLabel}. {explanation.basisReason}
        </li>
        {explanation.ruleReason && (
          <li>
            <strong>Rule:</strong> {explanation.ruleReason} {explanation.ruleDescription}
          </li>
        )}
        {explanation.effectiveFrom && (
          <li>
            <strong>Effective period:</strong> {formatDate(explanation.effectiveFrom)} –{' '}
            {explanation.effectiveTo ? formatDate(explanation.effectiveTo) : 'open-ended'}
          </li>
        )}
      </ul>

      <p className="commission-panel__footnote">
        Illustrative rates. The amount is calculated once, in whole paise, when the commission is generated.
      </p>
    </div>
  )
}

export default CommissionCalculation
