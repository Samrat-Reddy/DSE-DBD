/**
 * Test-only stand-in for the Module 1 policy register, for the Module 2–6 suites.
 *
 * Module 1 now issues policies through the FastAPI backend into MySQL, but
 * Modules 2–6 still read the mock policy register (`mockPolicyStore`) until
 * their own migrations. Their "newly issued policy" scenarios therefore add a
 * policy to that register directly, in exactly the shape the former mock
 * issuance produced, so those modules keep their coverage.
 *
 * Load it through the same harness as the module under test so both share
 * one `mockPolicyStore` instance.
 */

export const loadMockPolicyRegister = async (harness) => {
  const store = await harness.load('/src/services/mockPolicyStore.js')
  const { policyProducts } = await harness.load('/src/data/policyProducts.js')
  const pricing = await harness.load('/src/utils/policyPricing.js')
  const { POLICY_STATUS } = await harness.load('/src/utils/constants.js')

  const issuePolicy = async ({ productId, values }) => {
    const product = policyProducts.find((item) => item.id === productId)
    if (!product) throw new Error(`Unknown product ${productId}`)

    const id = store.generatePolicyId()
    const today = new Date().toISOString().slice(0, 10)
    const coverageAmount = Number(values.coverageAmount)
    const durationYears = Number(values.durationYears)
    const annualPremium = pricing.calculateAnnualPremium(product, coverageAmount)

    const policy = {
      id,
      productId: product.id,
      productName: product.name,
      type: product.type,
      status: POLICY_STATUS.ACTIVE,
      coverageAmount,
      premium: pricing.calculateInstalmentPremium(annualPremium, values.premiumFrequency),
      annualPremium,
      premiumFrequency: values.premiumFrequency,
      durationYears,
      issueDate: today,
      startDate: values.startDate,
      endDate: pricing.calculateEndDate(values.startDate, durationYears),
      policyholder: {
        name: values.fullName.trim(),
        customerId: values.customerId.trim() || store.generateCustomerId(),
        dateOfBirth: values.dateOfBirth,
        email: values.email.trim(),
        phone: values.phone.trim(),
        address: {
          line1: values.addressLine1.trim(),
          line2: values.addressLine2.trim(),
          city: values.city.trim(),
          state: values.state.trim(),
          postalCode: values.postalCode.trim(),
        },
      },
      nominee: {
        name: values.nomineeName.trim(),
        relationship: values.nomineeRelationship,
        dateOfBirth: values.nomineeDateOfBirth,
      },
      agent: { id: 'AGT-0000', name: 'Demo Issuing User', branch: 'Demo Branch', email: 'demo.user@example.com' },
      documents: [],
      lifecycle: [],
      isSessionIssued: true,
    }

    store.addPolicy(policy)
    return JSON.parse(JSON.stringify(policy))
  }

  const clone = (value) => JSON.parse(JSON.stringify(value))

  /** The register as Modules 2–6 see it (seed book plus policies added here). */
  const getIssuedPolicies = async () => {
    const items = store.getAllPolicies()
    return { items: clone(items), total: items.length }
  }

  const getIssuedPolicyById = async (id) => {
    const policy = store.findPolicyById(id)
    if (!policy) throw new Error(`No policy ${id} in the mock register`)
    return clone(policy)
  }

  return { issuePolicy, getIssuedPolicies, getIssuedPolicyById }
}
