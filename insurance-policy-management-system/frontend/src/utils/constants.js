/**
 * Application-wide constants.
 *
 * Route paths live here so navigation links and the router definition can
 * never drift apart.
 */

export const ROUTES = {
  HOME: '/',
  POLICY_CATALOG: '/policies',
  POLICY_DETAILS: '/policies/:id',
  POLICY_ISSUANCE: '/policies/issue',
  POLICY_ISSUANCE_FOR_PRODUCT: '/policies/issue/:productId',

  // Module 2 — Premium Schedule & Payments
  PREMIUMS: '/payments',
  PAYMENT_HISTORY: '/payments/history',
  PAYMENT_DETAILS: '/payments/history/:paymentId',
  POLICY_PREMIUMS: '/payments/:policyId',
  // One route with an optional segment, so choosing a different instalment
  // updates the URL without remounting the payment page.
  PREMIUM_PAYMENT: '/payments/:policyId/pay/:installmentId?',

  // Module 3 — Claim Filing & Approval Workflow.
  // The static `file` segment ranks above `:claimId`.
  CLAIMS: '/claims',
  CLAIM_FILING: '/claims/file/:policyId?',
  CLAIM_DETAILS: '/claims/:claimId',

  // Module 4 — Renewal Reminder Engine
  RENEWALS: '/renewals',
  RENEWAL_DETAILS: '/renewals/:policyId',

  // Module 5 — Agent Commission.
  // Static `agents` and `policies` segments rank above `:commissionId`.
  COMMISSIONS: '/commissions',
  COMMISSION_AGENTS: '/commissions/agents',
  COMMISSION_AGENT_DETAILS: '/commissions/agents/:agentId',
  COMMISSION_POLICY: '/commissions/policies/:policyId',
  COMMISSION_DETAILS: '/commissions/:commissionId',

  // Module 6 — MIS Reports
  REPORTS: '/reports',
  POLICY_REPORT: '/reports/policies',
  PREMIUM_REPORT: '/reports/premiums',
  CLAIMS_REPORT: '/reports/claims',
  RENEWAL_REPORT: '/reports/renewals',
  COMMISSION_REPORT: '/reports/commissions',

  NOT_FOUND: '*',
}

/** Path builders — keeps `:param` substitution out of components. */
export const buildPolicyDetailsPath = (id) => `/policies/${id}`
export const buildIssuancePath = (productId) =>
  productId ? `/policies/issue/${productId}` : '/policies/issue'

export const buildPolicyPremiumsPath = (policyId) => `/payments/${policyId}`
export const buildPremiumPaymentPath = (policyId, installmentId) =>
  installmentId
    ? `/payments/${policyId}/pay/${installmentId}`
    : `/payments/${policyId}/pay`
export const buildPaymentDetailsPath = (paymentId) =>
  `/payments/history/${paymentId}`

export const buildClaimDetailsPath = (claimId) => `/claims/${claimId}`
export const buildClaimFilingPath = (policyId) =>
  policyId ? `/claims/file/${policyId}` : '/claims/file'

export const buildRenewalDetailsPath = (policyId) => `/renewals/${policyId}`

export const buildCommissionDetailsPath = (commissionId) => `/commissions/${commissionId}`
export const buildAgentCommissionPath = (agentId) => `/commissions/agents/${agentId}`
export const buildPolicyCommissionPath = (policyId) => `/commissions/policies/${policyId}`

export const APP_META = {
  name: 'Insurance Policy Management System',
  shortName: 'IPMS',
  version: '0.1.0',
}

/** HTTP verbs used by the service layer. */
export const HTTP_METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DELETE',
}

/**
 * Conceptual roles the UI adapts to. There is no authentication in this
 * module — the role is a demo-only switch used to show how navigation and
 * actions differ per audience.
 */
export const ROLES = {
  POLICYHOLDER: 'policyholder',
  AGENT: 'agent',
  ADMINISTRATOR: 'administrator',
}

export const ROLE_OPTIONS = [
  { value: ROLES.POLICYHOLDER, label: 'Policyholder' },
  { value: ROLES.AGENT, label: 'Agent' },
  { value: ROLES.ADMINISTRATOR, label: 'Administrator' },
]

