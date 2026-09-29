import StatusBadge from '../common/StatusBadge'
import { REPORT_SORT_DIRECTIONS } from '../../utils/constants'
import { formatCurrency, formatDate } from '../../utils/formatters'
import './Reports.css'

const ARIA_SORT = { asc: 'ascending', desc: 'descending' }

/** Render a cell by its declared column type. Values arrive already derived. */
const renderCell = (row, column) => {
  const value = row[column.key]
  if (value === null || value === undefined || value === '') return <span className="report-table__muted">—</span>

  switch (column.type) {
    case 'currency':
      return formatCurrency(value)
    case 'date':
      return formatDate(value)
    case 'number':
      return value
    case 'status':
      return <StatusBadge status={value} />
    default:
      return value
  }
}

/**
 * A sortable report table.
 *
 * Sorting is requested from the report service (which sorts with the pure
 * `sortReportRows`), so what is exported always matches what is shown. The
 * table scrolls inside its own box rather than forcing the page sideways.
 */
const ReportTable = ({
  caption,
  columns = [],
  rows = [],
  sort,
  direction = REPORT_SORT_DIRECTIONS.DESC,
  onSort,
  total = 0,
  truncated = 0,
  emptyTitle = 'No matching records',
  emptyMessage = 'No records match this reporting period and these filters.',
}) => {
  if (!rows.length) {
    return (
      <div className="report-table__empty">
        <p className="report-table__empty-title">{emptyTitle}</p>
        <p className="report-table__empty-message">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <>
      <div className="report-table-wrap">
        <table className="report-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const isSorted = sort === column.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className={column.type === 'currency' || column.type === 'number' ? 'report-table__numeric' : undefined}
                    aria-sort={isSorted ? ARIA_SORT[direction] : 'none'}
                  >
                    {onSort ? (
                      <button type="button" className="report-table__sort" onClick={() => onSort(column.key)}>
                        {column.label}
                        <span className="report-table__sort-icon" aria-hidden="true">
                          {isSorted ? (direction === REPORT_SORT_DIRECTIONS.ASC ? '▲' : '▼') : '⇅'}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column, index) =>
                  index === 0 ? (
                    <th scope="row" key={column.key} className="report-table__row-header">
                      {renderCell(row, column)}
                    </th>
                  ) : (
                    <td
                      key={column.key}
                      className={column.type === 'currency' || column.type === 'number' ? 'report-table__numeric' : undefined}
                    >
                      {renderCell(row, column)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="report-table__footnote">
        Showing {rows.length} of {total} {total === 1 ? 'record' : 'records'}.
        {truncated > 0 && ` ${truncated} further ${truncated === 1 ? 'record is' : 'records are'} not rendered; export the report to see them all.`}
      </p>
    </>
  )
}

export default ReportTable
