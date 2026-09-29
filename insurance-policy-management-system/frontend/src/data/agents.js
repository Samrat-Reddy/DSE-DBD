/**
 * Mock agent registry.
 *
 * ILLUSTRATIVE DATA ONLY — invented agents for a university demonstration.
 *
 * Policies (Module 1) already name their agent. This registry is what the
 * commission module checks that agent against: a commission is only generated
 * for an agent who is registered and active. The IDs and names match the
 * `agent` blocks in `issuedPolicies.js` exactly (the test suite checks this).
 *
 * AGT-0000 is the agent that Module 1 assigns to policies issued in the
 * browser session, so those policies can earn commission too.
 */

import { AGENT_STATUS } from '../utils/constants'

export const agents = [
  { id: 'AGT-0456', name: 'Nisha Gupta', branch: 'Delhi NCR', status: AGENT_STATUS.ACTIVE },
  { id: 'AGT-1184', name: 'Arjun Nair', branch: 'Mumbai West', status: AGENT_STATUS.ACTIVE },
  { id: 'AGT-2207', name: 'Meera Iyer', branch: 'Bengaluru South', status: AGENT_STATUS.ACTIVE },
  { id: 'AGT-3390', name: 'Sandeep Rao', branch: 'Kochi Central', status: AGENT_STATUS.ACTIVE },
  { id: 'AGT-0000', name: 'Demo Issuing User', branch: 'Demo Branch', status: AGENT_STATUS.ACTIVE },
]

export default agents
