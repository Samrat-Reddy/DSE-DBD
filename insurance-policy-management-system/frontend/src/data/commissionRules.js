/**
 * Commission rules.
 *
 * ILLUSTRATIVE RATES ONLY — invented for a university demonstration. They are
 * not real insurer or regulatory commission rates.
 *
 * A rule says, for one product (and optionally one agent), which percentage of
 * a successful premium payment is paid as commission, during an effective
 * period:
 *
 *   firstYearRatePercent  instalments that fall in policy year 1
 *   renewalRatePercent    instalments in policy year 2 onwards
 *
 * Resolution for a payment (see `resolveCommissionRule`): only rules for the
 * policy's product whose period contains the payment date are considered; an
 * agent-specific rule beats a product-wide rule; then the latest
 * `effectiveFrom` wins. `effectiveTo: null` means open-ended.
 *
 * The inactive products PRD-HLT-006 and PRD-LIF-007 have no rule, because no
 * new policy can be issued for them.
 */

export const commissionRules = [
  {
    ruleId: 'CR-HLT-001-STD',
    productId: 'PRD-HLT-001',
    agentId: null,
    firstYearRatePercent: 15,
    renewalRatePercent: 7.5,
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    description: 'Standard health commission.',
  },
  {
    ruleId: 'CR-LIF-002-STD',
    productId: 'PRD-LIF-002',
    agentId: null,
    firstYearRatePercent: 20,
    renewalRatePercent: 5,
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    description: 'Standard term life commission.',
  },
  {
    ruleId: 'CR-LIF-002-AGT-1184',
    productId: 'PRD-LIF-002',
    agentId: 'AGT-1184',
    firstYearRatePercent: 22.5,
    renewalRatePercent: 5.5,
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    description: 'Agent-specific term life rate agreed with Arjun Nair from 2025.',
  },
  {
    ruleId: 'CR-MOT-003-STD',
    productId: 'PRD-MOT-003',
    agentId: null,
    firstYearRatePercent: 10,
    renewalRatePercent: 10,
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    description: 'Motor commission (same rate every year).',
  },
  {
    ruleId: 'CR-ACC-004-STD',
    productId: 'PRD-ACC-004',
    agentId: null,
    firstYearRatePercent: 12,
    renewalRatePercent: 6,
    effectiveFrom: '2023-01-01',
    effectiveTo: null,
    description: 'Standard personal accident commission.',
  },
  {
    ruleId: 'CR-HOM-005-2023',
    productId: 'PRD-HOM-005',
    agentId: null,
    firstYearRatePercent: 10,
    renewalRatePercent: 5,
    effectiveFrom: '2023-01-01',
    effectiveTo: '2024-12-31',
    description: 'Home commission before the 2025 revision.',
  },
  {
    ruleId: 'CR-HOM-005-2025',
    productId: 'PRD-HOM-005',
    agentId: null,
    firstYearRatePercent: 12,
    renewalRatePercent: 6,
    effectiveFrom: '2025-01-01',
    effectiveTo: null,
    description: 'Revised home commission from 2025.',
  },
]

export default commissionRules
