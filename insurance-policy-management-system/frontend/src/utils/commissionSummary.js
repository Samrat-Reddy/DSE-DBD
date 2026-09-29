/**
 * Agent Commission — summaries, search, filters and sorting (pure).
 *
 * Every total is derived from commission records at read time; nothing is
 * stored, so a dashboard figure can never disagree with the register.
 */

import { COMMISSION_STATUS } from './constants'
import { sumAmounts } from './commissionCalculation'

const { PENDING, EARNED, PAID } = COMMISSION_STATUS

const totalOf = (records, status) =>
  sumAmounts(records.filter((record) => !status || record.status === status).map((record) => record.amount))

/** Headline totals for a set of commission views. */
export const summariseCommissions = (records = []) => ({
  records: records.length,
  total: totalOf(records),
  pending: totalOf(records, PENDING),
  earned: totalOf(records, EARNED),
  paid: totalOf(records, PAID),
  pendingCount: records.filter((record) => record.status === PENDING).length,
  earnedCount: records.filter((record) => record.status === EARNED).length,
  paidCount: records.filter((record) => record.status === PAID).length,
  agents: new Set(records.map((record) => record.agentId)).size,
  policies: new Set(records.map((record) => record.policyId)).size,
})

/**
 * One row per agent: associated policies (from Module 1) and commission
 * totals (from records). Agents with policies but no commission still appear.
 *
 * @param {object[]} records commission views
 * @param {object[]} agents  registry entries to include
 * @param {object[]} policies Module 1 policies
 */
export const summariseByAgent = (records, agents, policies) =>
  agents.map((agent) => {
    const own = records.filter((record) => record.agentId === agent.id)
    const agentPolicies = policies.filter((policy) => policy.agent?.id === agent.id)
    return {
      agentId: agent.id,
      agentName: agent.name,
      branch: agent.branch,
      agentStatus: agent.status,
      policyIds: agentPolicies.map((policy) => policy.id),
      policyCount: agentPolicies.length,
      ...summariseCommissions(own),
    }
  })

/* ------------------------------------------------------------------ */
/* Register query                                                      */
/* ------------------------------------------------------------------ */

const normalise = (value) => String(value ?? '').toLowerCase().trim()
const isAll = (value) => !value || value === 'all'
const STATUS_ORDER = [PENDING, EARNED, PAID]

export const matchesCommissionSearch = (record, term) => {
  const query = normalise(term)
  if (!query) return true
  return [
    record.commissionId,
    record.agentName,
    record.agentId,
    record.policyId,
    record.policyholderName,
    record.productName,
    record.paymentId,
    record.transactionReference,
  ].some((field) => normalise(field).includes(query))
}

const SORTS = {
  'payment-desc': (a, b) => String(b.paymentDate).localeCompare(String(a.paymentDate)) || b.commissionId.localeCompare(a.commissionId),
  'payment-asc': (a, b) => String(a.paymentDate).localeCompare(String(b.paymentDate)) || a.commissionId.localeCompare(b.commissionId),
  'amount-desc': (a, b) => b.amount - a.amount || a.commissionId.localeCompare(b.commissionId),
  'amount-asc': (a, b) => a.amount - b.amount || a.commissionId.localeCompare(b.commissionId),
  'agent-asc': (a, b) => normalise(a.agentName).localeCompare(normalise(b.agentName)) || a.commissionId.localeCompare(b.commissionId),
  status: (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.commissionId.localeCompare(b.commissionId),
}

/** @param {{search?: string, status?: string, agentId?: string, policyId?: string, sort?: string}} query */
export const queryCommissions = (records, query = {}) => {
  const { search, status, agentId, policyId, sort } = query
  const filtered = records.filter(
    (record) =>
      matchesCommissionSearch(record, search) &&
      (isAll(status) || record.status === status) &&
      (isAll(agentId) || record.agentId === agentId) &&
      (isAll(policyId) || record.policyId === policyId),
  )
  const comparator = SORTS[sort] ?? SORTS['payment-desc']
  return [...filtered].sort(comparator)
}
