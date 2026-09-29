import './IssuanceStepIndicator.css'

/**
 * Progress indicator for the issuance wizard.
 *
 * Completed steps are buttons so an operator can jump back to correct an
 * answer; future steps are inert until reached, which prevents skipping past
 * validation. The current step is announced via `aria-current`.
 */
const IssuanceStepIndicator = ({
  steps = [],
  currentStep = 0,
  furthestStep = 0,
  onStepSelect,
  locked = false,
  // Reused by the Module 2 payment flow, which supplies its own label.
  label = 'Policy issuance progress',
}) => (
  <nav className="steps" aria-label={label}>
    <p className="steps__status" role="status" aria-live="polite">
      Step {currentStep + 1} of {steps.length}: {steps[currentStep]?.label}
    </p>

    <ol className="steps__list" style={{ '--step-count': steps.length }}>
      {steps.map((step, index) => {
        const isComplete = index < currentStep
        const isCurrent = index === currentStep
        const canNavigate =
          !locked && index <= furthestStep && index !== currentStep

        const state = isCurrent ? 'current' : isComplete ? 'complete' : 'upcoming'

        return (
          <li className={`steps__item steps__item--${state}`} key={step.label}>
            <button
              type="button"
              className="steps__button"
              onClick={() => canNavigate && onStepSelect?.(index)}
              disabled={!canNavigate}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="steps__marker" aria-hidden="true">
                {isComplete ? '✓' : index + 1}
              </span>
              <span className="steps__text">
                <span className="steps__label">{step.label}</span>
                {step.description && (
                  <span className="steps__description">{step.description}</span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  </nav>
)

export default IssuanceStepIndicator
