import { Link } from 'react-router-dom'
import Button from '../common/Button'
import { buildPaymentDetailsPath, buildPolicyCommissionPath } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './CommissionPanels.css'

/**
 * Successful premium payments that have no commission yet, and the
 * administrator's bulk actions: generate eligible commission, and confirm
 * earned commission whose hold has passed. Both are idempotent in the service.
 *
 * `onGenerateAll()` and `onConfirmEarnings()` resolve to `{ ok, error? }`;
 * the page holds `result`.
 */
const AwaitingCommissionPanel = ({
  awaiting,
  canManage = false,
  onGenerateAll,
  onConfirmEarnings,
  pending = false,
  result = null,
  error = null,
}) => {
  const eligible = awaiting?.eligible ?? []
  const blocked = awaiting?.blocked ?? []

  return (
    <div className="commission-panel">
      <p className="commission-panel__intro">
        Each successful premium payment generates one commission. Payments below have none yet.
      </p>

      {eligible.length ? (
        <ul className="commission-awaiting">
          {eligible.map((row) => (
            <li key={row.paymentId}>
              <Link to={buildPaymentDetailsPath(row.paymentId)} className="commission-payments__id">
                {row.paymentId}
              </Link>{' '}
              on <Link to={buildPolicyCommissionPath(row.policyId)}>{row.policyId}</Link> ({row.agentName}), paid{' '}
              {formatDate(row.paymentDate)}: would generate <strong>{formatCurrency(row.preview.amount)}</strong>{' '}
              <span className="commission-panel__muted">({row.preview.explanation.formula})</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="commission-panel__muted">No eligible payment is waiting for commission.</p>
      )}

      {blocked.length > 0 && (
        <ul className="commission-awaiting commission-awaiting--blocked" aria-label="Payments that cannot generate commission">
          {blocked.map((row) => (
            <li key={row.paymentId}>
              <span className="commission-payments__id">{row.paymentId}</span> on {row.policyId}: {row.reason}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <div className="commission-panel__actions">
          <Button onClick={onGenerateAll} disabled={pending || !eligible.length}>
            {pending ? 'Working…' : `Generate eligible commission${eligible.length ? ` (${eligible.length})` : ''}`}
          </Button>
          <Button variant="secondary" onClick={onConfirmEarnings} disabled={pending}>
            Confirm eligible earnings
          </Button>
        </div>
      ) : (
        <p className="commission-panel__readonly">Commission is generated and confirmed by an administrator.</p>
      )}

      {error && (
        <p className="commission-panel__error" role="alert">
          {error}
        </p>
      )}

      <div role="status" aria-live="polite" className="commission-panel__live">
        {result && <p className="commission-panel__result">{result}</p>}
      </div>

      <p className="commission-panel__footnote">Simulation only. No payout is made and no bank is contacted.</p>
    </div>
  )
}

export default AwaitingCommissionPanel
