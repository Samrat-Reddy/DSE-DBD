import StatusBadge from '../common/StatusBadge'
import {
  formatCompactCurrency,
  formatCurrency,
  formatDuration,
} from '../../utils/formatters'
import './ProductStep.css'

/**
 * Step 1 — choose the product being issued.
 *
 * Only active products are selectable: an inactive product is closed to new
 * business, so offering it would be misleading.
 */
const ProductStep = ({ products = [], selectedId, onSelect }) => {
  if (!products.length) {
    return (
      <p className="product-step__empty">
        No products are currently open for new business.
      </p>
    )
  }

  return (
    <fieldset className="product-step">
      <legend className="product-step__legend">
        Select the product to issue
      </legend>

      <div className="product-step__options">
        {products.map((product) => {
          const isSelected = product.id === selectedId

          return (
            <label
              className={`product-option${isSelected ? ' product-option--selected' : ''}`}
              key={product.id}
            >
              <input
                type="radio"
                name="productId"
                value={product.id}
                checked={isSelected}
                onChange={() => onSelect(product.id)}
                className="product-option__input"
              />

              <span className="product-option__body">
                <span className="product-option__head">
                  <span className="product-option__name">{product.name}</span>
                  <StatusBadge status={product.status} />
                </span>

                <span className="product-option__id">{product.id}</span>
                <span className="product-option__tagline">{product.tagline}</span>

                <span className="product-option__figures">
                  <span>
                    <span className="product-option__figure-label">Type</span>
                    {product.type}
                  </span>
                  <span>
                    <span className="product-option__figure-label">Coverage</span>
                    {formatCompactCurrency(product.coverageAmount)}
                  </span>
                  <span>
                    <span className="product-option__figure-label">Premium</span>
                    {formatCurrency(product.premium)}
                  </span>
                  <span>
                    <span className="product-option__figure-label">Duration</span>
                    {formatDuration(product.durationYears)}
                  </span>
                </span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export default ProductStep
