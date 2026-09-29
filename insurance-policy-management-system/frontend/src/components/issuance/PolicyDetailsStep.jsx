import FormField from '../common/FormField'
import { NOMINEE_RELATIONSHIPS } from '../../utils/issuanceValidation'
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
  formatDuration,
} from '../../utils/formatters'
import { buildPremiumBreakdown, calculateEndDate } from '../../utils/policyPricing'
import './FormSteps.css'

/**
 * Step 3 — coverage, dates, payment frequency and nominee.
 *
 * The option sets (durations, frequencies, coverage band) come from the
 * selected product, so the form can never offer a combination the product
 * does not support.
 */
const PolicyDetailsStep = ({ product, values, errors, touched, onChange, onBlur }) => {
  const fieldProps = (name) => ({
    name,
    value: values[name],
    onChange,
    onBlur,
    error: touched[name] ? errors[name] : undefined,
  })

  const durationOptions = (product?.availableDurations ?? []).map((years) => ({
    value: String(years),
    label: formatDuration(years),
  }))

  const frequencyOptions = (product?.availableFrequencies ?? []).map((value) => ({
    value,
    label: value,
  }))

  const relationshipOptions = NOMINEE_RELATIONSHIPS.map((value) => ({
    value,
    label: value,
  }))

  const premium = buildPremiumBreakdown(
    product,
    values.coverageAmount,
    values.premiumFrequency,
  )

  const endDate = calculateEndDate(values.startDate, values.durationYears)
  const hasPremiumPreview =
    values.coverageAmount && values.premiumFrequency && !errors.coverageAmount

  return (
    <div className="form-step">
      <div className="form-step__group">
        <h3 className="form-step__group-title">Coverage and term</h3>
        <div className="form-grid">
          <FormField
            label="Coverage amount"
            type="number"
            required
            prefix="₹"
            min={product?.coverageRange?.min}
            max={product?.coverageRange?.max}
            step={50000}
            placeholder={String(product?.coverageAmount ?? '')}
            hint={
              product
                ? `Permitted range: ${formatCompactCurrency(
                    product.coverageRange.min,
                  )} to ${formatCompactCurrency(product.coverageRange.max)}`
                : undefined
            }
            {...fieldProps('coverageAmount')}
          />
          <FormField
            label="Policy start date"
            type="date"
            required
            hint="Cover begins on this date."
            {...fieldProps('startDate')}
          />
          <FormField
            label="Policy duration"
            as="select"
            required
            placeholder="Select duration"
            options={durationOptions}
            {...fieldProps('durationYears')}
          />
          <FormField
            label="Premium frequency"
            as="select"
            required
            placeholder="Select frequency"
            options={frequencyOptions}
            {...fieldProps('premiumFrequency')}
          />
        </div>

        {hasPremiumPreview && (
          <div className="premium-preview" role="status" aria-live="polite">
            <div className="premium-preview__item">
              <span className="premium-preview__label">Indicative annual premium</span>
              <strong className="premium-preview__value">
                {formatCurrency(premium.annual)}
              </strong>
            </div>
            <div className="premium-preview__item">
              <span className="premium-preview__label">
                Per instalment ({values.premiumFrequency})
              </span>
              <strong className="premium-preview__value">
                {formatCurrency(premium.instalment)}
              </strong>
            </div>
            <div className="premium-preview__item">
              <span className="premium-preview__label">Cover ends on</span>
              <strong className="premium-preview__value">
                {endDate ? formatDate(endDate) : '—'}
              </strong>
            </div>
            <p className="premium-preview__note">
              Indicative figures only. Final pricing will be confirmed by the
              rating engine once the backend is connected.
            </p>
          </div>
        )}
      </div>

      <div className="form-step__group">
        <h3 className="form-step__group-title">Nominee</h3>
        <div className="form-grid">
          <FormField
            label="Nominee name"
            required
            placeholder="Full name of the nominee"
            {...fieldProps('nomineeName')}
          />
          <FormField
            label="Relationship to policyholder"
            as="select"
            required
            placeholder="Select relationship"
            options={relationshipOptions}
            {...fieldProps('nomineeRelationship')}
          />
          <FormField
            label="Nominee date of birth"
            type="date"
            required
            {...fieldProps('nomineeDateOfBirth')}
          />
        </div>
      </div>
    </div>
  )
}

export default PolicyDetailsStep
