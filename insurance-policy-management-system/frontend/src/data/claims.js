/**
 * Mock claims.
 *
 * ILLUSTRATIVE DATA ONLY — people, incidents, amounts, decisions and
 * settlement references are invented for a university demonstration. No real
 * claim, adjudication or payment is represented.
 *
 * Every claim references an issued policy in `issuedPolicies.js` (Module 1),
 * and every incident date falls inside that policy's cover period. Only two
 * seed policies have cover running today (POL-2024-000226 and
 * POL-2024-000519), so open claims are concentrated on them; the Health and
 * Home policies carry closed claims from when their cover was in force.
 *
 * Activity histories are chronological and follow the transition table in
 * `utils/claimWorkflow.js` — the test suite checks that every recorded step is
 * a legal move made by a permitted role. Timestamps are ISO-8601 UTC.
 */

import { CLAIM_STATUS, ROLES } from '../utils/constants'

const S = CLAIM_STATUS

const officer = (name) => ({ name, role: ROLES.ADMINISTRATOR })
const policyholder = (name) => ({ name, role: ROLES.POLICYHOLDER })
const agent = (name) => ({ name, role: ROLES.AGENT })

const KULKARNI = officer('S. Kulkarni')
const BANERJEE = officer('R. Banerjee')

/** Build one activity event. */
const event = (claimId, index, at, action, label, fromStatus, toStatus, actor, note = null) => ({
  eventId: `${claimId}-E${index}`,
  at,
  action,
  label,
  fromStatus,
  toStatus,
  actor,
  note,
})

/** Document metadata. No file exists anywhere. */
const doc = (claimId, index, type, label, fileName, required, status, submittedAt) => ({
  documentId: `${claimId}-D${index}`,
  type,
  label,
  fileName,
  required,
  status,
  submittedAt,
})

