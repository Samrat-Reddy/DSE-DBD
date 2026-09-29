import { Link } from 'react-router-dom'
import DataList from '../common/DataList'
import SectionCard from '../common/SectionCard'
import StatusBadge from '../common/StatusBadge'
import MockNotice from './MockNotice'
import {
  buildPolicyDetailsPath,
  buildPolicyPremiumsPath,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS,
} from '../../utils/constants'
import { formatCurrency, formatDate, formatDateTime } from '../../utils/formatters'
import './PaymentDetailsPanel.css'

const BANNERS = {
  [PAYMENT_STATUS.SUCCESS]: {
    icon: '✓',
    title: 'Successful payment',
    text: 'This payment was recorded successfully and applied to the instalment below.',
  },
  [PAYMENT_STATUS.FAILED]: {
    icon: '×',
    title: 'Failed payment',
    text: 'This payment attempt did not succeed. It did not reduce the instalment balance.',
  },
  [PAYMENT_STATUS.PENDING]: {
    icon: '…',
    title: 'Pending payment',
    text: 'This payment is awaiting confirmation. The instalment cannot be paid again meanwhile.',
  },
}

/**
 * Full record of one payment and the instalment it was applied to.
 *
 * Used by the payment details page and by the payment flow when someone opens
 * an instalment that has already been paid.
 */
const PaymentDetailsPanel = ({ payment, installment, policy, isOrphaned = false }) => {
  const banner = BANNERS[payment.status] ?? BANNERS[PAYMENT_STATUS.PENDING]

  return (
    <div className="payment-details">
      <div className={`payment-banner payment-banner--${payment.status}`}>
        <span className="payment-banner__icon" aria-hidden="true">
          {banner.icon}
        </span>
        <div>
          <h2 className="payment-banner__title">{banner.title}</h2>
          <p className="payment-banner__text">{banner.text}</p>
          {payment.failureReason && (
            <p className="payment-banner__text">
              <strong>Reason:</strong> {payment.failureReason}
            </p>
          )}
        </div>
      </div>

      <SectionCard id="payment-record" title="Payment">
        <DataList
          columns={3}
          items={[
            { label: 'Payment ID', value: payment.paymentId, mono: true },
            { label: 'Status', value: <StatusBadge status={payment.status} /> },
            { label: 'Amount', value: formatCurrency(payment.amount) },
            {
              label: 'Payment date',
              value: payment.paidAt
                ? formatDateTime(payment.paidAt)
                : formatDate(payment.paymentDate),
            },
            {
              label: 'Payment method',
              value: PAYMENT_METHOD_LABELS[payment.paymentMethod] ?? payment.paymentMethod,
            },
            {
              label: 'Transaction reference',
              value: payment.transactionReference,
              mono: true,
            },
          ]}
        />
        <div className="payment-details__notice">
          <MockNotice title="Demonstration payment record">
            The transaction reference is generated for demonstration and does not correspond to
            any bank or payment gateway.
          </MockNotice>
        </div>
      </SectionCard>

      <SectionCard id="payment-applied-to" title="Applied to">
        {isOrphaned && (
          <p className="payment-details__warning" role="note">
            The policy {payment.policyId} is no longer available in the policy store. The payment
            record is retained, but policy details cannot be shown.
          </p>
        )}
        <DataList
          columns={3}
          items={[
            {
              label: 'Policy',
              value: policy ? (
                <Link to={buildPolicyPremiumsPath(payment.policyId)}>{payment.policyId}</Link>
              ) : (
                payment.policyId
              ),
              mono: true,
            },
            { label: 'Product', value: policy?.productName ?? null },
            {
              label: 'Policyholder',
              value: policy?.policyholderName
                ? `${policy.policyholderName} (${policy.customerId})`
                : null,
            },
            {
              label: 'Instalment',
              value: installment
                ? `${installment.installmentNumber} (${installment.installmentId})`
                : payment.installmentId,
            },
            {
              label: 'Instalment due date',
              value: installment ? formatDate(installment.dueDate) : null,
            },
            {
              label: 'Instalment status now',
              value: installment ? <StatusBadge status={installment.status} /> : null,
            },
          ]}
        />
        {policy && (
          <p className="payment-details__links">
            <Link to={buildPolicyDetailsPath(payment.policyId)}>Open the policy record</Link>
          </p>
        )}
      </SectionCard>
    </div>
  )
}

export default PaymentDetailsPanel
