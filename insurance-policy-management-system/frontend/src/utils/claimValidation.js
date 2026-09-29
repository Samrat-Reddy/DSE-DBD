/**
 * Validation for the claim filing form — pure.
 *
 * Shared by the filing form (inline errors) and `claimService.createClaim`
 * (which re-validates), so both enforce identical rules.
 *
 * Document fields are metadata only: a document is "provided" by recording
 * its name. Nothing is uploaded or stored.
 */

import {
  CLAIM_DESCRIPTION_MAX_LENGTH,
  CLAIM_DESCRIPTION_MIN_LENGTH,
} from './constants'
import { compareIsoDates, isValidIsoDate } from './dateUtils'
import { formatDate } from './formatters'

/** Stable form-field key for a document requirement. */
export const documentFieldKey = (type) => `document-${type}`

export const buildEmptyClaimForm = (policyId = '') => ({
  policyId,
  claimType: '',
  incidentDate: '',
  claimedAmount: '',
  description: '',
  documents: {},
})

/** Order of fields for focusing the first error, top to bottom. */
export const CLAIM_FORM_FIELD_ORDER = ['policyId', 'claimType', 'incidentDate', 'claimedAmount', 'description']

/**
 * @param {object} values Form values (see `buildEmptyClaimForm`).
 * @param {{policy: object|null, claimType: object|null, claimTypes: Array, asOf: string}} context
 * @returns {Record<string, string>} Field key to message; empty when valid.
 */
export const validateClaimForm = (values, { policy, claimType, claimTypes, asOf }) => {
  const errors = {}

  // Policy
  if (!values.policyId) {
    errors.policyId = 'Select the policy this claim is for.'
  } else if (!policy) {
    errors.policyId = `Policy ${values.policyId} could not be found.`
  }

  // Claim type
  if (!values.claimType) {
    errors.claimType = 'Select a claim type.'
  } else if (!claimTypes.some((type) => type.value === values.claimType)) {
    errors.claimType = 'Select a valid claim type.'
  } else if (policy && claimType && claimType.policyType !== policy.type) {
    errors.claimType = `${claimType.label} is not covered by a ${policy.type} policy.`
  }

  // Incident date
  if (!values.incidentDate) {
    errors.incidentDate = 'Enter the date of the incident.'
  } else if (!isValidIsoDate(values.incidentDate)) {
    errors.incidentDate = 'Enter a valid incident date.'
  } else if (compareIsoDates(values.incidentDate, asOf) > 0) {
    errors.incidentDate = 'The incident date cannot be in the future.'
  } else if (
    policy &&
    (compareIsoDates(values.incidentDate, policy.startDate) < 0 ||
      compareIsoDates(values.incidentDate, policy.endDate) > 0)
  ) {
    errors.incidentDate = `The incident must fall within the policy cover period (${formatDate(
      policy.startDate,
    )} to ${formatDate(policy.endDate)}).`
  }

  // Claimed amount
  const amountText = String(values.claimedAmount ?? '').trim()
  const amount = Number(amountText)
  if (!amountText) {
    errors.claimedAmount = 'Enter the amount being claimed.'
  } else if (!Number.isFinite(amount)) {
    errors.claimedAmount = 'The claimed amount must be a number.'
  } else if (amount <= 0) {
    errors.claimedAmount = 'The claimed amount must be greater than zero.'
  } else if (!/^\d+(\.\d{1,2})?$/.test(amountText)) {
    // Checked on the text, not the number, to avoid floating-point artefacts.
    errors.claimedAmount = 'The claimed amount can have at most two decimal places.'
  }

  // Description
  const description = String(values.description ?? '').trim()
  if (!description) {
    errors.description = 'Describe what happened.'
  } else if (description.length < CLAIM_DESCRIPTION_MIN_LENGTH) {
    errors.description = `Add more detail: at least ${CLAIM_DESCRIPTION_MIN_LENGTH} characters (currently ${description.length}).`
  } else if (description.length > CLAIM_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Keep the description to ${CLAIM_DESCRIPTION_MAX_LENGTH} characters or fewer.`
  }

  // Documents — only once a claim type defines the requirements
  if (claimType) {
    for (const requirement of claimType.requiredDocuments) {
      const entry = values.documents?.[requirement.type]
      const name = String(entry?.fileName ?? '').trim()

      if (requirement.required && !entry?.provided) {
        errors[documentFieldKey(requirement.type)] = `${requirement.label} is required for a ${claimType.label.toLowerCase()} claim.`
      } else if (entry?.provided && name.length < 3) {
        errors[documentFieldKey(requirement.type)] = `Enter a document name for ${requirement.label.toLowerCase()} (at least 3 characters).`
      }
    }
  }

  return errors
}

export const isClaimFormValid = (values, context) =>
  Object.keys(validateClaimForm(values, context)).length === 0

/** Document metadata records for the documents the filer provided. */
export const buildDocumentRecords = (claimId, claimType, documentValues, at) =>
  (claimType?.requiredDocuments ?? [])
    .filter((requirement) => documentValues?.[requirement.type]?.provided)
    .map((requirement, index) => ({
      documentId: `${claimId}-D${index + 1}`,
      type: requirement.type,
      label: requirement.label,
      fileName: String(documentValues[requirement.type].fileName).trim(),
      required: requirement.required,
      status: 'submitted',
      submittedAt: at,
    }))
