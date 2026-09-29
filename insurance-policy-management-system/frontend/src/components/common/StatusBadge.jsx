import './StatusBadge.css'

/**
 * Status pill with a consistent colour per lifecycle state.
 *
 * Keeping the mapping here means a status always looks the same wherever it
 * appears — catalog, list, or detail header.
 */
const STATUS_META = {
  active: { label: 'Active', tone: 'active' },
  inactive: { label: 'Inactive', tone: 'inactive' },
  pending: { label: 'Pending', tone: 'pending' },
  expired: { label: 'Expired', tone: 'expired' },
  lapsed: { label: 'Lapsed', tone: 'expired' },

  // Premium instalments (Module 2)
  paid: { label: 'Paid', tone: 'active' },
  due: { label: 'Due', tone: 'pending' },
  upcoming: { label: 'Upcoming', tone: 'info' },
  overdue: { label: 'Overdue', tone: 'expired' },

  // Payment attempts (Module 2). `pending` above is shared.
  success: { label: 'Successful', tone: 'active' },
  failed: { label: 'Failed', tone: 'expired' },

  // Policy-level premium standing (Module 2)
  'up-to-date': { label: 'Up to date', tone: 'info' },
  'fully-paid': { label: 'Fully paid', tone: 'active' },

  // Claim workflow (Module 3)
  draft: { label: 'Draft', tone: 'inactive' },
  submitted: { label: 'Submitted', tone: 'info' },
  'under-review': { label: 'Under review', tone: 'pending' },
  verified: { label: 'Verified', tone: 'info' },
  assessed: { label: 'Assessed', tone: 'pending' },
  approved: { label: 'Approved', tone: 'active' },
  rejected: { label: 'Rejected', tone: 'expired' },
  settled: { label: 'Settled', tone: 'active' },
  cancelled: { label: 'Cancelled', tone: 'inactive' },

  // Renewal status (Module 4). `upcoming`, `due` and `expired` above are shared.
  'not-due': { label: 'Not due', tone: 'inactive' },
  'due-soon': { label: 'Due soon', tone: 'pending' },
  'expiring-today': { label: 'Expiring today', tone: 'expired' },
  'expiry-unknown': { label: 'Expiry unknown', tone: 'inactive' },

  // Reminder attempts and stages (Module 4). `failed` above is shared.
  scheduled: { label: 'Scheduled', tone: 'info' },
  sent: { label: 'Sent', tone: 'active' },
  skipped: { label: 'Skipped', tone: 'inactive' },
  missed: { label: 'Missed', tone: 'inactive' },

  // Renewal readiness (Module 4)
  ready: { label: 'Ready for renewal', tone: 'active' },
  'action-required': { label: 'Action required', tone: 'pending' },
  'window-not-open': { label: 'Window not open', tone: 'info' },
  'not-eligible': { label: 'Not eligible', tone: 'inactive' },

  // Agent commission (Module 5). `pending` and `paid` above are shared.
  earned: { label: 'Earned', tone: 'info' },
}

const StatusBadge = ({ status, label, size = 'md' }) => {
  const meta = STATUS_META[status] ?? { label: status ?? 'Unknown', tone: 'inactive' }
  const text = label ?? meta.label

  return (
    <span
      className={`status-badge status-badge--${meta.tone} status-badge--${size}`}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      {text}
    </span>
  )
}

export default StatusBadge
