"""Policy catalog: products and their offered options and descriptive lists."""

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, IntPK, Money, TimestampMixin, code_string
from app.models.enums import (
    PremiumFrequency,
    ProductFeatureKind,
    ProductStatus,
    ProductType,
    sql_in,
)


class Product(TimestampMixin, Base):
    """A sellable insurance product. Never deleted once policies reference it
    (FK RESTRICT); withdrawn products are marked `inactive` instead."""

    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("code REGEXP '^PRD-[A-Z]{3}-[0-9]{3}$'", name="code_format"),
        CheckConstraint(sql_in("product_type", ProductType), name="product_type_allowed"),
        CheckConstraint(sql_in("status", ProductStatus), name="status_allowed"),
        CheckConstraint(
            "min_coverage_amount > 0 AND min_coverage_amount <= reference_coverage_amount "
            "AND reference_coverage_amount <= max_coverage_amount",
            name="coverage_range",
        ),
        CheckConstraint("base_annual_premium > 0", name="base_premium_positive"),
        CheckConstraint("default_term_years BETWEEN 1 AND 50", name="default_term_range"),
        CheckConstraint(
            "min_entry_age >= 0 AND min_entry_age <= max_entry_age AND max_entry_age <= 120",
            name="entry_age_range",
        ),
        Index("ix_products_status_product_type", "status", "product_type"),
    )

    id: Mapped[IntPK]
    code: Mapped[str] = mapped_column(code_string(20), unique=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    product_type: Mapped[str] = mapped_column(code_string(24))
    status: Mapped[str] = mapped_column(code_string(16), server_default=text("'active'"))
    tagline: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text)
    # Base premium is quoted per year at the reference coverage amount; the
    # issued premium scales linearly with the chosen coverage.
    reference_coverage_amount: Mapped[Money]
    min_coverage_amount: Mapped[Money]
    max_coverage_amount: Mapped[Money]
    base_annual_premium: Mapped[Money]
    default_term_years: Mapped[int] = mapped_column(SmallInteger)
    min_entry_age: Mapped[int] = mapped_column(SmallInteger)
    max_entry_age: Mapped[int] = mapped_column(SmallInteger)
    eligibility_summary: Mapped[str] = mapped_column(String(255))
    waiting_period: Mapped[str] = mapped_column(String(120))

    term_options: Mapped[list["ProductTermOption"]] = relationship(
        lazy="selectin", order_by="ProductTermOption.term_years"
    )
    premium_frequencies: Mapped[list["ProductPremiumFrequency"]] = relationship(lazy="selectin")
    features: Mapped[list["ProductFeature"]] = relationship(
        lazy="selectin", order_by=lambda: [ProductFeature.kind, ProductFeature.position]
    )


class ProductTermOption(Base):
    """A policy term (in years) the product may be issued for."""

    __tablename__ = "product_term_options"
    __table_args__ = (CheckConstraint("term_years BETWEEN 1 AND 50", name="term_range"),)

    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    term_years: Mapped[int] = mapped_column(SmallInteger, primary_key=True)


class ProductPremiumFrequency(Base):
    """A premium payment frequency the product may be issued with."""

    __tablename__ = "product_premium_frequencies"
    __table_args__ = (
        CheckConstraint(sql_in("frequency", PremiumFrequency), name="frequency_allowed"),
    )

    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="CASCADE"), primary_key=True
    )
    frequency: Mapped[str] = mapped_column(code_string(16), primary_key=True)


class ProductFeature(Base):
    """One entry of a product's benefits / coverage items / exclusions /
    eligibility criteria, kept as rows (1NF) rather than a JSON list."""

    __tablename__ = "product_features"
    __table_args__ = (
        UniqueConstraint("product_id", "kind", "position"),
        CheckConstraint(sql_in("kind", ProductFeatureKind), name="kind_allowed"),
        CheckConstraint("position >= 1", name="position_positive"),
        # Only coverage items carry a limit, and they always do.
        CheckConstraint(
            "(kind = 'coverage_item') = (limit_text IS NOT NULL)", name="limit_for_coverage_items"
        ),
    )

    id: Mapped[IntPK]
    product_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("products.id", ondelete="CASCADE")
    )
    kind: Mapped[str] = mapped_column(code_string(24))
    position: Mapped[int] = mapped_column(SmallInteger)
    content: Mapped[str] = mapped_column(String(255))
    limit_text: Mapped[str | None] = mapped_column(String(120))
