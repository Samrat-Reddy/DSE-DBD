import './PolicyDocumentList.css'

/**
 * Document register for a policy.
 *
 * UI ONLY — there is no file storage, upload or download in this module. The
 * disabled action makes that explicit rather than offering a link that would
 * do nothing.
 */
const DOCUMENT_ICONS = {
  'Policy Schedule': '▤',
  'Proposal Form': '▤',
  KYC: '▣',
  Medical: '✚',
  Financial: '₹',
  Inspection: '◈',
  Valuation: '◈',
}

const PolicyDocumentList = ({ documents = [] }) => {
  if (!documents.length) {
    return (
      <p className="documents__empty">
        No documents have been recorded against this policy.
      </p>
    )
  }

  return (
    <>
      <ul className="documents">
        {documents.map((document) => (
          <li className="documents__item" key={document.id}>
            <span className="documents__icon" aria-hidden="true">
              {DOCUMENT_ICONS[document.type] ?? '▤'}
            </span>

            <div className="documents__meta">
              <p className="documents__name">{document.name}</p>
              <p className="documents__detail">
                <span>{document.type}</span>
                {document.size && document.size !== '—' && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{document.size}</span>
                  </>
                )}
              </p>
            </div>

            <button
              type="button"
              className="documents__action"
              disabled
              title="Document storage is not part of this module"
            >
              Download
            </button>
          </li>
        ))}
      </ul>

      <p className="documents__note">
        Document storage and download are not implemented in this module. These
        entries are displayed for interface completeness only.
      </p>
    </>
  )
}

export default PolicyDocumentList
