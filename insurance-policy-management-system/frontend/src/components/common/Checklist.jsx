import './Checklist.css'

const OUTCOME_META = {
  pass: { icon: '✓', label: 'Passed' },
  fail: { icon: '×', label: 'Failed' },
  blocked: { icon: '×', label: 'Blocked' },
  warning: { icon: '!', label: 'Needs attention' },
  skipped: { icon: '–', label: 'Not checked' },
}

/**
 * A list of rule checks with a clear outcome for each.
 *
 * Shared by claim eligibility and verification (Module 3) and renewal
 * readiness (Module 4). The outcome is written out as visually hidden text as
 * well as shown as an icon, so it never depends on colour alone.
 *
 * @param {{checks: Array<{id: string, label: string, outcome: string, detail?: string}>, label?: string}} props
 */
const Checklist = ({ checks = [], label }) => (
  <ul className="checklist" aria-label={label}>
    {checks.map((item) => {
      const meta = OUTCOME_META[item.outcome] ?? OUTCOME_META.skipped
      return (
        <li key={item.id} className={`checklist__item checklist__item--${item.outcome}`}>
          <span className="checklist__icon" aria-hidden="true">
            {meta.icon}
          </span>
          <div className="checklist__text">
            <p className="checklist__label">
              {item.label}
              <span className="sr-only">: {meta.label}.</span>
            </p>
            {item.detail && <p className="checklist__detail">{item.detail}</p>}
          </div>
        </li>
      )
    })}
  </ul>
)

export default Checklist
