import { useMemo, useRef, useState } from 'react'
import Button from '../common/Button'
import DataList from '../common/DataList'
import FormField from '../common/FormField'
import ClaimDocumentsInput from './ClaimDocumentsInput'
import ClaimTypeSelector from './ClaimTypeSelector'
import { createClaim } from '../../services/claimService'
import {
  buildEmptyClaimForm,
  CLAIM_FORM_FIELD_ORDER,
  documentFieldKey,
  validateClaimForm,
} from '../../utils/claimValidation'
import {
  CLAIM_DESCRIPTION_MAX_LENGTH,
  CLAIM_DESCRIPTION_MIN_LENGTH,
  ROLES,
} from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './ClaimFiling.css'

/**
 * Structured claim form for one eligible policy.
 *
 * Validation rules come from `claimValidation` and are re-applied by the
 * service. Errors show inline, are collected in a summary, and focus moves to
 * the first invalid field. Once the user has tried to submit, errors update
 * live as fields are corrected.
 */
const ClaimFilingForm = ({ context, role, onFiled }) => {
  const { policy, claimTypes, eligibility, asOf } = context

  const [values, setValues] = useState(() => buildEmptyClaimForm(policy.id))
  const [attempted, setAttempted] = useState(false)
  const [serviceErrors, setServiceErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const formRef = useRef(null)
  const summaryRef = useRef(null)

  const selectedType = claimTypes.find((type) => type.value === values.claimType) ?? null
  const validationContext = { policy, claimType: selectedType, claimTypes, asOf }

  const clientErrors = useMemo(
    () => (attempted ? validateClaimForm(values, { policy, claimType: selectedType, claimTypes, asOf }) : {}),
    [attempted, values, policy, selectedType, claimTypes, asOf],
  )
  const errors = { ...serviceErrors, ...clientErrors }

  const orderedErrorKeys = [
    ...CLAIM_FORM_FIELD_ORDER,
    ...(selectedType?.requiredDocuments ?? []).map((item) => documentFieldKey(item.type)),
  ].filter((key) => errors[key])

  const setField = (name, value) => {
    setValues((previous) => ({ ...previous, [name]: value }))
    setServiceErrors((previous) => {
      if (!previous[name]) return previous
      const next = { ...previous }
      delete next[name]
      return next
    })
  }

  const focusFirstError = (errorMap) => {
    const firstKey = [
      ...CLAIM_FORM_FIELD_ORDER,
      ...(selectedType?.requiredDocuments ?? []).map((item) => documentFieldKey(item.type)),
    ].find((key) => errorMap[key])

    const target = firstKey ? formRef.current?.querySelector(`[name="${firstKey}"]`) : null
    if (target) target.focus()
    else summaryRef.current?.focus()
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setAttempted(true)
    setSubmitError(null)

    const nextErrors = validateClaimForm(values, validationContext)
    if (Object.keys(nextErrors).length) {
      // Render the summary first, then move focus to the first invalid field.
      requestAnimationFrame(() => focusFirstError(nextErrors))
      return
    }

    setSubmitting(true)
    try {
      const result = await createClaim(values, { role })
      onFiled(result)
    } catch (error) {
      if (error?.data?.errors) {
        setServiceErrors(error.data.errors)
        requestAnimationFrame(() => focusFirstError(error.data.errors))
      }
      setSubmitError(error?.message ?? 'The claim could not be submitted.')
    } finally {
      setSubmitting(false)
    }
  }

  const descriptionLength = values.description.trim().length

  return (
    <form className="claim-form" onSubmit={handleSubmit} noValidate ref={formRef} aria-labelledby="claim-form-title">
      <div className="claim-form__body">
        <h2 id="claim-form-title" className="claim-form__title">
          Claim details
        </h2>

        {orderedErrorKeys.length > 0 && (
          <div className="claim-form__summary" role="alert" tabIndex={-1} ref={summaryRef}>
            <h3 className="claim-form__summary-title">
              {orderedErrorKeys.length === 1
                ? 'There is 1 problem to fix'
                : `There are ${orderedErrorKeys.length} problems to fix`}
            </h3>
            <ul>
              {orderedErrorKeys.map((key) => (
                <li key={key}>{errors[key]}</li>
              ))}
            </ul>
          </div>
        )}

        {submitError && !orderedErrorKeys.length && (
          <div className="claim-form__summary" role="alert">
            <h3 className="claim-form__summary-title">The claim was not submitted</h3>
            <p>{submitError}</p>
          </div>
        )}

        <section className="claim-form__group" aria-labelledby="claim-form-policy">
          <h3 id="claim-form-policy" className="claim-form__group-title">
            Policy
          </h3>
          <DataList
            columns={3}
            dense
            items={[
              { label: 'Policy', value: policy.id, mono: true },
              { label: 'Product', value: policy.productName },
              { label: 'Policyholder', value: `${policy.policyholderName} (${policy.customerId})` },
            ]}
          />
          {role === ROLES.AGENT && (
            <p className="claim-form__hint">You are filing as the agent on behalf of the policyholder.</p>
          )}
        </section>

        <section className="claim-form__group">
          <ClaimTypeSelector
            claimTypes={claimTypes}
            value={values.claimType}
            onChange={(value) => setField('claimType', value)}
            error={errors.claimType}
          />
        </section>

        <section className="claim-form__group" aria-labelledby="claim-form-incident">
          <h3 id="claim-form-incident" className="claim-form__group-title">
            Incident
          </h3>
          <div className="claim-form__grid">
            <FormField
              label="Incident date"
              name="incidentDate"
              type="date"
              required
              min={eligibility.incidentWindow?.earliest}
              max={eligibility.incidentWindow?.latest}
              value={values.incidentDate}
              onChange={(event) => setField('incidentDate', event.target.value)}
              error={errors.incidentDate}
              hint={
                eligibility.incidentWindow
                  ? `Between ${formatDate(eligibility.incidentWindow.earliest)} and ${formatDate(eligibility.incidentWindow.latest)}.`
                  : undefined
              }
            />
            <FormField
              label="Claimed amount"
              name="claimedAmount"
              type="number"
              prefix="₹"
              required
              min={1}
              step="0.01"
              value={values.claimedAmount}
              onChange={(event) => setField('claimedAmount', event.target.value)}
              error={errors.claimedAmount}
              hint={
                selectedType?.illustrativeLimit
                  ? `Illustrative limit for this claim type: ${formatCurrency(selectedType.illustrativeLimit.limit)}. Higher amounts are capped at assessment.`
                  : 'Choose a claim type to see its illustrative limit.'
              }
            />
          </div>
          <FormField
            label="What happened?"
            name="description"
            as="textarea"
            required
            rows={5}
            maxLength={CLAIM_DESCRIPTION_MAX_LENGTH}
            value={values.description}
            onChange={(event) => setField('description', event.target.value)}
            error={errors.description}
            hint={`${descriptionLength} of ${CLAIM_DESCRIPTION_MAX_LENGTH} characters. Minimum ${CLAIM_DESCRIPTION_MIN_LENGTH}.`}
          />
        </section>

        <section className="claim-form__group">
          {selectedType ? (
            <ClaimDocumentsInput
              requirements={selectedType.requiredDocuments}
              value={values.documents}
              onChange={(documents) => setField('documents', documents)}
              errors={errors}
            />
          ) : (
            <p className="claim-form__hint">Choose a claim type to see which documents are required.</p>
          )}
        </section>
      </div>

      <footer className="claim-form__footer">
        <p className="claim-form__footer-note">
          Submitting records the claim for review. This is a demonstration; no insurer receives it.
        </p>
        <Button type="submit" size="lg" disabled={submitting}>
          {submitting ? 'Submitting claim…' : 'Submit Claim'}
        </Button>
      </footer>
    </form>
  )
}

export default ClaimFilingForm
