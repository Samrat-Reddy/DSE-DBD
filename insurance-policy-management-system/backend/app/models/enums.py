"""Controlled vocabularies for Module 1 (Policy Catalog & Issuance).

Stored as lower-case codes and enforced by CHECK constraints. Display labels
match `frontend/src/utils/constants.js`; the frontend service maps codes to
labels, and the backend uses the labels only for catalog text search.
"""

from enum import StrEnum


def sql_in(column: str, values: type[StrEnum]) -> str:
    """CHECK constraint body restricting `column` to the enum's values."""
    return f"{column} IN ({', '.join(repr(v.value) for v in values)})"


class ProductType(StrEnum):
    HEALTH = "health"
    LIFE = "life"
    MOTOR = "motor"
    PERSONAL_ACCIDENT = "personal_accident"
    HOME = "home"

    @property
    def label(self) -> str:
        return {
            "health": "Health",
            "life": "Life",
            "motor": "Motor",
            "personal_accident": "Personal Accident",
            "home": "Home",
        }[self.value]


class ProductStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class PremiumFrequency(StrEnum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    HALF_YEARLY = "half_yearly"
    ANNUAL = "annual"

    @property
    def instalments_per_year(self) -> int:
        return {"monthly": 12, "quarterly": 4, "half_yearly": 2, "annual": 1}[self.value]


class ProductFeatureKind(StrEnum):
    """The descriptive lists shown on a product page, in display order."""

    BENEFIT = "benefit"
    COVERAGE_ITEM = "coverage_item"
    EXCLUSION = "exclusion"
    ELIGIBILITY_CRITERION = "eligibility_criterion"


class PolicyStatus(StrEnum):
    """Only the statuses Module 1 uses. Later modules (renewals, premium
    payments) extend this list, and the CHECK constraint, in their own migrations."""

    PENDING = "pending"
    ACTIVE = "active"
    EXPIRED = "expired"


class NomineeRelationship(StrEnum):
    """Same values as NOMINEE_RELATIONSHIPS in frontend/src/utils/issuanceValidation.js."""

    SPOUSE = "Spouse"
    SON = "Son"
    DAUGHTER = "Daughter"
    FATHER = "Father"
    MOTHER = "Mother"
    BROTHER = "Brother"
    SISTER = "Sister"
    OTHER = "Other"
