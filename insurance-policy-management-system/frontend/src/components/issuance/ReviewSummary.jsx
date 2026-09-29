import DataList from '../common/DataList'
import Button from '../common/Button'
import {
  formatAddressLines,
  formatCurrency,
  formatDate,
  formatDuration,
  formatPhone,
} from '../../utils/formatters'
import { buildPremiumBreakdown, calculateEndDate } from '../../utils/policyPricing'
import './ReviewSummary.css'

/**
 * Step 4 — read-only confirmation of everything captured.
 *
 * Each block offers an Edit action that jumps back to the owning step, which
 * is faster and less error-prone than stepping backwards through the wizard.
 */
const ReviewBlock = ({ title, onEdit, editLabel, children }) => (
  <section className="review-block">
    <header className="review-block__header">
      <h3 className="review-block__title">{title}</h3>
      {onEdit && (
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
          <span className="sr-only"> {editLabel ?? title}</span>
        </Button>
      )}
    </header>
    <div className="review-block__body">{children}</div>
  </section>
)

const ReviewSummary = ({ product, values, onEditStep }) => {
  const premium = buildPremiumBreakdown(
    product,
    values.coverageAmount,
    values.premiumFrequency,
  )

  const endDate = calculateEndDate(values.startDate, values.durationYears)
  const addressLines = formatAddressLines({
    line1: values.addressLine1,
    line2: values.addressLine2,
    city: values.city,
    state: values.state,
    postalCode: values.postalCode,
  })

  return (
    <div className="review">
      <p className="review__intro">
        Check every detail below before issuing. Nothing has been created yet.
      </p>

      <ReviewBlock
        title="Product"
        editLabel="product selection"
        onEdit={() => onEditStep(0)}
      >
        <DataList
          items={[
            { label: 'Product', value: product?.name },
            { label: 'Product ID', value: product?.id, mono: true },
            { label: 'Policy type', value: product?.type },
          ]}
          columns={3}
        />
      </ReviewBlock>

      <ReviewBlock
        title="Policyholder"
        editLabel="policyholder details"
        onEdit={() => onEditStep(1)}
      >
        <DataList
          items={[
            { label: 'Full name', value: values.fullName },
            {
              label: 'Customer ID',
              value: values.customerId || 'To be generated on issue',
              mono: Boolean(values.customerId),
            },
            { label: 'Date of birth', value: formatDate(values.dateOfBirth) },
            { label: 'Email', value: values.email },
            { label: 'Phone', value: formatPhone(values.phone) },
            {
              label: 'Address',
              span: true,
              value: addressLines.length ? (
                <address className="review__address">
                  {addressLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </address>
              ) : null,
            },
          ]}
        />
      </ReviewBlock>

      <ReviewBlock
        title="Coverage and premium"
        editLabel="coverage and premium"
        onEdit={() => onEditStep(2)}
      >
        <DataList
          items={[
            {
              label: 'Coverage amount',
              value: formatCurrency(values.coverageAmount),
            },
            {
              label: 'Premium frequency',
              value: values.premiumFrequency,
            },
            {
              label: 'Indicative annual premium',
              value: formatCurrency(premium.annual),
            },
            {
              label: 'Per instalment',
              value: `${formatCurrency(premium.instalment)} × ${premium.instalmentsPerYear} per year`,
            },
          ]}
        />
      </ReviewBlock>

      <ReviewBlock
        title="Policy dates"
        editLabel="policy dates"
        onEdit={() => onEditStep(2)}
      >
        <DataList
          columns={3}
          items={[
            { label: 'Start date', value: formatDate(values.startDate) },
            { label: 'Duration', value: formatDuration(values.durationYears) },
            { label: 'End date', value: endDate ? formatDate(endDate) : '—' },
          ]}
        />
      </ReviewBlock>

      <ReviewBlock
        title="Nominee"
        editLabel="nominee details"
        onEdit={() => onEditStep(2)}
      >
        <DataList
          columns={3}
          items={[
            { label: 'Name', value: values.nomineeName },
            { label: 'Relationship', value: values.nomineeRelationship },
            {
              label: 'Date of birth',
              value: formatDate(values.nomineeDateOfBirth),
            },
          ]}
        />
      </ReviewBlock>
    </div>
  )
}

export default ReviewSummary
