import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildCommissionDetailsPath, buildPaymentDetailsPath } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './CommissionPanels.css'

/**
 * Every premium payment on a policy and what it means for commission:
 * already commissioned (with a link), eligible and awaiting generation (with
 * the amount it would generate), or not commissionable (with the reason).
 *
 * `onGenerate(paymentId)` is offered to administrators only.
 */
const CommissionPaymentList = ({ payments = [], canManage = false, onGenerate, pending = false }) => {
  if (!payments.length) {
    return <p className="commission-panel__intro">No premium payments have been recorded for this policy yet.</p>
  }

  return (
    <ul className="commission-payments">
      {payments.map((payment) => (
        <li key={payment.paymentId} className="commission-payments__item">
          <div className="commission-payments__head">
            <Link className="commission-payments__id" to={buildPaymentDetailsPath(payment.paymentId)}>
              {payment.paymentId}
            </Link>
            <StatusBadge status={payment.status} />
            <span className="commission-payments__meta">
              {formatCurrency(payment.amount)} · {formatDate(payment.paymentDate)} · {payment.installmentId}
            </span>
          </div>

          {payment.commissionId ? (
            <p className="commission-payments__outcome">
              Commission <Link to={buildCommissionDetailsPath(payment.commissionId)}>{payment.commissionId}</Link>:{' '}
              {formatCurrency(payment.commissionAmount)} <StatusBadge status={payment.commissionStatus} />
            </p>
          ) : payment.eligible ? (
            <div className="commission-payments__eligible">
              <p className="commission-payments__outcome">
                <strong>Awaiting commission.</strong> Would generate {formatCurrency(payment.previewAmount)} (
                {payment.previewExplanation?.formula}).
              </p>
              {canManage && (
                <Button size="sm" onClick={() => onGenerate(payment.paymentId)} disabled={pending}>
                  Generate commission
                  <span className="sr-only"> for {payment.paymentId}</span>
                </Button>
              )}
            </div>
          ) : (
            <p className="commission-payments__outcome commission-payments__outcome--blocked">
              <strong>No commission.</strong> {payment.reason}
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

export default CommissionPaymentList
