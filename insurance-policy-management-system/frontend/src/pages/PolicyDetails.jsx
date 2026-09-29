import { useParams } from 'react-router-dom'
import {
  Button,
  DataList,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/common'
import {
  CoverageSection,
  CustomerSummary,
  LifecycleTimeline,
  PolicyDocumentList,
  PolicySummary,
} from '../components/policy'
import { getPolicyRecordById } from '../services/policyService'
import { useAsync, useDemoRole } from '../hooks'
import {
  buildIssuancePath,
  buildClaimFilingPath,
  buildPolicyPremiumsPath,
  PRODUCT_STATUS,
  ROUTES,
} from '../utils/constants'
import { formatDate, formatDuration } from '../utils/formatters'
import { isPolicyScheduleEligible } from '../utils/premiumCalculations'
import './PolicyDetails.css'

/**
 * Policy Details — serves both a catalog product and an issued policy.
 *
 * Sections are deliberately separated (status, financial, customer, coverage,
 * documents, lifecycle) so the Policy 360 view can later add panels without
 * restructuring this page. No scoring or risk logic lives here.
 */
const PolicyDetails = () => {
  const { id } = useParams()
  const { role, canIssuePolicy, canFileClaim } = useDemoRole()

  // The role is part of the key: whether an issued policy is visible depends on who asks.
  const record = useAsync(() => getPolicyRecordById(id), [id, role])

  if (record.isLoading) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: 'Policies', to: ROUTES.POLICY_CATALOG },
            { label: id },
          ]}
          title="Loading policy…"
        />
        <LoadingState label="Loading policy details" variant="rows" rows={4} />
      </>
    )
  }

  if (record.isError) {
    return (
      <>
        <PageHeader
          breadcrumbs={[
            { label: 'Policies', to: ROUTES.POLICY_CATALOG },
            { label: id },
          ]}
          title="Policy not found"
        />
        <ErrorState
          title="We could not open this record"
          error={record.error}
          onRetry={record.reload}
        />
        <div className="policy-detail__error-action">
          <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
            Back to catalog
          </Button>
        </div>
      </>
    )
  }

  const { kind, policy, product } = record.data
  const isIssued = kind === 'policy'
  const headline = isIssued ? policy : product
  const displayName = isIssued ? policy.productName : product.name

  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Policies', to: ROUTES.POLICY_CATALOG },
          { label: isIssued ? policy.id : product.id },
        ]}
        eyebrow={isIssued ? 'Issued policy' : 'Catalog product'}
        title={displayName}
        description={isIssued ? undefined : product.tagline}
        meta={
          <>
            <span className="policy-detail__identifier">
              {isIssued ? policy.id : product.id}
            </span>
            <span>{headline.type}</span>
            <StatusBadge status={headline.status} size="lg" />
            {isIssued && policy.isSessionIssued && (
              <span className="policy-detail__session-tag">
                Issued in this session
              </span>
            )}
          </>
        }
        actions={
          !isIssued &&
          canIssuePolicy &&
          product.status === PRODUCT_STATUS.ACTIVE ? (
            <Button to={buildIssuancePath(product.id)}>Issue this policy</Button>
          ) : (
            <>
              {/* Module 2 integration: an issued policy links to its premiums. */}
              {isIssued && isPolicyScheduleEligible(policy) && (
                <Button to={buildPolicyPremiumsPath(policy.id)}>Premium schedule</Button>
              )}
              {/* Module 3 integration: claims are filed against issued policies. */}
              {isIssued && canFileClaim && isPolicyScheduleEligible(policy) && (
                <Button variant="secondary" to={buildClaimFilingPath(policy.id)}>File a claim</Button>
              )}
              <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
                Back to catalog
              </Button>
            </>
          )
        }
      />

      <div className="policy-detail">
        {/* ---- Financial / overview ---- */}
        <SectionCard
          id="overview"
          title="Policy overview"
          description={
            isIssued
              ? 'Key financial terms of this policy.'
              : 'Headline terms offered by this product.'
          }
        >
          <PolicySummary record={headline} />
        </SectionCard>

        {/* ---- Policy information (issued only) ---- */}
        {isIssued && (
          <SectionCard
            id="policy-information"
            title="Policy information"
            description="Issuance, cover period and servicing agent."
          >
            <DataList
              columns={3}
              items={[
                { label: 'Policy number', value: policy.id, mono: true },
                { label: 'Product ID', value: policy.productId, mono: true },
                {
                  label: 'Policy status',
                  value: <StatusBadge status={policy.status} />,
                },
                { label: 'Issue date', value: formatDate(policy.issueDate) },
                { label: 'Start date', value: formatDate(policy.startDate) },
                { label: 'End date', value: formatDate(policy.endDate) },
                {
                  label: 'Duration',
                  value: formatDuration(policy.durationYears),
                },
                { label: 'Servicing agent', value: policy.agent?.name },
                {
                  label: 'Agent ID / branch',
                  value: policy.agent
                    ? `${policy.agent.id} · ${policy.agent.branch}`
                    : null,
                },
              ]}
            />
          </SectionCard>
        )}

        {/* ---- Customer ---- */}
        {isIssued && (
          <SectionCard
            id="policyholder"
            title="Policyholder information"
            description="The insured person and their registered nominee."
          >
            <CustomerSummary
              policyholder={policy.policyholder}
              nominee={policy.nominee}
            />
          </SectionCard>
        )}

        {/* ---- Coverage ---- */}
        <SectionCard
          id="coverage"
          title="Coverage"
          description="Benefits, limits, exclusions and eligibility."
        >
          <CoverageSection product={product} />
        </SectionCard>

        {/* ---- Documents ---- */}
        {isIssued && (
          <SectionCard
            id="documents"
            title="Documents"
            description="Records held against this policy."
          >
            <PolicyDocumentList documents={policy.documents} />
          </SectionCard>
        )}

        {/* ---- Lifecycle ---- */}
        {isIssued ? (
          <SectionCard
            id="lifecycle"
            title="Activity and lifecycle"
            description="Chronological record of this policy from application to issuance."
          >
            <LifecycleTimeline events={policy.lifecycle} />
          </SectionCard>
        ) : (
          <SectionCard
            id="lifecycle"
            title="Issuance lifecycle"
            description="The stages a policy moves through once issued from this product."
          >
            <LifecycleTimeline
              events={[
                { stage: 'Application Submitted', status: 'upcoming', note: 'Proposal captured from the policyholder.' },
                { stage: 'Underwriting Completed', status: 'upcoming', note: 'Risk assessed and rated.' },
                { stage: 'Policy Approved', status: 'upcoming', note: 'Approved by the underwriting desk.' },
                { stage: 'Policy Issued', status: 'upcoming', note: 'Policy number generated and schedule issued.' },
              ]}
            />
            <p className="policy-detail__muted policy-detail__lifecycle-note">
              No policy has been issued from this product in this view. Issue a
              policy to record real lifecycle activity.
            </p>
          </SectionCard>
        )}
      </div>
    </>
  )
}

export default PolicyDetails
