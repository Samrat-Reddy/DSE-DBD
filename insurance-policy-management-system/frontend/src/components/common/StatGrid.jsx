import './StatGrid.css'

/**
 * Grid of headline financial figures.
 *
 * Each stat has a tone (paid, due, overdue, upcoming, primary, neutral) that
 * adds a coloured accent. Colour is never the only signal: the label always
 * states what the figure is.
 *
 * @param {{items: Array<{id: string, label: string, value: React.ReactNode,
 *   detail?: React.ReactNode, tone?: string}>, columns?: number}} props
 */
const StatGrid = ({ items = [], columns = 4 }) => (
  <dl className="stat-grid" style={{ '--stat-columns': columns }}>
    {items.map((item) => (
      <div className={`stat-grid__item stat-grid__item--${item.tone ?? 'neutral'}`} key={item.id}>
        <dt className="stat-grid__label">{item.label}</dt>
        <dd className="stat-grid__value">{item.value}</dd>
        {item.detail && <dd className="stat-grid__detail">{item.detail}</dd>}
      </div>
    ))}
  </dl>
)

export default StatGrid
