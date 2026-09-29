import './MockNotice.css'

/**
 * Standard disclaimer for simulated payment behaviour.
 *
 * Used wherever a payment is initiated or displayed, so nobody reviewing the
 * demo can mistake it for a real financial transaction.
 */
const MockNotice = ({ title = 'Simulated payment', children }) => (
  <div className="mock-notice">
    <span className="mock-notice__icon" aria-hidden="true">
      ⓘ
    </span>
    <p className="mock-notice__text">
      <strong>{title}.</strong>{' '}
      {children ??
        'Payments are recorded in the database for demonstration. No money moves, and no bank, card or UPI provider is contacted.'}
    </p>
  </div>
)

export default MockNotice
