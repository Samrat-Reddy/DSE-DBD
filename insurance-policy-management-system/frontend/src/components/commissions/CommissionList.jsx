import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildAgentCommissionPath, buildCommissionDetailsPath, buildPaymentDetailsPath, buildPolicyCommissionPath } from '../../utils/constants'
import { formatRate } from '../../utils/commissionCalculation'
import { parseInstallmentNumber } from '../../utils/premiumCalculations'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './CommissionList.css'

/**
 * Commission register — a table on wide screens, cards below 900px, both
 * built from the same commission views. Amounts come from the service; this
 * component never calculates commission.
 */
const CommissionList = ({ commissions = [], showAgent = true }) => (
  <>
    <div className="commission-table-wrap">
      <table className="commission-table">
        <caption className="sr-only">
          Commission records with agent, policy, premium payment, calculation, amount and status
        </caption>
        <thead>
          <tr>
            <th scope="col">Commission</th>
            {showAgent && <th scope="col">Agent</th>}
            <th scope="col">Policy</th>
            <th scope="col">Premium payment</th>
            <th scope="col">Calculation</th>
            <th scope="col" className="commission-table__numeric">Commission</th>
            <th scope="col">Status</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {commissions.map((item) => (
            <tr key={item.commissionId}>
              <th scope="row">
                <Link className="commission-list__id" to={buildCommissionDetailsPath(item.commissionId)}>
                  {item.commissionId}
                </Link>
                <span className="commission-list__secondary">{item.basisLabel}</span>
              </th>
              {showAgent && (
                <td>
                  <Link className="commission-list__primary" to={buildAgentCommissionPath(item.agentId)}>
                    {item.agentName}
                  </Link>
                  <span className="commission-list__mono">{item.agentId}</span>
                </td>
              )}
              <td>
                <Link className="commission-list__primary" to={buildPolicyCommissionPath(item.policyId)}>
                  {item.policyId}
                </Link>
                <span className="commission-list__secondary">
                  {item.policyholderName ?? '—'} · {item.productName}
                </span>
              </td>
              <td>
                <Link className="commission-list__mono-link" to={buildPaymentDetailsPath(item.paymentId)}>
                  {item.paymentId}
                </Link>
                <span className="commission-list__secondary">
                  {formatDate(item.paymentDate)} · instalment {parseInstallmentNumber(item.installmentId)}
                </span>
              </td>
              <td className="commission-list__nowrap">
                {formatCurrency(item.commissionableAmount)} × {formatRate(item.ratePercent)}
              </td>
              <td className="commission-table__numeric commission-list__amount">{formatCurrency(item.amount)}</td>
              <td>
                <StatusBadge status={item.status} />
                {!item.linkage.valid && <span className="commission-list__warning">Payment link broken</span>}
              </td>
              <td className="commission-table__action">
                <Button to={buildCommissionDetailsPath(item.commissionId)} variant="secondary" size="sm">
                  Open
                  <span className="sr-only"> commission {item.commissionId}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="commission-cards">
      {commissions.map((item) => (
        <li key={item.commissionId} className={`commission-card commission-card--${item.status}`}>
          <div className="commission-card__top">
            <Link className="commission-list__id" to={buildCommissionDetailsPath(item.commissionId)}>
              {item.commissionId}
            </Link>
            <StatusBadge status={item.status} />
          </div>
          <p className="commission-card__amount">{formatCurrency(item.amount)}</p>
          <p className="commission-card__meta">
            {formatCurrency(item.commissionableAmount)} × {formatRate(item.ratePercent)} · {item.basisLabel}
          </p>
          <dl className="commission-card__figures">
            {showAgent && (
              <div>
                <dt>Agent</dt>
                <dd>{item.agentName}</dd>
              </div>
            )}
            <div>
              <dt>Policy</dt>
              <dd>{item.policyId}</dd>
            </div>
            <div>
              <dt>Payment</dt>
              <dd>{item.paymentId}</dd>
            </div>
            <div>
              <dt>Paid on</dt>
              <dd>{formatDate(item.paymentDate)}</dd>
            </div>
          </dl>
          <Button to={buildCommissionDetailsPath(item.commissionId)} variant="secondary" size="sm" fullWidth>
            Open commission
            <span className="sr-only"> {item.commissionId}</span>
          </Button>
        </li>
      ))}
    </ul>
  </>
)

export default CommissionList