/** Only internal staff roles may issue a policy. */
export const ROLES_ALLOWED_TO_ISSUE = [ROLES.AGENT, ROLES.ADMINISTRATOR]

export const POLICY_TYPES = {
  HEALTH: 'Health',
  LIFE: 'Life',
  MOTOR: 'Motor',
  PERSONAL_ACCIDENT: 'Personal Accident',
  HOME: 'Home',
}

export const POLICY_TYPE_OPTIONS = Object.values(POLICY_TYPES).map((type) => ({
  value: type,
  label: type,
}))

/** Lifecycle status of a catalog product. */
export const PRODUCT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
}

/** Lifecycle status of an issued policy. */
export const POLICY_STATUS = {
  ACTIVE: 'active',
  PENDING: 'pending',
  EXPIRED: 'expired',
  LAPSED: 'lapsed',
}

export const PREMIUM_FREQUENCIES = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  HALF_YEARLY: 'Half-Yearly',
  ANNUAL: 'Annual',
}

export const PREMIUM_FREQUENCY_OPTIONS = Object.values(
  PREMIUM_FREQUENCIES,
).map((value) => ({ value, label: value }))

/** Number of premium instalments per year, used for display maths only. */
export const FREQUENCY_INSTALMENTS_PER_YEAR = {
  [PREMIUM_FREQUENCIES.MONTHLY]: 12,
  [PREMIUM_FREQUENCIES.QUARTERLY]: 4,
  [PREMIUM_FREQUENCIES.HALF_YEARLY]: 2,
  [PREMIUM_FREQUENCIES.ANNUAL]: 1,
}

export const CATALOG_SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'premium-asc', label: 'Premium (Low to High)' },
  { value: 'premium-desc', label: 'Premium (High to Low)' },
  { value: 'coverage-desc', label: 'Coverage (High to Low)' },
  { value: 'type-asc', label: 'Policy Type' },
]

export const DEFAULT_CATALOG_QUERY = {
  search: '',
  type: 'all',
  status: 'all',
  sort: 'name-asc',
}

/* ------------------------------------------------------------------ */
/* Module 2 — Premium Schedule & Payments                              */
/* ------------------------------------------------------------------ */

/**
 * Roles that may record a (mock) premium payment. Policyholders pay their
 * own premiums; administrators can record payments. Agents have read-only
 * visibility of premium status.
 */
export const ROLES_ALLOWED_TO_PAY = [ROLES.POLICYHOLDER, ROLES.ADMINISTRATOR]

/**
 * Status of a single premium instalment. Distinct from policy status: an
 * ACTIVE policy can have an instalment that is DUE or OVERDUE.
 */
export const INSTALLMENT_STATUS = {
  PAID: 'paid',
  DUE: 'due',
  UPCOMING: 'upcoming',
  OVERDUE: 'overdue',
}

/** Status of a payment attempt. Distinct from instalment status. */
export const PAYMENT_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING: 'pending',
}

/** Policy-level premium standing, derived from its instalments. */
export const PAYMENT_STANDING = {
  OVERDUE: 'overdue',
  DUE: 'due',
  UP_TO_DATE: 'up-to-date',
  FULLY_PAID: 'fully-paid',
}

export const PAYMENT_STANDING_OPTIONS = [
  { value: PAYMENT_STANDING.OVERDUE, label: 'Overdue' },
  { value: PAYMENT_STANDING.DUE, label: 'Due' },
  { value: PAYMENT_STANDING.UP_TO_DATE, label: 'Up to date' },
  { value: PAYMENT_STANDING.FULLY_PAID, label: 'Fully paid' },
]

export const PAYMENT_STATUS_OPTIONS = [
  { value: PAYMENT_STATUS.SUCCESS, label: 'Successful' },
  { value: PAYMENT_STATUS.FAILED, label: 'Failed' },
  { value: PAYMENT_STATUS.PENDING, label: 'Pending' },
]

/**
 * Illustrative payment methods. No card, bank or UPI details are ever
 * collected — the method is a label on a simulated payment.
 */
export const PAYMENT_METHODS = {
  UPI: 'upi',
  CARD: 'card',
  NET_BANKING: 'net-banking',
}

