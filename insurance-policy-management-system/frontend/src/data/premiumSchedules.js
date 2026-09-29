/**
 * Mock premium schedule headers.
 *
 * ILLUSTRATIVE DATA ONLY — every schedule belongs to an issued policy in
 * `issuedPolicies.js` (Module 1). No policy is invented for this module.
 *
 * A header records the premium terms the schedule was generated from. The
 * individual instalments are generated from these terms by
 * `generateInstallments()` in `utils/premiumCalculations.js`, so a 25-year
 * quarterly plan does not need 100 hand-written rows that could drift out of
 * sync. Paid/unpaid state comes from `payments.js`; DUE / UPCOMING / OVERDUE
 * is derived from dates at read time, so it never goes stale.
 *
 * POL-2025-000031 is deliberately absent: it is still PENDING issuance, and a
 * premium schedule only exists once a policy is issued.
 *
 * `premiumAmount` is the per-instalment amount, matching `policy.premium`.
 */

import { PREMIUM_FREQUENCIES } from '../utils/constants'

export const premiumSchedules = [
  {
    scheduleId: 'SCH-2024-000148',
    policyId: 'POL-2024-000148',
    premiumAmount: 18500,
    frequency: PREMIUM_FREQUENCIES.ANNUAL,
    startDate: '2024-04-15',
    endDate: '2025-04-14',
    totalInstallments: 1,
  },
  {
    scheduleId: 'SCH-2024-000226',
    policyId: 'POL-2024-000226',
    premiumAmount: 4650,
    frequency: PREMIUM_FREQUENCIES.QUARTERLY,
    startDate: '2024-07-05',
    endDate: '2049-07-04',
    totalInstallments: 100,
  },
  {
    scheduleId: 'SCH-2023-000874',
    policyId: 'POL-2023-000874',
    premiumAmount: 8400,
    frequency: PREMIUM_FREQUENCIES.ANNUAL,
    startDate: '2023-09-20',
    endDate: '2024-09-19',
    totalInstallments: 1,
  },
  {
    scheduleId: 'SCH-2024-000519',
    policyId: 'POL-2024-000519',
    premiumAmount: 1550,
    frequency: PREMIUM_FREQUENCIES.HALF_YEARLY,
    startDate: '2024-11-10',
    endDate: '2026-11-09',
    totalInstallments: 4,
  },
]

export default premiumSchedules
