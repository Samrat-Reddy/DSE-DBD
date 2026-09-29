import './SectionCard.css'

/**
 * Titled panel used to separate the Policy Details sections (customer,
 * coverage, financial, documents, lifecycle, status).
 *
 * Each panel is a landmark `<section>` labelled by its heading, which keeps
 * the detail page navigable by screen reader and gives Policy 360 a clean
 * slot to extend later.
 */
const SectionCard = ({
  title,
  description,
  actions,
  id,
  children,
  className = '',
}) => {
  const headingId = id ? `${id}-heading` : undefined

  return (
    <section
      className={`section-card ${className}`.trim()}
      id={id}
      aria-labelledby={headingId}
    >
      <header className="section-card__header">
        <div className="section-card__heading">
          <h2 className="section-card__title" id={headingId}>
            {title}
          </h2>
          {description && (
            <p className="section-card__description">{description}</p>
          )}
        </div>
        {actions && <div className="section-card__actions">{actions}</div>}
      </header>

      <div className="section-card__body">{children}</div>
    </section>
  )
}

export default SectionCard
