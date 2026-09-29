/**
 * Policy Catalog & Issuance service (Module 1) — backed by the FastAPI API.
 *
 *   React  ->  policyService  ->  authApi (JWT)  ->  FastAPI  ->  MySQL
 *
 * The function signatures and the shapes they resolve to are unchanged from
 * the mock implementation, so no page or component changed. This file only
 * translates between the API contract (snake_case, stable codes such as
 * `personal_accident`, money as decimal strings) and the UI's existing shape
 * (display labels, numbers, `id` = policy number / product code).
 *
 * The backend owns every rule: pricing, policy numbers, validation and who may
 * see which policy. Nothing here decides access or computes a premium.
 *
 * Modules 2–6 still read the mock policy register (`mockPolicyStore`) until
 * their own migrations; policies issued here are stored in MySQL.
 */

import { ApiError } from './apiClient'
import { authApi } from './authSession'
import { ENDPOINTS } from './endpoints'
import { POLICY_TYPES, PREMIUM_FREQUENCIES } from '../utils/constants'

/** API codes <-> the labels the UI already uses. */
const TYPE_LABELS = {
  health: POLICY_TYPES.HEALTH,
  life: POLICY_TYPES.LIFE,
  motor: POLICY_TYPES.MOTOR,
  personal_accident: POLICY_TYPES.PERSONAL_ACCIDENT,
  home: POLICY_TYPES.HOME,
}
const FREQUENCY_LABELS = {
  monthly: PREMIUM_FREQUENCIES.MONTHLY,
  quarterly: PREMIUM_FREQUENCIES.QUARTERLY,
  half_yearly: PREMIUM_FREQUENCIES.HALF_YEARLY,
  annual: PREMIUM_FREQUENCIES.ANNUAL,
}
const invert = (map) => Object.fromEntries(Object.entries(map).map(([code, label]) => [label, code]))
const TYPE_CODES = invert(TYPE_LABELS)
const FREQUENCY_CODES = invert(FREQUENCY_LABELS)

/** The register has no paging UI yet; this is the API's maximum page size. */
const POLICY_REGISTER_LIMIT = 200

const toNumber = (value) => (value === null || value === undefined ? null : Number(value))

/** Only send filters that actually narrow the query ('all' means no filter). */
const filterValue = (value, codes) => (!value || value === 'all' ? undefined : codes?.[value] ?? value)

const toProduct = (product) => ({
  id: product.code,
  name: product.name,
  type: TYPE_LABELS[product.type] ?? product.type,
  status: product.status,
  tagline: product.tagline,
  description: product.description,
  coverageAmount: toNumber(product.reference_coverage_amount),
  coverageRange: {
    min: toNumber(product.min_coverage_amount),
    max: toNumber(product.max_coverage_amount),
  },
  // The catalog premium is quoted per year at the reference coverage.
  premium: toNumber(product.base_annual_premium),
  premiumFrequency: PREMIUM_FREQUENCIES.ANNUAL,
  availableFrequencies: product.premium_frequencies.map((code) => FREQUENCY_LABELS[code] ?? code),
  durationYears: product.default_term_years,
  availableDurations: product.term_options,
  waitingPeriod: product.waiting_period,
  eligibility: {
    minAge: product.min_entry_age,
    maxAge: product.max_entry_age,
    summary: product.eligibility_summary,
    criteria: product.eligibility_criteria,
  },
  benefits: product.benefits,
  coverageItems: product.coverage_items.map((item) => ({ name: item.name, limit: item.limit })),
  exclusions: product.exclusions,
})

const toPolicy = (policy) => ({
  id: policy.policy_number,
  productId: policy.product.code,
  productName: policy.product.name,
  type: TYPE_LABELS[policy.product.type] ?? policy.product.type,
  status: policy.status,
  coverageAmount: toNumber(policy.coverage_amount),
  // Every screen labels `premium` "per <frequency> instalment".
  premium: toNumber(policy.instalment_premium),
  annualPremium: toNumber(policy.annual_premium),
  premiumFrequency: FREQUENCY_LABELS[policy.premium_frequency] ?? policy.premium_frequency,
  durationYears: policy.term_years,
  issueDate: policy.issue_date,
  startDate: policy.start_date,
  endDate: policy.end_date,
  policyholder: {
    name: policy.policyholder.full_name,
    customerId: policy.policyholder.customer_code,
    dateOfBirth: policy.policyholder.date_of_birth,
    email: policy.policyholder.email,
    phone: policy.policyholder.phone,
    address: {
      line1: policy.policyholder.address.line1,
      line2: policy.policyholder.address.line2 ?? '',
      city: policy.policyholder.address.city,
      state: policy.policyholder.address.state,
      postalCode: policy.policyholder.address.postal_code,
    },
  },
  nominee: {
    name: policy.nominee.name,
    relationship: policy.nominee.relationship,
    dateOfBirth: policy.nominee.date_of_birth,
  },
  agent: policy.agent
    ? {
        id: policy.agent.agent_code,
        name: policy.agent.full_name,
        branch: policy.agent.branch,
        email: policy.agent.email,
      }
    : null,
  // No document store exists yet; the page shows its empty state.
  documents: [],
  lifecycle: policy.lifecycle.map((event) => ({
    stage: event.stage,
    date: event.date,
    note: event.note,
    status: event.status,
  })),
})