export const PAYMENT_METHOD_OPTIONS = [
  {
    value: PAYMENT_METHODS.UPI,
    label: 'UPI',
    description: 'Illustrative UPI payment. No UPI ID is collected.',
  },
  {
    value: PAYMENT_METHODS.CARD,
    label: 'Card',
    description: 'Illustrative debit or credit card payment. No card details are collected.',
  },
  {
    value: PAYMENT_METHODS.NET_BANKING,
    label: 'Net Banking',
    description: 'Illustrative net banking payment. No bank credentials are collected.',
  },
]

export const PAYMENT_METHOD_LABELS = Object.fromEntries(
  PAYMENT_METHOD_OPTIONS.map((option) => [option.value, option.label]),
)

/** An unpaid instalment becomes DUE this many days before its due date. */
export const DUE_WINDOW_DAYS = 30

/** Upcoming instalments shown before the "show all" toggle on long schedules. */
export const SCHEDULE_PREVIEW_UPCOMING = 3

export const PREMIUM_ACCOUNT_SORT_OPTIONS = [
  { value: 'next-due-asc', label: 'Next due date (soonest)' },
  { value: 'overdue-desc', label: 'Overdue amount (highest)' },
  { value: 'outstanding-desc', label: 'Outstanding balance (highest)' },
  { value: 'policy-asc', label: 'Policy number' },
  { value: 'policyholder-asc', label: 'Policyholder (A–Z)' },
]

export const DEFAULT_PREMIUM_QUERY = {
  search: '',
  standing: 'all',
  sort: 'next-due-asc',
}

export const PAYMENT_SORT_OPTIONS = [
  { value: 'date-desc', label: 'Payment date (newest)' },
  { value: 'date-asc', label: 'Payment date (oldest)' },
  { value: 'amount-desc', label: 'Amount (highest)' },
  { value: 'amount-asc', label: 'Amount (lowest)' },
]

export const DEFAULT_PAYMENT_QUERY = {
  search: '',
  status: 'all',
  method: 'all',
  sort: 'date-desc',
}

/* ------------------------------------------------------------------ */
/* Module 3 — Claim Filing & Approval Workflow                         */
/* ------------------------------------------------------------------ */

/**
 * Claim workflow statuses. The allowed moves between them live in
 * `utils/claimWorkflow.js`; this is only the vocabulary.
 */
export const CLAIM_STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  UNDER_REVIEW: 'under-review',
  VERIFIED: 'verified',
  ASSESSED: 'assessed',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  SETTLED: 'settled',
  CANCELLED: 'cancelled',
}

export const CLAIM_STATUS_LABELS = {
  [CLAIM_STATUS.DRAFT]: 'Draft',
  [CLAIM_STATUS.SUBMITTED]: 'Submitted',
  [CLAIM_STATUS.UNDER_REVIEW]: 'Under review',
  [CLAIM_STATUS.VERIFIED]: 'Verified',
  [CLAIM_STATUS.ASSESSED]: 'Assessed',
  [CLAIM_STATUS.APPROVED]: 'Approved',
  [CLAIM_STATUS.REJECTED]: 'Rejected',
  [CLAIM_STATUS.SETTLED]: 'Settled',
  [CLAIM_STATUS.CANCELLED]: 'Cancelled',
}

export const CLAIM_STATUS_OPTIONS = Object.values(CLAIM_STATUS)
  .filter((status) => status !== CLAIM_STATUS.DRAFT)
  .map((value) => ({ value, label: CLAIM_STATUS_LABELS[value] }))

/**
 * Roles that may file a claim. Policyholders file their own; agents may file
 * on a policyholder's behalf. Claims officers (administrators) adjudicate and
 * deliberately cannot file, so the same person never files and approves.
 */
export const ROLES_ALLOWED_TO_FILE_CLAIM = [ROLES.POLICYHOLDER, ROLES.AGENT]

/** Display name used for actions taken under each demo role. */
export const DEMO_ROLE_TITLES = {
  [ROLES.POLICYHOLDER]: 'Policyholder',
  [ROLES.AGENT]: 'Agent',
  [ROLES.ADMINISTRATOR]: 'Claims Officer',
}

/** Claims may still be filed this long after cover ends, for incidents within cover. */
export const CLAIM_FILING_WINDOW_DAYS = 90

