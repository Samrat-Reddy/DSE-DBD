import { Button, Card, PageHeader } from '../components/common'
import { projectModules } from '../data'
import { useDemoRole } from '../hooks'
import { buildIssuancePath, ROUTES } from '../utils/constants'
import './Home.css'

/**
 * Project overview screen.
 *
 * Shows which modules are built and which are still planned, and routes into
 * the implemented modules.
 */
const DELIVERED_MODULE_IDS = ['policies', 'premiums', 'claims', 'renewals', 'commission', 'reports']

const Home = () => {
  const { canIssuePolicy, canViewCommissions, canViewReports } = useDemoRole()

  return (
    <>
      <PageHeader
        eyebrow="Insurance Policy Management System"
        title="Project overview"
        description="A university project building an enterprise-style policy administration interface. All six official modules are implemented."
        actions={
          <>
            <Button to={ROUTES.POLICY_CATALOG}>Open policy catalog</Button>
            <Button variant="secondary" to={ROUTES.PREMIUMS}>
              Premiums &amp; payments
            </Button>
            <Button variant="secondary" to={ROUTES.CLAIMS}>
              Claims
            </Button>
            <Button variant="secondary" to={ROUTES.RENEWALS}>
              Renewals
            </Button>
            {canViewCommissions && (
              <Button variant="secondary" to={ROUTES.COMMISSIONS}>
                Agent commission
              </Button>
            )}
            {canViewReports && (
              <Button variant="secondary" to={ROUTES.REPORTS}>
                MIS Reports
              </Button>
            )}
            {canIssuePolicy && (
              <Button variant="secondary" to={buildIssuancePath()}>
                Issue a policy
              </Button>
            )}
          </>
        }
      />

      <div className="home__grid">
        <Card
          title="Module 1 — Policy Catalog & Issuance"
          subtitle="Implemented"
          footer="Browse products, inspect coverage and lifecycle, and issue a policy."
        >
          <ul className="home__list">
            <li>Policy catalog with search, filters and sorting</li>
            <li>Policy details with coverage, documents and lifecycle</li>
            <li>Multi-step issuance workflow with validation</li>
          </ul>
        </Card>

        <Card
          title="Module 2 — Premium Schedule & Payments"
          subtitle="Implemented"
          footer="Payments are simulated. No money moves and no provider is contacted."
        >
          <ul className="home__list">
            <li>Premium position with overdue, due and upcoming totals</li>
            <li>Per-policy schedules with instalment status tracking</li>
            <li>Mock payment flow, payment history and payment records</li>
          </ul>
        </Card>

        <Card
          title="Module 3 — Claim Filing & Approval Workflow"
          subtitle="Implemented"
          footer="Illustrative workflow. No real adjudication or settlement takes place."
        >
          <ul className="home__list">
            <li>Explicit claim eligibility checks per policy</li>
            <li>Enforced workflow from submission to settlement</li>
            <li>Verification, assessment, decisions and audit trail</li>
          </ul>
        </Card>

        <Card
          title="Module 4 — Renewal Reminder Engine"
          subtitle="Implemented"
          footer="Reminders are simulated. No message is sent and no policy is renewed."
        >
          <ul className="home__list">
            <li>Renewal status derived from expiry and the engine date</li>
            <li>Staged reminder schedule with duplicate prevention</li>
            <li>Reminder check, failure, retry, readiness and history</li>
          </ul>
        </Card>

        <Card
          title="Module 5 — Agent Commission"
          subtitle="Implemented"
          footer="Commission is simulated. No payout is made and no bank is contacted."
        >
          <ul className="home__list">
            <li>Commission generated from successful premium payments</li>
            <li>Explicit, explainable rates by product, agent and period</li>
            <li>Pending, earned and paid lifecycle with an audit trail</li>
          </ul>
        </Card>

        <Card
          title="Module 6 — MIS Reports"
          subtitle="Implemented"
          footer="Management reports derived from Modules 1 to 5. Administrators only."
        >
          <ul className="home__list">
            <li>Policy, premium, claim, renewal and commission reports</li>
            <li>Reporting periods, filters and CSV export</li>
            <li>Every figure derived from existing records</li>
          </ul>
        </Card>

        <Card
          title="Official module scope"
          subtitle={`${DELIVERED_MODULE_IDS.length} of ${projectModules.length} modules implemented`}
        >
          <ul className="home__list">
            {projectModules.map((module) => (
              <li key={module.id}>
                {module.name}{' '}
                <span className="home__tag">
                  {DELIVERED_MODULE_IDS.includes(module.id) ? 'implemented' : module.status}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          title="Architecture"
          subtitle="How data reaches the screen"
          footer="Mock data is swapped for FastAPI inside the service layer alone."
        >
          <p className="home__flow">
            React <span aria-hidden="true">→</span> Service layer{' '}
            <span aria-hidden="true">→</span> Mock data
          </p>
          <p className="home__note">
            Components never call the network directly, and no API URL is
            hardcoded outside configuration.
          </p>
        </Card>
      </div>
    </>
  )
}

export default Home
