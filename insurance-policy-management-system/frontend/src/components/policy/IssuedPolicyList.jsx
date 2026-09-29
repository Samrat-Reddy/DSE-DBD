import { Link } from 'react-router-dom'
import StatusBadge from '../common/StatusBadge'
import {
  formatCompactCurrency,
  formatCurrency,
  formatDate,
} from '../../utils/formatters'
import { buildPolicyDetailsPath } from '../../utils/constants'
import './IssuedPolicyList.css'

/**
 * The in-force policy book.
 *
 * Renders a real table on wide screens and a stacked card list below 900px —
 * a table squeezed onto a phone is unreadable, so the mobile view is a
 * different layout rather than a shrunken one. Both come from the same data.
 */
const IssuedPolicyList = ({ policies = [] }) => (
  <>
    <div className="issued-table-wrap">
      <table className="issued-table">
        <caption className="sr-only">
          Issued policies with policy number, product, policyholder, coverage,
          premium, term and status
        </caption>
        <thead>
          <tr>
            <th scope="col">Policy number</th>
            <th scope="col">Product</th>
            <th scope="col">Policyholder</th>
            <th scope="col" className="issued-table__numeric">
              Coverage
            </th>
            <th scope="col" className="issued-table__numeric">
              Premium
            </th>
            <th scope="col">Cover period</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id}>
              <th scope="row">
                <Link className="issued-table__link" to={buildPolicyDetailsPath(policy.id)}>
                  {policy.id}
                </Link>
                {policy.isSessionIssued && (
                  <span className="issued-table__new">New</span>
                )}
              </th>
              <td>
                <span className="issued-table__product">{policy.productName}</span>
                <span className="issued-table__type">{policy.type}</span>
              </td>
              <td>
                <span className="issued-table__product">
                  {policy.policyholder?.name ?? '—'}
                </span>
                <span className="issued-table__type">
                  {policy.policyholder?.customerId ?? '—'}
                </span>
              </td>
              <td className="issued-table__numeric">
                {formatCompactCurrency(policy.coverageAmount)}
              </td>
              <td className="issued-table__numeric">
                <span className="issued-table__product">
                  {formatCurrency(policy.premium)}
                </span>
                <span className="issued-table__type">
                  {policy.premiumFrequency}
                </span>
              </td>
              <td>
                <span className="issued-table__dates">
                  {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
                </span>
              </td>
              <td>
                <StatusBadge status={policy.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="issued-cards">
      {policies.map((policy) => (
        <li className="issued-card" key={policy.id}>
          <div className="issued-card__top">
            <Link className="issued-card__id" to={buildPolicyDetailsPath(policy.id)}>
              {policy.id}
            </Link>
            <StatusBadge status={policy.status} />
          </div>

          <p className="issued-card__product">{policy.productName}</p>
          <p className="issued-card__holder">
            {policy.policyholder?.name} · {policy.policyholder?.customerId}
          </p>

          <dl className="issued-card__figures">
            <div>
              <dt>Coverage</dt>
              <dd>{formatCompactCurrency(policy.coverageAmount)}</dd>
            </div>
            <div>
              <dt>Premium</dt>
              <dd>{formatCurrency(policy.premium)}</dd>
            </div>
            <div>
              <dt>Cover period</dt>
              <dd>
                {formatDate(policy.startDate)} – {formatDate(policy.endDate)}
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  </>
)

export default IssuedPolicyList
