import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import Button from '../common/Button'
import DataList from '../common/DataList'
import StatusBadge from '../common/StatusBadge'
import IssuanceStepIndicator from '../issuance/IssuanceStepIndicator'
import MockNotice from './MockNotice'
import PaymentMethodSelector from './PaymentMethodSelector'
import PaymentResult from './PaymentResult'
import PaymentSummaryPanel from './PaymentSummaryPanel'
import { MOCK_PAYMENT_OUTCOMES, recordMockPayment } from '../../services/premiumService'
import { getPayableInstallments } from '../../utils/premiumCalculations'
import { validatePaymentRequest } from '../../utils/paymentValidation'
import { INSTALLMENT_STATUS, PAYMENT_METHOD_LABELS } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PaymentFlow.css'

const STEPS = [
  { label: 'Select instalment', description: 'Choose what to pay' },
  { label: 'Payment method', description: 'Illustrative options only' },
  { label: 'Review & confirm', description: 'Check before confirming' },
]

const SELECT_STEP = 0
const METHOD_STEP = 1
const REVIEW_STEP = 2

/** The validation error that blocks leaving each step. */
const STEP_ERROR_FIELD = {
  [SELECT_STEP]: 'installment',
  [METHOD_STEP]: 'method',
}

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * Mock premium payment workflow.
 *
 * Owns wizard state only. Payability and request rules come from
 * `paymentValidation`, and the payment is recorded through `premiumService`,
 * which re-validates, so a bypassed or double-clicked confirm cannot record a
 * duplicate payment.
 */
