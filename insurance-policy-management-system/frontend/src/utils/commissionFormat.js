/**
 * Display text for commission runs (Module 5). Pure, so it is unit tested.
 */

import { formatCurrency } from './formatters'

const plural = (count, singular) => `${count} ${count === 1 ? singular : `${singular}s`}`

/** Summary of a "generate eligible commission" run. */
export const describeGenerationResult = (run) =>
  run.generated.length
    ? `Generated ${plural(run.generated.length, 'commission')}: ${run.generated
        .map((item) => `${item.commissionId} (${formatCurrency(item.amount)})`)
        .join(', ')}.`
    : 'No new commission was generated. Every eligible payment already has one.'

/** Summary of a "confirm eligible earnings" run. */
export const describeEarningResult = (run) => {
  const parts = [
    run.earned.length
      ? `Confirmed ${plural(run.earned.length, 'commission')} as earned: ${run.earned.join(', ')}.`
      : 'No pending commission was ready to be earned.',
  ]
  if (run.held.length) parts.push(`${plural(run.held.length, 'commission')} still in the earning hold.`)
  return parts.join(' ')
}
