"""Catalog services: categories, products, and services.

NAMING NOTE
-----------
The model for a non-stocked offering is called ``Service`` (a haircut, a repair).
A class called ``ServiceService`` would be an unreadable pun, and ``ServiceService``
vs the *application service layer* is a genuine source of confusion in review. The
class is therefore ``ServiceItemService``: the application service that manages
``Service`` catalog items. The model keeps its domain name; the service layer gets
an unambiguous one.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any

from sqlmodel import col, select

from app.core.errors import ConflictError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.catalog import Category, Product, Service
from app.models.enums import AuditAction
from app.models.types import quantize_money
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.pagination import Page, PageInput, paginate

CATEGORY_FIELDS: frozenset[str] = frozenset({"name", "description", "color"})

PRODUCT_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "sku",
        "barcode",
        "description",
        "category_id",
        "price",
        "cost_price",
        "tax_percentage",
        "stock_quantity",
        "low_stock_threshold",
        "unit",
        "image_file_ids",
        "is_active",
    }
)

SERVICE_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "code",
        "description",
        "category_id",
        "price",
        "tax_percentage",
        "duration_minutes",
        "is_active",
    }
)

PRODUCT_SORT_FIELDS: dict[str, Any] = {
    "name": Product.name,
    "created_at": Product.created_at,
    "price": Product.price,
    "stock_quantity": Product.stock_quantity,
}

SERVICE_SORT_FIELDS: dict[str, Any] = {
    "name": Service.name,
    "created_at": Service.created_at,
    "price": Service.price,
}


# ---------------------------------------------------------------------------
# Shared validation
# ---------------------------------------------------------------------------
def _money(value: Any, field: str) -> Decimal:
    try:
        amount = quantize_money(value)
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise ValidationError(f"{field.replace('_', ' ').capitalize()} must be a number", field=field) from exc
    if amount < 0:
        raise ValidationError(
            f"{field.replace('_', ' ').capitalize()} cannot be negative", field=field
        )
    return amount


def _quantity(value: Any, field: str, *, allow_negative: bool = False) -> Decimal:
    try:
        qty = Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise ValidationError(f"{field.replace('_', ' ').capitalize()} must be a number", field=field) from exc
    if qty < 0 and not allow_negative:
        raise ValidationError(
            f"{field.replace('_', ' ').capitalize()} cannot be negative", field=field
        )
    return qty.quantize(Decimal("0.001"))


def _tax(value: Any) -> Decimal:
    try:
        tax = Decimal(str(value))
    except (InvalidOperation, TypeError) as exc:
        raise ValidationError("Tax percentage must be a number", field="tax_percentage") from exc
    if tax < 0 or tax > 100:
        raise ValidationError("Tax percentage must be between 0 and 100", field="tax_percentage")
    return tax


# ---------------------------------------------------------------------------
class CategoryService(BaseService):
    def get(self, category_id: str) -> Category:
        self.require(Permission.CATALOG_READ)
        return self.get_scoped(Category, category_id, label="Category")

    def list(
        self, page: PageInput | None = None, *, search: str | None = None
    ) -> Page[Category]:
        self.require(Permission.CATALOG_READ)
        stmt = select(Category).where(
            Category.business_id == self.scope_id,
            Category.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if search:
            stmt = stmt.where(col(Category.name).ilike(f"%{search.strip()}%"))
        stmt = stmt.order_by(col(Category.name).asc())
        return paginate(self.session, stmt, page or PageInput())

    def create(self, name: str, **fields: Any) -> Category:
        self.require(Permission.CATALOG_WRITE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Category name is required", field="name")
        self._assert_name_free(business_id, name)

        payload = {k: v for k, v in fields.items() if k in CATEGORY_FIELDS and k != "name"}
        category = Category(business_id=business_id, name=name, **payload)
        self.session.add(category)
        self.session.flush()

        self.audit(AuditAction.CREATE, "category", category.id, f"Category '{name}' created")
        self.session.commit()
        self.session.refresh(category)
        return category

    def update(self, category_id: str, **fields: Any) -> Category:
        self.require(Permission.CATALOG_WRITE)
        category = self.get_scoped(Category, category_id, label="Category")

        payload = {k: v for k, v in fields.items() if k in CATEGORY_FIELDS}
        if not payload:
            return category

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Category name is required", field="name")
            if name != category.name:
                self._assert_name_free(category.business_id, name)
            payload["name"] = name

        before = {k: getattr(category, k) for k in payload}
        for key, value in payload.items():
            setattr(category, key, value)
        self.session.add(category)

        self.audit(
            AuditAction.UPDATE,
            "category",
            category.id,
            f"Category '{category.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(category)
        return category

    def soft_delete(self, category_id: str) -> Category:
        self.require(Permission.CATALOG_DELETE)
        category = self.get_scoped(Category, category_id, label="Category")

        # The DB's ON DELETE SET NULL never fires for a soft delete, so we detach the
        # members by hand. Leaving them pointing at an invisible category would show
        # blank chips in the UI and break the category filter.
        orphaned = 0
        for model in (Product, Service):
            rows = self.session.exec(
                select(model).where(
                    model.business_id == category.business_id,
                    model.category_id == category.id,
                    model.deleted_at.is_(None),  # type: ignore[union-attr]
                )
            ).all()
            for row in rows:
                row.category_id = None
                self.session.add(row)
                orphaned += 1

        category.deleted_at = utcnow()
        self.session.add(category)
        self.audit(
            AuditAction.DELETE,
            "category",
            category.id,
            f"Category '{category.name}' deleted; {orphaned} item(s) uncategorised",
        )
        self.session.commit()
        self.session.refresh(category)
        return category

    def _assert_name_free(self, business_id: str, name: str) -> None:
        existing = self.session.exec(
            select(Category).where(
                Category.business_id == business_id,
                Category.name == name,
                Category.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()
        if existing is not None:
            raise ConflictError(f"A category called '{name}' already exists", field="name")


# ---------------------------------------------------------------------------
class ProductService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self.storage = StorageService(self.session)

    def get(self, product_id: str) -> Product:
        self.require(Permission.CATALOG_READ)
        return self.get_scoped(Product, product_id, label="Product")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        category_id: str | None = None,
        is_active: bool | None = None,
        low_stock: bool = False,
        sort_by: str = "name",
        sort_desc: bool = False,
    ) -> Page[Product]:
        self.require(Permission.CATALOG_READ)

        stmt = select(Product).where(
            Product.business_id == self.scope_id,
            Product.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                col(Product.name).ilike(like)
                | col(Product.sku).ilike(like)
                | col(Product.barcode).ilike(like)
            )
        if category_id:
            stmt = stmt.where(Product.category_id == category_id)
        if is_active is not None:
            stmt = stmt.where(Product.is_active == is_active)
        if low_stock:
            # "Low stock" is only meaningful for products that declared a threshold;
            # everything else has opted out of stock warnings.
            stmt = stmt.where(
                col(Product.low_stock_threshold).is_not(None),
                col(Product.stock_quantity) <= col(Product.low_stock_threshold),
            )

        column = PRODUCT_SORT_FIELDS.get(sort_by)
        if column is None:
            raise ValidationError(
                f"Cannot sort by '{sort_by}'. Allowed: {', '.join(sorted(PRODUCT_SORT_FIELDS))}",
                field="sort_by",
            )
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    def create(self, name: str, **fields: Any) -> Product:
        self.require(Permission.CATALOG_WRITE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Product name is required", field="name")

        payload = {k: v for k, v in fields.items() if k in PRODUCT_FIELDS and k != "name"}
        self._validate(payload)
        self._assert_unique(business_id, sku=payload.get("sku"), barcode=payload.get("barcode"))
        if payload.get("category_id"):
            self.get_scoped(Category, payload["category_id"], label="Category")

        image_ids: list[str] = list(payload.pop("image_file_ids", []) or [])

        product = Product(business_id=business_id, name=name, image_file_ids=image_ids, **payload)
        self.session.add(product)
        self.session.flush()

        self.storage.attach_many(image_ids)

        self.audit(AuditAction.CREATE, "product", product.id, f"Product '{name}' created")
        self.session.commit()
        self.session.refresh(product)
        return product

    def update(self, product_id: str, **fields: Any) -> Product:
        self.require(Permission.CATALOG_WRITE)
        product = self.get_scoped(Product, product_id, label="Product")

        payload = {k: v for k, v in fields.items() if k in PRODUCT_FIELDS}
        if not payload:
            return product
        self._validate(payload)

        if "sku" in payload or "barcode" in payload:
            self._assert_unique(
                product.business_id,
                sku=payload.get("sku"),
                barcode=payload.get("barcode"),
                exclude_id=product.id,
            )
        if payload.get("category_id"):
            self.get_scoped(Category, payload["category_id"], label="Category")

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Product name is required", field="name")
            payload["name"] = name

        before = {k: getattr(product, k) for k in payload}

        if "image_file_ids" in payload:
            new_ids: list[str] = list(payload["image_file_ids"] or [])
            old_ids: list[str] = list(product.image_file_ids or [])
            self.storage.attach_many([i for i in new_ids if i not in old_ids])
            self.storage.detach_many([i for i in old_ids if i not in new_ids])
            # Reassign a NEW list rather than mutating in place: SQLAlchemy does not
            # track in-place mutation of a plain JSON column, so an .append() here
            # would simply not be saved.
            payload["image_file_ids"] = new_ids

        for key, value in payload.items():
            setattr(product, key, value)
        self.session.add(product)

        self.audit(
            AuditAction.UPDATE,
            "product",
            product.id,
            f"Product '{product.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(product)
        return product

    def adjust_stock(
        self, product_id: str, delta: Decimal | int | float | str, *, reason: str | None = None
    ) -> Product:
        """Add to (or subtract from) stock. Negative results are allowed.

        See models/catalog.py: this is a credit tracker, not inventory software. A
        stale count must never be able to block a sale, so the stock is allowed to go
        negative -- which surfaces the discrepancy instead of hiding it.
        """
        self.require(Permission.CATALOG_WRITE)
        product = self.get_scoped(Product, product_id, label="Product")

        amount = _quantity(delta, "delta", allow_negative=True)
        if amount == 0:
            return product

        before = product.stock_quantity
        product.stock_quantity = (before + amount).quantize(Decimal("0.001"))
        self.session.add(product)

        note = f" ({reason})" if reason else ""
        self.audit(
            AuditAction.UPDATE,
            "product",
            product.id,
            f"Stock for '{product.name}' changed by {amount}{note}",
            {"stock_quantity": [str(before), str(product.stock_quantity)]},
        )
        self.session.commit()
        self.session.refresh(product)
        return product

    def set_stock(self, product_id: str, quantity: Decimal | int | float | str) -> Product:
        """Absolute stock count (a stocktake, not a movement)."""
        self.require(Permission.CATALOG_WRITE)
        product = self.get_scoped(Product, product_id, label="Product")

        qty = _quantity(quantity, "stock_quantity", allow_negative=True)
        before = product.stock_quantity
        product.stock_quantity = qty
        self.session.add(product)

        self.audit(
            AuditAction.UPDATE,
            "product",
            product.id,
            f"Stock for '{product.name}' set to {qty}",
            {"stock_quantity": [str(before), str(qty)]},
        )
        self.session.commit()
        self.session.refresh(product)
        return product

    def soft_delete(self, product_id: str) -> Product:
        self.require(Permission.CATALOG_DELETE)
        product = self.get_scoped(Product, product_id, label="Product")

        product.deleted_at = utcnow()
        product.is_active = False
        self.session.add(product)
        self.storage.detach_many(list(product.image_file_ids or []))

        self.audit(AuditAction.DELETE, "product", product.id, f"Product '{product.name}' deleted")
        self.session.commit()
        self.session.refresh(product)
        return product

    def restore(self, product_id: str) -> Product:
        self.require(Permission.CATALOG_DELETE)
        product = self.session.get(Product, product_id)
        if product is None or product.business_id != self.scope_id:
            raise ConflictError("Product not found")
        if product.deleted_at is None:
            return product

        product.deleted_at = None
        product.is_active = True
        self.session.add(product)
        self.storage.attach_many(list(product.image_file_ids or []))

        self.audit(AuditAction.RESTORE, "product", product.id, f"Product '{product.name}' restored")
        self.session.commit()
        self.session.refresh(product)
        return product

    # -- helpers -------------------------------------------------------------
    def _validate(self, fields: dict[str, Any]) -> None:
        for key in ("price", "cost_price"):
            if key in fields and fields[key] is not None:
                fields[key] = _money(fields[key], key)
        if "tax_percentage" in fields and fields["tax_percentage"] is not None:
            fields["tax_percentage"] = _tax(fields["tax_percentage"])
        if "stock_quantity" in fields and fields["stock_quantity"] is not None:
            fields["stock_quantity"] = _quantity(
                fields["stock_quantity"], "stock_quantity", allow_negative=True
            )
        if "low_stock_threshold" in fields and fields["low_stock_threshold"] is not None:
            fields["low_stock_threshold"] = _quantity(
                fields["low_stock_threshold"], "low_stock_threshold"
            )
        for key in ("sku", "barcode"):
            if key in fields and fields[key] is not None:
                value = str(fields[key]).strip()
                fields[key] = value or None

    def _assert_unique(
        self,
        business_id: str,
        *,
        sku: str | None,
        barcode: str | None,
        exclude_id: str | None = None,
    ) -> None:
        """SKU and barcode are unique PER BUSINESS, not globally -- two unrelated shops
        may legitimately both sell SKU 'A-1'."""
        for field, value in (("sku", sku), ("barcode", barcode)):
            if not value:
                continue
            stmt = select(Product).where(
                Product.business_id == business_id,
                getattr(Product, field) == value,
                Product.deleted_at.is_(None),  # type: ignore[union-attr]
            )
            if exclude_id:
                stmt = stmt.where(Product.id != exclude_id)
            if self.session.exec(stmt).first() is not None:
                raise ConflictError(
                    f"Another product already uses the {field} '{value}'", field=field
                )


# ---------------------------------------------------------------------------
class ServiceItemService(BaseService):
    """Manages ``Service`` catalog rows. Named ``ServiceItemService`` -- see module docstring."""

    def get(self, service_id: str) -> Service:
        self.require(Permission.CATALOG_READ)
        return self.get_scoped(Service, service_id, label="Service")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        category_id: str | None = None,
        is_active: bool | None = None,
        sort_by: str = "name",
        sort_desc: bool = False,
    ) -> Page[Service]:
        self.require(Permission.CATALOG_READ)

        stmt = select(Service).where(
            Service.business_id == self.scope_id,
            Service.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(col(Service.name).ilike(like) | col(Service.code).ilike(like))
        if category_id:
            stmt = stmt.where(Service.category_id == category_id)
        if is_active is not None:
            stmt = stmt.where(Service.is_active == is_active)

        column = SERVICE_SORT_FIELDS.get(sort_by)
        if column is None:
            raise ValidationError(
                f"Cannot sort by '{sort_by}'. Allowed: {', '.join(sorted(SERVICE_SORT_FIELDS))}",
                field="sort_by",
            )
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    def create(self, name: str, **fields: Any) -> Service:
        self.require(Permission.CATALOG_WRITE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Service name is required", field="name")

        payload = {k: v for k, v in fields.items() if k in SERVICE_FIELDS and k != "name"}
        self._validate(payload)
        self._assert_code_free(business_id, payload.get("code"))
        if payload.get("category_id"):
            self.get_scoped(Category, payload["category_id"], label="Category")

        service = Service(business_id=business_id, name=name, **payload)
        self.session.add(service)
        self.session.flush()

        self.audit(AuditAction.CREATE, "service", service.id, f"Service '{name}' created")
        self.session.commit()
        self.session.refresh(service)
        return service

    def update(self, service_id: str, **fields: Any) -> Service:
        self.require(Permission.CATALOG_WRITE)
        service = self.get_scoped(Service, service_id, label="Service")

        payload = {k: v for k, v in fields.items() if k in SERVICE_FIELDS}
        if not payload:
            return service
        self._validate(payload)

        if "code" in payload:
            self._assert_code_free(service.business_id, payload.get("code"), exclude_id=service.id)
        if payload.get("category_id"):
            self.get_scoped(Category, payload["category_id"], label="Category")

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Service name is required", field="name")
            payload["name"] = name

        before = {k: getattr(service, k) for k in payload}
        for key, value in payload.items():
            setattr(service, key, value)
        self.session.add(service)

        self.audit(
            AuditAction.UPDATE,
            "service",
            service.id,
            f"Service '{service.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(service)
        return service

    def soft_delete(self, service_id: str) -> Service:
        self.require(Permission.CATALOG_DELETE)
        service = self.get_scoped(Service, service_id, label="Service")

        service.deleted_at = utcnow()
        service.is_active = False
        self.session.add(service)

        self.audit(AuditAction.DELETE, "service", service.id, f"Service '{service.name}' deleted")
        self.session.commit()
        self.session.refresh(service)
        return service

    def restore(self, service_id: str) -> Service:
        self.require(Permission.CATALOG_DELETE)
        service = self.session.get(Service, service_id)
        if service is None or service.business_id != self.scope_id:
            raise ConflictError("Service not found")
        if service.deleted_at is None:
            return service

        service.deleted_at = None
        service.is_active = True
        self.session.add(service)
        self.audit(AuditAction.RESTORE, "service", service.id, f"Service '{service.name}' restored")
        self.session.commit()
        self.session.refresh(service)
        return service

    # -- helpers -------------------------------------------------------------
    def _validate(self, fields: dict[str, Any]) -> None:
        if "price" in fields and fields["price"] is not None:
            fields["price"] = _money(fields["price"], "price")
        if "tax_percentage" in fields and fields["tax_percentage"] is not None:
            fields["tax_percentage"] = _tax(fields["tax_percentage"])
        if "duration_minutes" in fields and fields["duration_minutes"] is not None:
            minutes = fields["duration_minutes"]
            if isinstance(minutes, bool) or not isinstance(minutes, int) or minutes <= 0:
                raise ValidationError(
                    "Duration must be a positive number of minutes", field="duration_minutes"
                )
        if "code" in fields and fields["code"] is not None:
            value = str(fields["code"]).strip()
            fields["code"] = value or None

    def _assert_code_free(
        self, business_id: str, code: str | None, *, exclude_id: str | None = None
    ) -> None:
        if not code:
            return
        stmt = select(Service).where(
            Service.business_id == business_id,
            Service.code == code,
            Service.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if exclude_id:
            stmt = stmt.where(Service.id != exclude_id)
        if self.session.exec(stmt).first() is not None:
            raise ConflictError(f"Another service already uses the code '{code}'", field="code")