/** Friendly names for the fields the backend may reject on issuance. */
const FIELD_LABELS = {
  'body.product_code': 'Product',
  'body.coverage_amount': 'Coverage amount',
  'body.start_date': 'Policy start date',
  'body.term_years': 'Policy duration',
  'body.premium_frequency': 'Premium frequency',
  'body.agent_code': 'Agent',
  'body.policyholder.customer_code': 'Customer ID',
  'body.policyholder.date_of_birth': 'Date of birth',
  'body.policyholder.phone': 'Phone number',
  'body.policyholder.email': 'Email',
  'body.policyholder.postal_code': 'PIN code',
  'body.nominee.date_of_birth': 'Nominee date of birth',
}

/** Fold field-level API errors into the message the form already displays. */
const withFieldDetails = (error) => {
  const fieldErrors = error instanceof ApiError ? error.data?.errors : null
  if (!fieldErrors?.length) return error

  const details = fieldErrors
    .map(({ field, message }) => `${FIELD_LABELS[field] ?? field.split('.').pop()}: ${message}`)
    .join('; ')
  return new ApiError(`${error.message} ${details}`, { status: error.status, data: error.data })
}

/**
 * List catalog products, optionally searched, filtered and sorted (in MySQL).
 *
 * @param {{search?: string, type?: string, status?: string, sort?: string}} query
 * @returns {Promise<{items: Array, total: number, summary: object}>}
 */
export const getPolicyProducts = async (query = {}) => {
  const response = await authApi.get(ENDPOINTS.policyProducts, {
    params: {
      search: query.search?.trim() || undefined,
      type: filterValue(query.type, TYPE_CODES),
      status: filterValue(query.status),
      sort: query.sort,
    },
  })

  return {
    items: response.items.map(toProduct),
    total: response.total,
    summary: response.summary,
  }
}

/**
 * Fetch a single catalog product.
 *
 * @param {string} id Product code, e.g. `PRD-HLT-001`.
 * @returns {Promise<object>}
 */
export const getPolicyProductById = async (id) =>
  toProduct(await authApi.get(ENDPOINTS.policyProductById(id)))

/**
 * List the issued policies the signed-in account may see (the backend
 * applies the role's scope).
 *
 * @returns {Promise<{items: Array, total: number}>}
 */
export const getIssuedPolicies = async () => {
  const response = await authApi.get(ENDPOINTS.policies, {
    params: { limit: POLICY_REGISTER_LIMIT },
  })
  return { items: response.items.map(toPolicy), total: response.total }
}

/**
 * Fetch a single issued policy.
 *
 * @param {string} id Policy number, e.g. `POL-2024-000148`.
 * @returns {Promise<object>}
 */
export const getIssuedPolicyById = async (id) =>
  toPolicy(await authApi.get(ENDPOINTS.policyById(id)))

const PRODUCT_CODE = /^PRD-/i

/**
 * Resolve an ID that may belong to either a catalog product or an issued
 * policy. The details page uses this so one route serves both.
 *
 * @param {string} id
 * @returns {Promise<{kind: 'policy'|'product', product: object, policy: object|null}>}
 */
export const getPolicyRecordById = async (id) => {
  try {
    if (PRODUCT_CODE.test(id)) {
      return { kind: 'product', policy: null, product: await getPolicyProductById(id) }
    }

    const policy = await getIssuedPolicyById(id)
    const product = await getPolicyProductById(policy.productId).catch(() => null)
    return { kind: 'policy', policy, product }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(
        `No policy or product found for "${id}". It may have been removed, or the link may be incorrect.`,
        { status: 404, data: error.data },
      )
    }
    throw error
  }
}

/** Map the wizard's form values onto the API's issuance request. */
const toIssueRequest = (productId, values) => ({
  product_code: productId,
  policyholder: {
    customer_code: values.customerId.trim() || null,
    full_name: values.fullName,
    date_of_birth: values.dateOfBirth,
    email: values.email,
    phone: values.phone,
    address_line1: values.addressLine1,
    address_line2: values.addressLine2.trim() || null,
    city: values.city,
    state: values.state,
    postal_code: values.postalCode,
  },
  coverage_amount: String(values.coverageAmount),
  start_date: values.startDate,
  term_years: Number(values.durationYears),
  premium_frequency: FREQUENCY_CODES[values.premiumFrequency] ?? values.premiumFrequency,
  nominee: {
    name: values.nomineeName,
    relationship: values.nomineeRelationship,
    date_of_birth: values.nomineeDateOfBirth,
  },
})

/**
 * Issue a policy. The backend validates, rates the premium, numbers the
 * policy and stores it in one transaction.
 *
 * @param {{productId: string, values: object}} payload
 * @returns {Promise<object>} The newly created policy record.
 */
export const issuePolicy = async ({ productId, values }) => {
  if (!productId) {
    throw new ApiError('Select a valid policy product before issuing.', { status: 400 })
  }

  try {
    return toPolicy(await authApi.post(ENDPOINTS.policies, toIssueRequest(productId, values)))
  } catch (error) {
    throw withFieldDetails(error)
  }
}

export default {
  getPolicyProducts,
  getPolicyProductById,
  getIssuedPolicies,
  getIssuedPolicyById,
  getPolicyRecordById,
  issuePolicy,
}
