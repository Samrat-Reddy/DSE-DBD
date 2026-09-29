"""Indicative premium rating, owned by the backend.

Same formula the frontend previews with (frontend/src/utils/policyPricing.js):
the product's base annual premium scales linearly with the chosen coverage,
rounded half-up to whole rupees. The per-instalment amount follows the
premium schedule's split rule (app.services.premium_rules), so the premium a
policy displays is exactly what its schedule charges.
"""

from decimal import ROUND_HALF_UP, Decimal

from app.models import PremiumFrequency, Product
from app.services.premium_rules import regular_installment_amount

WHOLE_RUPEE = Decimal("1")
CENTS = Decimal("0.01")


def _to_rupees(amount: Decimal) -> Decimal:
    """Round half-up to whole rupees, kept at 2 decimal places like stored money."""
    return amount.quantize(WHOLE_RUPEE, rounding=ROUND_HALF_UP).quantize(CENTS)


def rate_annual_premium(product: Product, coverage_amount: Decimal) -> Decimal:
    scaled = product.base_annual_premium * coverage_amount / product.reference_coverage_amount
    return _to_rupees(scaled)


def instalment_premium(annual_premium: Decimal, frequency: PremiumFrequency) -> Decimal:
    """The regular instalment of the policy's premium schedule."""
    return regular_installment_amount(annual_premium, PremiumFrequency(frequency))
