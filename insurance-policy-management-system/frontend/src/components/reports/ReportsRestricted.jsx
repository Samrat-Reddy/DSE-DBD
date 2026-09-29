import { EmptyState } from '../common/StateViews'
import Button from '../common/Button'
import { ROLES, ROUTES } from '../../utils/constants'

/**
 * Shown instead of a report to roles that may not read MIS Reports. The
 * report service refuses these roles as well; this only avoids a request that
 * is certain to be refused, and points an agent at the views they do have.
 */
const ReportsRestricted = ({ role }) => (
  <EmptyState
    icon="🔒"
    title="MIS Reports are restricted"
    description={
      role === ROLES.AGENT
        ? 'MIS Reports are organisation-wide management reports, available to administrators only. Your own commission and the policies you service remain available to you.'
        : 'MIS Reports are organisation-wide management reports, available to administrators only. Switch the demo role to Administrator to continue.'
    }
    action={
      role === ROLES.AGENT ? (
        <Button variant="secondary" to={ROUTES.COMMISSIONS}>
          My commission
        </Button>
      ) : null
    }
  />
)

export default ReportsRestricted
