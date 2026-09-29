import { useCallback, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  APP_META,
  ROLE_OPTIONS,
  ROLES,
  ROLES_ALLOWED_TO_ISSUE,
  ROLES_ALLOWED_TO_VIEW_COMMISSIONS,
  ROLES_ALLOWED_TO_VIEW_REPORTS,
  ROUTES,
} from '../utils/constants'
import { readStoredDemoRole, storeDemoRole } from '../utils/demoRole'
import './MainLayout.css'

/**
 * Shell shared by every routed page.
 *
 * Holds the demo role and passes it down through the router outlet, which
 * avoids a global store while still letting pages adapt. This is a
 * development convenience, NOT authentication.
 */
const MainLayout = () => {
  const [role, setRole] = useState(readStoredDemoRole)

  const handleRoleChange = useCallback((event) => {
    // Persist before re-rendering: pages refetch as the new role in their
    // effects, and the backend sign-in bridge reads the stored role.
    storeDemoRole(event.target.value)
    setRole(event.target.value)
  }, [])

  const canIssue = ROLES_ALLOWED_TO_ISSUE.includes(role)
  const canViewCommissions = ROLES_ALLOWED_TO_VIEW_COMMISSIONS.includes(role)
  const canViewReports = ROLES_ALLOWED_TO_VIEW_REPORTS.includes(role)

  const navLinkClass = ({ isActive }) =>
    `main-nav__link${isActive ? ' main-nav__link--active' : ''}`

  return (
    <div className="main-layout">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="main-layout__header">
        <div className="main-layout__bar">
          <div className="main-layout__brand">
            <span className="main-layout__mark" aria-hidden="true">
              {APP_META.shortName}
            </span>
            <span className="main-layout__brand-text">
              <span className="main-layout__brand-name">{APP_META.name}</span>
              <span className="main-layout__brand-sub">
                Policy operations console
              </span>
            </span>
          </div>

          <div className="main-layout__role">
            <label className="main-layout__role-label" htmlFor="demo-role">
              Demo role
            </label>
            <select
              id="demo-role"
              className="main-layout__role-select"
              value={role}
              onChange={handleRoleChange}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <nav className="main-nav" aria-label="Primary">
          <div className="main-nav__inner">
            <NavLink to={ROUTES.HOME} className={navLinkClass} end>
              Overview
            </NavLink>
            <NavLink to={ROUTES.POLICY_CATALOG} className={navLinkClass}>
              Policy catalog
            </NavLink>
            {canIssue && (
              <NavLink to={ROUTES.POLICY_ISSUANCE} className={navLinkClass}>
                Issue policy
              </NavLink>
            )}
            <NavLink to={ROUTES.PREMIUMS} className={navLinkClass}>
              Premiums &amp; payments
            </NavLink>
            <NavLink to={ROUTES.CLAIMS} className={navLinkClass}>
              Claims
            </NavLink>
            <NavLink to={ROUTES.RENEWALS} className={navLinkClass}>
              Renewals
            </NavLink>
            {canViewCommissions && (
              <NavLink to={ROUTES.COMMISSIONS} className={navLinkClass}>
                Agent commission
              </NavLink>
            )}
            {canViewReports && (
              <NavLink to={ROUTES.REPORTS} className={navLinkClass}>
                MIS Reports
              </NavLink>
            )}
          </div>
        </nav>
      </header>

      <main className="main-layout__content" id="main-content">
        <Outlet context={{ role, setRole }} />
      </main>

      <footer className="main-layout__footer">
        <span>
          {APP_META.name} · v{APP_META.version}
        </span>
        <span className="main-layout__footer-note">
          Demonstration data only. No real policies or customers are
          represented.
        </span>
      </footer>
    </div>
  )
}

export default MainLayout
