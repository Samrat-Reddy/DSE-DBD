import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildRenewalDetailsPath } from '../../utils/constants'
import { formatDate } from '../../utils/formatters'
import { describeCurrentStage, describeDaysRemaining, describeNextReminder } from '../../utils/renewalFormat'
import './RenewalList.css'

const StageCell = ({ account }) => {
  const stage = describeCurrentStage(account)
  if (!stage) return <span className="renewal-list__muted">No active stage</span>
  return (
    <>
      <span className="renewal-list__primary">{stage.label}</span>
      <StatusBadge status={stage.state} label={stage.stateLabel} />
    </>
  )
}

const NextReminderCell = ({ next }) => {
  const text = describeNextReminder(next)
  return (
    <>
      <span className={`renewal-list__primary${text.dueNow ? ' renewal-list__due-now' : ''}`}>{text.when}</span>
      {text.stage && <span className="renewal-list__secondary-text">{text.stage}</span>}
    </>
  )
}

const PremiumBadge = ({ standing }) =>
  standing ? <StatusBadge status={standing} /> : <span className="renewal-list__muted">No schedule</span>

/**
 * Renewal register — a table on wide screens, cards below 900px, both built
 * from the same renewal accounts.
 */
const RenewalList = ({ accounts = [] }) => (
  <>
    <div className="renewal-table-wrap">
      <table className="renewal-table">
        <caption className="sr-only">
          Policies with expiry date, days remaining, renewal status, current reminder stage, next reminder and
          premium standing
        </caption>
        <thead>
          <tr>
            <th scope="col">Policy</th>
            <th scope="col">Policyholder</th>
            <th scope="col">Expiry</th>
            <th scope="col">Renewal status</th>
            <th scope="col">Reminder stage</th>
            <th scope="col">Next reminder</th>
            <th scope="col">Premium</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.policyId}>
              <th scope="row">
                <Link className="renewal-list__id" to={buildRenewalDetailsPath(account.policyId)}>
                  {account.policyId}
                </Link>
                <span className="renewal-list__secondary-text">{account.policy.productName}</span>
              </th>
              <td>
                <span className="renewal-list__primary">{account.policy.policyholderName ?? '—'}</span>
                <span className="renewal-list__secondary">{account.policy.customerId ?? '—'}</span>
              </td>
              <td className="renewal-list__nowrap">
                <span className="renewal-list__primary">{formatDate(account.policy.endDate)}</span>
                <span className="renewal-list__secondary-text">{describeDaysRemaining(account.daysUntilExpiry)}</span>
              </td>
              <td>
                <StatusBadge status={account.status} />
              </td>
              <td className="renewal-list__stack">
                <StageCell account={account} />
              </td>
              <td>
                <NextReminderCell next={account.nextReminder} />
              </td>
              <td>
                <PremiumBadge standing={account.premiumStanding} />
              </td>
              <td className="renewal-table__action">
                <Button to={buildRenewalDetailsPath(account.policyId)} variant="secondary" size="sm">
                  Open
                  <span className="sr-only"> renewal for {account.policyId}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="renewal-cards">
      {accounts.map((account) => (
        <li key={account.policyId} className={`renewal-card renewal-card--${account.status}`}>
          <div className="renewal-card__top">
            <Link className="renewal-list__id" to={buildRenewalDetailsPath(account.policyId)}>
              {account.policyId}
            </Link>
            <StatusBadge status={account.status} />
          </div>
          <p className="renewal-card__product">{account.policy.productName}</p>
          <p className="renewal-card__holder">{account.policy.policyholderName ?? '—'}</p>

          <dl className="renewal-card__figures">
            <div>
              <dt>Expiry</dt>
              <dd>
                {formatDate(account.policy.endDate)}
                <span className="renewal-list__secondary-text">{describeDaysRemaining(account.daysUntilExpiry)}</span>
              </dd>
            </div>
            <div>
              <dt>Next reminder</dt>
              <dd>
                <NextReminderCell next={account.nextReminder} />
              </dd>
            </div>
            <div className="renewal-list__stack">
              <dt>Reminder stage</dt>
              <dd>
                <StageCell account={account} />
              </dd>
            </div>
            <div>
              <dt>Premium</dt>
              <dd>
                <PremiumBadge standing={account.premiumStanding} />
              </dd>
            </div>
          </dl>

          <Button to={buildRenewalDetailsPath(account.policyId)} variant="secondary" size="sm" fullWidth>
            Open renewal
            <span className="sr-only"> for {account.policyId}</span>
          </Button>
        </li>
      ))}
    </ul>
  </>
)

export default RenewalList
