/**
 * Generic, framework-agnostic validation primitives.
 *
 * Each rule returns an error message string when the value is invalid, or
 * `null` when it passes. Form-specific rule sets compose these — see
 * `issuanceValidation.js`.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
// Indian mobile numbers: 10 digits starting 6-9, optionally +91 prefixed.
const PHONE_PATTERN = /^(?:\+?91[\s-]?)?[6-9]\d{9}$/
const POSTAL_CODE_PATTERN = /^\d{6}$/

export const isBlank = (value) =>
  value === null || value === undefined || String(value).trim() === ''

export const required = (label) => (value) =>
  isBlank(value) ? `${label} is required.` : null

export const minLength = (label, length) => (value) =>
  !isBlank(value) && String(value).trim().length < length
    ? `${label} must be at least ${length} characters.`
    : null

export const maxLength = (label, length) => (value) =>
  !isBlank(value) && String(value).trim().length > length
    ? `${label} must be ${length} characters or fewer.`
    : null

export const email = (label = 'Email') => (value) =>
  !isBlank(value) && !EMAIL_PATTERN.test(String(value).trim())
    ? `Enter a valid ${label.toLowerCase()} address, for example name@example.com.`
    : null

export const phone = (label = 'Phone number') => (value) =>
  !isBlank(value) && !PHONE_PATTERN.test(String(value).replace(/\s/g, ''))
    ? `${label} must be a valid 10-digit mobile number.`
    : null

export const postalCode = (label = 'PIN code') => (value) =>
  !isBlank(value) && !POSTAL_CODE_PATTERN.test(String(value).trim())
    ? `${label} must be exactly 6 digits.`
    : null

export const positiveNumber = (label) => (value) => {
  if (isBlank(value)) return null
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return `${label} must be a number.`
  return numeric > 0 ? null : `${label} must be greater than zero.`
}

export const numberInRange = (label, min, max, format = (v) => v) => (value) => {
  if (isBlank(value)) return null
  const numeric = Number(value)
  if (Number.isNaN(numeric)) return `${label} must be a number.`
  if (numeric < min) return `${label} must be at least ${format(min)}.`
  if (numeric > max) return `${label} cannot exceed ${format(max)}.`
  return null
}

export const validDate = (label) => (value) => {
  if (isBlank(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? `${label} must be a valid date.` : null
}

/** Rejects dates in the past, compared at day precision. */
export const notInPast = (label) => (value) => {
  if (isBlank(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  date.setHours(0, 0, 0, 0)

  return date < today ? `${label} cannot be in the past.` : null
}

export const notInFuture = (label) => (value) => {
  if (isBlank(value)) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const today = new Date()
  today.setHours(23, 59, 59, 999)

  return date > today ? `${label} cannot be in the future.` : null
}

/** Whole years between a date of birth and today. */
export const calculateAge = (dateOfBirth) => {
  const dob = new Date(dateOfBirth)
  if (Number.isNaN(dob.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - dob.getFullYear()
  const monthDelta = today.getMonth() - dob.getMonth()

  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < dob.getDate())) {
    age -= 1
  }

  return age
}

export const ageBetween = (label, min, max) => (value) => {
  if (isBlank(value)) return null
  const age = calculateAge(value)
  if (age === null) return null
  if (age < min) return `${label} indicates an age of ${age}; the minimum entry age is ${min}.`
  if (age > max) return `${label} indicates an age of ${age}; the maximum entry age is ${max}.`
  return null
}

export const oneOf = (label, allowed) => (value) =>
  !isBlank(value) && !allowed.includes(value)
    ? `Select a valid ${label.toLowerCase()}.`
    : null

/**
 * Run a `{ field: [rule, ...] }` schema over a values object.
 *
 * @returns {Record<string, string>} Field name to first failing message.
 */
export const runValidationSchema = (schema, values) =>
  Object.entries(schema).reduce((errors, [field, rules]) => {
    for (const rule of rules) {
      const message = rule(values[field], values)
      if (message) return { ...errors, [field]: message }
    }
    return errors
  }, {})
