import { useParams } from 'react-router-dom'
import { Button, ErrorState, LoadingState, PageHeader } from '../components/common'
import { PaymentDetailsPanel } from '../components/premium'
import { getPaymentById } from '../services/premiumService'
import { useAsync } from '../hooks'
import { buildPolicyPremiumsPath, ROUTES } from '../utils/constants'
import './Premiums.css'

/** One payment record, and the instalment it was applied to. */
const PaymentDetails = () => {
  const { paymentId } = useParams()
  const record = useAsync(() => getPaymentById(paymentId), [paymentId])

  const breadcrumbs = [
    { label: 'Premiums & payments', to: ROUTES.PREMIUMS },
    { label: 'Payment history', to: ROUTES.PAYMENT_HISTORY },
    { label: paymentId },
  ]

  if (record.isLoading) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading payment…" />
        <LoadingState label="Loading payment details" variant="rows" rows={4} />
      </>
    )
  }

  if (record.isError) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Payment not found" />
        <ErrorState
          title="We could not open this payment"
          error={record.error}
          onRetry={record.reload}
        />
        <div className="premiums__centered-action">
          <Button variant="secondary" to={ROUTES.PAYMENT_HISTORY}>
            Back to payment history
          </Button>
        </div>
      </>
    )
  }

  const { payment, installment, policy, isOrphaned } = record.data

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Payment record"
        title={payment.paymentId}
        description={`Mock payment for instalment ${payment.installmentNumber ?? '—'} of policy ${payment.policyId}.`}
        actions={
          <>
            {policy && (
              <Button variant="secondary" to={buildPolicyPremiumsPath(payment.policyId)}>
                Premium schedule
              </Button>
            )}
            <Button variant="ghost" to={ROUTES.PAYMENT_HISTORY}>
              Payment history
            </Button>
          </>
        }
      />

      <PaymentDetailsPanel
        payment={payment}
        installment={installment}
        policy={policy}
        isOrphaned={isOrphaned}
      />
    </>
  )
}

export default PaymentDetails