export const CLAIM_DESCRIPTION_MIN_LENGTH = 30
export const CLAIM_DESCRIPTION_MAX_LENGTH = 1000
export const CLAIM_REJECTION_REASON_MIN_LENGTH = 15

export const CLAIM_SORT_OPTIONS = [
  { value: 'updated-desc', label: 'Last updated (newest)' },
  { value: 'filed-desc', label: 'Filing date (newest)' },
  { value: 'incident-desc', label: 'Incident date (newest)' },
  { value: 'claimed-desc', label: 'Claimed amount (highest)' },
  { value: 'claim-asc', label: 'Claim ID' },
]

export const DEFAULT_CLAIM_QUERY = {
  search: '',
  status: 'all',
  claimType: 'all',
  sort: 'updated-desc',
}

/* ------------------------------------------------------------------ */
/* Module 4 — Renewal Reminder Engine                                  */
/* ------------------------------------------------------------------ */

/** Simulated reminder channels. No message is ever sent on any of them. */
export const REMINDER_CHANNELS = {
  EMAIL: 'email',
  SMS: 'sms',
  IN_APP: 'in-app',
}

export const REMINDER_CHANNEL_OPTIONS = [
  { value: REMINDER_CHANNELS.EMAIL, label: 'Email (simulated)' },
  { value: REMINDER_CHANNELS.SMS, label: 'SMS (simulated)' },
  { value: REMINDER_CHANNELS.IN_APP, label: 'In-app (simulated)' },
]

export const REMINDER_CHANNEL_LABELS = {
  [REMINDER_CHANNELS.EMAIL]: 'Email',
  [REMINDER_CHANNELS.SMS]: 'SMS',
  [REMINDER_CHANNELS.IN_APP]: 'In-app',
}

/**
 * ILLUSTRATIVE renewal rules for this university project — not an insurer's
 * or regulator's rules. Every threshold the engine uses lives here.
 *
 * `offsetDays` is relative to the policy expiry date: negative is before it.
 * A stage becomes due on its date and stays actionable until the next stage
 * falls due (or, for the last stage, until the follow-up window closes).
 */
export const RENEWAL_CONFIG = {
  stages: [
    { id: 'd60', label: '60 days before expiry', shortLabel: '60 days', offsetDays: -60, channel: REMINDER_CHANNELS.EMAIL },
    { id: 'd30', label: '30 days before expiry', shortLabel: '30 days', offsetDays: -30, channel: REMINDER_CHANNELS.EMAIL },
    { id: 'd15', label: '15 days before expiry', shortLabel: '15 days', offsetDays: -15, channel: REMINDER_CHANNELS.SMS },
    { id: 'd7', label: '7 days before expiry', shortLabel: '7 days', offsetDays: -7, channel: REMINDER_CHANNELS.SMS },
    { id: 'd1', label: '1 day before expiry', shortLabel: '1 day', offsetDays: -1, channel: REMINDER_CHANNELS.IN_APP },
    { id: 'd0', label: 'On expiry day', shortLabel: 'Expiry day', offsetDays: 0, channel: REMINDER_CHANNELS.EMAIL },
    { id: 'post', label: 'Post-expiry follow-up', shortLabel: 'Follow-up', offsetDays: 7, channel: REMINDER_CHANNELS.EMAIL },
  ],
  /** Renewal status bands, in days before expiry (inclusive upper bounds). */
  statusWindows: { upcomingDays: 60, dueSoonDays: 30, dueDays: 7 },
  /** No reminders are issued after this many days past expiry. */
  followUpWindowDays: 30,
}

/** Derived renewal status of a policy as of a date. */
export const RENEWAL_STATUS = {
  NOT_DUE: 'not-due',
  UPCOMING: 'upcoming',
  DUE_SOON: 'due-soon',
  DUE: 'due',
  EXPIRING_TODAY: 'expiring-today',
  EXPIRED: 'expired',
  UNKNOWN: 'expiry-unknown',
}

export const RENEWAL_STATUS_LABELS = {
  [RENEWAL_STATUS.NOT_DUE]: 'Not due',
  [RENEWAL_STATUS.UPCOMING]: 'Upcoming',
  [RENEWAL_STATUS.DUE_SOON]: 'Due soon',
  [RENEWAL_STATUS.DUE]: 'Due',
  [RENEWAL_STATUS.EXPIRING_TODAY]: 'Expiring today',
  [RENEWAL_STATUS.EXPIRED]: 'Expired',
  [RENEWAL_STATUS.UNKNOWN]: 'Expiry unknown',
}

