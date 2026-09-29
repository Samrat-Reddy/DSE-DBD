import { useCallback, useEffect, useRef, useState } from 'react'
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
import { LifecycleTimeline } from '../components/policy'
import {
  ClaimActivityLog,
  ClaimDecisionSummary,
  ClaimDocumentList,
  ClaimPolicyContext,
  ClaimSettlementPanel,
  ClaimWorkflowActions,
  ClaimWorkflowRules,
} from '../components/claims'
import {
  approveClaim,
  assessClaim,
  getClaimById,
  rejectClaim,
  settleClaim,
  transitionClaim,
  verifyClaim,
} from '../services/claimService'
import { useAsync, useDemoRole } from '../hooks'
import {
  CLAIM_STATUS,
  CLAIM_STATUS_LABELS,
  DEMO_ROLE_TITLES,
  ROUTES,
} from '../utils/constants'
import { formatCurrency, formatDate } from '../utils/formatters'
import './Claims.css'

const S = CLAIM_STATUS

/**
 * Service call for each workflow action. Kept as a table so the page never
 * decides what a transition means — it only routes to the service, which
 * applies and enforces the workflow rules.
 */
const ACTIONS = {
  'start-review': (claimId, actor) => transitionClaim(claimId, S.UNDER_REVIEW, actor),
  withdraw: (claimId, actor, payload) => transitionClaim(claimId, S.CANCELLED, actor, { note: payload?.note }),
  verify: (claimId, actor, payload) => verifyClaim(claimId, actor, { note: payload?.note }),
  assess: (claimId, actor, payload) => assessClaim(claimId, payload, actor),
  approve: (claimId, actor) => approveClaim(claimId, actor),
  reject: (claimId, actor, payload) => rejectClaim(claimId, payload?.reason, actor),
  settle: (claimId, actor) => settleClaim(claimId, actor),
}

