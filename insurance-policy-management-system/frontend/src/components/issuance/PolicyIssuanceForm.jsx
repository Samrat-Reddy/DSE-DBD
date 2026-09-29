import { useCallback, useMemo, useRef, useState } from 'react'
import Button from '../common/Button'
import IssuanceStepIndicator from './IssuanceStepIndicator'
import ProductStep from './ProductStep'
import PolicyholderStep from './PolicyholderStep'
import PolicyDetailsStep from './PolicyDetailsStep'
import ReviewSummary from './ReviewSummary'
import IssuanceSuccess from './IssuanceSuccess'
import { issuePolicy } from '../../services/policyService'
import {
  EMPTY_ISSUANCE_FORM,
  validateStep,
} from '../../utils/issuanceValidation'
import './PolicyIssuanceForm.css'

const STEPS = [
  { label: 'Select product', description: 'Choose the product to issue' },
  { label: 'Policyholder', description: 'Identity and contact details' },
  { label: 'Policy details', description: 'Coverage, dates and nominee' },
  { label: 'Review', description: 'Confirm before issuing' },
]

const PRODUCT_STEP = 0
const REVIEW_STEP = 3

/** Fields belonging to each step, used to mark the right ones as touched. */
const STEP_FIELDS = {
  1: [
    'fullName',
    'customerId',
    'dateOfBirth',
    'email',
    'phone',
    'addressLine1',
    'city',
    'state',
    'postalCode',
  ],
  2: [
    'coverageAmount',
    'startDate',
    'durationYears',
    'premiumFrequency',
    'nomineeName',
    'nomineeRelationship',
    'nomineeDateOfBirth',
  ],
}

/**
 * Multi-step policy issuance workflow.
 *
 * Owns wizard state only. Validation rules live in `utils/issuanceValidation`
 * and persistence goes through `policyService`, so this component stays a
 * coordinator rather than a place where business rules accumulate.
 */
