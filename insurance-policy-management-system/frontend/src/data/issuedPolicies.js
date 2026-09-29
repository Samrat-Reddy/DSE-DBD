/**
 * Mock issued policies (the in-force book).
 *
 * ILLUSTRATIVE DATA ONLY — customers, agents and policy numbers are invented
 * for a university frontend demonstration.
 *
 * The shape mirrors an expected FastAPI `/policies` response. Lifecycle
 * events are stored oldest-first so the timeline renders chronologically.
 */

import {
  POLICY_STATUS,
  POLICY_TYPES,
  PREMIUM_FREQUENCIES,
} from '../utils/constants'

/** Lifecycle stages a policy moves through, in order. */
export const LIFECYCLE_STAGES = [
  'Application Submitted',
  'Underwriting Completed',
  'Policy Approved',
  'Policy Issued',
]

export const issuedPolicies = [
  {
    id: 'POL-2024-000148',
    productId: 'PRD-HLT-001',
    productName: 'Secure Health Shield',
    type: POLICY_TYPES.HEALTH,
    status: POLICY_STATUS.ACTIVE,
    coverageAmount: 1000000,
    premium: 18500,
    premiumFrequency: PREMIUM_FREQUENCIES.ANNUAL,
    durationYears: 1,
    issueDate: '2024-04-12',
    startDate: '2024-04-15',
    endDate: '2025-04-14',
    policyholder: {
      name: 'Ananya Krishnan',
      customerId: 'CUS-100241',
      dateOfBirth: '1990-06-18',
      email: 'ananya.krishnan@example.com',
      phone: '9845012377',
      address: {
        line1: '14, Brigade Gardens',
        line2: 'Ashok Nagar',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560025',
      },
    },
    nominee: {
      name: 'Rahul Krishnan',
      relationship: 'Spouse',
      dateOfBirth: '1988-02-04',
    },
    agent: {
      id: 'AGT-2207',
      name: 'Meera Iyer',
      branch: 'Bengaluru South',
      email: 'meera.iyer@example.com',
    },
    documents: [
      { id: 'DOC-001', name: 'Policy Schedule.pdf', type: 'Policy Schedule', size: '412 KB', uploadedOn: '2024-04-12' },
      { id: 'DOC-002', name: 'Proposal Form.pdf', type: 'Proposal Form', size: '268 KB', uploadedOn: '2024-04-08' },
      { id: 'DOC-003', name: 'KYC - Aadhaar.pdf', type: 'KYC', size: '154 KB', uploadedOn: '2024-04-08' },
      { id: 'DOC-004', name: 'Medical Report.pdf', type: 'Medical', size: '890 KB', uploadedOn: '2024-04-10' },
    ],
    lifecycle: [
      { stage: 'Application Submitted', date: '2024-04-08', note: 'Proposal received through agent portal.', status: 'completed' },
      { stage: 'Underwriting Completed', date: '2024-04-10', note: 'Medical screening cleared without loading.', status: 'completed' },
      { stage: 'Policy Approved', date: '2024-04-11', note: 'Approved by underwriting desk.', status: 'completed' },
      { stage: 'Policy Issued', date: '2024-04-12', note: 'Policy schedule generated and dispatched.', status: 'completed' },
    ],
  },
  {
    id: 'POL-2024-000226',
    productId: 'PRD-LIF-002',
    productName: 'LifeSecure Term Plan',
    type: POLICY_TYPES.LIFE,
    status: POLICY_STATUS.ACTIVE,
    coverageAmount: 7500000,
    premium: 4650,
    premiumFrequency: PREMIUM_FREQUENCIES.QUARTERLY,
    durationYears: 25,
    issueDate: '2024-07-02',
    startDate: '2024-07-05',
    endDate: '2049-07-04',
    policyholder: {
      name: 'Vikram Desai',
      customerId: 'CUS-100388',
      dateOfBirth: '1985-11-27',
      email: 'vikram.desai@example.com',
      phone: '9820114563',
      address: {
        line1: 'B-702, Sunview Residency',
        line2: 'Powai',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400076',
      },
    },
    nominee: {
      name: 'Sneha Desai',
      relationship: 'Spouse',
      dateOfBirth: '1987-09-12',
    },
    agent: {
      id: 'AGT-1184',
      name: 'Arjun Nair',
      branch: 'Mumbai West',
      email: 'arjun.nair@example.com',
    },
    documents: [
      { id: 'DOC-011', name: 'Policy Schedule.pdf', type: 'Policy Schedule', size: '388 KB', uploadedOn: '2024-07-02' },
      { id: 'DOC-012', name: 'Proposal Form.pdf', type: 'Proposal Form', size: '301 KB', uploadedOn: '2024-06-24' },
      { id: 'DOC-013', name: 'Income Proof.pdf', type: 'Financial', size: '220 KB', uploadedOn: '2024-06-25' },
      { id: 'DOC-014', name: 'Tele-Medical Report.pdf', type: 'Medical', size: '512 KB', uploadedOn: '2024-06-28' },
    ],
    lifecycle: [
      { stage: 'Application Submitted', date: '2024-06-24', note: 'Proposal captured at Mumbai West branch.', status: 'completed' },
      { stage: 'Underwriting Completed', date: '2024-06-29', note: 'Tele-medical assessment cleared.', status: 'completed' },
      { stage: 'Policy Approved', date: '2024-07-01', note: 'Approved at standard rates.', status: 'completed' },
      { stage: 'Policy Issued', date: '2024-07-02', note: 'Policy bond issued electronically.', status: 'completed' },
    ],
  },
  {
    id: 'POL-2025-000031',
    productId: 'PRD-MOT-003',
    productName: 'DriveSafe Motor Package',
    type: POLICY_TYPES.MOTOR,
    status: POLICY_STATUS.PENDING,
    coverageAmount: 950000,
    premium: 15800,
    premiumFrequency: PREMIUM_FREQUENCIES.ANNUAL,
    durationYears: 1,
    issueDate: null,
    startDate: '2025-02-01',
    endDate: '2026-01-31',
    policyholder: {
      name: 'Priya Menon',
      customerId: 'CUS-100512',
      dateOfBirth: '1994-03-09',
      email: 'priya.menon@example.com',
      phone: '9995641230',
      address: {
        line1: '27, Marine Drive Road',
        line2: 'Ernakulam',
        city: 'Kochi',
        state: 'Kerala',
        postalCode: '682031',
      },
    },
    nominee: {
      name: 'Latha Menon',
      relationship: 'Mother',
      dateOfBirth: '1966-01-22',
    },
    agent: {
      id: 'AGT-3390',
      name: 'Sandeep Rao',
      branch: 'Kochi Central',
      email: 'sandeep.rao@example.com',
    },
    documents: [
      { id: 'DOC-021', name: 'Proposal Form.pdf', type: 'Proposal Form', size: '245 KB', uploadedOn: '2025-01-18' },
      { id: 'DOC-022', name: 'Registration Certificate.pdf', type: 'KYC', size: '198 KB', uploadedOn: '2025-01-18' },
      { id: 'DOC-023', name: 'Vehicle Inspection.pdf', type: 'Inspection', size: '640 KB', uploadedOn: '2025-01-21' },
    ],
    lifecycle: [
      { stage: 'Application Submitted', date: '2025-01-18', note: 'Proposal submitted with vehicle documents.', status: 'completed' },
      { stage: 'Underwriting Completed', date: '2025-01-22', note: 'Vehicle inspection report accepted.', status: 'completed' },
      { stage: 'Policy Approved', date: null, note: 'Awaiting approval from the underwriting desk.', status: 'current' },
      { stage: 'Policy Issued', date: null, note: 'Pending issuance.', status: 'upcoming' },
    ],
  },
  {
    id: 'POL-2023-000874',
    productId: 'PRD-HOM-005',
    productName: 'HomeShield Property Cover',
    type: POLICY_TYPES.HOME,
    status: POLICY_STATUS.EXPIRED,
    coverageAmount: 2800000,
    premium: 8400,
    premiumFrequency: PREMIUM_FREQUENCIES.ANNUAL,
    durationYears: 1,
    issueDate: '2023-09-14',
    startDate: '2023-09-20',
    endDate: '2024-09-19',
    policyholder: {
      name: 'Rohit Sharma',
      customerId: 'CUS-100097',
      dateOfBirth: '1979-12-02',
      email: 'rohit.sharma@example.com',
      phone: '9711204588',
      address: {
        line1: 'House 41, Sector 15',
        line2: 'Dwarka',
        city: 'New Delhi',
        state: 'Delhi',
        postalCode: '110078',
      },
    },
    nominee: {
      name: 'Kavita Sharma',
      relationship: 'Spouse',
      dateOfBirth: '1982-05-30',
    },
    agent: {
      id: 'AGT-0456',
      name: 'Nisha Gupta',
      branch: 'Delhi NCR',
      email: 'nisha.gupta@example.com',
    },
    documents: [
      { id: 'DOC-031', name: 'Policy Schedule.pdf', type: 'Policy Schedule', size: '402 KB', uploadedOn: '2023-09-14' },
      { id: 'DOC-032', name: 'Proposal Form.pdf', type: 'Proposal Form', size: '289 KB', uploadedOn: '2023-09-06' },
      { id: 'DOC-033', name: 'Property Valuation.pdf', type: 'Valuation', size: '735 KB', uploadedOn: '2023-09-09' },
    ],
    lifecycle: [
      { stage: 'Application Submitted', date: '2023-09-06', note: 'Proposal received with property documents.', status: 'completed' },
      { stage: 'Underwriting Completed', date: '2023-09-11', note: 'Valuation report reviewed and accepted.', status: 'completed' },
      { stage: 'Policy Approved', date: '2023-09-13', note: 'Approved by property underwriting.', status: 'completed' },
      { stage: 'Policy Issued', date: '2023-09-14', note: 'Policy issued. Cover ended on 19 Sep 2024.', status: 'completed' },
    ],
  },
  {
    id: 'POL-2024-000519',
    productId: 'PRD-ACC-004',
    productName: 'SafeGuard Personal Accident',
    type: POLICY_TYPES.PERSONAL_ACCIDENT,
    status: POLICY_STATUS.ACTIVE,
    coverageAmount: 2500000,
    premium: 1550,
    premiumFrequency: PREMIUM_FREQUENCIES.HALF_YEARLY,
    durationYears: 2,
    issueDate: '2024-11-08',
    startDate: '2024-11-10',
    endDate: '2026-11-09',
    policyholder: {
      name: 'Farhan Qureshi',
      customerId: 'CUS-100630',
      dateOfBirth: '1992-08-21',
      email: 'farhan.qureshi@example.com',
      phone: '9032217744',
      address: {
        line1: 'Flat 9C, Lakeview Enclave',
        line2: 'Banjara Hills',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500034',
      },
    },
    nominee: {
      name: 'Sana Qureshi',
      relationship: 'Sister',
      dateOfBirth: '1996-04-17',
    },
    agent: {
      id: 'AGT-2207',
      name: 'Meera Iyer',
      branch: 'Bengaluru South',
      email: 'meera.iyer@example.com',
    },
    documents: [
      { id: 'DOC-041', name: 'Policy Schedule.pdf', type: 'Policy Schedule', size: '356 KB', uploadedOn: '2024-11-08' },
      { id: 'DOC-042', name: 'Proposal Form.pdf', type: 'Proposal Form', size: '232 KB', uploadedOn: '2024-11-04' },
      { id: 'DOC-043', name: 'Employment Proof.pdf', type: 'KYC', size: '176 KB', uploadedOn: '2024-11-04' },
    ],
    lifecycle: [
      { stage: 'Application Submitted', date: '2024-11-04', note: 'Proposal submitted online.', status: 'completed' },
      { stage: 'Underwriting Completed', date: '2024-11-06', note: 'Occupation class verified, no medicals required.', status: 'completed' },
      { stage: 'Policy Approved', date: '2024-11-07', note: 'Approved at standard rates.', status: 'completed' },
      { stage: 'Policy Issued', date: '2024-11-08', note: 'Policy issued and welcome kit dispatched.', status: 'completed' },
    ],
  },
]

export default issuedPolicies
