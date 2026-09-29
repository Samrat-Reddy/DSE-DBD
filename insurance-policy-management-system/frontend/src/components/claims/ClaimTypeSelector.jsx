import { useId } from 'react'
import { formatCurrency } from '../../utils/formatters'
import './ClaimFiling.css'

/**
 * Choice of claim type, limited to types the policy's cover supports.
 * A native radio group: arrow keys move between options.
 */
const ClaimTypeSelector = ({ claimTypes = [], value, onChange, error }) => {
  const baseId = useId()
  const errorId = `${baseId}-error`

  return (
    <fieldset
      className={`claim-type-selector${error ? ' claim-type-selector--invalid' : ''}`}
      aria-describedby={error ? errorId : undefined}
    >
      <legend className="claim-form__legend">
        Claim type <span className="claim-form__required" aria-hidden="true">*</span>
        <span className="sr-only"> (required)</span>
      </legend>

      {error && (
        <p className="claim-form__field-error" id={errorId}>
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}

      <div className="claim-type-selector__options">
        {claimTypes.map((type) => {
          const checked = value === type.value
          return (
            <label key={type.value} className={`claim-type-option${checked ? ' claim-type-option--selected' : ''}`}>
              <input
                type="radio"
                name="claimType"
                value={type.value}
                checked={checked}
                onChange={() => onChange(type.value)}
                aria-invalid={error ? 'true' : undefined}
                className="claim-type-option__input"
              />
              <span className="claim-type-option__body">
                <span className="claim-type-option__label">{type.label}</span>
                <span className="claim-type-option__description">{type.description}</span>
                <span className="claim-type-option__meta">
                  Covered under “{type.coverageItem}” · Illustrative limit{' '}
                  {type.illustrativeLimit ? formatCurrency(type.illustrativeLimit.limit) : '—'}
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default ClaimTypeSelector
