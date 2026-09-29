"""SQLAlchemy models.

Import every model module here so that `Base.metadata` is complete when
Alembic autogenerates migrations. Business tables are added module by module
as the relational schema is designed.
"""

from app.db.base import Base
from app.models.enums import (
    InstallmentStatus,
    NomineeRelationship,
    PaymentMethod,
    PaymentStatus,
    PolicyStatus,
    PremiumFrequency,
    ProductFeatureKind,
    ProductStatus,
    ProductType,
)
from app.models.party import Agent, Customer
from app.models.policy import IdSequence, Policy
from app.models.premium import Installment, Payment, PremiumSchedule
from app.models.product import Product, ProductFeature, ProductPremiumFrequency, ProductTermOption
from app.models.role import Role, RoleName
from app.models.user import User

__all__ = [
    "Agent",
    "Base",
    "Customer",
    "IdSequence",
    "Installment",
    "InstallmentStatus",
    "NomineeRelationship",
    "Payment",
    "PaymentMethod",
    "PaymentStatus",
    "Policy",
    "PolicyStatus",
    "PremiumFrequency",
    "PremiumSchedule",
    "Product",
    "ProductFeature",
    "ProductFeatureKind",
    "ProductPremiumFrequency",
    "ProductStatus",
    "ProductTermOption",
    "ProductType",
    "Role",
    "RoleName",
    "User",
]
