import Checklist from '../common/Checklist'

/**
 * Claim eligibility and verification checklist.
 *
 * Now a thin wrapper around the shared `Checklist`, which Module 4 reuses for
 * renewal readiness. Behaviour and markup are unchanged apart from class names.
 */
const ClaimChecklist = (props) => <Checklist {...props} />

export default ClaimChecklist
