import './CoverageSection.css'

/**
 * Coverage items with limits, major exclusions, eligibility and benefits.
 *
 * Shared by the product view and the issued-policy view, so coverage always
 * reads the same way regardless of how the page was reached.
 */
const CoverageSection = ({ product }) => {
  if (!product) {
    return (
      <p className="coverage__unavailable">
        Coverage details are unavailable because the originating product could
        not be found in the catalog.
      </p>
    )
  }

  const { coverageItems = [], exclusions = [], benefits = [], eligibility } = product

  return (
    <div className="coverage">
      <div className="coverage__block">
        <h3 className="coverage__subtitle">Coverage items and limits</h3>
        {coverageItems.length ? (
          <div className="coverage__table-wrap">
            <table className="coverage__table">
              <caption className="sr-only">
                Coverage items and their limits for {product.name}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Benefit</th>
                  <th scope="col">Limit</th>
                </tr>
              </thead>
              <tbody>
                {coverageItems.map((item) => (
                  <tr key={item.name}>
                    <th scope="row">{item.name}</th>
                    <td>{item.limit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="coverage__muted">No coverage items listed.</p>
        )}
      </div>

      <div className="coverage__grid">
        <div className="coverage__block">
          <h3 className="coverage__subtitle">Key benefits</h3>
          {benefits.length ? (
            <ul className="coverage__list coverage__list--positive">
              {benefits.map((benefit) => (
                <li key={benefit}>{benefit}</li>
              ))}
            </ul>
          ) : (
            <p className="coverage__muted">No benefits listed.</p>
          )}
        </div>

        <div className="coverage__block">
          <h3 className="coverage__subtitle">Major exclusions</h3>
          {exclusions.length ? (
            <ul className="coverage__list coverage__list--negative">
              {exclusions.map((exclusion) => (
                <li key={exclusion}>{exclusion}</li>
              ))}
            </ul>
          ) : (
            <p className="coverage__muted">No exclusions listed.</p>
          )}
        </div>
      </div>

      {eligibility && (
        <div className="coverage__block coverage__eligibility">
          <h3 className="coverage__subtitle">Eligibility</h3>
          <p className="coverage__eligibility-summary">{eligibility.summary}</p>

          <div className="coverage__eligibility-meta">
            <span>
              <strong>Entry age:</strong> {eligibility.minAge}–{eligibility.maxAge} years
            </span>
            {product.waitingPeriod && (
              <span>
                <strong>Waiting period:</strong> {product.waitingPeriod}
              </span>
            )}
          </div>

          {eligibility.criteria?.length ? (
            <ul className="coverage__list">
              {eligibility.criteria.map((criterion) => (
                <li key={criterion}>{criterion}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  )
}

export default CoverageSection
