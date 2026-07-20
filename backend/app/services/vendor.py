"""VendorService -- the people a shop pays.

Mirrors CustomerService's shape without any of its money: a vendor has no balance,
no credit score and no ledger, because the money flows the other way. See
app/models/vendor.py for why they are not one table.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.enums import AuditAction
from app.models.expense import Expense
from app.models.recurring import RecurringExpenseTemplate
from app.models.vendor import Vendor
from app.services.base import BaseService, diff_fields
from app.utils.pagination import Page, PageInput, paginate

VENDOR_FIELDS: frozenset[str] = frozenset(
    {"name", "phone", "email", "address", "notes", "is_active"}
)

VENDOR_SORT_FIELDS: dict[str, Any] = {
    "name": Vendor.name,
    "created_at": Vendor.created_at,
}


class VendorService(BaseService):
    def get(self, vendor_id: str) -> Vendor:
        self.require(Permission.VENDOR_READ)
        return self.get_scoped(Vendor, vendor_id, label="Vendor")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        is_active: bool | None = None,
        sort_by: str = "name",
        sort_desc: bool = False,
    ) -> Page[Vendor]:
        self.require(Permission.VENDOR_READ)

        stmt = select(Vendor).where(
            Vendor.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Vendor.deleted_at).is_(None),
        )
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                or_(
                    col(Vendor.name).ilike(like),
                    col(Vendor.phone).ilike(like),
                    col(Vendor.email).ilike(like),
                )
            )
        if is_active is not None:
            stmt = stmt.where(Vendor.is_active == is_active)

        column = VENDOR_SORT_FIELDS.get(sort_by)
        if column is None:
            raise ValidationError(
                f"Cannot sort by '{sort_by}'. Allowed: {', '.join(sorted(VENDOR_SORT_FIELDS))}",
                field="sort_by",
            )
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    def search(self, term: str, page: PageInput | None = None) -> Page[Vendor]:
        return self.list(page, search=term)

    def build(self, name: str, **fields: Any) -> Vendor:
        """Create a vendor WITHOUT committing. The caller owns the transaction --
        see ExpenseService.build for why the bulk importer needs this."""
        return self._create(name, commit=False, **fields)

    def create(self, name: str, **fields: Any) -> Vendor:
        return self._create(name, commit=True, **fields)

    def _create(self, name: str, *, commit: bool, **fields: Any) -> Vendor:
        self.require(Permission.VENDOR_WRITE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Vendor name is required", field="name")
        self._assert_name_free(business_id, name)

        payload = {k: v for k, v in fields.items() if k in VENDOR_FIELDS and k != "name"}
        self._validate(payload)

        vendor = Vendor(business_id=business_id, name=name, **payload)
        self.session.add(vendor)
        self.session.flush()

        self.audit(AuditAction.CREATE, "vendor", vendor.id, f"Vendor '{name}' created")
        if commit:
            self.session.commit()
            self.session.refresh(vendor)
        return vendor

    def update(self, vendor_id: str, **fields: Any) -> Vendor:
        self.require(Permission.VENDOR_WRITE)
        vendor = self.get_scoped(Vendor, vendor_id, label="Vendor")

        payload = {k: v for k, v in fields.items() if k in VENDOR_FIELDS}
        if not payload:
            return vendor
        self._validate(payload)

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Vendor name is required", field="name")
            if name != vendor.name:
                self._assert_name_free(vendor.business_id, name)
            payload["name"] = name

        before = {k: getattr(vendor, k) for k in payload}
        for key, value in payload.items():
            setattr(vendor, key, value)
        self.session.add(vendor)

        # Renaming a vendor does NOT rewrite the snapshot on past expenses. Those
        # record who was paid at the time -- see models/vendor.py. Only new expenses
        # pick up the new name.
        self.audit(
            AuditAction.UPDATE,
            "vendor",
            vendor.id,
            f"Vendor '{vendor.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(vendor)
        return vendor

    def soft_delete(self, vendor_id: str) -> Vendor:
        self.require(Permission.VENDOR_DELETE)
        vendor = self.get_scoped(Vendor, vendor_id, label="Vendor")

        # Detach by hand: the column carries no DB-level FK (see models/expense.py),
        # and ON DELETE SET NULL would not fire for a soft delete even if it did.
        # vendor_name stays behind, so the expense still says who was paid.
        detached = 0
        for model in (Expense, RecurringExpenseTemplate):
            rows = self.session.exec(
                select(model).where(
                    model.business_id == vendor.business_id,
                    model.vendor_id == vendor.id,
                    col(model.deleted_at).is_(None),
                )
            ).all()
            for row in rows:
                row.vendor_id = None
                if not row.vendor_name:
                    row.vendor_name = vendor.name
                self.session.add(row)
                detached += 1

        vendor.deleted_at = utcnow()
        vendor.is_active = False
        self.session.add(vendor)

        self.audit(
            AuditAction.DELETE,
            "vendor",
            vendor.id,
            f"Vendor '{vendor.name}' deleted; {detached} record(s) keep the name only",
        )
        self.session.commit()
        self.session.refresh(vendor)
        return vendor

    def restore(self, vendor_id: str) -> Vendor:
        self.require(Permission.VENDOR_DELETE)
        vendor = self.session.get(Vendor, vendor_id)
        if vendor is None or vendor.deleted_at is None:
            raise NotFoundError("Deleted vendor not found")
        self.assert_in_scope(vendor.business_id)

        # Past expenses are NOT re-linked. They were detached deliberately and their
        # snapshot is the record; silently re-pointing them would rewrite history.
        vendor.deleted_at = None
        vendor.is_active = True
        self.session.add(vendor)
        self.audit(AuditAction.RESTORE, "vendor", vendor.id, f"Vendor '{vendor.name}' restored")
        self.session.commit()
        self.session.refresh(vendor)
        return vendor

    # -- helpers -------------------------------------------------------------
    def _validate(self, fields: dict[str, Any]) -> None:
        for key in ("phone", "email", "address", "notes"):
            if key in fields and fields[key] is not None:
                text = str(fields[key]).strip()
                fields[key] = text or None
        email = fields.get("email")
        if email and "@" not in email:
            raise ValidationError("That does not look like an email address", field="email")

    def _assert_name_free(self, business_id: str, name: str) -> None:
        existing = self.session.exec(
            select(Vendor).where(
                Vendor.business_id == business_id,
                Vendor.name == name,
                col(Vendor.deleted_at).is_(None),
            )
        ).first()
        if existing is not None:
            raise ConflictError(f"A vendor called '{name}' already exists", field="name")
