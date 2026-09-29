import {
  CATALOG_SORT_OPTIONS,
  POLICY_TYPE_OPTIONS,
  PRODUCT_STATUS,
} from '../../utils/constants'
import Button from '../common/Button'
import './PolicyFilters.css'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: PRODUCT_STATUS.ACTIVE, label: 'Active' },
  { value: PRODUCT_STATUS.INACTIVE, label: 'Inactive' },
]

const TYPE_OPTIONS = [{ value: 'all', label: 'All policy types' }, ...POLICY_TYPE_OPTIONS]

/**
 * Search, filter and sort controls for the catalog.
 *
 * Controlled component: it owns no state. The page holds the query and this
 * renders it, which keeps a single source of truth for what is being asked of
 * the service layer.
 */
const PolicyFilters = ({
  query,
  onChange,
  onReset,
  resultCount,
  isFiltered,
  disabled = false,
}) => {
  const update = (field) => (event) =>
    onChange({ ...query, [field]: event.target.value })

  return (
    <section className="policy-filters" aria-label="Filter policy products">
      <div className="policy-filters__row">
        <div className="policy-filters__search">
          <label className="policy-filters__label" htmlFor="catalog-search">
            Search
          </label>
          <div className="policy-filters__search-control">
            <span className="policy-filters__search-icon" aria-hidden="true">
              ⌕
            </span>
            <input
              id="catalog-search"
              type="search"
              className="policy-filters__input"
              placeholder="Product name, product ID, or policy type"
              value={query.search}
              onChange={update('search')}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="policy-filters__control">
          <label className="policy-filters__label" htmlFor="catalog-type">
            Policy type
          </label>
          <select
            id="catalog-type"
            className="policy-filters__select"
            value={query.type}
            onChange={update('type')}
            disabled={disabled}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="policy-filters__control">
          <label className="policy-filters__label" htmlFor="catalog-status">
            Status
          </label>
          <select
            id="catalog-status"
            className="policy-filters__select"
            value={query.status}
            onChange={update('status')}
            disabled={disabled}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="policy-filters__control">
          <label className="policy-filters__label" htmlFor="catalog-sort">
            Sort by
          </label>
          <select
            id="catalog-sort"
            className="policy-filters__select"
            value={query.sort}
            onChange={update('sort')}
            disabled={disabled}
          >
            {CATALOG_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="policy-filters__footer">
        <p className="policy-filters__count" role="status" aria-live="polite">
          {resultCount === null
            ? 'Loading products…'
            : `${resultCount} ${resultCount === 1 ? 'product' : 'products'} shown`}
        </p>

        {isFiltered && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            Clear filters
          </Button>
        )}
      </div>
    </section>
  )
}

export default PolicyFilters
