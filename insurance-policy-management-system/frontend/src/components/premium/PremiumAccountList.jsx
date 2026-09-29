import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildPolicyPremiumsPath } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './PremiumAccountList.css'

const ProgressBar = ({ ratio }) => (
  <span className="account-progress" aria-hidden="true">
    <span className="account-progress__fill" style={{ width: `${Math.round(ratio * 100)}%` }} />
  </span>
)

const NextDue = ({ summary }) =>
  summary.nextDueDate ? (
    <>
      <span className="account-list__primary">{formatDate(summary.nextDueDate)}</span>
      <span className="account-list__secondary">
        {formatCurrency(summary.nextDueAmount)}
      </span>
    </>
  ) : (
    <span className="account-list__secondary">No instalments remaining</span>
  )

/**
 * Premium accounts: one row per policy with a schedule.
 *
 * A table on wide screens, stacked cards below 900px. Both render from the
 * same data; the mobile layout is designed rather than a squeezed table.
 */
const PremiumAccountList = ({ accounts = [] }) => (
  <>
    <div className="account-table-wrap">
      <table className="account-table">
        <caption className="sr-only">
          Premium accounts with policy, policyholder, premium, instalments paid,
          outstanding balance, next due date and premium standing
        </caption>
        <thead>
          <tr>
            <th scope="col">Policy</th>
            <th scope="col">Policyholder</th>
            <th scope="col" className="account-table__numeric">Premium</th>
            <th scope="col">Instalments paid</th>
            <th scope="col" className="account-table__numeric">Outstanding</th>
            <th scope="col">Next due</th>
            <th scope="col">Standing</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => {
            const { summary } = account
            return (
              <tr
                key={account.policyId}
                className={summary.counts.overdue > 0 ? 'account-table__row--overdue' : undefined}
              >
                <th scope="row">
                  <Link className="account-list__id" to={buildPolicyPremiumsPath(account.policyId)}>
                    {account.policyId}
                  </Link>
                  <span className="account-list__secondary">
                    {account.policy?.productName ?? 'Policy record unavailable'}
                  </span>
                </th>
                <td>
                  <span className="account-list__primary">
                    {account.policy?.policyholderName ?? '—'}
                  </span>
                  <span className="account-list__secondary">
                    {account.policy?.customerId ?? '—'}
                  </span>
                </td>
                <td className="account-table__numeric">
                  <span className="account-list__primary">
                    {formatCurrency(account.premiumAmount)}
                  </span>
                  <span className="account-list__secondary">{account.frequency}</span>
                </td>
                <td>
                  <span className="account-list__primary">
                    {summary.counts.paid} of {summary.totalInstallments}
                  </span>
                  <ProgressBar ratio={summary.paidRatio} />
                </td>
                <td className="account-table__numeric">
                  <span className="account-list__primary">
                    {formatCurrency(summary.outstanding)}
                  </span>
                  {summary.overdueAmount > 0 && (
                    <span className="account-list__overdue">
                      {formatCurrency(summary.overdueAmount)} overdue
                    </span>
                  )}
                </td>
                <td>
                  <NextDue summary={summary} />
                </td>
                <td>
                  <StatusBadge status={summary.standing} />
                </td>
                <td className="account-table__action">
                  <Button to={buildPolicyPremiumsPath(account.policyId)} variant="secondary" size="sm">
                    View schedule
                    <span className="sr-only"> for {account.policyId}</span>
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    <ul className="account-cards">
      {accounts.map((account) => {
        const { summary } = account
        return (
          <li
            key={account.policyId}
            className={`account-card${summary.counts.overdue > 0 ? ' account-card--overdue' : ''}`}
          >
            <div className="account-card__top">
              <Link className="account-list__id" to={buildPolicyPremiumsPath(account.policyId)}>
                {account.policyId}
              </Link>
              <StatusBadge status={summary.standing} />
            </div>

            <p className="account-card__product">
              {account.policy?.productName ?? 'Policy record unavailable'}
            </p>
            <p className="account-card__holder">
              {account.policy?.policyholderName ?? '—'} · {formatCurrency(account.premiumAmount)}{' '}
              {account.frequency.toLowerCase()}
            </p>

            <dl className="account-card__figures">
              <div>
                <dt>Outstanding</dt>
                <dd>{formatCurrency(summary.outstanding)}</dd>
              </div>
              <div>
                <dt>Overdue</dt>
                <dd className={summary.overdueAmount > 0 ? 'account-list__overdue' : undefined}>
                  {formatCurrency(summary.overdueAmount)}
                </dd>
              </div>
              <div>
                <dt>Paid</dt>
                <dd>
                  {summary.counts.paid} of {summary.totalInstallments}
                </dd>
              </div>
              <div>
                <dt>Next due</dt>
                <dd>{summary.nextDueDate ? formatDate(summary.nextDueDate) : '—'}</dd>
              </div>
            </dl>

            <Button
              to={buildPolicyPremiumsPath(account.policyId)}
              variant="secondary"
              size="sm"
              fullWidth
            >
              View schedule
              <span className="sr-only"> for {account.policyId}</span>
            </Button>
          </li>
        )
      })}
    </ul>
  </>
)

export default PremiumAccountList
