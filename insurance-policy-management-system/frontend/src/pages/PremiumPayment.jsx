import { useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/common'
import { PaymentDetailsPanel, PaymentFlow } from '../components/premium'
import { getPremiumScheduleByPolicyId } from '../services/premiumService'
import { useAsync, useDemoRole } from '../hooks'
import { getPayableInstallments } from '../utils/premiumCalculations'
import { checkInstallmentPayable, PAYABILITY_REASON } from '../utils/paymentValidation'
import {
  buildPaymentDetailsPath,
  buildPolicyPremiumsPath,
  buildPremiumPaymentPath,
  ROUTES,
} from '../utils/constants'
import './Premiums.css'

/**
 * Payment page for one policy, optionally for one instalment.
 *
 * Handles every reason a payment cannot start (role, unknown policy, unknown
 * instalment, already paid, not yet due, nothing payable) before handing a
 * payable instalment to the wizard.
 */
const PremiumPayment = () => {
  const { policyId, installmentId } = useParams()
  const navigate = useNavigate()
  const { canRecordPayment, role } = useDemoRole()

  const account = useAsync(() => getPremiumScheduleByPolicyId(policyId), [policyId, role], {
    enabled: canRecordPayment,
  })

  // Keep the URL in step with the selected instalment without remounting.
  const handleInstallmentChange = useCallback(
    (nextId) => navigate(buildPremiumPaymentPath(policyId, nextId), { replace: true }),
    [navigate, policyId],
  )

  const backToSchedule = (
    <Button variant="secondary" to={buildPolicyPremiumsPath(policyId)}>
      Back to premium schedule
    </Button>
  )

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: 'Premiums & payments', to: ROUTES.PREMIUMS },
        { label: policyId, to: buildPolicyPremiumsPath(policyId) },
        { label: 'Pay premium' },
      ]}
      eyebrow="Premium payment"
      title="Pay premium"
      description="Record a premium payment, in full or in part, against a due or overdue instalment."
      actions={
        <Button variant="secondary" to={buildPolicyPremiumsPath(policyId)}>
          Cancel
        </Button>
      }
    />
  )

  // ---- Demo role gate (not authentication) ----
  if (!canRecordPayment) {
    return (
      <>
        {header}
        <EmptyState
          icon="⛔"
          title="Recording payments is not available for this role"
          description={`The demo role is set to ${role ?? 'unknown'}. Agents have read-only access to premium status. Switch to Policyholder or Administrator in the header to record a payment.`}
          action={backToSchedule}
        />
      </>
    )
  }

  if (account.isLoading) {
    return (
      <>
        {header}
        <LoadingState label="Loading payable instalments" variant="rows" rows={3} />
      </>
    )
  }

  if (account.isError) {
    return (
      <>
        {header}
        <ErrorState
          title={
            account.error?.status === 409
              ? 'This policy has no premium schedule yet'
              : 'We could not start this payment'
          }
          error={account.error}
          onRetry={account.error?.status === 409 ? undefined : account.reload}
        />
        <div className="premiums__centered-action">
          <Button variant="secondary" to={ROUTES.PREMIUMS}>
            Back to premiums & payments
          </Button>
        </div>
      </>
    )
  }

  const data = account.data
  const payable = getPayableInstallments(data.installments)

  if (installmentId) {
    const requested =
      data.installments.find((item) => item.installmentId === installmentId) ?? null
    const payability = checkInstallmentPayable(requested)

    if (payability.reason === PAYABILITY_REASON.NOT_FOUND) {
      return (
        <>
          {header}
          <EmptyState
            icon="?"
            title="Instalment not found"
            description={`There is no instalment "${installmentId}" on the premium schedule for ${policyId}.`}
            action={backToSchedule}
          />
        </>
      )
    }

    // Already paid: show the payment instead of offering to pay again.
    if (payability.reason === PAYABILITY_REASON.ALREADY_PAID) {
      const payment = data.payments.find((item) => item.paymentId === requested.paymentId)

      return (
        <>
          {header}
          <div className="premiums__stack">
            <div className="premiums__info" role="note">
              <strong>This instalment is already paid.</strong> {payability.message}
            </div>
            {payment ? (
              <PaymentDetailsPanel
                payment={payment}
                installment={requested}
                policy={data.policy}
                isOrphaned={data.isOrphaned}
              />
            ) : null}
            <div className="premiums__actions">
              {payment && (
                <Button to={buildPaymentDetailsPath(payment.paymentId)}>
                  Open payment record
                </Button>
              )}
              {backToSchedule}
            </div>
          </div>
        </>
      )
    }

    if (!payability.payable) {
      return (
        <>
          {header}
          <EmptyState
            icon="◷"
            title={
              payability.reason === PAYABILITY_REASON.NOT_YET_DUE
                ? 'This instalment is not payable yet'
                : 'This instalment cannot be paid right now'
            }
            description={payability.message}
            action={backToSchedule}
          />
        </>
      )
    }
  }

  if (!payable.length) {
    return (
      <>
        {header}
        <EmptyState
          icon="✓"
          title="Nothing is payable right now"
          description={`No instalment for ${policyId} is due or overdue.`}
          action={backToSchedule}
        />
      </>
    )
  }

  const initialInstallmentId = installmentId ?? payable[0].installmentId

  return (
    <>
      {header}
      <PaymentFlow
        account={data}
        initialInstallmentId={initialInstallmentId}
        onInstallmentChange={handleInstallmentChange}
      />
    </>
  )
}

export default PremiumPayment
