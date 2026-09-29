import { useParams } from 'react-router-dom'
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
} from '../components/common'
import { PolicyIssuanceForm } from '../components/issuance'
import { getPolicyProducts } from '../services/policyService'
import { useAsync, useDemoRole } from '../hooks'
import { PRODUCT_STATUS, ROUTES } from '../utils/constants'
import './PolicyIssuance.css'

/**
 * Policy issuance workflow page.
 *
 * Responsible for loading the issuable product list and for the role gate;
 * the wizard itself owns the step and form state.
 */
const PolicyIssuance = () => {
  const { productId } = useParams()
  const { canIssuePolicy, role } = useDemoRole()

  // Only products open for new business can be issued.
  const products = useAsync(
    () => getPolicyProducts({ status: PRODUCT_STATUS.ACTIVE, sort: 'name-asc' }),
    [],
  )

  const header = (
    <PageHeader
      breadcrumbs={[
        { label: 'Policies', to: ROUTES.POLICY_CATALOG },
        { label: 'Issue policy' },
      ]}
      eyebrow="Module 1 · Policy Catalog & Issuance"
      title="Issue a policy"
      description="Capture the proposal, confirm the details, and issue the policy."
      actions={
        <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
          Cancel
        </Button>
      }
    />
  )

  // ---- Role gate (demo only, not authentication) ----
  if (!canIssuePolicy) {
    return (
      <>
        {header}
        <EmptyState
          icon="⛔"
          title="Issuance is not available for this role"
          description={`The demo role is set to ${role ?? 'unknown'}. Switch to Agent or Administrator in the header to use the issuance workflow.`}
          action={
            <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
              Back to catalog
            </Button>
          }
        />
      </>
    )
  }

  if (products.isLoading) {
    return (
      <>
        {header}
        <LoadingState label="Loading issuable products" variant="rows" rows={4} />
      </>
    )
  }

  if (products.isError) {
    return (
      <>
        {header}
        <ErrorState
          title="Unable to start the issuance workflow"
          error={products.error}
          onRetry={products.reload}
        />
      </>
    )
  }

  const issuableProducts = products.data?.items ?? []

  if (!issuableProducts.length) {
    return (
      <>
        {header}
        <EmptyState
          title="No products are open for new business"
          description="Every product in the catalog is currently inactive, so no policy can be issued."
          action={
            <Button variant="secondary" to={ROUTES.POLICY_CATALOG}>
              Back to catalog
            </Button>
          }
        />
      </>
    )
  }

  // A product ID in the URL only preselects if it is actually issuable.
  const preselectedId = issuableProducts.some((item) => item.id === productId)
    ? productId
    : null

  return (
    <>
      {header}
      <PolicyIssuanceForm
        products={issuableProducts}
        initialProductId={preselectedId}
      />
    </>
  )
}

export default PolicyIssuance
