import { Link } from 'react-router-dom'
import StatusBadge from '../common/StatusBadge'
import {
  buildPaymentDetailsPath,
  buildPolicyPremiumsPath,
  PAYMENT_METHOD_LABELS,
} from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PaymentHistoryList.css'

/**
 * Payment records — a table on wide screens, cards below 900px.
 *
 * `showPolicy` hides the policy column when the list is already scoped to a
 * single policy (the premium details page).
 */
const PaymentHistoryList = ({ payments = [], showPolicy = true }) => (
  <>
    <div className="payment-table-wrap">
      <table className="payment-table">
        <caption className="sr-only">
          Payment records with payment ID, {showPolicy ? 'policy, ' : ''}instalment, amount,
          date, method, transaction reference and status
        </caption>
        <thead>
          <tr>
            <th scope="col">Payment ID</th>
            {showPolicy && <th scope="col">Policy</th>}
            <th scope="col">Instalment</th>
            <th scope="col" className="payment-table__numeric">Amount</th>
            <th scope="col">Date</th>
            <th scope="col">Method</th>
            <th scope="col">Transaction reference</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr key={payment.paymentId}>
              <th scope="row">
                <Link className="payment-list__id" to={buildPaymentDetailsPath(payment.paymentId)}>
                  {payment.paymentId}
                </Link>
                {payment.isSessionRecorded && <span className="payment-list__new">New</span>}
              </th>
              {showPolicy && (
                <td>
                  <Link className="payment-list__policy" to={buildPolicyPremiumsPath(payment.policyId)}>
                    {payment.policyId}
                  </Link>
                  <span className="payment-list__secondary">
                    {payment.policyholderName ?? 'Policy record unavailable'}
                  </span>
                </td>
              )}
              <td>#{payment.installmentNumber ?? '—'}</td>
              <td className="payment-table__numeric payment-list__amount">
                {formatCurrency(payment.amount)}
              </td>
              <td className="payment-list__nowrap">{formatDate(payment.paymentDate)}</td>
              <td>{PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}</td>
              <td className="payment-list__mono">{payment.transactionReference}</td>
              <td>
                <StatusBadge status={payment.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="payment-cards">
      {payments.map((payment) => (
        <li key={payment.paymentId} className={`payment-card payment-card--${payment.status}`}>
          <div className="payment-card__top">
            <Link className="payment-list__id" to={buildPaymentDetailsPath(payment.paymentId)}>
              {payment.paymentId}
            </Link>
            <StatusBadge status={payment.status} />
          </div>

          <div className="payment-card__amount">{formatCurrency(payment.amount)}</div>
          <p className="payment-card__meta">
            {formatDate(payment.paymentDate)} ·{' '}
            {PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod}
          </p>

          <dl className="payment-card__figures">
            {showPolicy && (
              <div>
                <dt>Policy</dt>
                <dd className="payment-list__mono">{payment.policyId}</dd>
              </div>
            )}
            <div>
              <dt>Instalment</dt>
              <dd>#{payment.installmentNumber ?? '—'}</dd>
            </div>
            <div className="payment-card__wide">
              <dt>Transaction reference</dt>
              <dd className="payment-list__mono">{payment.transactionReference}</dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  </>
)

export default PaymentHistoryList