export const claims = [
  // ---------------------------------------------------------------- REJECTED
  {
    claimId: 'CLM-2024-000087',
    policyId: 'POL-2023-000874',
    policyholderId: 'CUS-100097',
    claimType: 'contents-burglary',
    incidentDate: '2024-03-18',
    filingDate: '2024-03-20',
    description:
      'Burglary at the insured residence while the family was away. Entry was forced through the rear balcony door; a laptop, a television, cash and jewellery were taken. Police were informed the same evening.',
    claimedAmount: 185000,
    approvedAmount: null,
    status: S.REJECTED,
    assignedTo: BANERJEE,
    filedBy: policyholder('Rohit Sharma'),
    documents: [
      doc('CLM-2024-000087', 1, 'incident-report', 'FIR / incident report', 'fir-dwarka-sector-15.pdf', true, 'verified', '2024-03-20T05:10:00.000Z'),
      doc('CLM-2024-000087', 2, 'stolen-items-list', 'List of stolen items', 'stolen-items-list.pdf', true, 'verified', '2024-03-20T05:12:00.000Z'),
      doc('CLM-2024-000087', 3, 'purchase-invoices', 'Purchase invoices', 'electronics-invoices.pdf', false, 'verified', '2024-03-20T05:15:00.000Z'),
    ],
    verification: {
      verifiedAt: '2024-03-28T09:30:00.000Z',
      verifiedBy: BANERJEE,
      checksPassed: 6,
      checksTotal: 6,
      warnings: 0,
      note: 'FIR and item list are consistent with the incident description.',
    },
    assessment: {
      assessedAmount: 185000,
      illustrativeLimit: 560000,
      limitBasis: '20% of sum insured for household contents',
      note: 'Items verified against the FIR. Cash of Rs. 60,000 and jewellery of Rs. 1,10,000 make up most of the claimed value.',
      assessedAt: '2024-04-02T07:45:00.000Z',
      assessedBy: BANERJEE,
    },
    decision: {
      outcome: S.REJECTED,
      reason:
        'Most of the claimed value is cash and jewellery that were not declared at proposal stage. Loss of undeclared cash and valuables is excluded under the illustrative policy terms.',
      decidedAt: '2024-04-05T10:20:00.000Z',
      decidedBy: BANERJEE,
    },
    rejectionReason:
      'Most of the claimed value is cash and jewellery that were not declared at proposal stage. Loss of undeclared cash and valuables is excluded under the illustrative policy terms.',
    settlement: null,
    createdAt: '2024-03-20T05:20:00.000Z',
    updatedAt: '2024-04-05T10:20:00.000Z',
    activity: [
      event('CLM-2024-000087', 1, '2024-03-20T05:20:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, policyholder('Rohit Sharma')),
      event('CLM-2024-000087', 2, '2024-03-22T04:05:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, BANERJEE),
      event('CLM-2024-000087', 3, '2024-03-28T09:30:00.000Z', 'verify', 'Claim verified', S.UNDER_REVIEW, S.VERIFIED, BANERJEE, 'FIR and item list are consistent with the incident description.'),
      event('CLM-2024-000087', 4, '2024-04-02T07:45:00.000Z', 'assess', 'Claim assessed', S.VERIFIED, S.ASSESSED, BANERJEE, 'Assessed at Rs. 1,85,000.'),
      event('CLM-2024-000087', 5, '2024-04-05T10:20:00.000Z', 'reject', 'Claim rejected', S.ASSESSED, S.REJECTED, BANERJEE, 'Undeclared cash and valuables are excluded.'),
    ],
  },

  // ----------------------------------------------------------------- SETTLED
  {
    claimId: 'CLM-2024-000152',
    policyId: 'POL-2024-000148',
    policyholderId: 'CUS-100241',
    claimType: 'hospitalisation',
    incidentDate: '2024-11-02',
    filingDate: '2024-11-08',
    description:
      'Admitted with acute appendicitis and underwent a laparoscopic appendectomy. Discharged after three days. Treatment was at a network hospital but the cashless request was not raised in time, so this is a reimbursement claim.',
    claimedAmount: 68400,
    approvedAmount: 64900,
    status: S.SETTLED,
    assignedTo: KULKARNI,
    filedBy: agent('Meera Iyer'),
    documents: [
      doc('CLM-2024-000152', 1, 'discharge-summary', 'Hospital discharge summary', 'discharge-summary.pdf', true, 'verified', '2024-11-08T06:02:00.000Z'),
      doc('CLM-2024-000152', 2, 'hospital-bill', 'Hospital bill', 'final-hospital-bill.pdf', true, 'verified', '2024-11-08T06:04:00.000Z'),
      doc('CLM-2024-000152', 3, 'identity', 'Identity document', 'aadhaar-ananya.pdf', true, 'verified', '2024-11-08T06:05:00.000Z'),
    ],
    verification: {
      verifiedAt: '2024-11-14T08:15:00.000Z',
      verifiedBy: KULKARNI,
      checksPassed: 6,
      checksTotal: 6,
      warnings: 0,
      note: 'Admission and billing documents are complete.',
    },
    assessment: {
      assessedAmount: 64900,
      illustrativeLimit: 1000000,
      limitBasis: 'Up to the sum insured',
      note: 'Rs. 3,500 of non-medical consumables excluded (illustrative).',
      assessedAt: '2024-11-18T11:40:00.000Z',
      assessedBy: KULKARNI,
    },
    decision: {
      outcome: S.APPROVED,
      reason: 'Assessed amount is within the illustrative coverage limit.',
      decidedAt: '2024-11-20T06:30:00.000Z',
      decidedBy: KULKARNI,
    },
    rejectionReason: null,
    settlement: {
      reference: 'SET-2024-000118',
      settledAt: '2024-12-02T09:00:00.000Z',
      settledDate: '2024-12-02',
      amount: 64900,
      settledBy: KULKARNI,
      note: 'Settlement recorded. No payment is made by this demonstration system.',
    },
    createdAt: '2024-11-08T06:10:00.000Z',
    updatedAt: '2024-12-02T09:00:00.000Z',
    activity: [
      event('CLM-2024-000152', 1, '2024-11-08T06:10:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, agent('Meera Iyer'), 'Filed by the agent on behalf of the policyholder.'),
      event('CLM-2024-000152', 2, '2024-11-11T04:30:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, KULKARNI),
      event('CLM-2024-000152', 3, '2024-11-14T08:15:00.000Z', 'verify', 'Claim verified', S.UNDER_REVIEW, S.VERIFIED, KULKARNI, 'Admission and billing documents are complete.'),
      event('CLM-2024-000152', 4, '2024-11-18T11:40:00.000Z', 'assess', 'Claim assessed', S.VERIFIED, S.ASSESSED, KULKARNI, 'Assessed at Rs. 64,900.'),
      event('CLM-2024-000152', 5, '2024-11-20T06:30:00.000Z', 'approve', 'Claim approved', S.ASSESSED, S.APPROVED, KULKARNI),
      event('CLM-2024-000152', 6, '2024-12-02T09:00:00.000Z', 'settle', 'Claim settled', S.APPROVED, S.SETTLED, KULKARNI, 'Settlement reference SET-2024-000118.'),
    ],
  },

  // ---------------------------------------------------------------- APPROVED
  {
    claimId: 'CLM-2026-000044',
    policyId: 'POL-2024-000519',
    policyholderId: 'CUS-100630',
    claimType: 'temporary-disablement',
    incidentDate: '2026-04-12',
    filingDate: '2026-06-01',
    description:
      'Two-wheeler collision on the way to work caused a fractured right wrist. Advised complete rest from work for six weeks; claim filed after the fitness certificate was issued.',
    claimedAmount: 150000,
    approvedAmount: 150000,
    status: S.APPROVED,
    assignedTo: BANERJEE,
    filedBy: policyholder('Farhan Qureshi'),
    documents: [
      doc('CLM-2026-000044', 1, 'incident-report', 'FIR / incident report', 'accident-report-banjara-hills.pdf', true, 'verified', '2026-06-01T07:00:00.000Z'),
      doc('CLM-2026-000044', 2, 'medical-certificate', 'Medical certificate of disablement', 'orthopaedic-certificate.pdf', true, 'verified', '2026-06-01T07:02:00.000Z'),
      doc('CLM-2026-000044', 3, 'identity', 'Identity document', 'pan-farhan.pdf', true, 'verified', '2026-06-01T07:03:00.000Z'),
    ],
    verification: {
      verifiedAt: '2026-06-12T10:05:00.000Z',
      verifiedBy: BANERJEE,
      checksPassed: 5,
      checksTotal: 6,
      warnings: 1,
      note: 'Medical certificate confirms six weeks of total disablement.',
    },
    assessment: {
      assessedAmount: 150000,
      illustrativeLimit: 2500000,
      limitBasis: '1% of sum insured per week, up to 100 weeks',
      note: 'Six weeks at Rs. 25,000 per week. Held pending employer confirmation of the leave period.',
      assessedAt: '2026-09-04T06:50:00.000Z',
      assessedBy: BANERJEE,
    },
    decision: {
      outcome: S.APPROVED,
      reason: 'Assessed amount is within the illustrative coverage limit.',
      decidedAt: '2026-09-11T05:15:00.000Z',
      decidedBy: BANERJEE,
    },
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-06-01T07:10:00.000Z',
    updatedAt: '2026-09-11T05:15:00.000Z',
    activity: [
      event('CLM-2026-000044', 1, '2026-06-01T07:10:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, policyholder('Farhan Qureshi')),
      event('CLM-2026-000044', 2, '2026-06-03T05:00:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, BANERJEE),
      event('CLM-2026-000044', 3, '2026-06-12T10:05:00.000Z', 'verify', 'Claim verified', S.UNDER_REVIEW, S.VERIFIED, BANERJEE, 'Medical certificate confirms six weeks of total disablement.'),
      event('CLM-2026-000044', 4, '2026-09-04T06:50:00.000Z', 'assess', 'Claim assessed', S.VERIFIED, S.ASSESSED, BANERJEE, 'Assessed at Rs. 1,50,000 after employer confirmation.'),
      event('CLM-2026-000044', 5, '2026-09-11T05:15:00.000Z', 'approve', 'Claim approved', S.ASSESSED, S.APPROVED, BANERJEE),
    ],
  },

  // ---------------------------------------------------------------- VERIFIED
  {
    claimId: 'CLM-2026-000052',
    policyId: 'POL-2024-000226',
    policyholderId: 'CUS-100388',
    claimType: 'terminal-illness',
    incidentDate: '2026-07-10',
    filingDate: '2026-07-28',
    description:
      'Diagnosis confirmed by the treating oncologist and reviewed by a second specialist. The policyholder has requested the accelerated terminal illness benefit.',
    claimedAmount: 2000000,
    approvedAmount: null,
    status: S.VERIFIED,
    assignedTo: KULKARNI,
    filedBy: agent('Arjun Nair'),
    documents: [
      doc('CLM-2026-000052', 1, 'specialist-report', 'Specialist medical report', 'specialist-opinion.pdf', true, 'verified', '2026-07-28T08:20:00.000Z'),
      doc('CLM-2026-000052', 2, 'identity', 'Identity document', 'passport-vikram.pdf', true, 'verified', '2026-07-28T08:21:00.000Z'),
      doc('CLM-2026-000052', 3, 'other', 'Other supporting document', 'second-opinion.pdf', false, 'verified', '2026-07-28T08:24:00.000Z'),
    ],
    verification: {
      verifiedAt: '2026-08-12T07:35:00.000Z',
      verifiedBy: KULKARNI,
      checksPassed: 5,
      checksTotal: 6,
      warnings: 1,
      note: 'Two independent specialist opinions on file.',
    },
    assessment: null,
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-07-28T08:30:00.000Z',
    updatedAt: '2026-08-12T07:35:00.000Z',
    activity: [
      event('CLM-2026-000052', 1, '2026-07-28T08:30:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, agent('Arjun Nair'), 'Filed by the agent on behalf of the policyholder.'),
      event('CLM-2026-000052', 2, '2026-07-30T04:45:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, KULKARNI),
      event('CLM-2026-000052', 3, '2026-08-12T07:35:00.000Z', 'verify', 'Claim verified', S.UNDER_REVIEW, S.VERIFIED, KULKARNI, 'Two independent specialist opinions on file.'),
    ],
  },

  // ---------------------------------------------------------------- ASSESSED
  {
    claimId: 'CLM-2026-000071',
    policyId: 'POL-2024-000519',
    policyholderId: 'CUS-100630',
    claimType: 'permanent-disability',
    incidentDate: '2026-04-12',
    filingDate: '2026-08-05',
    description:
      'Following the April two-wheeler collision, the treating surgeon certified a permanent partial loss of grip strength in the right hand once recovery plateaued.',
    claimedAmount: 500000,
    approvedAmount: null,
    status: S.ASSESSED,
    assignedTo: BANERJEE,
    filedBy: agent('Meera Iyer'),
    documents: [
      doc('CLM-2026-000071', 1, 'incident-report', 'FIR / incident report', 'accident-report-banjara-hills.pdf', true, 'verified', '2026-08-05T06:40:00.000Z'),
      doc('CLM-2026-000071', 2, 'disability-certificate', 'Disability certificate', 'disability-certificate.pdf', true, 'verified', '2026-08-05T06:42:00.000Z'),
      doc('CLM-2026-000071', 3, 'identity', 'Identity document', 'pan-farhan.pdf', true, 'verified', '2026-08-05T06:43:00.000Z'),
    ],
    verification: {
      verifiedAt: '2026-08-21T09:10:00.000Z',
      verifiedBy: BANERJEE,
      checksPassed: 5,
      checksTotal: 6,
      warnings: 1,
      note: 'Disability certificate issued by a government medical board.',
    },
    assessment: {
      assessedAmount: 375000,
      illustrativeLimit: 1250000,
      limitBasis: 'Illustrative ceiling of 50% of sum insured (benefit table)',
      note: 'Disability assessed at 15% of sum insured under the illustrative benefit table.',
      assessedAt: '2026-09-09T08:25:00.000Z',
      assessedBy: BANERJEE,
    },
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-08-05T06:50:00.000Z',
    updatedAt: '2026-09-09T08:25:00.000Z',
    activity: [
      event('CLM-2026-000071', 1, '2026-08-05T06:50:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, agent('Meera Iyer'), 'Filed by the agent on behalf of the policyholder.'),
      event('CLM-2026-000071', 2, '2026-08-07T05:20:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, BANERJEE),
      event('CLM-2026-000071', 3, '2026-08-21T09:10:00.000Z', 'verify', 'Claim verified', S.UNDER_REVIEW, S.VERIFIED, BANERJEE, 'Disability certificate issued by a government medical board.'),
      event('CLM-2026-000071', 4, '2026-09-09T08:25:00.000Z', 'assess', 'Claim assessed', S.VERIFIED, S.ASSESSED, BANERJEE, 'Assessed at Rs. 3,75,000 (15% of sum insured).'),
    ],
  },

  // ------------------------------------------------------------ UNDER REVIEW
  {
    claimId: 'CLM-2026-000083',
    policyId: 'POL-2024-000519',
    policyholderId: 'CUS-100630',
    claimType: 'temporary-disablement',
    incidentDate: '2026-07-20',
    filingDate: '2026-08-18',
    description:
      'Slipped on a wet staircase at the office and sustained a ligament tear in the left knee. Advised three weeks of complete rest by the orthopaedic surgeon.',
    claimedAmount: 75000,
    approvedAmount: null,
    status: S.UNDER_REVIEW,
    assignedTo: BANERJEE,
    filedBy: policyholder('Farhan Qureshi'),
    documents: [
      doc('CLM-2026-000083', 1, 'incident-report', 'FIR / incident report', 'office-incident-report.pdf', true, 'submitted', '2026-08-18T11:00:00.000Z'),
      doc('CLM-2026-000083', 2, 'medical-certificate', 'Medical certificate of disablement', 'knee-rest-certificate.pdf', true, 'submitted', '2026-08-18T11:02:00.000Z'),
      doc('CLM-2026-000083', 3, 'identity', 'Identity document', 'pan-farhan.pdf', true, 'submitted', '2026-08-18T11:03:00.000Z'),
    ],
    verification: null,
    assessment: null,
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-08-18T11:05:00.000Z',
    updatedAt: '2026-09-02T06:00:00.000Z',
    activity: [
      event('CLM-2026-000083', 1, '2026-08-18T11:05:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, policyholder('Farhan Qureshi')),
      event('CLM-2026-000083', 2, '2026-09-02T06:00:00.000Z', 'start-review', 'Review started', S.SUBMITTED, S.UNDER_REVIEW, BANERJEE),
    ],
  },

  // --------------------------------------------------------------- CANCELLED
  {
    claimId: 'CLM-2026-000084',
    policyId: 'POL-2024-000519',
    policyholderId: 'CUS-100630',
    claimType: 'temporary-disablement',
    incidentDate: '2026-07-20',
    filingDate: '2026-08-18',
    description:
      'Slipped on a wet staircase at the office and sustained a ligament tear in the left knee. Duplicate of an earlier submission made the same day.',
    claimedAmount: 75000,
    approvedAmount: null,
    status: S.CANCELLED,
    assignedTo: null,
    filedBy: policyholder('Farhan Qureshi'),
    documents: [
      doc('CLM-2026-000084', 1, 'incident-report', 'FIR / incident report', 'office-incident-report.pdf', true, 'submitted', '2026-08-18T11:20:00.000Z'),
      doc('CLM-2026-000084', 2, 'medical-certificate', 'Medical certificate of disablement', 'knee-rest-certificate.pdf', true, 'submitted', '2026-08-18T11:21:00.000Z'),
      doc('CLM-2026-000084', 3, 'identity', 'Identity document', 'pan-farhan.pdf', true, 'submitted', '2026-08-18T11:22:00.000Z'),
    ],
    verification: null,
    assessment: null,
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-08-18T11:25:00.000Z',
    updatedAt: '2026-08-19T03:40:00.000Z',
    activity: [
      event('CLM-2026-000084', 1, '2026-08-18T11:25:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, policyholder('Farhan Qureshi')),
      event('CLM-2026-000084', 2, '2026-08-19T03:40:00.000Z', 'withdraw', 'Claim withdrawn', S.SUBMITTED, S.CANCELLED, policyholder('Farhan Qureshi'), 'Submitted twice by mistake; CLM-2026-000083 remains open.'),
    ],
  },

  // --------------------------------------------------------------- SUBMITTED
  {
    claimId: 'CLM-2026-000097',
    policyId: 'POL-2024-000519',
    policyholderId: 'CUS-100630',
    claimType: 'temporary-disablement',
    incidentDate: '2026-09-06',
    filingDate: '2026-09-12',
    description:
      'Sprained ankle with a hairline fracture after a fall on a trekking trail near Vikarabad. Immobilised and advised two weeks of complete rest from work.',
    claimedAmount: 50000,
    approvedAmount: null,
    status: S.SUBMITTED,
    assignedTo: null,
    filedBy: policyholder('Farhan Qureshi'),
    documents: [
      doc('CLM-2026-000097', 1, 'incident-report', 'FIR / incident report', 'trek-incident-report.pdf', true, 'submitted', '2026-09-12T04:35:00.000Z'),
      doc('CLM-2026-000097', 2, 'medical-certificate', 'Medical certificate of disablement', 'ankle-rest-certificate.pdf', true, 'submitted', '2026-09-12T04:38:00.000Z'),
      doc('CLM-2026-000097', 3, 'identity', 'Identity document', 'pan-farhan.pdf', true, 'submitted', '2026-09-12T04:40:00.000Z'),
    ],
    verification: null,
    assessment: null,
    decision: null,
    rejectionReason: null,
    settlement: null,
    createdAt: '2026-09-12T04:42:00.000Z',
    updatedAt: '2026-09-12T04:42:00.000Z',
    activity: [
      event('CLM-2026-000097', 1, '2026-09-12T04:42:00.000Z', 'submit', 'Claim submitted', S.DRAFT, S.SUBMITTED, policyholder('Farhan Qureshi')),
    ],
  },
]

export default claims