const PaymentFlow = ({ account, initialInstallmentId, onInstallmentChange }) => {
  const [step, setStep] = useState(SELECT_STEP)
  const [furthestStep, setFurthestStep] = useState(SELECT_STEP)
  const [selectedId, setSelectedId] = useState(initialInstallmentId)
  const [method, setMethod] = useState('')
  const [outcome, setOutcome] = useState(MOCK_PAYMENT_OUTCOMES.APPROVE)
  const [revealedErrors, setRevealedErrors] = useState({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [result, setResult] = useState(null)

  const headingRef = useRef(null)
  const hasMountedRef = useRef(false)
  const submittingRef = useRef(false)
  const baseId = useId()

  const payable = useMemo(
    () => getPayableInstallments(account.installments),
    [account.installments],
  )

  const selected = useMemo(
    () => account.installments.find((item) => item.installmentId === selectedId) ?? null,
    [account.installments, selectedId],
  )

  const errors = useMemo(
    () => validatePaymentRequest({ installment: selected, amount: selected?.amount, method }),
    [selected, method],
  )

  // Move focus to the new step heading so keyboard and screen reader users
  // land on the content that changed. Skipped on first render.
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true
      return
    }
    headingRef.current?.focus()
  }, [step])

  const goToStep = useCallback((nextStep) => {
    setStep(nextStep)
    setFurthestStep((previous) => Math.max(previous, nextStep))
    setSubmitError(null)
  }, [])

  const handleSelect = useCallback(
    (installmentId) => {
      setSelectedId(installmentId)
      onInstallmentChange?.(installmentId)
    },
    [onInstallmentChange],
  )

  const handleContinue = useCallback(() => {
    const field = STEP_ERROR_FIELD[step]
    if (field && errors[field]) {
      setRevealedErrors((previous) => ({ ...previous, [field]: true }))
      return
    }
    goToStep(step + 1)
  }, [errors, goToStep, step])

  const handleConfirm = useCallback(async () => {
    if (submittingRef.current) return

    if (Object.keys(errors).length > 0) {
      setRevealedErrors({ installment: true, method: true, amount: true })
      return
    }

    submittingRef.current = true
    setIsSubmitting(true)
    setSubmitError(null)

    try {
      const response = await recordMockPayment({
        policyId: account.policyId,
        installmentId: selected.installmentId,
        amount: selected.amount,
        method,
        outcome,
      })
      setResult(response)
    } catch (error) {
      setSubmitError(error)
    } finally {
      submittingRef.current = false
      setIsSubmitting(false)
    }
  }, [account.policyId, errors, method, outcome, selected])

  const handleRetry = useCallback(() => {
    setResult(null)
    setOutcome(MOCK_PAYMENT_OUTCOMES.APPROVE)
    setStep(METHOD_STEP)
  }, [])

  if (result) {
    return <PaymentResult result={result} onRetry={handleRetry} />
  }

  const visibleError = (field) => (revealedErrors[field] ? errors[field] : undefined)
  const reviewErrors = step === REVIEW_STEP
    ? Object.entries(errors).filter(([field]) => revealedErrors[field])
    : []

  return (
    <div className="payment-flow">
      <IssuanceStepIndicator
        steps={STEPS}
        currentStep={step}
        furthestStep={furthestStep}
        onStepSelect={goToStep}
        locked={isSubmitting}
        label="Mock payment progress"
      />

      <div className="payment-flow__layout">
        <PaymentSummaryPanel account={account} installment={selected} method={method} />

        <form
          className="payment-flow__panel"
          onSubmit={(event) => event.preventDefault()}
          noValidate
          aria-labelledby={`${baseId}-heading`}
        >
          <div className="payment-flow__body">
            <h2
              className="payment-flow__heading"
              id={`${baseId}-heading`}
              ref={headingRef}
              tabIndex={-1}
            >
              {STEPS[step].label}
            </h2>

            {step === SELECT_STEP && (
              <fieldset className="installment-picker">
                <legend className="installment-picker__legend">
                  Payable instalments for {account.policyId}
                </legend>

                {visibleError('installment') && (
                  <p className="payment-flow__field-error" role="alert">
                    <span aria-hidden="true">⚠</span> {visibleError('installment')}
                  </p>
                )}

                <div className="installment-picker__options">
                  {payable.map((installment) => {
                    const checked = installment.installmentId === selectedId
                    return (
                      <label
                        key={installment.installmentId}
                        className={`installment-option installment-option--${installment.status}${
                          checked ? ' installment-option--selected' : ''
                        }`}
                      >
                        <input
                          type="radio"
                          name={`${baseId}-installment`}
                          value={installment.installmentId}
                          checked={checked}
                          onChange={() => handleSelect(installment.installmentId)}
                          className="installment-option__input"
                        />
                        <span className="installment-option__main">
                          <span className="installment-option__title">
                            Instalment {installment.installmentNumber}
                          </span>
                          <span className="installment-option__meta">
                            Due {formatDate(installment.dueDate)}
                            {installment.status === INSTALLMENT_STATUS.OVERDUE &&
                              ` · ${plural(installment.daysOverdue, 'day')} overdue`}
                          </span>
                        </span>
                        <span className="installment-option__side">
                          <strong className="installment-option__amount">
                            {formatCurrency(installment.amount)}
                          </strong>
                          <StatusBadge status={installment.status} />
                        </span>
                      </label>
                    )
                  })}
                </div>

                {payable.length > 1 && (
                  <p className="installment-picker__hint">
                    Instalments are listed oldest first. Paying the oldest overdue instalment first
                    is recommended.
                  </p>
                )}
              </fieldset>
            )}

            {step === METHOD_STEP && (
              <PaymentMethodSelector
                value={method}
                onChange={(value) => setMethod(value)}
                error={visibleError('method')}
              />
            )}

            {step === REVIEW_STEP && selected && (
              <div className="payment-review">
                {reviewErrors.length > 0 && (
                  <div className="payment-flow__error-summary" role="alert">
                    <h3 className="payment-flow__error-title">Resolve these before confirming</h3>
                    <ul>
                      {reviewErrors.map(([field, message]) => (
                        <li key={field}>{message}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {submitError && (
                  <div className="payment-flow__error-summary" role="alert">
                    <h3 className="payment-flow__error-title">The mock payment was not recorded</h3>
                    <p>{submitError.message}</p>
                  </div>
                )}

                <div className="payment-review__amount">
                  <span>You are confirming a mock payment of</span>
                  <strong>{formatCurrency(selected.amount)}</strong>
                </div>

                <DataList
                  columns={2}
                  items={[
                    { label: 'Policy', value: account.policyId, mono: true },
                    { label: 'Policyholder', value: account.policy?.policyholderName ?? '—' },
                    {
                      label: 'Instalment',
                      value: `${selected.installmentNumber} of ${account.totalInstallments}`,
                    },
                    { label: 'Due date', value: formatDate(selected.dueDate) },
                    { label: 'Instalment status', value: <StatusBadge status={selected.status} /> },
                    {
                      label: 'Payment method',
                      value: (
                        <>
                          {PAYMENT_METHOD_LABELS[method] ?? '—'}{' '}
                          <Button variant="ghost" size="sm" onClick={() => goToStep(METHOD_STEP)}>
                            Change<span className="sr-only"> payment method</span>
                          </Button>
                        </>
                      ),
                    },
                  ]}
                />

                <fieldset className="outcome-picker">
                  <legend className="outcome-picker__legend">Mock outcome (demonstration only)</legend>
                  <p className="outcome-picker__hint">
                    Choose how the simulated payment should resolve, so both results can be
                    demonstrated.
                  </p>
                  <div className="outcome-picker__options">
                    <label className="outcome-option">
                      <input
                        type="radio"
                        name={`${baseId}-outcome`}
                        value={MOCK_PAYMENT_OUTCOMES.APPROVE}
                        checked={outcome === MOCK_PAYMENT_OUTCOMES.APPROVE}
                        onChange={() => setOutcome(MOCK_PAYMENT_OUTCOMES.APPROVE)}
                      />
                      Approve — record a successful payment
                    </label>
                    <label className="outcome-option">
                      <input
                        type="radio"
                        name={`${baseId}-outcome`}
                        value={MOCK_PAYMENT_OUTCOMES.DECLINE}
                        checked={outcome === MOCK_PAYMENT_OUTCOMES.DECLINE}
                        onChange={() => setOutcome(MOCK_PAYMENT_OUTCOMES.DECLINE)}
                      />
                      Decline — record a failed attempt
                    </label>
                  </div>
                </fieldset>

                <MockNotice />
              </div>
            )}
          </div>

          <footer className="payment-flow__footer">
            <Button
              variant="secondary"
              onClick={() => goToStep(step - 1)}
              disabled={step === SELECT_STEP || isSubmitting}
            >
              Back
            </Button>

            {step < REVIEW_STEP ? (
              <Button onClick={handleContinue} disabled={isSubmitting}>
                Continue
              </Button>
            ) : (
              <Button size="lg" onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? 'Recording mock payment…' : 'Confirm Mock Payment'}
              </Button>
            )}
          </footer>
        </form>
      </div>
    </div>
  )
}

export default PaymentFlow
