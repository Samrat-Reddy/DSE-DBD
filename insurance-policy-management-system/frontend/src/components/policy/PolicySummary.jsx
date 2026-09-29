import {
  formatCompactCurrency,
  formatCurrency,
  formatDuration,
} from '../../utils/formatters'
import './PolicySummary.css'

/**
 * Headline financial figures for a product or an issued policy.
 *
 * Rendered as a strip of emphasised metrics so the numbers a reviewer looks
 * for first (coverage, premium, frequency, term) are readable at a glance.
 */
const PolicySummary = ({ record }) => {
  if (!record) return null

  const metrics = [
    {
      label: 'Coverage amount',
      value: formatCompactCurrency(record.coverageAmount),
      detail: formatCurrency(record.coverageAmount),
    },
    {
      label: 'Premium',
      value: formatCurrency(record.premium),
      detail: `Per ${(record.premiumFrequency ?? '').toLowerCase() || 'term'} instalment`,
    },
    {
      label: 'Premium frequency',
      value: record.premiumFrequency ?? '—',
      detail: 'Payment schedule',
    },
    {
      label: 'Policy duration',
      value: formatDuration(record.durationYears),
      detail: 'Total term',
    },
  ]

  return (
    <dl className="policy-summary">
      {metrics.map((metric) => (
        <div className="policy-summary__metric" key={metric.label}>
          <dt className="policy-summary__label">{metric.label}</dt>
          <dd className="policy-summary__value">{metric.value}</dd>
          <p className="policy-summary__detail">{metric.detail}</p>
        </div>
      ))}
    </dl>
  )
}

export default PolicySummary
