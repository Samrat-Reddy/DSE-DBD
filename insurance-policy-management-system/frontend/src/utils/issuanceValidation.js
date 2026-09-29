/**
 * Validation rules for the policy issuance workflow.
 *
 * Each step exposes a validator so the form component only decides *when* to
 * validate, never *what* is valid. Rules that depend on the selected product
 * (coverage band, entry age, permitted durations) receive it as an argument.
 */

import {
  ageBetween,
  email,
  maxLength,
  minLength,
  notInFuture,
  notInPast,
  numberInRange,
  oneOf,
  phone,
  postalCode,
  required,
  runValidationSchema,
  validDate,
} from './validators'
import { formatCurrency } from './formatters'

/** Blank form state — also the shape the service expects on submit. */
export const EMPTY_ISSUANCE_FORM = {
  // Step 2 — policyholder
  fullName: '',
  customerId: '',
  dateOfBirth: '',
  email: '',
  phone: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  // Step 3 — policy details
  coverageAmount: '',
  startDate: '',
  durationYears: '',
  premiumFrequency: '',
  nomineeName: '',
  nomineeRelationship: '',
  nomineeDateOfBirth: '',
}

export const NOMINEE_RELATIONSHIPS = [
  'Spouse',
  'Son',
  'Daughter',
  'Father',
  'Mother',
  'Brother',
  'Sister',
  'Other',
]

const CUSTOMER_ID_PATTERN = /^CUS-\d{6}$/

/** Optional field: blank is fine, but a supplied value must match the format. */
const customerIdFormat = (value) =>
  value && !CUSTOMER_ID_PATTERN.test(String(value).trim())
    ? 'Customer ID must look like CUS-100241, or leave it blank to generate one.'
    : null

/** Step 2 — policyholder details. */
export const validatePolicyholderStep = (values, product) => {
  const minAge = product?.eligibility?.minAge ?? 18
  const maxAge = product?.eligibility?.maxAge ?? 100

  return runValidationSchema(
    {
      fullName: [
        required('Full name'),
        minLength('Full name', 3),
        maxLength('Full name', 80),
      ],
      customerId: [customerIdFormat],
      dateOfBirth: [
        required('Date of birth'),
        validDate('Date of birth'),
        notInFuture('Date of birth'),
        ageBetween('Date of birth', minAge, maxAge),
      ],
      email: [required('Email address'), email('Email')],
      phone: [required('Phone number'), phone('Phone number')],
      addressLine1: [required('Address line 1'), maxLength('Address line 1', 120)],
      city: [required('City')],
      state: [required('State')],
      postalCode: [required('PIN code'), postalCode()],
    },
    values,
  )
}

/** Step 3 — coverage, dates, frequency and nominee. */
export const validatePolicyDetailsStep = (values, product) => {
  const min = product?.coverageRange?.min ?? 1
  const max = product?.coverageRange?.max ?? Number.MAX_SAFE_INTEGER
  const durations = (product?.availableDurations ?? []).map(String)
  const frequencies = product?.availableFrequencies ?? []

  return runValidationSchema(
    {
      coverageAmount: [
        required('Coverage amount'),
        numberInRange('Coverage amount', min, max, (value) =>
          formatCurrency(value),
        ),
      ],
      startDate: [
        required('Policy start date'),
        validDate('Policy start date'),
        notInPast('Policy start date'),
      ],
      durationYears: [
        required('Policy duration'),
        oneOf('policy duration', durations),
      ],
      premiumFrequency: [
        required('Premium frequency'),
        oneOf('premium frequency', frequencies),
      ],
      nomineeName: [
        required('Nominee name'),
        minLength('Nominee name', 3),
        maxLength('Nominee name', 80),
      ],
      nomineeRelationship: [
        required('Nominee relationship'),
        oneOf('nominee relationship', NOMINEE_RELATIONSHIPS),
      ],
      nomineeDateOfBirth: [
        required('Nominee date of birth'),
        validDate('Nominee date of birth'),
        notInFuture('Nominee date of birth'),
      ],
    },
    values,
  )
}

/**
 * Validator per wizard step index. Steps 0 (product), 3 (review) and 4
 * (success) have no editable fields.
 */
export const STEP_VALIDATORS = {
  1: validatePolicyholderStep,
  2: validatePolicyDetailsStep,
}

/** Validate a single step; returns `{}` when the step has no inputs. */
export const validateStep = (stepIndex, values, product) => {
  const validator = STEP_VALIDATORS[stepIndex]
  return validator ? validator(values, product) : {}
}

/** True when every editable step passes — gates the final Issue action. */
export const isIssuanceFormValid = (values, product) =>
  Object.keys(validatePolicyholderStep(values, product)).length === 0 &&
  Object.keys(validatePolicyDetailsStep(values, product)).length === 0
