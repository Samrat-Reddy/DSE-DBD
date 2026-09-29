import { useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
} from '../components/common'
import {
  ClaimEligibilityPanel,
  ClaimFilingForm,
  ClaimFilingSuccess,
  PolicyClaimPicker,
} from '../components/claims'
import { getClaimFilingContext, getEligiblePoliciesForClaim } from '../services/claimService'
import { useAsync, useDemoRole } from '../hooks'
import { buildClaimFilingPath, DEMO_ROLE_TITLES, ROUTES } from '../utils/constants'
import './Claims.css'

/**
 * Claim filing.
 *
 *   /claims/file            choose a policy (every policy shows eligibility)
 *   /claims/file/:policyId  eligibility for that policy, then the claim form
 *
 * Eligibility and form rules are re-checked by the service on submission.
 */
const ClaimFiling = () => {
  const { policyId } = useParams()
  const { role, canFileClaim } = useDemoRole()
  const [filed, setFiled] = useState(null)

  const policies = useAsync(() => getEligiblePoliciesForClaim(), [], {
    enabled: canFileClaim && !policyId,
  })
  const context = useAsync(() => getClaimFilingContext(policyId), [policyId], {
    enabled: canFileClaim && Boolean(policyId),
  })

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: 'Claims', to: ROUTES.CLAIMS },
        ...(policyId ? [{ label: 'File a claim', to: buildClaimFilingPath() }, { label: policyId }] : [{ label: 'File a claim' }]),
      ]}
      eyebrow="Module 3 · Claim Filing & Approval Workflow"
      title="File a claim"
      description={
        policyId
          ? 'Check eligibility, then describe the incident and record the supporting documents.'
          : 'Choose the policy the claim is for. Each policy shows whether a claim can be filed against it.'
      }
      actions={
        <Button variant="secondary" to={ROUTES.CLAIMS}>
          Cancel
        </Button>
      }
    />
  )

  // ---- Demo role gate (not authentication; the service also enforces it) ----
  if (!canFileClaim) {
    return (
      <>
        {header}
        <EmptyState
          icon="⛔"
          title="Claims officers do not file claims"
          description={`The demo role is set to ${DEMO_ROLE_TITLES[role] ?? 'unknown'}. Claims are filed by the policyholder or by their agent, so the person who files a claim is never the person who approves it. Switch the demo role to Policyholder or Agent to file a claim.`}
          action={
            <Button variant="secondary" to={ROUTES.CLAIMS}>
              Back to claims
            </Button>
          }
        />
      </>
    )
  }

  if (filed) {
    return (
      <>
        {header}
        <ClaimFilingSuccess details={filed} />
      </>
    )
  }

  // ---- Step 1: choose a policy ----
  if (!policyId) {
    if (policies.isLoading) {
      return (
        <>
          {header}
          <LoadingState label="Checking policy eligibility" variant="rows" rows={4} />
        </>
      )
    }
    if (policies.isError) {
      return (
        <>
          {header}
          <ErrorState title="Unable to load policies" error={policies.error} onRetry={policies.reload} />
        </>
      )
    }
    if (!policies.data.items.length) {
      return (
        <>
          {header}
          <EmptyState
            title="No issued policies"
            description="A claim can only be filed against an issued policy."
            action={<Button to={ROUTES.POLICY_CATALOG}>Go to policy catalog</Button>}
          />
        </>
      )
    }
    return (
      <>
        {header}
        <p className="claims__role-note">
          {policies.data.eligibleCount === 1
            ? '1 policy is currently eligible for a claim.'
            : `${policies.data.eligibleCount} policies are currently eligible for a claim.`}{' '}
          Ineligible policies are listed with the reason.
        </p>
        <PolicyClaimPicker items={policies.data.items} />
      </>
    )
  }

  // ---- Step 2: eligibility and form ----
  if (context.isLoading) {
    return (
      <>
        {header}
        <LoadingState label="Checking claim eligibility" variant="rows" rows={4} />
      </>
    )
  }

  if (context.isError) {
    return (
      <>
        {header}
        <ErrorState
          title={context.error?.status === 404 ? 'Policy not found' : 'Unable to check eligibility'}
          error={context.error}
          onRetry={context.error?.status === 404 ? undefined : context.reload}
        />
        <div className="claims__centered-action">
          <Button variant="secondary" to={buildClaimFilingPath()}>
            Choose another policy
          </Button>
        </div>
      </>
    )
  }

  const { eligibility } = context.data

  return (
    <>
      {header}
      <div className="claims__stack">
        <SectionCard
          id="claim-eligibility"
          title="Claim eligibility"
          description={`${context.data.policy.id} · ${context.data.policy.productName}`}
        >
          <ClaimEligibilityPanel eligibility={eligibility} />
        </SectionCard>

        {eligibility.eligible ? (
          <ClaimFilingForm context={context.data} role={role} onFiled={setFiled} />
        ) : (
          <div className="claims__centered-action">
            <Button variant="secondary" to={buildClaimFilingPath()}>
              Choose another policy
            </Button>
          </div>
        )}
      </div>
    </>
  )
}

export default ClaimFiling
