import { formatCurrency } from '../../utils/formatters'
import './Reports.css'

/**
 * A distribution as a labelled bar list.
 *
 * Every bar states its own count, share and (optionally) amount in text, so
 * the chart is readable without relying on colour or on comparing lengths.
 * It is a description list, not an image, so it stays usable to a screen
 * reader and at 375px.
 */
const DistributionChart = ({ title, items = [], emptyMessage = 'No data in this reporting period.', showAmount = false }) => {
  if (!items.length) {
    return (
      <div className="distribution">
        {title && <p className="distribution__title">{title}</p>}
        <p className="distribution__empty">{emptyMessage}</p>
      </div>
    )
  }

  const largest = Math.max(...items.map((item) => item.count), 1)

  return (
    <div className="distribution">
      {title && <p className="distribution__title">{title}</p>}
      <dl className="distribution__list">
        {items.map((item) => (
          <div className="distribution__item" key={item.key}>
            <dt className="distribution__label">{item.label}</dt>
            <dd className="distribution__value">
              <span className="distribution__bar" aria-hidden="true">
                <span className="distribution__fill" style={{ '--distribution-width': `${(item.count / largest) * 100}%` }} />
              </span>
              <span className="distribution__numbers">
                <strong>{item.count}</strong>
                <span className="distribution__share">{item.share}%</span>
                {showAmount && item.amount !== undefined && <span className="distribution__amount">{formatCurrency(item.amount)}</span>}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export default DistributionChart
