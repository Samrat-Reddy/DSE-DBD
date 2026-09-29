import StatusBadge from '../common/StatusBadge'
import { PAYMENT_METHOD_LABELS } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PaymentSummaryPanel.css'

/**
 * "What am I paying?" — visible on every step of the payment flow, so the
 * amount and the instalment are never out of view while choosing options.
 */
const PaymentSummaryPanel = ({ account, installment, method }) => (
  <aside className="payment-summary" aria-labelledby="payment-summary-heading">
    <h2 id="payment-summary-heading" className="payment-summary__title">
      Payment summary
    </h2>

    {installment ? (
      <>
        <div className="payment-summary__amount">
          <span className="payment-summary__amount-label">Amount to pay</span>
          <strong className="payment-summary__amount-value">
            {formatCurrency(installment.amount)}
          </strong>
        </div>

        <dl className="payment-summary__list">
          <div>
            <dt>Policy</dt>
            <dd className="payment-summary__mono">{account.policyId}</dd>
          </div>
          <div>
            <dt>Product</dt>
            <dd>{account.policy?.productName ?? 'Policy record unavailable'}</dd>
          </div>
          <div>
            <dt>Policyholder</dt>
            <dd>{account.policy?.policyholderName ?? '—'}</dd>
          </div>
          <div>
            <dt>Instalment</dt>
            <dd>
              {installment.installmentNumber} of {account.totalInstallments}
            </dd>
          </div>
          <div>
            <dt>Due date</dt>
            <dd>{formatDate(installment.dueDate)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <StatusBadge status={installment.status} />
            </dd>
          </div>
          <div>
            <dt>Method</dt>
            <dd>{method ? PAYMENT_METHOD_LABELS[method] : 'Not selected'}</dd>
          </div>
        </dl>
      </>
    ) : (
      <p className="payment-summary__empty">Select an instalment to see its summary.</p>
    )}
  </aside>
)

export default PaymentSummaryPanel
