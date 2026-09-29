import DataList from '../common/DataList'
import {
  formatAddressLines,
  formatDate,
  formatPhone,
} from '../../utils/formatters'

/**
 * Policyholder and nominee details for an issued policy.
 *
 * A dedicated component because Policy 360 will later extend this into a full
 * customer panel (linked policies, contact history) without touching the page.
 */
const CustomerSummary = ({ policyholder, nominee }) => {
  if (!policyholder) {
    return (
      <p className="policy-detail__muted">
        Policyholder information appears once a policy has been issued from this
        product.
      </p>
    )
  }

  const addressLines = formatAddressLines(policyholder.address)

  return (
    <>
      <DataList
        items={[
          { label: 'Full name', value: policyholder.name },
          { label: 'Customer ID', value: policyholder.customerId, mono: true },
          { label: 'Date of birth', value: formatDate(policyholder.dateOfBirth) },
          {
            label: 'Email',
            value: (
              <a href={`mailto:${policyholder.email}`}>{policyholder.email}</a>
            ),
          },
          {
            label: 'Phone',
            value: (
              <a href={`tel:${policyholder.phone}`}>
                {formatPhone(policyholder.phone)}
              </a>
            ),
          },
          {
            label: 'Address',
            span: true,
            value: addressLines.length ? (
              <address className="policy-detail__address">
                {addressLines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </address>
            ) : null,
          },
        ]}
      />

      {nominee && (
        <div className="policy-detail__subsection">
          <h3 className="policy-detail__subtitle">Nominee</h3>
          <DataList
            dense
            columns={3}
            items={[
              { label: 'Name', value: nominee.name },
              { label: 'Relationship', value: nominee.relationship },
              {
                label: 'Date of birth',
                value: formatDate(nominee.dateOfBirth),
              },
            ]}
          />
        </div>
      )}
    </>
  )
}

export default CustomerSummary
