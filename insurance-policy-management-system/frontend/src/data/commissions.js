/**
 * Mock commission records and their audit events.
 *
 * ILLUSTRATIVE DATA ONLY — no commission has been paid to anyone. Every record
 * comes from a SUCCESSFUL seed payment in `payments.js` (Module 2) on an
 * issued policy in `issuedPolicies.js` (Module 1), and its amount is exactly
 * what `calculateCommission` produces under `commissionRules.js`. The test
 * suite recalculates every record to prove it.
 *
 * A record is immutable once generated. Its status is not stored on it: it is
 * derived from the append-only events below (generated → earned → paid).
 *
 * Seeded situation:
 *   11 of 12 records came from payments made before 2026 and are paid or
 *   earned; COM-2026-000002 is still pending (its 30-day hold has passed, so
 *   an administrator can confirm it as earned).
 *   PAY-2026-000036 (Life, instalment 8) is deliberately NOT commissioned yet,
 *   so the demo starts with a payment awaiting commission.
 *   PAY-2026-000079 failed, so it can never earn commission.
 */

import { COMMISSION_BASIS, COMMISSION_EVENT_TYPES, COMMISSION_STATUS } from '../utils/constants'

const COMMISSION_DESK = { name: 'R. Kapoor (Commission desk)', role: 'administrator' }
const { FIRST_YEAR, RENEWAL } = COMMISSION_BASIS

/**
 * [commissionId, policyId, agentId, productId, paymentId, installmentId,
 *  policyYear, basis, ruleId, ratePercent, commissionableAmount, amount,
 *  generatedOn, earnedOn, paidOn, payoutReference]
 */
