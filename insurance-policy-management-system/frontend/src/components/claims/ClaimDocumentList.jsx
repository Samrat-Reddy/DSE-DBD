import { formatDate } from '../../utils/formatters'
import './ClaimDocuments.css'

const STATUS_LABELS = {
  submitted: 'Submitted',
  verified: 'Verified',
  missing: 'Missing',
}

/**
 * Claim document register. Metadata only — no file exists or can be opened.
 *
 * Required documents the claim type expects but that were never provided are
 * listed as missing, so gaps are visible rather than silently absent.
 */
const ClaimDocumentList = ({ documents = [], claimType }) => {
  const providedTypes = new Set(documents.map((item) => item.type))
  const missing = (claimType?.requiredDocuments ?? []).filter(
    (requirement) => requirement.required && !providedTypes.has(requirement.type),
  )

  const rows = [
    ...documents,
    ...missing.map((requirement) => ({
      documentId: `missing-${requirement.type}`,
      label: requirement.label,
      fileName: null,
      required: true,
      status: 'missing',
      submittedAt: null,
    })),
  ]

  if (!rows.length) {
    return <p className="claim-docs__empty">No documents are recorded for this claim.</p>
  }

  return (
    <>
      <ul className="claim-docs">
        {rows.map((item) => (
          <li key={item.documentId} className={`claim-docs__item claim-docs__item--${item.status}`}>
            <span className="claim-docs__icon" aria-hidden="true">
              {item.status === 'missing' ? '!' : '▤'}
            </span>
            <div className="claim-docs__meta">
              <p className="claim-docs__label">
                {item.label}
                {item.required ? (
                  <span className="claim-docs__required">Required</span>
                ) : (
                  <span className="claim-docs__optional">Optional</span>
                )}
              </p>
              <p className="claim-docs__detail">
                {item.fileName ? <span className="claim-docs__file">{item.fileName}</span> : 'Not provided'}
                {item.submittedAt && <span> · recorded {formatDate(item.submittedAt)}</span>}
              </p>
            </div>
            <span className={`claim-docs__status claim-docs__status--${item.status}`}>
              {STATUS_LABELS[item.status] ?? item.status}
            </span>
          </li>
        ))}
      </ul>
      <p className="claim-docs__note">
        Demonstration only: documents are recorded by name. No file is uploaded, stored or available to open.
      </p>
    </>
  )
}

export default ClaimDocumentList
