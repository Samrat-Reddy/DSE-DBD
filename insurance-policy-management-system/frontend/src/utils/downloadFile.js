/**
 * Browser download helper.
 *
 * Kept out of components so they stay declarative, and out of the pure report
 * utilities so those remain testable in Node. It creates a blob URL, clicks a
 * temporary link and revokes the URL again — no network request is made and
 * nothing is stored.
 *
 * Returns `false` when the browser APIs are unavailable (for example during
 * server-side rendering in the test harness), so callers can react instead of
 * throwing.
 */
export const downloadTextFile = (filename, text, mimeType = 'text/plain;charset=utf-8') => {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false

  const url = URL.createObjectURL(new Blob([text], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}

export const downloadCsv = (filename, csv) => downloadTextFile(filename, csv, 'text/csv;charset=utf-8')

export default downloadTextFile
