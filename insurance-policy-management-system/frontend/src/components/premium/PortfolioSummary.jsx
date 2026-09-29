import StatGrid from '../common/StatGrid'
import { DUE_WINDOW_DAYS } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PortfolioSummary.css'

const plural = (count, singular, pluralForm = `${singular}s`) =>
  `${count} ${count === 1 ? singular : pluralForm}`

/**
 * Headline premium figures across every policy with a schedule.
 *
 * Every number comes from `calculatePortfolioSummary`; nothing here is
 * computed or hardcoded. The four instalment buckets (overdue, due, upcoming,
 * paid) are mutually exclusive, so they never double count.
 */
const PortfolioSummary = ({ portfolio, asOf }) => {
  if (!portfolio) return null

  const items = [
    {
      id: 'payable-now',
      tone: 'primary',
      label: 'Payable now',
      value: formatCurrency(portfolio.payableNow),
      detail: `${plural(portfolio.dueCount + portfolio.overdueCount, 'instalment')} due or overdue`,
    },
    {
      id: 'overdue',
      tone: 'overdue',
      label: 'Overdue',
      value: formatCurrency(portfolio.overdueAmount),
      detail: `${plural(portfolio.overdueCount, 'instalment')} · ${plural(
        portfolio.policiesOverdue,
        'policy',
        'policies',
      )}`,
    },
    {
      id: 'due',
      tone: 'due',
      label: `Due within ${DUE_WINDOW_DAYS} days`,
      value: formatCurrency(portfolio.dueAmount),
      detail: plural(portfolio.dueCount, 'instalment'),
    },
    {
      id: 'upcoming',
      tone: 'upcoming',
      label: 'Upcoming (remaining terms)',
      value: formatCurrency(portfolio.upcomingAmount),
      detail: plural(portfolio.upcomingCount, 'instalment'),
    },
    {
      id: 'paid',
      tone: 'paid',
      label: 'Premium paid',
      value: formatCurrency(portfolio.totalPaid),
      detail: `${plural(portfolio.paidCount, 'instalment')} across ${plural(
        portfolio.policies,
        'policy',
        'policies',
      )}`,
    },
  ]

  return (
    <section className="portfolio-summary" aria-labelledby="portfolio-summary-heading">
      <div className="portfolio-summary__heading">
        <h2 id="portfolio-summary-heading" className="portfolio-summary__title">
          Premium position
        </h2>
        <p className="portfolio-summary__asof">As of {formatDate(asOf)}</p>
      </div>

      <StatGrid items={items} columns={5} />

      <p className="portfolio-summary__legend">
        <strong>Due</strong> means payable within {DUE_WINDOW_DAYS} days of its due date.{' '}
        <strong>Overdue</strong> means the due date has passed without a successful payment.
        An overdue instalment does not change the policy status.
      </p>
    </section>
  )
}

export default PortfolioSummary
