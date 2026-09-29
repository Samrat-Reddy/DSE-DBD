import { Link } from 'react-router-dom'
import Button from '../common/Button'
import { buildAgentCommissionPath } from '../../utils/constants'
import { formatCurrency } from '../../utils/formatters'
import './CommissionList.css'
import './CommissionPanels.css'

const policies = (count) => `${count} ${count === 1 ? 'policy' : 'policies'}`
const records = (count) => `${count} ${count === 1 ? 'record' : 'records'}`

/** Agent-wise commission totals; a table on wide screens and cards below 900px. */
const AgentCommissionTable = ({ agents = [] }) => (
  <>
    <div className="commission-table-wrap">
      <table className="commission-table commission-table--compact">
        <caption className="sr-only">
          Commission by agent with associated policies, records, total, earned, pending and paid amounts
        </caption>
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col" className="commission-table__numeric">Policies</th>
            <th scope="col" className="commission-table__numeric">Records</th>
            <th scope="col" className="commission-table__numeric">Total commission</th>
            <th scope="col" className="commission-table__numeric">Pending</th>
            <th scope="col" className="commission-table__numeric">Earned</th>
            <th scope="col" className="commission-table__numeric">Paid</th>
            <th scope="col"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {agents.map((agent) => (
            <tr key={agent.agentId}>
              <th scope="row">
                <Link className="commission-list__primary" to={buildAgentCommissionPath(agent.agentId)}>
                  {agent.agentName}
                </Link>
                <span className="commission-list__mono">
                  {agent.agentId} · {agent.branch}
                </span>
              </th>
              <td className="commission-table__numeric">{agent.policyCount}</td>
              <td className="commission-table__numeric">{agent.records}</td>
              <td className="commission-table__numeric commission-list__amount">{formatCurrency(agent.total)}</td>
              <td className="commission-table__numeric commission-list__nowrap">{formatCurrency(agent.pending)}</td>
              <td className="commission-table__numeric commission-list__nowrap">{formatCurrency(agent.earned)}</td>
              <td className="commission-table__numeric commission-list__nowrap">{formatCurrency(agent.paid)}</td>
              <td className="commission-table__action">
                <Button to={buildAgentCommissionPath(agent.agentId)} variant="secondary" size="sm">
                  View
                  <span className="sr-only"> commission for {agent.agentName}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <ul className="commission-cards">
      {agents.map((agent) => (
        <li key={agent.agentId} className="commission-card commission-card--paid">
          <div className="commission-card__top">
            <Link className="commission-list__primary" to={buildAgentCommissionPath(agent.agentId)}>
              {agent.agentName}
            </Link>
            <span className="commission-list__mono">{agent.agentId}</span>
          </div>
          <p className="commission-card__amount">{formatCurrency(agent.total)}</p>
          <p className="commission-card__meta">
            {policies(agent.policyCount)} · {records(agent.records)}
          </p>
          <dl className="commission-card__figures">
            <div>
              <dt>Pending</dt>
              <dd>{formatCurrency(agent.pending)}</dd>
            </div>
            <div>
              <dt>Earned</dt>
              <dd>{formatCurrency(agent.earned)}</dd>
            </div>
            <div>
              <dt>Paid</dt>
              <dd>{formatCurrency(agent.paid)}</dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{agent.branch}</dd>
            </div>
          </dl>
          <Button to={buildAgentCommissionPath(agent.agentId)} variant="secondary" size="sm" fullWidth>
            View agent commission
            <span className="sr-only"> for {agent.agentName}</span>
          </Button>
        </li>
      ))}
    </ul>
  </>
)

export default AgentCommissionTable
