import { useId } from 'react'
import FormField from '../common/FormField'
import { documentFieldKey } from '../../utils/claimValidation'
import './ClaimDocuments.css'

/**
 * Simulated document submission. Marking a document as provided records its
 * name as metadata. No file is selected, uploaded or stored.
 *
 * `value` is `{ [documentType]: { provided: boolean, fileName: string } }`.
 */
const ClaimDocumentsInput = ({ requirements = [], value = {}, onChange, errors = {} }) => {
  const baseId = useId()

  const update = (type, patch) => onChange({ ...value, [type]: { ...value[type], ...patch } })

  return (
    <fieldset className="claim-docs-input">
      <legend className="claim-form__legend">Supporting documents</legend>
      <p className="claim-docs-input__notice">
        <strong>Demonstration.</strong> Tick each document you have and confirm its name. Only the name is recorded;
        no file is uploaded or stored.
      </p>

      <ul className="claim-docs-input__list">
        {requirements.map((requirement) => {
          const entry = value[requirement.type] ?? { provided: false, fileName: '' }
          const key = documentFieldKey(requirement.type)
          const error = errors[key]
          const checkboxId = `${baseId}-${requirement.type}`
          const errorId = `${checkboxId}-error`

          return (
            <li
              key={requirement.type}
              className={`claim-docs-input__item${error ? ' claim-docs-input__item--invalid' : ''}`}
            >
              <div className="claim-docs-input__row">
                <input
                  type="checkbox"
                  id={checkboxId}
                  name={key}
                  checked={Boolean(entry.provided)}
                  onChange={(event) =>
                    update(requirement.type, {
                      provided: event.target.checked,
                      fileName: entry.fileName || requirement.suggestedName,
                    })
                  }
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? errorId : undefined}
                  className="claim-docs-input__checkbox"
                />
                <label htmlFor={checkboxId} className="claim-docs-input__label">
                  {requirement.label}
                  {requirement.required ? (
                    <span className="claim-docs__required">Required</span>
                  ) : (
                    <span className="claim-docs__optional">Optional</span>
                  )}
                </label>
              </div>

              {entry.provided && (
                <div className="claim-docs-input__name">
                  <FormField
                    label={`Document name for ${requirement.label.toLowerCase()}`}
                    name={`documentName-${requirement.type}`}
                    value={entry.fileName}
                    onChange={(event) => update(requirement.type, { fileName: event.target.value })}
                    maxLength={120}
                  />
                </div>
              )}

              {error && (
                <p className="claim-form__field-error" id={errorId}>
                  <span aria-hidden="true">⚠</span> {error}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

export default ClaimDocumentsInput
