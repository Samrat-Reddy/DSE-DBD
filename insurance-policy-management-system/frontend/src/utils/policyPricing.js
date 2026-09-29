/**
 * Indicative premium display maths.
 *
 * NOT actuarial pricing. This exists only so the issuance summary can show a
 * consistent figure when a user changes the coverage amount or the payment
 * frequency. Real rating will come from the FastAPI backend.
 */

import { FREQUENCY_INSTALMENTS_PER_YEAR } from './constants'

/**
 * Scale a product's base annual premium to the chosen coverage amount.
 *
 * @param {object} product Catalog product providing the base rate.
 * @param {number} coverageAmount Requested sum insured.
 * @returns {number} Indicative annual premium, rounded to the rupee.
 */
export const calculateAnnualPremium = (product, coverageAmount) => {
  if (!product) return 0

  const baseCoverage = Number(product.coverageAmount) || 0
  const basePremium = Number(product.premium) || 0
  const requested = Number(coverageAmount)

  if (!baseCoverage || !requested || Number.isNaN(requested)) {
    return basePremium
  }

  return Math.round(basePremium * (requested / baseCoverage))
}

/** Split an annual premium across the instalments implied by a frequency. */
export const calculateInstalmentPremium = (annualPremium, frequency) => {
  const instalments = FREQUENCY_INSTALMENTS_PER_YEAR[frequency] ?? 1
  return Math.round((Number(annualPremium) || 0) / instalments)
}

/**
 * Full indicative premium breakdown for the issuance review step.
 *
 * @returns {{annual: number, instalment: number, instalmentsPerYear: number}}
 */
export const buildPremiumBreakdown = (product, coverageAmount, frequency) => {
  const annual = calculateAnnualPremium(product, coverageAmount)

  return {
    annual,
    instalment: calculateInstalmentPremium(annual, frequency),
    instalmentsPerYear: FREQUENCY_INSTALMENTS_PER_YEAR[frequency] ?? 1,
  }
}

/** Policy end date = start date + duration, minus one day. */
export const calculateEndDate = (startDate, durationYears) => {
  if (!startDate || !durationYears) return null

  const start = new Date(startDate)
  if (Number.isNaN(start.getTime())) return null

  const end = new Date(start)
  end.setFullYear(end.getFullYear() + Number(durationYears))
  end.setDate(end.getDate() - 1)

  return end.toISOString().slice(0, 10)
}
