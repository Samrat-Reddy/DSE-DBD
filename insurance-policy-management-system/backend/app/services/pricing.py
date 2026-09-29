"""Indicative premium rating, owned by the backend.

Same formula the frontend previews with (frontend/src/utils/policyPricing.js):
the product's base annual premium scales linearly with the chosen coverage,
and each amount is rounded half-up to whole rupees.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.models import PremiumFrequency, Product

WHOLE_RUPEE = Decimal("1")
CENTS = Decimal("0.01")


def _to_rupees(amount: Decimal) -> Decimal:
    """Round half-up to whole rupees, kept at 2 decimal places like stored money."""
    return amount.quantize(WHOLE_RUPEE, rounding=ROUND_HALF_UP).quantize(CENTS)


def rate_annual_premium(product: Product, coverage_amount: Decimal) -> Decimal:
    scaled = product.base_annual_premium * coverage_amount / product.reference_coverage_amount
    return _to_rupees(scaled)


def instalment_premium(annual_premium: Decimal, frequency: PremiumFrequency) -> Decimal:
    return _to_rupees(annual_premium / frequency.instalments_per_year)
