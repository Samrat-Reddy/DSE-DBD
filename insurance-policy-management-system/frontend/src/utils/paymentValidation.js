/**
 * Validation rules for recording a mock premium payment.
 *
 * Shared by the payment flow (to show errors) and by `premiumService` (to
 * reject an invalid request even if the UI were bypassed), so both enforce
 * exactly the same rules.
 */

import {
  DUE_WINDOW_DAYS,
  INSTALLMENT_STATUS,
  PAYMENT_METHOD_OPTIONS,
} from './constants'
import { formatCurrency, formatDate } from './formatters'
import { addDaysIso } from './dateUtils'

/** Machine-readable reasons an instalment cannot be paid. */
export const PAYABILITY_REASON = {
  NOT_FOUND: 'not-found',
  ALREADY_PAID: 'already-paid',
  NOT_YET_DUE: 'not-yet-due',
  PAYMENT_PENDING: 'payment-pending',
}

const VALID_METHODS = PAYMENT_METHOD_OPTIONS.map((option) => option.value)

/**
 * Decide whether an instalment can be paid now.
 *
 * @returns {{payable: boolean, reason: string|null, message: string|null}}
 */
export const checkInstallmentPayable = (installment) => {
  if (!installment) {
    return {
      payable: false,
      reason: PAYABILITY_REASON.NOT_FOUND,
      message: 'The selected instalment does not exist on this premium schedule.',
    }
  }

  if (installment.status === INSTALLMENT_STATUS.PAID) {
    return {
      payable: false,
      reason: PAYABILITY_REASON.ALREADY_PAID,
      message: `Instalment ${installment.installmentNumber} was already paid on ${formatDate(
        installment.paidDate,
      )}. It cannot be paid again.`,
    }
  }

  if (installment.pendingPaymentId) {
    return {
      payable: false,
      reason: PAYABILITY_REASON.PAYMENT_PENDING,
      message: `A payment (${installment.pendingPaymentId}) is already pending for this instalment.`,
    }
  }

  if (installment.status === INSTALLMENT_STATUS.UPCOMING) {
    return {
      payable: false,
      reason: PAYABILITY_REASON.NOT_YET_DUE,
      message: `Instalment ${installment.installmentNumber} is not due yet. It becomes payable on ${formatDate(
        addDaysIso(installment.dueDate, -DUE_WINDOW_DAYS),
      )} and is due on ${formatDate(installment.dueDate)}.`,
    }
  }

  return { payable: true, reason: null, message: null }
}

/**
 * Validate a complete payment request.
 *
 * Partial payments are not supported: the amount must equal the instalment
 * amount exactly.
 *
 * @param {{installment: object|null, amount: number|string, method: string}} request
 * @returns {Record<string, string>} Field name to message; empty when valid.
 */
export const validatePaymentRequest = ({ installment, amount, method }) => {
  const errors = {}

  const payability = checkInstallmentPayable(installment)
  if (!payability.payable) {
    errors.installment = payability.message
  }

  const numericAmount = Number(amount)
  if (amount === '' || amount === null || amount === undefined || Number.isNaN(numericAmount)) {
    errors.amount = 'Payment amount is required.'
  } else if (numericAmount <= 0) {
    errors.amount = 'Payment amount must be greater than zero.'
  } else if (installment && numericAmount !== Number(installment.amount)) {
    errors.amount = `Payment amount must equal the instalment amount of ${formatCurrency(
      installment.amount,
    )}. Partial payments are not supported.`
  }

  if (!method) {
    errors.method = 'Select a payment method to continue.'
  } else if (!VALID_METHODS.includes(method)) {
    errors.method = 'Select a valid payment method.'
  }

  return errors
}

export const isPaymentRequestValid = (request) =>
  Object.keys(validatePaymentRequest(request)).length === 0
