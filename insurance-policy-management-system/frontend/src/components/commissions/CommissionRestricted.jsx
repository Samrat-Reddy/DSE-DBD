import { EmptyState } from '../common/StateViews'

/**
 * Shown instead of commission information to roles that may not see it. The
 * commission service refuses these roles as well; this only avoids a request
 * that is certain to be refused.
 */
const CommissionRestricted = () => (
  <EmptyState
    icon="🔒"
    title="Agent commission is confidential"
    description="Commission information is available only to agents (for their own policies) and administrators. Switch the demo role to Agent or Administrator to continue."
  />
)

export default CommissionRestricted