const ROWS = [
  ['COM-2023-000014', 'POL-2023-000874', 'AGT-0456', 'PRD-HOM-005', 'PAY-2023-000212', 'INS-2023-000874-001', 1, FIRST_YEAR, 'CR-HOM-005-2023', 10, 8400, 840, '2023-09-15', '2023-10-16', '2023-10-31', 'MOCKPAYOUT-2023-10-0456'],
  ['COM-2024-000031', 'POL-2024-000148', 'AGT-2207', 'PRD-HLT-001', 'PAY-2024-000101', 'INS-2024-000148-001', 1, FIRST_YEAR, 'CR-HLT-001-STD', 15, 18500, 2775, '2024-04-13', '2024-05-13', '2024-05-31', 'MOCKPAYOUT-2024-05-2207'],
  ['COM-2024-000046', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2024-000102', 'INS-2024-000226-001', 1, FIRST_YEAR, 'CR-LIF-002-STD', 20, 4650, 930, '2024-07-03', '2024-08-02', '2024-08-30', 'MOCKPAYOUT-2024-08-1184'],
  ['COM-2024-000072', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2024-000118', 'INS-2024-000226-002', 1, FIRST_YEAR, 'CR-LIF-002-STD', 20, 4650, 930, '2024-10-04', '2024-11-04', '2024-11-29', 'MOCKPAYOUT-2024-11-1184'],
  ['COM-2024-000089', 'POL-2024-000519', 'AGT-2207', 'PRD-ACC-004', 'PAY-2024-000131', 'INS-2024-000519-001', 1, FIRST_YEAR, 'CR-ACC-004-STD', 12, 1550, 186, '2024-11-09', '2024-12-09', '2024-12-31', 'MOCKPAYOUT-2024-12-2207'],
  ['COM-2025-000003', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2025-000007', 'INS-2024-000226-003', 1, FIRST_YEAR, 'CR-LIF-002-AGT-1184', 22.5, 4650, 1046.25, '2025-01-05', '2025-02-04', '2025-02-28', 'MOCKPAYOUT-2025-02-1184'],
  ['COM-2025-000020', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2025-000041', 'INS-2024-000226-004', 1, FIRST_YEAR, 'CR-LIF-002-AGT-1184', 22.5, 4650, 1046.25, '2025-04-03', '2025-05-05', '2025-05-30', 'MOCKPAYOUT-2025-05-1184'],
  ['COM-2025-000027', 'POL-2024-000519', 'AGT-2207', 'PRD-ACC-004', 'PAY-2025-000058', 'INS-2024-000519-002', 1, FIRST_YEAR, 'CR-ACC-004-STD', 12, 1550, 186, '2025-05-10', '2025-06-09', '2025-06-30', 'MOCKPAYOUT-2025-06-2207'],
  ['COM-2025-000041', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2025-000083', 'INS-2024-000226-005', 2, RENEWAL, 'CR-LIF-002-AGT-1184', 5.5, 4650, 255.75, '2025-07-06', '2025-08-05', null, null],
  ['COM-2025-000058', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2025-000121', 'INS-2024-000226-006', 2, RENEWAL, 'CR-LIF-002-AGT-1184', 5.5, 4650, 255.75, '2025-10-02', '2025-11-03', null, null],
  ['COM-2025-000066', 'POL-2024-000519', 'AGT-2207', 'PRD-ACC-004', 'PAY-2025-000134', 'INS-2024-000519-003', 2, RENEWAL, 'CR-ACC-004-STD', 6, 1550, 93, '2025-11-08', '2025-12-08', null, null],
  ['COM-2026-000002', 'POL-2024-000226', 'AGT-1184', 'PRD-LIF-002', 'PAY-2026-000004', 'INS-2024-000226-007', 2, RENEWAL, 'CR-LIF-002-AGT-1184', 5.5, 4650, 255.75, '2026-01-04', null, null, null],
]

export const commissions = ROWS.map(
  ([commissionId, policyId, agentId, productId, paymentId, installmentId, policyYear, basis, ruleId, ratePercent, commissionableAmount, amount, generatedOn]) => ({
    commissionId,
    policyId,
    agentId,
    productId,
    paymentId,
    installmentId,
    policyYear,
    basis,
    ruleId,
    ratePercent,
    commissionableAmount,
    amount,
    generatedAt: `${generatedOn}T10:00:00.000Z`,
    generatedBy: COMMISSION_DESK,
  }),
)

/** Event IDs continue per year: CEV-<year>-<6-digit sequence>. */
const buildEvents = () => {
  const sequences = {}
  const nextId = (at) => {
    const year = at.slice(0, 4)
    sequences[year] = (sequences[year] ?? 0) + 1
    return `CEV-${year}-${String(sequences[year]).padStart(6, '0')}`
  }

  const drafts = ROWS.flatMap(([commissionId, , , , , , , , , , , , generatedOn, earnedOn, paidOn, payoutReference]) => [
    {
      commissionId,
      type: COMMISSION_EVENT_TYPES.GENERATED,
      fromStatus: null,
      toStatus: COMMISSION_STATUS.PENDING,
      at: `${generatedOn}T10:00:00.000Z`,
      note: 'Generated from a successful premium payment.',
    },
    earnedOn && {
      commissionId,
      type: COMMISSION_EVENT_TYPES.STATUS_CHANGED,
      fromStatus: COMMISSION_STATUS.PENDING,
      toStatus: COMMISSION_STATUS.EARNED,
      at: `${earnedOn}T11:00:00.000Z`,
      note: 'Earning hold completed; confirmed as earned.',
    },
    paidOn && {
      commissionId,
      type: COMMISSION_EVENT_TYPES.STATUS_CHANGED,
      fromStatus: COMMISSION_STATUS.EARNED,
      toStatus: COMMISSION_STATUS.PAID,
      at: `${paidOn}T12:00:00.000Z`,
      note: 'Included in the monthly commission payout (simulated).',
      payoutReference,
    },
  ]).filter(Boolean)

  return drafts
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((draft) => ({
      eventId: nextId(draft.at),
      payoutReference: null,
      ...draft,
      actor: COMMISSION_DESK,
    }))
}

export const commissionEvents = buildEvents()

export default commissions
