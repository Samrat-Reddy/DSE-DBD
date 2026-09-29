/**
 * Mock payment records.
 *
 * ILLUSTRATIVE DATA ONLY — no money has moved. Every record is a simulated
 * payment against an instalment of a schedule in `premiumSchedules.js`.
 * Transaction references carry a `MOCKTXN-` prefix so they can never be
 * mistaken for real bank or gateway references.
 *
 * Instalment IDs follow `INS-<policy number without POL->-<3-digit number>`,
 * which is exactly what `generateInstallments()` produces.
 *
 * Seeded situation (relative to the schedules):
 *   POL-2024-000148  1 of 1 paid
 *   POL-2024-000226  instalments 1-8 paid; a FAILED attempt on 9 (so 9 is
 *                    unpaid); 10 onwards unpaid
 *   POL-2023-000874  1 of 1 paid
 *   POL-2024-000519  instalments 1-3 paid; 4 unpaid
 */

import { PAYMENT_METHODS, PAYMENT_STATUS } from '../utils/constants'

export const payments = [
  {
    paymentId: 'PAY-2023-000212',
    policyId: 'POL-2023-000874',
    installmentId: 'INS-2023-000874-001',
    amount: 8400,
    paymentDate: '2023-09-14',
    paymentMethod: PAYMENT_METHODS.CARD,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-4QH7ZK2M8D',
  },
  {
    paymentId: 'PAY-2024-000101',
    policyId: 'POL-2024-000148',
    installmentId: 'INS-2024-000148-001',
    amount: 18500,
    paymentDate: '2024-04-12',
    paymentMethod: PAYMENT_METHODS.UPI,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-9B3TR6WJ1C',
  },
  {
    paymentId: 'PAY-2024-000102',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-001',
    amount: 4650,
    paymentDate: '2024-07-02',
    paymentMethod: PAYMENT_METHODS.NET_BANKING,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-2XK8PL5N7V',
  },
  {
    paymentId: 'PAY-2024-000118',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-002',
    amount: 4650,
    paymentDate: '2024-10-03',
    paymentMethod: PAYMENT_METHODS.NET_BANKING,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-6MW2QJ9R4T',
  },
  {
    paymentId: 'PAY-2024-000131',
    policyId: 'POL-2024-000519',
    installmentId: 'INS-2024-000519-001',
    amount: 1550,
    paymentDate: '2024-11-08',
    paymentMethod: PAYMENT_METHODS.UPI,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-8DF4HN1K6Z',
  },
  {
    paymentId: 'PAY-2025-000007',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-003',
    amount: 4650,
    paymentDate: '2025-01-04',
    paymentMethod: PAYMENT_METHODS.CARD,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-3VJ7BT2P9Q',
  },
  {
    paymentId: 'PAY-2025-000041',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-004',
    amount: 4650,
    paymentDate: '2025-04-02',
    paymentMethod: PAYMENT_METHODS.NET_BANKING,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-5RX9KM3W2H',
  },
  {
    paymentId: 'PAY-2025-000058',
    policyId: 'POL-2024-000519',
    installmentId: 'INS-2024-000519-002',
    amount: 1550,
    paymentDate: '2025-05-09',
    paymentMethod: PAYMENT_METHODS.UPI,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-1TG6ZC8L4N',
  },
  {
    paymentId: 'PAY-2025-000083',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-005',
    amount: 4650,
    paymentDate: '2025-07-05',
    paymentMethod: PAYMENT_METHODS.UPI,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-7PL3DQ5X8B',
  },
  {
    paymentId: 'PAY-2025-000121',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-006',
    amount: 4650,
    paymentDate: '2025-10-01',
    paymentMethod: PAYMENT_METHODS.NET_BANKING,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-4HZ8WN2R6K',
  },
  {
    paymentId: 'PAY-2025-000134',
    policyId: 'POL-2024-000519',
    installmentId: 'INS-2024-000519-003',
    amount: 1550,
    paymentDate: '2025-11-07',
    paymentMethod: PAYMENT_METHODS.CARD,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-9KC2VB7M3J',
  },
  {
    paymentId: 'PAY-2026-000004',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-007',
    amount: 4650,
    paymentDate: '2026-01-03',
    paymentMethod: PAYMENT_METHODS.NET_BANKING,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-6BN1XT4Q9W',
  },
  {
    paymentId: 'PAY-2026-000036',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-008',
    amount: 4650,
    paymentDate: '2026-04-04',
    paymentMethod: PAYMENT_METHODS.UPI,
    status: PAYMENT_STATUS.SUCCESS,
    transactionReference: 'MOCKTXN-2QM5JR8D1Y',
  },
  {
    paymentId: 'PAY-2026-000079',
    policyId: 'POL-2024-000226',
    installmentId: 'INS-2024-000226-009',
    amount: 4650,
    paymentDate: '2026-07-04',
    paymentMethod: PAYMENT_METHODS.CARD,
    status: PAYMENT_STATUS.FAILED,
    transactionReference: 'MOCKTXN-8WT3LK6F2P',
    failureReason: 'Declined by issuing bank (simulated).',
  },
]

export default payments
