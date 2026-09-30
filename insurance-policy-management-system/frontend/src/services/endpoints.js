/**
 * Central registry of API paths, relative to `config.apiBaseUrl`.
 *
 * Feature modules import from here instead of writing URL strings inline, so
 * a backend route change is a single edit. Paths are declared ahead of the
 * FastAPI implementation so the service layer is already wired for it.
 */

export const ENDPOINTS = {
  health: '/health',
  authLogin: '/auth/login',

  // Module 1 — Policy Catalog & Issuance (live FastAPI endpoints)
  policyProducts: '/products',
  policyProductById: (code) => `/products/${encodeURIComponent(code)}`,
  policies: '/policies',
  policyById: (policyNumber) => `/policies/${encodeURIComponent(policyNumber)}`,

  // Module 2 — Premium Schedule & Payments (live FastAPI endpoints)
  premiumSchedules: '/premium-schedules',
  premiumScheduleByPolicyId: (policyNumber) =>
    `/policies/${encodeURIComponent(policyNumber)}/premium-schedule`,
  policyInstallments: (policyNumber) => `/policies/${encodeURIComponent(policyNumber)}/installments`,
  installmentById: (installmentId) => `/installments/${encodeURIComponent(installmentId)}`,
  installmentPayments: (installmentId) =>
    `/installments/${encodeURIComponent(installmentId)}/payments`,
  payments: '/payments',
  paymentById: (paymentNumber) => `/payments/${encodeURIComponent(paymentNumber)}`,

  // Module 3 — Claim Filing & Approval Workflow (live FastAPI endpoints).
  // One endpoint per workflow action; there is no generic status endpoint.
  claims: '/claims',
  claimTypes: '/claim-types',
  claimById: (claimNumber) => `/claims/${encodeURIComponent(claimNumber)}`,
  claimTimeline: (claimNumber) => `/claims/${encodeURIComponent(claimNumber)}/timeline`,
  claimAction: (claimNumber, action) =>
    `/claims/${encodeURIComponent(claimNumber)}/${encodeURIComponent(action)}`,
  claimEligibility: '/claims/eligibility',
  claimFilingContext: (policyNumber) =>
    `/policies/${encodeURIComponent(policyNumber)}/claim-eligibility`,

  // Module 4 — Renewal Reminder Engine
  renewals: '/renewals',
  renewalByPolicyId: (policyId) => `/policies/${policyId}/renewal`,
  reminderHistory: (policyId) => `/policies/${policyId}/reminders`,
  reminderPlan: (policyId) => `/policies/${policyId}/reminder-plan`,
  reminderChecks: '/reminder-checks',
  reminders: (policyId) => `/policies/${policyId}/reminders`,
  reminderRetries: (reminderId) => `/reminders/${reminderId}/retries`,

  // Module 5 — Agent Commission
  commissions: '/commissions',
  commissionById: (commissionId) => `/commissions/${commissionId}`,
  commissionHistory: (commissionId) => `/commissions/${commissionId}/events`,
  commissionTransitions: (commissionId) => `/commissions/${commissionId}/transitions`,
  commissionRules: '/commission-rules',
  agentCommissions: '/agents/commission-summaries',
  agentCommissionById: (agentId) => `/agents/${agentId}/commissions`,
  policyCommissions: (policyId) => `/policies/${policyId}/commissions`,
  commissionGenerationRuns: '/commission-generation-runs',
  commissionEarningRuns: '/commission-earning-runs',

  // Module 6 — MIS Reports
  reportOverview: '/reports/overview',
  policyReport: '/reports/policies',
  premiumReport: '/reports/premiums',
  claimsReport: '/reports/claims',
  renewalReport: '/reports/renewals',
  commissionReport: '/reports/commissions',
}

export default ENDPOINTS