export const RENEWAL_STATUS_OPTIONS = Object.values(RENEWAL_STATUS).map((value) => ({
  value,
  label: RENEWAL_STATUS_LABELS[value],
}))

/** Persisted outcome of one reminder attempt. */
export const REMINDER_EVENT_STATUS = {
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
}

/** Derived state of a reminder stage within a policy's plan. */
export const REMINDER_STAGE_STATE = {
  SCHEDULED: 'scheduled',
  DUE: 'due',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  MISSED: 'missed',
}

export const REMINDER_STAGE_STATE_LABELS = {
  [REMINDER_STAGE_STATE.SCHEDULED]: 'Scheduled',
  [REMINDER_STAGE_STATE.DUE]: 'Due now',
  [REMINDER_STAGE_STATE.SENT]: 'Sent',
  [REMINDER_STAGE_STATE.FAILED]: 'Failed',
  [REMINDER_STAGE_STATE.SKIPPED]: 'Skipped',
  [REMINDER_STAGE_STATE.MISSED]: 'Missed',
}

/** What triggered a reminder attempt. */
export const REMINDER_TRIGGERS = {
  CHECK: 'reminder-check',
  MANUAL: 'manual',
  RETRY: 'retry',
  SEED: 'seed',
}

export const RENEWAL_READINESS = {
  READY: 'ready',
  ACTION_REQUIRED: 'action-required',
  NOT_YET_OPEN: 'window-not-open',
  NOT_ELIGIBLE: 'not-eligible',
}

export const RENEWAL_READINESS_LABELS = {
  [RENEWAL_READINESS.READY]: 'Ready for renewal',
  [RENEWAL_READINESS.ACTION_REQUIRED]: 'Action required',
  [RENEWAL_READINESS.NOT_YET_OPEN]: 'Renewal window not open',
  [RENEWAL_READINESS.NOT_ELIGIBLE]: 'Not eligible for reminders',
}

/** Agents may run the reminder check to assist; only administrators trigger, retry or move the clock. */
export const ROLES_ALLOWED_TO_RUN_REMINDER_CHECK = [ROLES.AGENT, ROLES.ADMINISTRATOR]
export const ROLES_ALLOWED_TO_MANAGE_REMINDERS = [ROLES.ADMINISTRATOR]

export const RENEWAL_SORT_OPTIONS = [
  { value: 'expiry-asc', label: 'Expiry date (soonest)' },
  { value: 'days-asc', label: 'Days remaining (fewest)' },
  { value: 'status', label: 'Renewal status (most urgent)' },
  { value: 'policyholder-asc', label: 'Policyholder (A–Z)' },
]

export const DEFAULT_RENEWAL_QUERY = {
  search: '',
  status: 'all',
  stage: 'all',
  premium: 'all',
  sort: 'expiry-asc',
}

/* ------------------------------------------------------------------ */
/* Module 5 — Agent Commission                                         */
/* ------------------------------------------------------------------ */

/**
 * Illustrative commission settings. Real rates are set by an insurer and a
 * regulator; these exist only to make the calculation explainable.
 *
 *   earningHoldDays  a commission can be confirmed as earned only this many
 *                    days after the premium payment it came from
 *   minRatePercent / maxRatePercent  bounds for a valid commission rate
 */
export const COMMISSION_CONFIG = {
  earningHoldDays: 30,
  minRatePercent: 0.01,
  maxRatePercent: 50,
  rateDecimals: 2,
}

export const AGENT_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
}

export const COMMISSION_STATUS = {
  PENDING: 'pending',
  EARNED: 'earned',
  PAID: 'paid',
}

export const COMMISSION_STATUS_LABELS = {
  [COMMISSION_STATUS.PENDING]: 'Pending',
  [COMMISSION_STATUS.EARNED]: 'Earned',
  [COMMISSION_STATUS.PAID]: 'Paid',
}

export const COMMISSION_STATUS_OPTIONS = Object.values(COMMISSION_STATUS).map((value) => ({
  value,
  label: COMMISSION_STATUS_LABELS[value],
}))

