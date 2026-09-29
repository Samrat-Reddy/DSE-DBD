import StatusBadge from '../common/StatusBadge'
import { formatCurrency } from '../../utils/formatters'
import './ClaimPanels.css'

/**
 * Transparent, rule-based explanation of an assessment and decision.
 *
 * Every figure and reason comes from `buildDecisionSummary`. There is no
 * score, model or AI involved.
 */
const ClaimDecisionSummary = ({ summary }) => {
  if (!summary) {
    return (
      <p className="claim-panel__muted">
        A decision summary appears once the claim has been assessed.
      </p>
    )
  }

  const decisionStatus = summary.decision === 'pending' ? 'assessed' : summary.decision

  return (
    <div className="decision-summary">
      <dl className="decision-summary__figures">
        <div>
          <dt>Claimed amount</dt>
          <dd>{formatCurrency(summary.claimedAmount)}</dd>
        </div>
        <div>
          <dt>Illustrative coverage limit</dt>
          <dd>
            {formatCurrency(summary.illustrativeLimit)}
            <span className="decision-summary__basis">{summary.limitBasis}</span>
          </dd>
        </div>
        <div>
          <dt>Assessment</dt>
          <dd>{formatCurrency(summary.assessedAmount)}</dd>
        </div>
        <div>
          <dt>Decision</dt>
          <dd>
            <StatusBadge status={decisionStatus} label={summary.decisionLabel} />
          </dd>
        </div>
      </dl>

      <div className="decision-summary__reasons">
        <h3 className="decision-summary__title">Reason</h3>
        <ul>
          {summary.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </div>

      <p className="claim-panel__footnote">
        Rule-based summary from illustrative frontend business rules. It is not an insurance adjudication and
        involves no automated scoring.
      </p>
    </div>
  )
}

export default ClaimDecisionSummary