/** The central claim screen: overview, workflow, context and audit trail. */
const ClaimDetails = () => {
  const { claimId } = useParams()
  const { role } = useDemoRole()
  const record = useAsync(() => getClaimById(claimId), [claimId])

  // The latest details returned by a workflow action, so the page updates in
  // place instead of flashing a loading state after every action.
  const [latest, setLatest] = useState(null)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const feedbackRef = useRef(null)

  const details = latest?.claim.claimId === claimId ? latest : record.data

  useEffect(() => {
    if (feedback) feedbackRef.current?.focus()
  }, [feedback])

  const runAction = useCallback(
    async (kind, payload) => {
      setPending(true)
      setFeedback(null)
      try {
        const next = await ACTIONS[kind](claimId, { role }, payload)
        setLatest(next)
        setFeedback({
          tone: 'success',
          message: `${next.claim.activity.at(-1).label}. Status is now ${CLAIM_STATUS_LABELS[next.claim.status]}.`,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error }
      } finally {
        setPending(false)
      }
    },
    [claimId, role],
  )

  const attemptTransition = useCallback(
    async (toStatus) => {
      setPending(true)
      try {
        const next = await transitionClaim(claimId, toStatus, { role })
        setLatest(next)
        setFeedback({
          tone: 'success',
          message: `${next.claim.activity.at(-1).label}. Status is now ${CLAIM_STATUS_LABELS[next.claim.status]}.`,
        })
        return { ok: true }
      } catch (error) {
        return { ok: false, error }
      } finally {
        setPending(false)
      }
    },
    [claimId, role],
  )

  const breadcrumbs = [{ label: 'Claims', to: ROUTES.CLAIMS }, { label: claimId }]

  if (!details && record.isLoading) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading claim…" />
        <LoadingState label="Loading claim" variant="rows" rows={5} />
      </>
    )
  }

  if (!details && record.isError) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Claim not found" />
        <ErrorState title="We could not open this claim" error={record.error} onRetry={record.reload} />
        <div className="claims__centered-action">
          <Button variant="secondary" to={ROUTES.CLAIMS}>
            Back to claims
          </Button>
        </div>
      </>
    )
  }

  const { claim, claimType, policy } = details

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Claim"
        title={claim.claimTypeLabel}
        meta={
          <>
            <span className="claims__identifier">{claim.claimId}</span>
            <StatusBadge status={claim.status} size="lg" />
            <span>
              {claim.policyholderName ?? 'Policy record unavailable'} · {claim.policyId}
            </span>
          </>
        }
        actions={
          <Button variant="secondary" to={ROUTES.CLAIMS}>
            All claims
          </Button>
        }
      />

      {feedback && (
        <p
          className={`claims__feedback claims__feedback--${feedback.tone}`}
          role="status"
          tabIndex={-1}
          ref={feedbackRef}
        >
          {feedback.message}
        </p>
      )}

      <div className="claim-detail">
        <div className="claim-detail__main">
          <SectionCard id="claim-overview" title="Claim overview">
            <DataList
              columns={3}
              items={[
                { label: 'Claim ID', value: claim.claimId, mono: true },
                { label: 'Claim type', value: claim.claimTypeLabel },
                { label: 'Status', value: <StatusBadge status={claim.status} /> },
                { label: 'Incident date', value: formatDate(claim.incidentDate) },
                { label: 'Filing date', value: formatDate(claim.filingDate) },
                {
                  label: 'Filed by',
                  value: `${claim.filedBy?.name} (${DEMO_ROLE_TITLES[claim.filedBy?.role] ?? claim.filedBy?.role})`,
                },
                { label: 'Claimed amount', value: formatCurrency(claim.claimedAmount) },
                {
                  label: 'Approved amount',
                  value: claim.approvedAmount ? formatCurrency(claim.approvedAmount) : 'Not yet approved',
                },
                {
                  label: 'Assigned to',
                  value: claim.assignedTo ? claim.assignedTo.name : 'Unassigned',
                },
              ]}
            />
          </SectionCard>

          <SectionCard
            id="claim-workflow"
            title="Workflow"
            description="Every stage from submission to settlement."
          >
            <LifecycleTimeline events={details.workflowStages} emptyMessage="No workflow stages recorded." />
          </SectionCard>

          {details.decisionSummary && (
            <SectionCard id="claim-decision" title="Decision summary" description="Rule-based and transparent.">
              <ClaimDecisionSummary summary={details.decisionSummary} />
            </SectionCard>
          )}

          <SectionCard
            id="claim-actions"
            title="Next action"
            description={`Acting as ${DEMO_ROLE_TITLES[role] ?? 'unknown role'} (demo role).`}
          >
            <ClaimWorkflowActions details={details} role={role} onAction={runAction} pending={pending} />
          </SectionCard>

          {claim.status === S.SETTLED && (
            <SectionCard id="claim-settlement" title="Settlement">
              <ClaimSettlementPanel claim={claim} />
            </SectionCard>
          )}

          {claim.status === S.REJECTED && (
            <SectionCard id="claim-rejection" title="Rejection">
              <p className="claims__rejection">
                <strong>Reason:</strong> {claim.rejectionReason}
              </p>
            </SectionCard>
          )}

          <SectionCard id="claim-incident" title="Incident details">
            <DataList
              columns={2}
              items={[
                { label: 'Incident date', value: formatDate(claim.incidentDate) },
                { label: 'Claim type', value: claimType?.label ?? claim.claimType },
                { label: 'Description', value: claim.description, span: true },
              ]}
            />
          </SectionCard>

          <SectionCard id="claim-documents" title="Documents" description="Metadata only.">
            <ClaimDocumentList documents={claim.documents} claimType={claimType} />
          </SectionCard>

          <SectionCard
            id="claim-activity"
            title="Activity history"
            description="Every workflow transition, oldest first."
          >
            <ClaimActivityLog activity={claim.activity} />
          </SectionCard>
        </div>

        <aside className="claim-detail__aside" aria-label="Policy and workflow context">
          <SectionCard id="claim-policy" title="Policy context">
            <ClaimPolicyContext
              policy={policy}
              policyError={details.policyError}
              coverage={details.coverage}
              premium={details.premium}
              claimType={claimType}
            />
          </SectionCard>

          <ClaimWorkflowRules
            key={`${claim.claimId}-${claim.status}`}
            status={claim.status}
            role={role}
            onAttempt={attemptTransition}
            pending={pending}
          />

        </aside>
      </div>
    </>
  )
}

export default ClaimDetails
