import './DataList.css'

/**
 * Label/value pairs rendered as a real description list.
 *
 * Used throughout Policy Details and the issuance review so that every
 * attribute row shares the same rhythm, alignment and responsive behaviour.
 *
 * @param {{items: Array<{label: string, value: React.ReactNode, span?: boolean}>}} props
 */
const DataList = ({ items = [], columns = 2, dense = false }) => {
  const visible = items.filter((item) => item && item.value !== undefined)

  if (!visible.length) return null

  return (
    <dl
      className={`data-list data-list--cols-${columns}${
        dense ? ' data-list--dense' : ''
      }`}
    >
      {visible.map((item) => (
        <div
          className={`data-list__item${item.span ? ' data-list__item--span' : ''}`}
          key={item.label}
        >
          <dt className="data-list__label">{item.label}</dt>
          <dd className={`data-list__value${item.mono ? ' data-list__value--mono' : ''}`}>
            {item.value === null || item.value === '' ? '—' : item.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default DataList