/** Which rate applies: the policy year the paid instalment belongs to. */
export const COMMISSION_BASIS = {
  FIRST_YEAR: 'first-year',
  RENEWAL: 'renewal',
}

export const COMMISSION_BASIS_LABELS = {
  [COMMISSION_BASIS.FIRST_YEAR]: 'First-year premium',
  [COMMISSION_BASIS.RENEWAL]: 'Renewal premium',
}

export const COMMISSION_EVENT_TYPES = {
  GENERATED: 'generated',
  STATUS_CHANGED: 'status-changed',
}

export const ROLES_ALLOWED_TO_VIEW_COMMISSIONS = [ROLES.AGENT, ROLES.ADMINISTRATOR]
export const ROLES_ALLOWED_TO_MANAGE_COMMISSIONS = [ROLES.ADMINISTRATOR]

/**
 * The agent the demo Agent role acts as. There is no sign-in, so the Agent
 * role stands for one registered agent and sees only that agent's
 * commission. The commission service enforces this, not the UI.
 */
export const DEMO_AGENT_ID = 'AGT-2207'

export const COMMISSION_SORT_OPTIONS = [
  { value: 'payment-desc', label: 'Payment date (newest)' },
  { value: 'payment-asc', label: 'Payment date (oldest)' },
  { value: 'amount-desc', label: 'Commission (high to low)' },
  { value: 'amount-asc', label: 'Commission (low to high)' },
  { value: 'agent-asc', label: 'Agent (A–Z)' },
  { value: 'status', label: 'Status' },
]

export const DEFAULT_COMMISSION_QUERY = {
  search: '',
  status: 'all',
  agentId: 'all',
  sort: 'payment-desc',
}

/* ------------------------------------------------------------------ */
/* Module 6 — MIS Reports                                              */
/* ------------------------------------------------------------------ */

/** MIS Reports are management reports: administrators only. */
export const ROLES_ALLOWED_TO_VIEW_REPORTS = [ROLES.ADMINISTRATOR]

export const REPORT_IDS = {
  POLICIES: 'policies',
  PREMIUMS: 'premiums',
  CLAIMS: 'claims',
  RENEWALS: 'renewals',
  COMMISSIONS: 'commissions',
}

/**
 * Reporting periods. Every range ends on the selected end date INCLUSIVE and
 * is derived from the data, never from a stored report snapshot:
 *
 *   all-time      earliest dated record in the report's data set → today
 *   today         today → today
 *   last-7        today − 6 days → today
 *   last-30       today − 29 days → today
 *   this-month    first of the current month → today (period to date)
 *   last-month    first → last day of the previous month
 *   custom        the dates chosen, both inclusive
 */
export const REPORT_PERIODS = {
  ALL_TIME: 'all-time',
  TODAY: 'today',
  LAST_7: 'last-7',
  LAST_30: 'last-30',
  THIS_MONTH: 'this-month',
  LAST_MONTH: 'last-month',
  CUSTOM: 'custom',
}

export const REPORT_PERIOD_OPTIONS = [
  { value: REPORT_PERIODS.ALL_TIME, label: 'All time' },
  { value: REPORT_PERIODS.TODAY, label: 'Today' },
  { value: REPORT_PERIODS.LAST_7, label: 'Last 7 days' },
  { value: REPORT_PERIODS.LAST_30, label: 'Last 30 days' },
  { value: REPORT_PERIODS.THIS_MONTH, label: 'Current month' },
  { value: REPORT_PERIODS.LAST_MONTH, label: 'Previous month' },
  { value: REPORT_PERIODS.CUSTOM, label: 'Custom range' },
]

/** Sort orders offered by report tables, applied by the report service. */
export const REPORT_SORT_DIRECTIONS = { ASC: 'asc', DESC: 'desc' }

/** Rows rendered per report table before the result is bounded. */
export const REPORT_ROW_LIMIT = 200

export const DEFAULT_REPORT_QUERY = {
  period: REPORT_PERIODS.ALL_TIME,
  from: '',
  to: '',
  product: 'all',
  status: 'all',
  agentId: 'all',
  search: '',
  sort: '',
  direction: REPORT_SORT_DIRECTIONS.DESC,
}
