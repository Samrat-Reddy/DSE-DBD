import { useId } from 'react'
import { PAYMENT_METHOD_OPTIONS } from '../../utils/constants'
import './PaymentMethodSelector.css'

const METHOD_ICONS = {
  upi: '⇄',
  card: '▭',
  'net-banking': '⌂',
}

/**
 * Choice of illustrative payment method.
 *
 * A native radio group, so arrow-key navigation works without custom ARIA.
 * Deliberately collects no card, bank or UPI details.
 */
const PaymentMethodSelector = ({ value, onChange, error }) => {
  const baseId = useId()
  const errorId = `${baseId}-error`
  const noteId = `${baseId}-note`

  return (
    <fieldset
      className={`method-selector${error ? ' method-selector--invalid' : ''}`}
      aria-describedby={[error ? errorId : null, noteId].filter(Boolean).join(' ')}
    >
      <legend className="method-selector__legend">
        Payment method <span className="method-selector__required" aria-hidden="true">*</span>
        <span className="sr-only"> (required)</span>
      </legend>

      {error && (
        <p className="method-selector__error" id={errorId}>
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}

      <div className="method-selector__options">
        {PAYMENT_METHOD_OPTIONS.map((option) => {
          const checked = value === option.value
          return (
            <label
              key={option.value}
              className={`method-option${checked ? ' method-option--selected' : ''}`}
            >
              <input
                type="radio"
                name={`${baseId}-method`}
                value={option.value}
                checked={checked}
                onChange={() => onChange(option.value)}
                className="method-option__input"
              />
              <span className="method-option__icon" aria-hidden="true">
                {METHOD_ICONS[option.value]}
              </span>
              <span className="method-option__text">
                <span className="method-option__label">{option.label}</span>
                <span className="method-option__description">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>

      <p className="method-selector__note" id={noteId}>
        Payment methods are illustrative. No payment details are requested or stored.
      </p>
    </fieldset>
  )
}

export default PaymentMethodSelector
