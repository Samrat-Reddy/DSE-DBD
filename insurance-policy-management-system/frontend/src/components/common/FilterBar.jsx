import { useId } from 'react'
import Button from './Button'
import './FilterBar.css'

/**
 * Configurable search + select filter bar.
 *
 * Controlled: it owns no state. The page holds the query object and this
 * renders it, so there is one source of truth for what is sent to the service
 * layer. Used by the premium accounts list and the payment history.
 *
 * @param {{
 *   query: object,
 *   onChange: (nextQuery: object) => void,
 *   searchField: {name: string, label: string, placeholder?: string},
 *   selectFields: Array<{name: string, label: string, options: Array<{value: string, label: string}>}>,
 *   resultCount: number|null,
 *   resultNoun: [string, string],
 * }} props
 */
const FilterBar = ({
  label,
  query,
  onChange,
  onReset,
  searchField,
  selectFields = [],
  resultCount,
  resultNoun = ['result', 'results'],
  isFiltered = false,
  disabled = false,
}) => {
  const baseId = useId()
  const fieldId = (name) => `${baseId}-${name}`

  const update = (name) => (event) => onChange({ ...query, [name]: event.target.value })

  const countText =
    resultCount === null
      ? 'Loading…'
      : `${resultCount} ${resultCount === 1 ? resultNoun[0] : resultNoun[1]} shown`

  return (
    <section className="filter-bar" aria-label={label}>
      <div
        className="filter-bar__row"
        style={{ '--filter-selects': selectFields.length }}
      >
        {searchField && (
          <div className="filter-bar__field filter-bar__field--search">
            <label className="filter-bar__label" htmlFor={fieldId(searchField.name)}>
              {searchField.label}
            </label>
            <div className="filter-bar__search">
              <span className="filter-bar__search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                id={fieldId(searchField.name)}
                type="search"
                className="filter-bar__control filter-bar__control--search"
                placeholder={searchField.placeholder}
                value={query[searchField.name] ?? ''}
                onChange={update(searchField.name)}
                disabled={disabled}
              />
            </div>
          </div>
        )}

        {selectFields.map((field) => (
          <div className="filter-bar__field" key={field.name}>
            <label className="filter-bar__label" htmlFor={fieldId(field.name)}>
              {field.label}
            </label>
            <select
              id={fieldId(field.name)}
              className="filter-bar__control"
              value={query[field.name] ?? ''}
              onChange={update(field.name)}
              disabled={disabled}
            >
              {field.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="filter-bar__footer">
        <p className="filter-bar__count" role="status" aria-live="polite">
          {countText}
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

export default FilterBar