const PolicyIssuanceForm = ({ products = [], initialProductId = null }) => {
  const [currentStep, setCurrentStep] = useState(
    initialProductId ? 1 : PRODUCT_STEP,
  )
  const [furthestStep, setFurthestStep] = useState(initialProductId ? 1 : 0)
  const [selectedProductId, setSelectedProductId] = useState(initialProductId)
  const [values, setValues] = useState(EMPTY_ISSUANCE_FORM)
  const [touched, setTouched] = useState({})
  const [submitState, setSubmitState] = useState('idle')
  const [submitError, setSubmitError] = useState(null)
  const [issuedPolicy, setIssuedPolicy] = useState(null)

  const stepPanelRef = useRef(null)
  const errorSummaryRef = useRef(null)

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  )

  const errors = useMemo(
    () => validateStep(currentStep, values, selectedProduct),
    [currentStep, values, selectedProduct],
  )

  const visibleErrors = useMemo(
    () =>
      Object.entries(errors).filter(([field]) => touched[field]),
    [errors, touched],
  )

  /** Seed sensible defaults from the product so the operator types less. */
  const handleProductSelect = useCallback(
    (productId) => {
      const product = products.find((item) => item.id === productId)
      setSelectedProductId(productId)

      if (!product) return

      setValues((previous) => ({
        ...previous,
        coverageAmount: String(product.coverageAmount),
        durationYears: String(product.durationYears),
        premiumFrequency: product.availableFrequencies.includes(
          product.premiumFrequency,
        )
          ? product.premiumFrequency
          : product.availableFrequencies[0] ?? '',
      }))
    },
    [products],
  )

  const handleChange = useCallback((event) => {
    const { name, value } = event.target
    setValues((previous) => ({ ...previous, [name]: value }))
  }, [])

  const handleBlur = useCallback((event) => {
    const { name } = event.target
    setTouched((previous) => ({ ...previous, [name]: true }))
  }, [])

  const focusFirstError = useCallback((stepErrors) => {
    const [firstField] = Object.keys(stepErrors)
    if (!firstField) return

    // Fields are rendered with a generated id suffix, so match on name.
    const control = stepPanelRef.current?.querySelector(
      `[name="${firstField}"]`,
    )

    if (control) {
      control.focus()
    } else {
      errorSummaryRef.current?.focus()
    }
  }, [])

  const goToStep = useCallback((step) => {
    setCurrentStep(step)
    setFurthestStep((previous) => Math.max(previous, step))
    setSubmitError(null)
  }, [])

  const handleNext = useCallback(() => {
    if (currentStep === PRODUCT_STEP && !selectedProductId) {
      setSubmitError(new Error('Select a product before continuing.'))
      return
    }

    const stepErrors = validateStep(currentStep, values, selectedProduct)

    if (Object.keys(stepErrors).length > 0) {
      // Reveal every error on this step, not only the fields already blurred.
      const fields = STEP_FIELDS[currentStep] ?? []
      setTouched((previous) => ({
        ...previous,
        ...Object.fromEntries(fields.map((field) => [field, true])),
      }))
      focusFirstError(stepErrors)
      return
    }

    goToStep(Math.min(currentStep + 1, REVIEW_STEP))
  }, [
    currentStep,
    focusFirstError,
    goToStep,
    selectedProduct,
    selectedProductId,
    values,
  ])

  const handleBack = useCallback(() => {
    goToStep(Math.max(currentStep - 1, PRODUCT_STEP))
  }, [currentStep, goToStep])

  const handleIssue = useCallback(async () => {
    setSubmitState('submitting')
    setSubmitError(null)

    try {
      const policy = await issuePolicy({
        productId: selectedProductId,
        values,
      })
      setIssuedPolicy(policy)
      setSubmitState('success')
    } catch (error) {
      setSubmitError(error)
      setSubmitState('error')
    }
  }, [selectedProductId, values])

  const handleIssueAnother = useCallback(() => {
    setValues(EMPTY_ISSUANCE_FORM)
    setTouched({})
    setSelectedProductId(null)
    setIssuedPolicy(null)
    setSubmitState('idle')
    setSubmitError(null)
    setCurrentStep(PRODUCT_STEP)
    setFurthestStep(0)
  }, [])

  if (submitState === 'success' && issuedPolicy) {
    return (
      <IssuanceSuccess
        policy={issuedPolicy}
        onIssueAnother={handleIssueAnother}
      />
    )
  }

  const isSubmitting = submitState === 'submitting'

  return (
    <div className="issuance">
      <IssuanceStepIndicator
        steps={STEPS}
        currentStep={currentStep}
        furthestStep={furthestStep}
        onStepSelect={goToStep}
        locked={isSubmitting}
      />

      <form
        className="issuance__panel"
        onSubmit={(event) => event.preventDefault()}
        noValidate
      >
        <div className="issuance__body" ref={stepPanelRef}>
          {visibleErrors.length > 0 && (
            <div
              className="issuance__error-summary"
              role="alert"
              tabIndex={-1}
              ref={errorSummaryRef}
            >
              <h3 className="issuance__error-title">
                {visibleErrors.length === 1
                  ? 'There is 1 problem to fix'
                  : `There are ${visibleErrors.length} problems to fix`}
              </h3>
              <ul className="issuance__error-list">
                {visibleErrors.map(([field, message]) => (
                  <li key={field}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          {submitError && (
            <div className="issuance__error-summary" role="alert">
              <h3 className="issuance__error-title">Unable to continue</h3>
              <p className="issuance__error-text">{submitError.message}</p>
            </div>
          )}

          {currentStep === 0 && (
            <ProductStep
              products={products}
              selectedId={selectedProductId}
              onSelect={handleProductSelect}
            />
          )}

          {currentStep === 1 && (
            <PolicyholderStep
              values={values}
              errors={errors}
              touched={touched}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          )}

          {currentStep === 2 && (
            <PolicyDetailsStep
              product={selectedProduct}
              values={values}
              errors={errors}
              touched={touched}
              onChange={handleChange}
              onBlur={handleBlur}
            />
          )}

          {currentStep === 3 && (
            <ReviewSummary
              product={selectedProduct}
              values={values}
              onEditStep={goToStep}
            />
          )}
        </div>

        <footer className="issuance__footer">
          <Button
            variant="secondary"
            onClick={handleBack}
            disabled={currentStep === PRODUCT_STEP || isSubmitting}
          >
            Back
          </Button>

          <div className="issuance__footer-primary">
            {currentStep < REVIEW_STEP ? (
              <Button onClick={handleNext} disabled={isSubmitting}>
                Continue
              </Button>
            ) : (
              <Button size="lg" onClick={handleIssue} disabled={isSubmitting}>
                {isSubmitting ? 'Issuing policy…' : 'Issue Policy'}
              </Button>
            )}
          </div>
        </footer>
      </form>
    </div>
  )
}

export default PolicyIssuanceForm
