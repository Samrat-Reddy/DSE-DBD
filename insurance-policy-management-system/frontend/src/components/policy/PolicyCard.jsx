import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { formatCurrency, formatCompactCurrency } from '../../utils/formatters'
import {
  buildIssuancePath,
  buildPolicyDetailsPath,
  PRODUCT_STATUS,
} from '../../utils/constants'
import './PolicyCard.css'

/**
 * Catalog tile for a single policy product.
 *
 * Presentational: it receives a product and a capability flag, and decides
 * nothing about who may issue — that is the caller's concern.
 */
const PolicyCard = ({ product, canIssue = false }) => {
  const isActive = product.status === PRODUCT_STATUS.ACTIVE

  return (
    <article className="policy-card">
      <div className="policy-card__top">
        <div className="policy-card__labels">
          <span className="policy-card__type">{product.type}</span>
          <StatusBadge status={product.status} />
        </div>
        <p className="policy-card__id">{product.id}</p>
      </div>

      <div className="policy-card__body">
        <h3 className="policy-card__name">{product.name}</h3>
        <p className="policy-card__tagline">{product.tagline}</p>
      </div>

      <dl className="policy-card__figures">
        <div>
          <dt>Coverage</dt>
          <dd>{formatCompactCurrency(product.coverageAmount)}</dd>
        </div>
        <div>
          <dt>Premium</dt>
          <dd>{formatCurrency(product.premium)}</dd>
        </div>
        <div>
          <dt>Frequency</dt>
          <dd>{product.premiumFrequency}</dd>
        </div>
        <div>
          <dt>Term</dt>
          <dd>
            {product.durationYears} {product.durationYears === 1 ? 'year' : 'years'}
          </dd>
        </div>
      </dl>

      <footer className="policy-card__footer">
        <Button
          to={buildPolicyDetailsPath(product.id)}
          variant="secondary"
          size="sm"
        >
          View details
          <span className="sr-only"> for {product.name}</span>
        </Button>

        {canIssue && isActive && (
          <Button to={buildIssuancePath(product.id)} size="sm">
            Issue policy
            <span className="sr-only"> for {product.name}</span>
          </Button>
        )}

        {!isActive && (
          <span className="policy-card__closed">Closed to new business</span>
        )}
      </footer>
    </article>
  )
}

export default PolicyCard
