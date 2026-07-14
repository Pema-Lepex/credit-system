"""Catalog: categories, products, and services."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import JSON, Column, UniqueConstraint
from sqlmodel import Field

from app.models.base import TenantEntity
from app.models.types import MoneyType


class Category(TenantEntity, table=True):
    __tablename__ = "category"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_category_business_name"),)

    name: str = Field(index=True, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, max_length=9)  # UI chip colour


class Product(TenantEntity, table=True):
    """A physical good.

    ARCHITECTURE NOTE: ``stock_quantity`` is tracked but deliberately NOT enforced.
    This is a credit tracker, not inventory software (per the spec) -- a grocer
    must still be able to record "3 bags of rice on credit" when the stock count
    is stale. Stock decrements on credit creation and is allowed to go negative,
    which surfaces the discrepancy instead of blocking the sale.
    """

    __tablename__ = "product"
    __table_args__ = (UniqueConstraint("business_id", "sku", name="uq_product_business_sku"),)

    name: str = Field(index=True, max_length=200)
    sku: str | None = Field(default=None, index=True, max_length=64)
    barcode: str | None = Field(default=None, index=True, max_length=64)
    description: str | None = Field(default=None, max_length=2000)

    category_id: str | None = Field(
        default=None, foreign_key="category.id", index=True, max_length=32, ondelete="SET NULL"
    )

    price: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    cost_price: Decimal | None = Field(default=None, sa_type=MoneyType)  # type: ignore[call-overload]
    tax_percentage: Decimal | None = Field(default=None, max_digits=5, decimal_places=2)

    stock_quantity: Decimal = Field(default=Decimal("0"), max_digits=12, decimal_places=3)
    low_stock_threshold: Decimal | None = Field(default=None, max_digits=12, decimal_places=3)
    unit: str = Field(default="pcs", max_length=20)  # pcs, kg, litre, box...

    # Images live in file_asset; this is the ordered list of file ids.
    # A JSON array beats a product_image join table here: images are always read
    # with the product, never queried independently, and the list is short.
    image_file_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))

    is_active: bool = Field(default=True, index=True)


class Service(TenantEntity, table=True):
    """A non-stocked offering (haircut, repair, delivery...)."""

    __tablename__ = "service"

    name: str = Field(index=True, max_length=200)
    code: str | None = Field(default=None, index=True, max_length=64)
    description: str | None = Field(default=None, max_length=2000)

    category_id: str | None = Field(
        default=None, foreign_key="category.id", index=True, max_length=32, ondelete="SET NULL"
    )

    price: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    tax_percentage: Decimal | None = Field(default=None, max_digits=5, decimal_places=2)
    duration_minutes: int | None = Field(default=None)

    is_active: bool = Field(default=True, index=True)
