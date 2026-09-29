import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import {
  buildPaymentDetailsPath,
  buildPremiumPaymentPath,
  INSTALLMENT_STATUS,
  SCHEDULE_PREVIEW_UPCOMING,
} from '../../utils/constants'
import {
  selectVisibleInstallments,
  sortInstallmentsByDueDate,
} from '../../utils/premiumCalculations'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PremiumScheduleTable.css'

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/** Short human explanation under the status badge. */
const StatusNote = ({ installment }) => {
  const notes = []

  if (installment.status === INSTALLMENT_STATUS.OVERDUE) {
    notes.push(`${plural(installment.daysOverdue, 'day')} overdue`)
  }
  if (installment.status === INSTALLMENT_STATUS.DUE) {
    notes.push(
      installment.daysUntilDue === 0
        ? 'Due today'
        : `Due in ${plural(installment.daysUntilDue, 'day')}`,
    )
  }
  if (installment.isPartiallyPaid) {
    notes.push(`${formatCurrency(installment.amountPaid)} paid, ${formatCurrency(installment.outstanding)} left`)
  }
  if (installment.pendingPaymentId) {
    notes.push('Payment pending')
  }
  if (installment.failedAttempts > 0 && installment.status !== INSTALLMENT_STATUS.PAID) {
    notes.push(`${plural(installment.failedAttempts, 'failed attempt')}`)
  }

  return notes.length ? <span className="schedule__note">{notes.join(' · ')}</span> : null
}

/** The single action available for an instalment, if any. */
const InstallmentAction = ({ installment, policyId, canRecordPayment, fullWidth = false }) => {
  if (installment.status === INSTALLMENT_STATUS.PAID) {
    return (
      <Button
        to={buildPaymentDetailsPath(installment.paymentId)}
        variant="ghost"
        size="sm"
        fullWidth={fullWidth}
      >
        View payment
        <span className="sr-only"> for instalment {installment.installmentNumber}</span>
      </Button>
    )
  }

  if (installment.status === INSTALLMENT_STATUS.UPCOMING) {
    return (
      <span className="schedule__muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not yet payable</span>
      </span>
    )
  }

  if (installment.pendingPaymentId) {
    return <span className="schedule__muted">Payment pending</span>
  }

  if (!canRecordPayment) {
    return <span className="schedule__muted">Awaiting payment</span>
  }

  return (
    <Button
      to={buildPremiumPaymentPath(policyId, installment.installmentId)}
      variant={installment.status === INSTALLMENT_STATUS.OVERDUE ? 'danger' : 'primary'}
      size="sm"
      fullWidth={fullWidth}
    >
      Pay premium
      <span className="sr-only"> for instalment {installment.installmentNumber}</span>
    </Button>
  )
}

/**
 * Chronological premium schedule.
 *
 * Long schedules (a 25-year quarterly plan has 100 instalments) show every
 * past instalment plus the next few upcoming ones, with a disclosure button
 * to reveal the rest. Only far-future rows are ever collapsed.
 */
const PremiumScheduleTable = ({ installments = [], policyId, canRecordPayment = false }) => {
  const [showAll, setShowAll] = useState(false)
  const baseId = useId()
  const tableId = `${baseId}-table`
  const cardsId = `${baseId}-cards`

  const { visible, hiddenCount } = selectVisibleInstallments(
    installments,
    SCHEDULE_PREVIEW_UPCOMING,
  )
  const rows = showAll ? sortInstallmentsByDueDate(installments) : visible
  const canToggle = hiddenCount > 0

  if (!installments.length) {
    return <p className="schedule__muted">This schedule has no instalments.</p>
  }

  return (
    <div className="schedule">
      <div className="schedule-table-wrap" id={tableId}>
        <table className="schedule-table">
          <caption className="sr-only">
            Premium schedule for {policyId}, in due-date order. Showing {rows.length} of{' '}
            {installments.length} instalments.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="schedule-table__number">#</th>
              <th scope="col">Due date</th>
              <th scope="col" className="schedule-table__numeric">Amount</th>
              <th scope="col">Status</th>
              <th scope="col">Paid date</th>
              <th scope="col">Payment</th>
              <th scope="col" className="schedule-table__action">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((installment) => (
              <tr
                key={installment.installmentId}
                className={`schedule-table__row schedule-table__row--${installment.status}`}
              >
                <th scope="row" className="schedule-table__number">
                  {installment.installmentNumber}
                </th>
                <td className="schedule-table__date">{formatDate(installment.dueDate)}</td>
                <td className="schedule-table__numeric schedule-table__amount">
                  {formatCurrency(installment.amount)}
                </td>
                <td>
                  <StatusBadge status={installment.status} />
                  <StatusNote installment={installment} />
                </td>
                <td className="schedule-table__date">
                  {installment.paidDate ? formatDate(installment.paidDate) : '—'}
                </td>
                <td>
                  {installment.paymentId ? (
                    <Link
                      className="schedule__payment-link"
                      to={buildPaymentDetailsPath(installment.paymentId)}
                    >
                      {installment.paymentId}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="schedule-table__action">
                  <InstallmentAction
                    installment={installment}
                    policyId={policyId}
                    canRecordPayment={canRecordPayment}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ol className="schedule-cards" id={cardsId}>
        {rows.map((installment) => (
          <li
            key={installment.installmentId}
            className={`schedule-card schedule-card--${installment.status}`}
          >
            <div className="schedule-card__top">
              <span className="schedule-card__number">
                Instalment {installment.installmentNumber}
              </span>
              <StatusBadge status={installment.status} />
            </div>

            <div className="schedule-card__amount">{formatCurrency(installment.amount)}</div>
            <StatusNote installment={installment} />

            <dl className="schedule-card__figures">
              <div>
                <dt>Due date</dt>
                <dd>{formatDate(installment.dueDate)}</dd>
              </div>
              <div>
                <dt>Paid date</dt>
                <dd>{installment.paidDate ? formatDate(installment.paidDate) : '—'}</dd>
              </div>
              {installment.paymentId && (
                <div className="schedule-card__wide">
                  <dt>Payment</dt>
                  <dd className="schedule__mono">{installment.paymentId}</dd>
                </div>
              )}
            </dl>

            {installment.status !== INSTALLMENT_STATUS.UPCOMING && (
              <div className="schedule-card__action">
                <InstallmentAction
                  installment={installment}
                  policyId={policyId}
                  canRecordPayment={canRecordPayment}
                  fullWidth
                />
              </div>
            )}
          </li>
        ))}
      </ol>

      {canToggle && (
        <div className="schedule__toggle">
          <p className="schedule__toggle-text">
            Showing {rows.length} of {installments.length} instalments.
            {!showAll && ` ${plural(hiddenCount, 'later upcoming instalment')} hidden.`}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAll((current) => !current)}
            aria-expanded={showAll}
            aria-controls={`${tableId} ${cardsId}`}
          >
            {showAll ? 'Show fewer instalments' : `Show all ${installments.length} instalments`}
          </Button>
        </div>
      )}
    </div>
  )
}

export default PremiumScheduleTable
