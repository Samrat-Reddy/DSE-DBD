import { Link } from 'react-router-dom'
import './PageHeader.css'

/**
 * Consistent page title block.
 *
 * Supports an optional breadcrumb trail, an eyebrow label, a meta strip for
 * identifiers/status, and an action slot on the right.
 *
 * @param {{breadcrumbs?: Array<{label: string, to?: string}>}} props
 */
const PageHeader = ({
  title,
  description,
  eyebrow,
  breadcrumbs = [],
  meta,
  actions,
}) => (
  <div className="page-header">
    {breadcrumbs.length > 0 && (
      <nav className="page-header__breadcrumbs" aria-label="Breadcrumb">
        <ol>
          {breadcrumbs.map((crumb, index) => {
            const isLast = index === breadcrumbs.length - 1

            return (
              <li key={`${crumb.label}-${index}`}>
                {crumb.to && !isLast ? (
                  <Link to={crumb.to}>{crumb.label}</Link>
                ) : (
                  <span aria-current={isLast ? 'page' : undefined}>
                    {crumb.label}
                  </span>
                )}
                {!isLast && (
                  <span className="page-header__crumb-divider" aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>
    )}

    <div className="page-header__main">
      <div className="page-header__text">
        {eyebrow && <p className="page-header__eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title">{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
        {meta && <div className="page-header__meta">{meta}</div>}
      </div>

      {actions && <div className="page-header__actions">{actions}</div>}
    </div>
  </div>
)

export default PageHeader
