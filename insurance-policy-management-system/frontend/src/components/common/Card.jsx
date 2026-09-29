import './Card.css'

/**
 * Simple surface container with an optional title and footer slot.
 */
const Card = ({ title, subtitle, footer, children }) => (
  <section className="ui-card">
    {(title || subtitle) && (
      <header className="ui-card__header">
        {title && <h2 className="ui-card__title">{title}</h2>}
        {subtitle && <p className="ui-card__subtitle">{subtitle}</p>}
      </header>
    )}

    <div className="ui-card__body">{children}</div>

    {footer && <footer className="ui-card__footer">{footer}</footer>}
  </section>
)

export default Card
