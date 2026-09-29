import Button from '../common/Button'
import DataList from '../common/DataList'
import StatusBadge from '../common/StatusBadge'
import MockNotice from './MockNotice'
import {
  buildPaymentDetailsPath,
  buildPolicyPremiumsPath,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
  ROUTES,
} from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PaymentResult.css'

/**
 * Outcome of a mock payment: success or failure.
 *
 * The payment ID and transaction reference get the most visual weight. On
 * success the before/after balances show the financial effect immediately.
 */
const PaymentResult = ({ result, onRetry }) => {
  const { payment, installment, account, previousSummary } = result
  const succeeded = payment.status === PAYMENT_STATUS.SUCCESS

  return (
    <div className={`payment-result payment-result--${payment.status}`}>
      <div className="payment-result__banner" role="status" aria-live="polite">
        <span className="payment-result__icon" aria-hidden="true">
          {succeeded ? '✓' : '×'}
        </span>
        <div>
          <h2 className="payment-result__title" tabIndex={-1}>
            {succeeded ? 'Mock payment successful' : 'Mock payment declined'}
          </h2>
          <p className="payment-result__subtitle">
            {succeeded
              ? `Instalment ${installment.installmentNumber} is now marked as paid.`
              : `Instalment ${installment.installmentNumber} remains unpaid. You can try again.`}
          </p>
        </div>
      </div>

      <div className="payment-result__reference">
        <div>
          <span className="payment-result__reference-label">Payment ID</span>
          <strong className="payment-result__reference-value">{payment.paymentId}</strong>
        </div>
        <div>
          <span className="payment-result__reference-label">Transaction reference</span>
          <strong className="payment-result__reference-value">
            {payment.transactionReference}
          </strong>
        </div>
        <StatusBadge status={payment.status} size="lg" />
      </div>

      <div className="payment-result__panel">
        <h3 className="payment-result__panel-title">Payment details</h3>
        <DataList
          columns={3}
          items={[
            { label: 'Amount', value: formatCurrency(payment.amount) },
            { label: 'Payment date', value: formatDate(payment.paymentDate) },
            {
              label: 'Payment method',
              value: PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod,
            },
            { label: 'Policy', value: payment.policyId, mono: true },
            {
              label: 'Instalment',
              value: `${installment.installmentNumber} · due ${formatDate(installment.dueDate)}`,
            },
            {
              label: 'Instalment status',
              value: <StatusBadge status={installment.status} />,
            },
            ...(payment.failureReason
              ? [{ label: 'Reason', value: payment.failureReason, span: true }]
              : []),
          ]}
        />
      </div>

      {succeeded && (
        <div className="payment-result__panel">
          <h3 className="payment-result__panel-title">Updated financial position</h3>
          <dl className="balance-change">
            <div className="balance-change__row">
              <dt>Total paid</dt>
              <dd>
                <span className="balance-change__before">
                  {formatCurrency(previousSummary.totalPaid)}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changed to </span>
                <strong>{formatCurrency(account.summary.totalPaid)}</strong>
              </dd>
            </div>
            <div className="balance-change__row">
              <dt>Total outstanding</dt>
              <dd>
                <span className="balance-change__before">
                  {formatCurrency(previousSummary.outstanding)}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changed to </span>
                <strong>{formatCurrency(account.summary.outstanding)}</strong>
              </dd>
            </div>
            <div className="balance-change__row">
              <dt>Payable now</dt>
              <dd>
                <span className="balance-change__before">
                  {formatCurrency(previousSummary.payableNow)}
                </span>
                <span aria-hidden="true"> → </span>
                <span className="sr-only"> changed to </span>
                <strong>{formatCurrency(account.summary.payableNow)}</strong>
              </dd>
            </div>
          </dl>
        </div>
      )}

      <MockNotice title="No real transaction took place">
        This payment was simulated in the browser. No money moved and no payment provider was
        contacted.
      </MockNotice>

      <div className="payment-result__actions">
        {succeeded ? (
          <Button to={buildPaymentDetailsPath(payment.paymentId)} size="lg">
            View payment details
          </Button>
        ) : (
          <Button onClick={onRetry} size="lg">
            Try again
          </Button>
        )}
        <Button variant="secondary" to={buildPolicyPremiumsPath(payment.policyId)}>
          Back to premium schedule
        </Button>
        <Button variant="ghost" to={ROUTES.PAYMENT_HISTORY}>
          Payment history
        </Button>
      </div>
    </div>
  )
}

export default PaymentResult
