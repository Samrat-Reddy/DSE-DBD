/**
 * Illustrative claim types.
 *
 * ILLUSTRATIVE RULES ONLY — these are frontend demonstration rules, not the
 * adjudication rules of any real insurer. Each type is tied to one policy type
 * and to a coverage item that exists on the products in `policyProducts.js`,
 * so a claim can only be filed against cover the policy actually has.
 *
 * `limitRule` produces the illustrative limit used at assessment:
 *   limit = policy coverage × percentOfCoverage / 100, capped at maxAmount.
 *
 * `requiredDocuments` are metadata requirements only. No file is uploaded or
 * stored anywhere; a document is recorded by name.
 */

import { POLICY_TYPES } from '../utils/constants'

const IDENTITY_DOCUMENT = { type: 'identity', label: 'Identity document', suggestedName: 'identity-document.pdf', required: true }
const OTHER_DOCUMENT = { type: 'other', label: 'Other supporting document', suggestedName: 'supporting-document.pdf', required: false }

export const claimTypes = [
  {
    value: 'hospitalisation',
    label: 'Hospitalisation',
    policyType: POLICY_TYPES.HEALTH,
    coverageItem: 'In-patient hospitalisation',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: 'Up to the sum insured',
    description: 'In-patient treatment requiring admission of 24 hours or more.',
    requiredDocuments: [
      { type: 'discharge-summary', label: 'Hospital discharge summary', suggestedName: 'discharge-summary.pdf', required: true },
      { type: 'hospital-bill', label: 'Hospital bill', suggestedName: 'hospital-bill.pdf', required: true },
      IDENTITY_DOCUMENT,
      OTHER_DOCUMENT,
    ],
  },
  {
    value: 'day-care',
    label: 'Day-care procedure',
    policyType: POLICY_TYPES.HEALTH,
    coverageItem: 'Day-care procedures',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: 'Up to the sum insured',
    description: 'A listed procedure completed without a 24-hour admission.',
    requiredDocuments: [
      { type: 'treatment-summary', label: 'Treatment summary', suggestedName: 'treatment-summary.pdf', required: true },
      { type: 'hospital-bill', label: 'Hospital bill', suggestedName: 'hospital-bill.pdf', required: true },
      IDENTITY_DOCUMENT,
    ],
  },
  {
    value: 'temporary-disablement',
    label: 'Accident — temporary disablement',
    policyType: POLICY_TYPES.PERSONAL_ACCIDENT,
    coverageItem: 'Temporary total disablement',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: '1% of sum insured per week, up to 100 weeks',
    description: 'Weekly benefit while an accidental injury prevents all work.',
    requiredDocuments: [
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'incident-report.pdf', required: true },
      { type: 'medical-certificate', label: 'Medical certificate of disablement', suggestedName: 'medical-certificate.pdf', required: true },
      IDENTITY_DOCUMENT,
      OTHER_DOCUMENT,
    ],
  },
  {
    value: 'permanent-disability',
    label: 'Accident — permanent partial disability',
    policyType: POLICY_TYPES.PERSONAL_ACCIDENT,
    coverageItem: 'Permanent partial disability',
    limitRule: { percentOfCoverage: 50 },
    limitBasis: 'Illustrative ceiling of 50% of sum insured (benefit table)',
    description: 'Lump-sum benefit for a lasting partial disability after an accident.',
    requiredDocuments: [
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'incident-report.pdf', required: true },
      { type: 'disability-certificate', label: 'Disability certificate', suggestedName: 'disability-certificate.pdf', required: true },
      IDENTITY_DOCUMENT,
    ],
  },
  {
    value: 'vehicle-damage',
    label: 'Vehicle damage',
    policyType: POLICY_TYPES.MOTOR,
    coverageItem: 'Own damage',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: 'Up to the insured declared value',
    description: 'Accidental damage to the insured vehicle.',
    requiredDocuments: [
      { type: 'repair-estimate', label: 'Repair estimate', suggestedName: 'repair-estimate.pdf', required: true },
      { type: 'registration-certificate', label: 'Registration certificate', suggestedName: 'registration-certificate.pdf', required: true },
      { type: 'driving-licence', label: 'Driving licence', suggestedName: 'driving-licence.pdf', required: true },
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'incident-report.pdf', required: false },
    ],
  },
  {
    value: 'vehicle-theft',
    label: 'Vehicle theft',
    policyType: POLICY_TYPES.MOTOR,
    coverageItem: 'Theft of vehicle',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: 'Up to the insured declared value',
    description: 'Theft of the insured vehicle.',
    requiredDocuments: [
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'fir.pdf', required: true },
      { type: 'registration-certificate', label: 'Registration certificate', suggestedName: 'registration-certificate.pdf', required: true },
      { type: 'non-traceable-report', label: 'Police non-traceable report', suggestedName: 'non-traceable-report.pdf', required: true },
    ],
  },
  {
    value: 'property-damage',
    label: 'Property damage',
    policyType: POLICY_TYPES.HOME,
    coverageItem: 'Building structure',
    limitRule: { percentOfCoverage: 100 },
    limitBasis: 'Up to the sum insured',
    description: 'Damage to the building from fire, flood or another insured peril.',
    requiredDocuments: [
      { type: 'incident-report', label: 'Incident report', suggestedName: 'incident-report.pdf', required: true },
      { type: 'repair-estimate', label: 'Repair estimate', suggestedName: 'repair-estimate.pdf', required: true },
      { type: 'photographs', label: 'Photographs of damage', suggestedName: 'damage-photographs.zip', required: false },
    ],
  },
  {
    value: 'contents-burglary',
    label: 'Burglary — household contents',
    policyType: POLICY_TYPES.HOME,
    coverageItem: 'Household contents',
    limitRule: { percentOfCoverage: 20 },
    limitBasis: '20% of sum insured for household contents',
    description: 'Loss of household contents through burglary or theft.',
    requiredDocuments: [
      { type: 'incident-report', label: 'FIR / incident report', suggestedName: 'fir.pdf', required: true },
      { type: 'stolen-items-list', label: 'List of stolen items', suggestedName: 'stolen-items.pdf', required: true },
      { type: 'purchase-invoices', label: 'Purchase invoices', suggestedName: 'invoices.pdf', required: false },
    ],
  },
  {
    value: 'terminal-illness',
    label: 'Terminal illness benefit',
    policyType: POLICY_TYPES.LIFE,
    coverageItem: 'Terminal illness benefit',
    limitRule: { percentOfCoverage: 100, maxAmount: 2000000 },
    limitBasis: 'Sum assured, capped at Rs. 20,00,000',
    description: 'Accelerated benefit on diagnosis of a terminal illness. Death claims are out of scope for this demonstration.',
    requiredDocuments: [
      { type: 'specialist-report', label: 'Specialist medical report', suggestedName: 'specialist-report.pdf', required: true },
      IDENTITY_DOCUMENT,
      OTHER_DOCUMENT,
    ],
  },
]

export default claimTypes
