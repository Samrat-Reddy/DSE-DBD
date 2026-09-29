import { Link } from 'react-router-dom'
import Button from '../common/Button'
import StatusBadge from '../common/StatusBadge'
import { buildClaimDetailsPath, buildPolicyDetailsPath } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './ClaimList.css'

/**
 * Claims register — a table on wide screens, cards below 900px, both built
 * from the same rows.
 */
const ClaimList = ({ claims = [] }) => (
  <>
    <div className="claim-table-wrap">
      <table className="claim-table">
        <caption className="sr-only">
          Claims with claim ID, policy, policyholder, claim type, incident date, claimed and
          approved amounts, status and last update
        </caption>
        <thead>
          <tr>
            <th scope="col">Claim</th>
            <th scope="col">Policyholder</th>
            <th scope="col">Claim type</th>
            <th scope="col">Incident</th>
            <th scope="col" className="claim-table__numeric">Claimed</th>
            <th scope="col" className="claim-table__numeric">Approved</th>
            <th scope="col">Status</th>
            <th scope="col">Last updated</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {claims.map((claim) => (
            <tr key={claim.claimId}>
              <th scope="row">
                <Link className="claim-list__id" to={buildClaimDetailsPath(claim.claimId)}>
                  {claim.claimId}
                </Link>
                {claim.isSessionCreated && <span className="claim-list__new">New</span>}
                <span className="claim-list__secondary">
                  <Link to={buildPolicyDetailsPath(claim.policyId)}>{claim.policyId}</Link>
                </span>
              </th>
              <td>
                <span className="claim-list__primary">{claim.policyholderName ?? 'Policy record unavailable'}</span>
                <span className="claim-list__secondary">{claim.policyholderId ?? '—'}</span>
              </td>
              <td>{claim.claimTypeLabel}</td>
              <td className="claim-list__nowrap">{formatDate(claim.incidentDate)}</td>
              <td className="claim-table__numeric claim-list__amount">{formatCurrency(claim.claimedAmount)}</td>
              <td className="claim-table__numeric claim-list__amount">
                {claim.approvedAmount ? formatCurrency(claim.approvedAmount) : <span className="claim-list__muted">—</span>}
              </td>
              <td>
                <StatusBadge status={claim.status} />
              </td>
              <td className="claim-list__nowrap">{formatDate(claim.updatedAt)}</td>
              <td className="claim-table__action">
                <Button to={buildClaimDetailsPath(claim.claimId)} variant="secondary" size="sm">
                  Open
                  <span className="sr-only"> claim {claim.claimId}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="claim-cards">
      {claims.map((claim) => (
        <li key={claim.claimId} className={`claim-card claim-card--${claim.status}`}>
          <div className="claim-card__top">
            <Link className="claim-list__id" to={buildClaimDetailsPath(claim.claimId)}>
              {claim.claimId}
            </Link>
            <StatusBadge status={claim.status} />
          </div>
          <p className="claim-card__type">{claim.claimTypeLabel}</p>
          <p className="claim-card__holder">
            {claim.policyholderName ?? 'Policy record unavailable'} · {claim.policyId}
          </p>

          <dl className="claim-card__figures">
            <div>
              <dt>Claimed</dt>
              <dd>{formatCurrency(claim.claimedAmount)}</dd>
            </div>
            <div>
              <dt>Approved</dt>
              <dd>{claim.approvedAmount ? formatCurrency(claim.approvedAmount) : '—'}</dd>
            </div>
            <div>
              <dt>Incident</dt>
              <dd>{formatDate(claim.incidentDate)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(claim.updatedAt)}</dd>
            </div>
          </dl>

          <Button to={buildClaimDetailsPath(claim.claimId)} variant="secondary" size="sm" fullWidth>
            Open claim
            <span className="sr-only"> {claim.claimId}</span>
          </Button>
        </li>
      ))}
    </ul>
  </>
)

export default ClaimList
