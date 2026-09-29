import { Route, Routes } from 'react-router-dom'
import { MainLayout } from '../layouts'
import {
  AgentCommissionDetails,
  ClaimDetails,
  ClaimFiling,
  ClaimsList,
  ClaimsReport,
  CommissionAgents,
  CommissionDetails,
  CommissionOverview,
  CommissionReport,
  Home,
  NotFound,
  PaymentDetails,
  PaymentHistory,
  PolicyCommission,
  PolicyReport,
  PremiumReport,
  PolicyCatalog,
  PolicyDetails,
  PolicyIssuance,
  PolicyPremiumDetails,
  PremiumOverview,
  PremiumPayment,
  RenewalDetails,
  RenewalReport,
  RenewalsOverview,
  ReportsOverview,
} from '../pages'
import { ROUTES } from '../utils/constants'

/**
 * Single place where URL paths map to pages. Feature routes are registered
 * here as nested children of the shared layout.
 *
 * Module 1 owns /policies/*, Module 2 owns /payments/*, Module 3 owns
 * /claims/*, Module 4 owns /renewals/*, Module 5 owns /commissions/* and
 * Module 6 owns /reports/*.
 */
const AppRoutes = () => (
  <Routes>
    <Route element={<MainLayout />}>
      <Route index path={ROUTES.HOME} element={<Home />} />

      {/* Module 1 — Policy Catalog & Issuance.
          `issue` is declared before `:id` so it is not captured as an ID. */}
      <Route path={ROUTES.POLICY_CATALOG} element={<PolicyCatalog />} />
      <Route path={ROUTES.POLICY_ISSUANCE} element={<PolicyIssuance />} />
      <Route
        path={ROUTES.POLICY_ISSUANCE_FOR_PRODUCT}
        element={<PolicyIssuance />}
      />
      <Route path={ROUTES.POLICY_DETAILS} element={<PolicyDetails />} />

      {/* Module 2 — Premium Schedule & Payments.
          Static `history` segments rank above `:policyId`. */}
      <Route path={ROUTES.PREMIUMS} element={<PremiumOverview />} />
      <Route path={ROUTES.PAYMENT_HISTORY} element={<PaymentHistory />} />
      <Route path={ROUTES.PAYMENT_DETAILS} element={<PaymentDetails />} />
      <Route path={ROUTES.POLICY_PREMIUMS} element={<PolicyPremiumDetails />} />
      <Route path={ROUTES.PREMIUM_PAYMENT} element={<PremiumPayment />} />

      {/* Module 3 — Claim Filing & Approval Workflow.
          The static `file` segment ranks above `:claimId`. */}
      <Route path={ROUTES.CLAIMS} element={<ClaimsList />} />
      <Route path={ROUTES.CLAIM_FILING} element={<ClaimFiling />} />
      <Route path={ROUTES.CLAIM_DETAILS} element={<ClaimDetails />} />

      {/* Module 4 — Renewal Reminder Engine */}
      <Route path={ROUTES.RENEWALS} element={<RenewalsOverview />} />
      <Route path={ROUTES.RENEWAL_DETAILS} element={<RenewalDetails />} />

      {/* Module 5 — Agent Commission.
          Static `agents` and `policies` segments rank above `:commissionId`. */}
      <Route path={ROUTES.COMMISSIONS} element={<CommissionOverview />} />
      <Route path={ROUTES.COMMISSION_AGENTS} element={<CommissionAgents />} />
      <Route path={ROUTES.COMMISSION_AGENT_DETAILS} element={<AgentCommissionDetails />} />
      <Route path={ROUTES.COMMISSION_POLICY} element={<PolicyCommission />} />
      <Route path={ROUTES.COMMISSION_DETAILS} element={<CommissionDetails />} />

      {/* Module 6 — MIS Reports. Every report path is static. */}
      <Route path={ROUTES.REPORTS} element={<ReportsOverview />} />
      <Route path={ROUTES.POLICY_REPORT} element={<PolicyReport />} />
      <Route path={ROUTES.PREMIUM_REPORT} element={<PremiumReport />} />
      <Route path={ROUTES.CLAIMS_REPORT} element={<ClaimsReport />} />
      <Route path={ROUTES.RENEWAL_REPORT} element={<RenewalReport />} />
      <Route path={ROUTES.COMMISSION_REPORT} element={<CommissionReport />} />

      <Route path={ROUTES.NOT_FOUND} element={<NotFound />} />
    </Route>
  </Routes>
)

export default AppRoutes
