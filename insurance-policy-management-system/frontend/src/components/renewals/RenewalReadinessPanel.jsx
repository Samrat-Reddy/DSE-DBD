import Checklist from '../common/Checklist'
import StatusBadge from '../common/StatusBadge'
import { RENEWAL_READINESS } from '../../utils/constants'
import './RenewalPanels.css'

const VERDICT_TEXT = {
  [RENEWAL_READINESS.READY]: 'Every readiness check passed.',
  [RENEWAL_READINESS.ACTION_REQUIRED]: 'Renewal can proceed, but some items need attention first.',
  [RENEWAL_READINESS.NOT_YET_OPEN]: 'The renewal window has not opened yet.',
  [RENEWAL_READINESS.NOT_ELIGIBLE]: 'This policy cannot receive renewal reminders.',
}

/**
 * Renewal readiness: a verdict plus the rule checks behind it, each marked
 * passed, needs attention (informational) or blocked. Readiness is advisory —
 * this module never renews a policy.
 */
const RenewalReadinessPanel = ({ readiness }) => {
  if (!readiness) return null

  return (
    <div className="renewal-panel">
      <p className="renewal-readiness__verdict">
        <StatusBadge status={readiness.verdict} size="lg" />
        <span>{VERDICT_TEXT[readiness.verdict]}</span>
      </p>
      <Checklist label="Renewal readiness checks" checks={readiness.checks} />
      <p className="renewal-panel__footnote">
        Illustrative rules. Outstanding premium is flagged for attention but does not block reminders. No
        underwriting decision is made and no renewal is processed.
      </p>
    </div>
  )
}

export default RenewalReadinessPanel
