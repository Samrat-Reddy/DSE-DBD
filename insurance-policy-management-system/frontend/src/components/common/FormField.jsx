import { useId } from 'react'
import './FormField.css'

/**
 * Labelled form control with inline validation messaging.
 *
 * Wires up `id`, `aria-describedby`, `aria-invalid` and `aria-required` so
 * every input in the issuance workflow is announced correctly, and the error
 * always sits next to the field it belongs to.
 *
 * Pass `as="select"` or `as="textarea"` to change the control, or supply
 * `children` to render a custom control (radio groups, composite inputs).
 */
const FormField = ({
  label,
  name,
  value,
  onChange,
  onBlur,
  error,
  hint,
  type = 'text',
  as = 'input',
  options = [],
  placeholder,
  required = false,
  disabled = false,
  prefix,
  wrapperClassName = '',
  children,
  ...rest
}) => {
  const reactId = useId()
  const fieldId = `${name}-${reactId}`
  const errorId = `${fieldId}-error`
  const hintId = `${fieldId}-hint`

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') ||
    undefined

  const controlProps = {
    id: fieldId,
    name,
    value: value ?? '',
    onChange,
    onBlur,
    disabled,
    'aria-invalid': error ? 'true' : undefined,
    'aria-describedby': describedBy,
    'aria-required': required || undefined,
    className: `form-field__control${error ? ' form-field__control--error' : ''}`,
    ...rest,
  }

  const renderControl = () => {
    if (children) return children

    if (as === 'select') {
      return (
        <select {...controlProps}>
          <option value="">{placeholder ?? 'Select an option'}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }

    if (as === 'textarea') {
      return <textarea rows={3} placeholder={placeholder} {...controlProps} />
    }

    return <input type={type} placeholder={placeholder} {...controlProps} />
  }

  return (
    <div
      className={`form-field${error ? ' form-field--invalid' : ''} ${wrapperClassName}`.trim()}
    >
      <label className="form-field__label" htmlFor={fieldId}>
        {label}
        {required && (
          <span className="form-field__required" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {prefix ? (
        <div className="form-field__group">
          <span className="form-field__prefix" aria-hidden="true">
            {prefix}
          </span>
          {renderControl()}
        </div>
      ) : (
        renderControl()
      )}

      {hint && !error && (
        <p className="form-field__hint" id={hintId}>
          {hint}
        </p>
      )}

      {error && (
        <p className="form-field__error" id={errorId}>
          <span aria-hidden="true">⚠</span> {error}
        </p>
      )}
    </div>
  )
}

export default FormField
