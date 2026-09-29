import { useId } from 'react'
import Button from '../common/Button'
import { REPORT_PERIOD_OPTIONS, REPORT_PERIODS } from '../../utils/constants'
import './Reports.css'

/**
 * Filters for one report: the reporting period (with a custom range), product,
 * an optional report-specific status, an optional agent, and an optional
 * search over the table.
 *
 * Controlled — the page owns the query and sends it to the report service, so
 * every filter genuinely changes the report rather than only the view. Each
 * report passes only the filters that make sense for it.
 */
const ReportFilterBar = ({
  query,
  onChange,
  onReset,
  options = {},
  show = {},
  range,
  disabled = false,
  isFiltered = false,
  resultCount = null,
  resultNoun = ['record', 'records'],
}) => {
  const baseId = useId()
  const fieldId = (name) => `${baseId}-${name}`
  const update = (name) => (event) => onChange({ ...query, [name]: event.target.value })
  const isCustom = query.period === REPORT_PERIODS.CUSTOM

  const select = (name, label, choices) => (
    <div className="report-filters__field">
      <label className="report-filters__label" htmlFor={fieldId(name)}>
        {label}
      </label>
      <select
        id={fieldId(name)}
        name={name}
        className="report-filters__control"
        value={query[name] ?? 'all'}
        onChange={update(name)}
        disabled={disabled}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  )

  const dateField = (name, label, bounds) => (
    <div className="report-filters__field">
      <label className="report-filters__label" htmlFor={fieldId(name)}>
        {label}
      </label>
      <input
        id={fieldId(name)}
        name={name}
        type="date"
        className="report-filters__control"
        value={query[name] ?? ''}
        onChange={update(name)}
        disabled={disabled}
        {...bounds}
      />
    </div>
  )

  const countText =
    resultCount === null ? 'Loading…' : `${resultCount} ${resultCount === 1 ? resultNoun[0] : resultNoun[1]} in this report`

  return (
    <section className="report-filters" aria-label="Report filters">
      <div className="report-filters__row">
        {select('period', 'Reporting period', REPORT_PERIOD_OPTIONS)}
        {isCustom && dateField('from', 'From', { max: query.to || undefined })}
        {isCustom && dateField('to', 'To', { min: query.from || undefined })}
        {options.products && select('product', 'Product', [{ value: 'all', label: 'All products' }, ...options.products])}
        {show.status &&
          options.statuses &&
          select('status', show.statusLabel ?? 'Status', [
            { value: 'all', label: show.allStatusesLabel ?? 'All statuses' },
            ...options.statuses,
          ])}
        {show.agent && options.agents && select('agentId', 'Agent', [{ value: 'all', label: 'All agents' }, ...options.agents])}

        {show.search && (
          <div className="report-filters__field report-filters__field--search">
            <label className="report-filters__label" htmlFor={fieldId('search')}>
              Search table
            </label>
            <input
              id={fieldId('search')}
              name="search"
              type="search"
              className="report-filters__control"
              placeholder={show.searchPlaceholder}
              value={query.search ?? ''}
              onChange={update('search')}
              disabled={disabled}
            />
          </div>
        )}
      </div>

      <div className="report-filters__footer">
        <p className="report-filters__range">
          <span className="report-filters__range-label">{range?.label ?? 'Reporting period'}:</span>{' '}
          {range?.description ?? 'not resolved'}
          {show.periodField && <span className="report-filters__hint"> · Scoped by {show.periodField.toLowerCase()}</span>}
        </p>
        <p className="report-filters__count">{countText}</p>
        <Button variant="ghost" size="sm" onClick={onReset} disabled={disabled || !isFiltered}>
          Reset filters
        </Button>
      </div>
    </section>
  )
}

export default ReportFilterBar
