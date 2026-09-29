import ClaimChecklist from './ClaimChecklist'
import './ClaimPanels.css'

/**
 * Claim eligibility for one policy: the checks, then a clear verdict.
 *
 * The verdict is announced as status text so assistive technology hears the
 * result, not only the checklist.
 */
const ClaimEligibilityPanel = ({ eligibility }) => {
  if (!eligibility) return null
  const { eligible, checks, reasons, warnings } = eligibility

  return (
    <div className="claim-eligibility">
      <ClaimChecklist checks={checks} label="Claim eligibility checks" />

      <div
        className={`claim-verdict claim-verdict--${eligible ? 'eligible' : 'blocked'}`}
        role="status"
      >
        <span className="claim-verdict__icon" aria-hidden="true">
          {eligible ? '✓' : '×'}
        </span>
        <div>
          <p className="claim-verdict__title">
            {eligible ? 'Eligible to file a claim' : 'A claim cannot currently be filed'}
          </p>
          {eligible ? (
            warnings.length > 0 && (
              <p className="claim-verdict__detail">
                Filing is allowed. {warnings.length === 1 ? 'One item needs' : `${warnings.length} items need`} attention
                and will be visible to the claims officer.
              </p>
            )
          ) : (
            <p className="claim-verdict__detail">
              <strong>Reason:</strong> {reasons.join(' ')}
            </p>
          )}
        </div>
      </div>

      <p className="claim-panel__footnote">
        These are illustrative eligibility rules for this demonstration, not an insurer&apos;s legal terms.
      </p>
    </div>
  )
}

export default ClaimEligibilityPanel
