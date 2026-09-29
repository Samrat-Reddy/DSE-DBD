import { formatRate } from '../../utils/commissionCalculation'
import { formatDate } from '../../utils/formatters'
import './CommissionList.css'
import './CommissionPanels.css'

/**
 * The commission rules in force, with the formula and the earning hold.
 * Rendered as a table inside a horizontally scrolling wrapper so it stays
 * readable at every width.
 */
const CommissionRulesTable = ({ rules = [], config }) => (
  <div className="commission-panel">
    <ul className="commission-calc__reasons">
      <li>
        <strong>Commission = commissionable amount × commission rate.</strong> The commissionable amount is a
        successful premium payment.
      </li>
      <li>
        The <strong>first-year rate</strong> applies to instalments in policy year 1; the <strong>renewal rate</strong>{' '}
        to later years.
      </li>
      <li>
        The rule used is the one in force on the payment date. An agent-specific rule takes priority over the product
        rule.
      </li>
      {config && (
        <li>
          Commission starts as <strong>Pending</strong>, can be confirmed as <strong>Earned</strong>{' '}
          {config.earningHoldDays} days after the payment, and is then <strong>Paid</strong> by an administrator.
        </li>
      )}
    </ul>

    <div className="commission-rules-wrap">
      <table className="commission-table commission-rules">
        <caption className="sr-only">Commission rules with product, scope, rates and effective period</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Product</th>
            <th scope="col">Applies to</th>
            <th scope="col" className="commission-table__numeric">First-year rate</th>
            <th scope="col" className="commission-table__numeric">Renewal rate</th>
            <th scope="col">Effective period</th>
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.ruleId}>
              <th scope="row">
                <span className="commission-list__mono">{rule.ruleId}</span>
                {rule.inForceToday ? (
                  <span className="commission-rules__tag">In force today</span>
                ) : (
                  <span className="commission-rules__tag commission-rules__tag--inactive">Not in force today</span>
                )}
              </th>
              <td>{rule.productName}</td>
              <td>{rule.agentName ? `Agent: ${rule.agentName}` : 'All agents'}</td>
              <td className="commission-table__numeric">{formatRate(rule.firstYearRatePercent)}</td>
              <td className="commission-table__numeric">{formatRate(rule.renewalRatePercent)}</td>
              <td className="commission-list__nowrap">
                {formatDate(rule.effectiveFrom)} – {rule.effectiveTo ? formatDate(rule.effectiveTo) : 'open-ended'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="commission-panel__footnote">Illustrative rates for demonstration only.</p>
  </div>
)

export default CommissionRulesTable
