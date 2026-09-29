import Button from '../common/Button'
import StatGrid from '../common/StatGrid'
import StatusBadge from '../common/StatusBadge'
import { buildPremiumPaymentPath, INSTALLMENT_STATUS } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './FinancialSummary.css'

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * Financial state of one policy, readable within seconds.
 *
 * Overdue premium is surfaced first as a banner with the amount, count, the
 * oldest due date and a direct action, then the headline figures follow.
 */
const FinancialSummary = ({ account, canRecordPayment = false }) => {
  const { summary } = account
  const overdue = summary.counts.overdue > 0
  const paidPercent = Math.round(summary.paidRatio * 100)

  const items = [
    {
      id: 'premium',
      label: 'Instalment premium',
      value: formatCurrency(account.premiumAmount),
      detail: `${account.frequency} payments`,
    },
    {
      id: 'total',
      label: 'Total premium payable',
      value: formatCurrency(summary.totalPremium),
      detail: `${plural(summary.totalInstallments, 'instalment')} over the full term`,
    },
    {
      id: 'paid',
      tone: 'paid',
      label: 'Total paid',
      value: formatCurrency(summary.totalPaid),
      detail: `${plural(summary.counts.paid, 'instalment')} paid`,
    },
    {
      id: 'outstanding',
      label: 'Total outstanding',
      value: formatCurrency(summary.outstanding),
      detail: 'Unpaid premium for the rest of the term',
    },
    {
      id: 'payable-now',
      tone: overdue ? 'overdue' : summary.counts.due > 0 ? 'due' : 'neutral',
      label: 'Payable now',
      value: formatCurrency(summary.payableNow),
      detail: overdue
        ? `Includes ${formatCurrency(summary.overdueAmount)} overdue`
        : summary.counts.due > 0
          ? `${plural(summary.counts.due, 'instalment')} due`
          : 'Nothing is due right now',
    },
    {
      id: 'next-due',
      tone: summary.nextDueStatus === INSTALLMENT_STATUS.OVERDUE ? 'overdue' : 'upcoming',
      label: 'Next due',
      value: summary.nextDueDate ? formatCurrency(summary.nextDueAmount) : '—',
      detail: summary.nextDueDate ? (
        <>
          {formatDate(summary.nextDueDate)}{' '}
          <StatusBadge status={summary.nextDueStatus} />
        </>
      ) : (
        'All instalments are paid'
      ),
    },
  ]

  return (
    <div className="financial-summary">
      {overdue && (
        <div className="overdue-banner">
          <div className="overdue-banner__text">
            <h3 className="overdue-banner__title">
              {plural(summary.counts.overdue, 'instalment')} overdue ·{' '}
              {formatCurrency(summary.overdueAmount)}
            </h3>
            <p className="overdue-banner__detail">
              Oldest overdue instalment was due on {formatDate(summary.oldestOverdueDate)} (
              {plural(summary.oldestOverdueDays, 'day')} ago). The policy status is not changed
              by an overdue premium.
            </p>
          </div>
          {canRecordPayment && summary.oldestOverdueInstallmentId && (
            <Button
              to={buildPremiumPaymentPath(account.policyId, summary.oldestOverdueInstallmentId)}
              variant="danger"
            >
              Pay oldest overdue
            </Button>
          )}
        </div>
      )}

      <StatGrid items={items} columns={3} />

      <div className="premium-progress">
        <div className="premium-progress__labels">
          <label htmlFor={`progress-${account.policyId}`} className="premium-progress__label">
            Instalments paid
          </label>
          <span className="premium-progress__value">
            {summary.counts.paid} of {summary.totalInstallments} ({paidPercent}%)
          </span>
        </div>
        <progress
          id={`progress-${account.policyId}`}
          className="premium-progress__bar"
          value={summary.counts.paid}
          max={summary.totalInstallments || 1}
        >
          {paidPercent}%
        </progress>
      </div>
    </div>
  )
}

export default FinancialSummary
