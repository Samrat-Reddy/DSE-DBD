import { Link, useParams } from 'react-router-dom'
import {
  Button,
  DataList,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
} from '../components/common'
import {
  FinancialSummary,
  PaymentHistoryList,
  PremiumScheduleTable,
} from '../components/premium'
import { getPremiumScheduleByPolicyId } from '../services/premiumService'
import { useAsync, useDemoRole } from '../hooks'
import {
  buildPolicyDetailsPath,
  buildPremiumPaymentPath,
  ROUTES,
} from '../utils/constants'
import { formatDate } from '../utils/formatters'
import './Premiums.css'

/**
 * Financial state of one policy: summary, full schedule and its payments.
 *
 * Policy status and premium standing are shown as two separately labelled
 * badges, because an ACTIVE policy can perfectly well have an OVERDUE premium.
 */
const PolicyPremiumDetails = () => {
  const { policyId } = useParams()
  const { canRecordPayment } = useDemoRole()
  const account = useAsync(() => getPremiumScheduleByPolicyId(policyId), [policyId])

  const breadcrumbs = [
    { label: 'Premiums & payments', to: ROUTES.PREMIUMS },
    { label: policyId },
  ]

  if (account.isLoading) {
    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Loading premium schedule…" />
        <LoadingState label="Loading premium schedule" variant="rows" rows={5} />
      </>
    )
  }

  if (account.isError) {
    // A policy that exists but is not issued yet is a normal state, not a failure.
    if (account.error?.status === 409) {
      return (
        <>
          <PageHeader breadcrumbs={breadcrumbs} title="No premium schedule yet" />
          <EmptyState
            icon="◷"
            title="This policy has not been issued"
            description={account.error.message}
            action={
              <Button variant="secondary" to={buildPolicyDetailsPath(policyId)}>
                View policy record
              </Button>
            }
          />
        </>
      )
    }

    return (
      <>
        <PageHeader breadcrumbs={breadcrumbs} title="Premium schedule not found" />
        <ErrorState
          title="We could not open this premium schedule"
          error={account.error}
          onRetry={account.reload}
        />
        <div className="premiums__centered-action">
          <Button variant="secondary" to={ROUTES.PREMIUMS}>
            Back to premiums & payments
          </Button>
        </div>
      </>
    )
  }

  const data = account.data
  const { policy, summary } = data
  const hasPayable = summary.payableNow > 0

  return (
    <>
      <PageHeader
        breadcrumbs={breadcrumbs}
        eyebrow="Premium schedule"
        title={policy?.productName ?? 'Unlinked premium schedule'}
        meta={
          <>
            <span className="premiums__identifier">{data.policyId}</span>
            {policy && (
              <span className="premiums__labelled-badge">
                Policy status <StatusBadge status={policy.status} />
              </span>
            )}
            <span className="premiums__labelled-badge">
              Premium standing <StatusBadge status={summary.standing} />
            </span>
          </>
        }
        actions={
          <>
            {canRecordPayment && hasPayable && (
              <Button to={buildPremiumPaymentPath(data.policyId)}>Pay premium</Button>
            )}
            {policy && (
              <Button variant="secondary" to={buildPolicyDetailsPath(data.policyId)}>
                View policy
              </Button>
            )}
          </>
        }
      />

      <div className="premiums__stack">
        {data.isOrphaned && (
          <div className="premiums__warning" role="note">
            <strong>Policy record unavailable.</strong> This schedule refers to policy{' '}
            {data.policyId}, which is not in the policy store. Premium figures are shown from the
            schedule itself; policyholder details cannot be displayed.
          </div>
        )}

        <SectionCard
          id="premium-policy-summary"
          title="Policy summary"
          description="The issued policy this schedule belongs to."
        >
          <DataList
            columns={3}
            items={[
              {
                label: 'Policy number',
                value: policy ? (
                  <Link to={buildPolicyDetailsPath(data.policyId)}>{data.policyId}</Link>
                ) : (
                  data.policyId
                ),
                mono: true,
              },
              { label: 'Product', value: policy?.productName ?? null },
              {
                label: 'Policyholder',
                value: policy?.policyholderName
                  ? `${policy.policyholderName} (${policy.customerId})`
                  : null,
              },
              {
                label: 'Policy status',
                value: policy ? <StatusBadge status={policy.status} /> : null,
              },
              {
                label: 'Policy period',
                value: `${formatDate(data.startDate)} – ${formatDate(data.endDate)}`,
              },
              { label: 'Schedule ID', value: data.scheduleId, mono: true },
            ]}
          />
        </SectionCard>

        <SectionCard
          id="premium-financial-summary"
          title="Financial summary"
          description={`Calculated as of ${formatDate(data.asOf)}.`}
        >
          <FinancialSummary account={data} canRecordPayment={canRecordPayment} />
        </SectionCard>

        <SectionCard
          id="premium-schedule"
          title="Premium schedule"
          description="Every instalment in due-date order."
        >
          <PremiumScheduleTable
            installments={data.installments}
            policyId={data.policyId}
            canRecordPayment={canRecordPayment}
          />
        </SectionCard>

        <SectionCard
          id="premium-payments"
          title="Payments for this policy"
          description="Every mock payment attempt, newest first."
          actions={
            <Button variant="ghost" size="sm" to={ROUTES.PAYMENT_HISTORY}>
              All payments
            </Button>
          }
        >
          {data.payments.length ? (
            <PaymentHistoryList payments={data.payments} showPolicy={false} />
          ) : (
            <p className="premiums__muted">No payments have been recorded for this policy yet.</p>
          )}
        </SectionCard>
      </div>
    </>
  )
}

export default PolicyPremiumDetails
