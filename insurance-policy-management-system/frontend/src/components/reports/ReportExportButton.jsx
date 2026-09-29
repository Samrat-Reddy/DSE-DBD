import { useState } from 'react'
import Button from '../common/Button'
import { buildCsv } from '../../utils/reportExport'
import { downloadCsv } from '../../utils/downloadFile'
import './Reports.css'

/**
 * Exports exactly the rows the report is currently showing — same columns,
 * same order, same period and filters — as CSV. The CSV text is built by the
 * pure `buildCsv`; this component only hands it to the browser.
 */
const ReportExportButton = ({ table, filename, disabled = false, label = 'Export CSV' }) => {
  const [message, setMessage] = useState(null)
  const rowCount = table?.rows?.length ?? 0

  const handleExport = () => {
    const csv = buildCsv(table)
    const saved = downloadCsv(filename, csv)
    setMessage(
      saved
        ? `Exported ${rowCount} ${rowCount === 1 ? 'record' : 'records'} to ${filename}.`
        : 'This browser blocked the download. Nothing was exported.',
    )
  }

  return (
    <div className="report-export">
      <Button variant="secondary" size="sm" onClick={handleExport} disabled={disabled || !rowCount}>
        {label}
      </Button>
      <span className="report-export__status" role="status" aria-live="polite">
        {message}
      </span>
    </div>
  )
}

export default ReportExportButton
