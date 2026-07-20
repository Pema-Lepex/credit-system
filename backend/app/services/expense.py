"""Expense services -- recording money that leaves the business.

WHY EXPENSES ARE EDITABLE AND PAYMENTS ARE NOT
-----------------------------------------------
``PaymentService`` refuses to edit a payment: it is a claim about what a customer
handed over, and rewriting it rewrites a shared history that the customer can
argue with. An expense has no counterparty inside the system. It is the owner's
own note-to-self about their own money, and the realistic failure mode is a typo
in last Tuesday's fuel bill -- not a disputed transaction.

So an expense updates in place (with the before/after landing in the audit log)
and soft-deletes to the Trash. No void, no reversal, no ledger entry. See
``app/models/expense.py`` for why nothing here touches the customer ledger.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import or_
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.cash_account import CashAccount
from app.models.enums import AuditAction, PaymentMethod
from app.models.expense import Expense, ExpenseCategory
from app.models.vendor import Vendor
from app.models.types import quantize_money
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.dates import today_in
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")

EXPENSE_CATEGORY_FIELDS: frozenset[str] = frozenset(
    {"name", "description", "color", "is_active", "sort_order"}
)

EXPENSE_FIELDS: frozenset[str] = frozenset(
    {
        "category_id",
        "amount",
        "vendor_id",
        "vendor_name",
        "cash_account_id",
        "payment_method",
        "provider",
        "expense_date",
        "reference",
        "notes",
        "receipt_file_id",
    }
)

EXPENSE_SORT_FIELDS: dict[str, Any] = {
    "expense_date": Expense.expense_date,
    "amount": Expense.amount,
    "created_at": Expense.created_at,
    "vendor_name": Expense.vendor_name,
}


@dataclass(slots=True)
class ExpenseFilter:
    search: str | None = None
    category_id: str | None = None
    vendor_id: str | None = None
    cash_account_id: str | None = None
    vendor_name: str | None = None
    payment_method: list[PaymentMethod] | None = None
    date_from: date | None = None
    date_to: date | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    created_by_user_id: str | None = None


# ---------------------------------------------------------------------------
class ExpenseCategoryService(BaseService):
    """Spending buckets. Mirrors CategoryService, including the orphan-detach on
    delete -- see the comment there for why the DB's ON DELETE cannot do it."""

    def get(self, category_id: str) -> ExpenseCategory:
        self.require(Permission.EXPENSE_CATEGORY_READ)
        return self.get_scoped(ExpenseCategory, category_id, label="Expense category")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> Page[ExpenseCategory]:
        self.require(Permission.EXPENSE_CATEGORY_READ)
        stmt = select(ExpenseCategory).where(
            ExpenseCategory.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(ExpenseCategory.deleted_at).is_(None),
        )
        if search:
            stmt = stmt.where(col(ExpenseCategory.name).ilike(f"%{search.strip()}%"))
        if is_active is not None:
            stmt = stmt.where(ExpenseCategory.is_active == is_active)
        # Manual order first, then name -- so an owner can pin "Rent" to the top
        # without renaming it.
        stmt = stmt.order_by(
            col(ExpenseCategory.sort_order).asc(), col(ExpenseCategory.name).asc()
        )
        return paginate(self.session, stmt, page or PageInput())

    def build(self, name: str, **fields: Any) -> ExpenseCategory:
        """Create a category WITHOUT committing. See ExpenseService.build."""
        return self._create(name, commit=False, **fields)

    def create(self, name: str, **fields: Any) -> ExpenseCategory:
        return self._create(name, commit=True, **fields)

    def _create(self, name: str, *, commit: bool, **fields: Any) -> ExpenseCategory:
        self.require(Permission.EXPENSE_CATEGORY_MANAGE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Category name is required", field="name")
        self._assert_name_free(business_id, name)

        payload = {
            k: v for k, v in fields.items() if k in EXPENSE_CATEGORY_FIELDS and k != "name"
        }
        self._validate(payload)

        category = ExpenseCategory(business_id=business_id, name=name, **payload)
        self.session.add(category)
        self.session.flush()

        self.audit(
            AuditAction.CREATE, "expense_category", category.id, f"Expense category '{name}' created"
        )
        if commit:
            self.session.commit()
            self.session.refresh(category)
        return category

    def update(self, category_id: str, **fields: Any) -> ExpenseCategory:
        self.require(Permission.EXPENSE_CATEGORY_MANAGE)
        category = self.get_scoped(ExpenseCategory, category_id, label="Expense category")

        payload = {k: v for k, v in fields.items() if k in EXPENSE_CATEGORY_FIELDS}
        if not payload:
            return category
        self._validate(payload)

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
            "expense_category",
            category.id,
            f"Expense category '{category.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(category)
        return category

    def set_active(self, category_id: str, *, is_active: bool) -> ExpenseCategory:
        """Activate/deactivate. A deactivated category keeps its history -- it just
        stops appearing in the picker for new expenses."""
        return self.update(category_id, is_active=is_active)

    def soft_delete(self, category_id: str) -> ExpenseCategory:
        self.require(Permission.EXPENSE_CATEGORY_MANAGE)
        category = self.get_scoped(ExpenseCategory, category_id, label="Expense category")

        # Same reasoning as CategoryService.soft_delete: ON DELETE SET NULL never
        # fires for a soft delete, so expenses would keep pointing at an invisible
        # category -- blank chips in the UI and a broken category filter.
        rows = self.session.exec(
            select(Expense).where(
                Expense.business_id == category.business_id,
                Expense.category_id == category.id,
                col(Expense.deleted_at).is_(None),
            )
        ).all()
        for row in rows:
            row.category_id = None
            self.session.add(row)

        category.deleted_at = utcnow()
        category.is_active = False
        self.session.add(category)
        self.audit(
            AuditAction.DELETE,
            "expense_category",
            category.id,
            f"Expense category '{category.name}' deleted; "
            f"{len(rows)} expense(s) uncategorised",
        )
        self.session.commit()
        self.session.refresh(category)
        return category

    # -- helpers -------------------------------------------------------------
    def _validate(self, fields: dict[str, Any]) -> None:
        if "sort_order" in fields and fields["sort_order"] is not None:
            value = fields["sort_order"]
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError("Sort order must be a whole number", field="sort_order")
        for key in ("description", "color"):
            if key in fields and fields[key] is not None:
                text = str(fields[key]).strip()
                fields[key] = text or None

    def _assert_name_free(self, business_id: str, name: str) -> None:
        existing = self.session.exec(
            select(ExpenseCategory).where(
                ExpenseCategory.business_id == business_id,
                ExpenseCategory.name == name,
                col(ExpenseCategory.deleted_at).is_(None),
            )
        ).first()
        if existing is not None:
            raise ConflictError(
                f"An expense category called '{name}' already exists", field="name"
            )


# ---------------------------------------------------------------------------
class ExpenseService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self.storage = StorageService(self.session)

    # ------------------------------------------------------------------ reads
    def get(self, expense_id: str) -> Expense:
        self.require(Permission.EXPENSE_READ)
        return self.get_scoped(Expense, expense_id, label="Expense")

    def list(
        self,
        filters: ExpenseFilter | None = None,
        page: PageInput | None = None,
        *,
        sort_by: str = "expense_date",
        sort_desc: bool = True,
    ) -> Page[Expense]:
        self.require(Permission.EXPENSE_READ)
        f = filters or ExpenseFilter()

        stmt = select(Expense).where(
            Expense.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Expense.deleted_at).is_(None),
        )

        if f.category_id:
            stmt = stmt.where(Expense.category_id == f.category_id)
        if f.vendor_id:
            stmt = stmt.where(Expense.vendor_id == f.vendor_id)
        if f.cash_account_id:
            stmt = stmt.where(Expense.cash_account_id == f.cash_account_id)
        if f.vendor_name:
            stmt = stmt.where(col(Expense.vendor_name).ilike(f"%{f.vendor_name.strip()}%"))
        if f.payment_method:
            stmt = stmt.where(
                col(Expense.payment_method).in_([PaymentMethod(m) for m in f.payment_method])
            )
        if f.date_from:
            stmt = stmt.where(col(Expense.expense_date) >= f.date_from)
        if f.date_to:
            stmt = stmt.where(col(Expense.expense_date) <= f.date_to)
        if f.min_amount is not None:
            stmt = stmt.where(Expense.amount >= quantize_money(f.min_amount))
        if f.max_amount is not None:
            stmt = stmt.where(Expense.amount <= quantize_money(f.max_amount))
        if f.created_by_user_id:
            stmt = stmt.where(Expense.created_by_user_id == f.created_by_user_id)
        if f.search:
            term = f"%{f.search.strip()}%"
            category_ids = select(ExpenseCategory.id).where(
                ExpenseCategory.business_id == self.scope_id,
                col(ExpenseCategory.name).ilike(term),
            )
            stmt = stmt.where(
                or_(
                    col(Expense.vendor_name).ilike(term),
                    col(Expense.notes).ilike(term),
                    col(Expense.reference).ilike(term),
                    col(Expense.category_id).in_(category_ids),
                )
            )

        column = EXPENSE_SORT_FIELDS.get(sort_by)
        if column is None:
            raise ValidationError(
                f"Cannot sort by '{sort_by}'. Allowed: {', '.join(sorted(EXPENSE_SORT_FIELDS))}",
                field="sort_by",
            )
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    def search(self, term: str, page: PageInput | None = None) -> Page[Expense]:
        """Convenience wrapper over ``list`` for the global search bar."""
        return self.list(ExpenseFilter(search=term), page)

    # ----------------------------------------------------------------- writes
    def build(self, **fields: Any) -> Expense:
        """Create an expense WITHOUT committing. The caller owns the transaction.

        Split out of ``create`` for the bulk importer, which turns one spreadsheet
        into hundreds of expenses and must land them as a single all-or-nothing
        batch. A per-row commit would leave half a failed import behind.
        """
        return self._create(commit=False, **fields)

    def create(self, **fields: Any) -> Expense:
        return self._create(commit=True, **fields)

    def _create(self, *, commit: bool, **fields: Any) -> Expense:
        self.require(Permission.EXPENSE_WRITE)
        business = self.get_business()

        payload = {k: v for k, v in fields.items() if k in EXPENSE_FIELDS}
        self._validate(payload)

        if payload.get("amount") is None:
            raise ValidationError("An expense amount is required", field="amount")
        if not payload.get("expense_date"):
            payload["expense_date"] = today_in(business.timezone)
        self._assert_references(payload)

        receipt_file_id = payload.get("receipt_file_id")

        expense = Expense(
            business_id=self.scope_id,
            created_by_user_id=self.ctx.user.id if self.ctx.user else None,
            **payload,
        )
        self.session.add(expense)
        self.session.flush()

        if receipt_file_id:
            self.storage.attach(receipt_file_id)

        self.audit(
            AuditAction.CREATE,
            "expense",
            expense.id,
            f"Recorded {business.currency} {expense.amount} expense"
            f"{f' to {expense.vendor_name}' if expense.vendor_name else ''} "
            f"({PaymentMethod(expense.payment_method).value}) on {expense.expense_date}",
        )
        if commit:
            self.session.commit()
            self.session.refresh(expense)
        return expense

    def update(self, expense_id: str, **fields: Any) -> Expense:
        self.require(Permission.EXPENSE_WRITE)
        expense = self.get_scoped(Expense, expense_id, label="Expense")

        payload = {k: v for k, v in fields.items() if k in EXPENSE_FIELDS}
        if not payload:
            return expense
        self._validate(payload)

        # A generated expense is the output of a standing instruction, not a note the
        # owner wrote -- editing one would make it disagree with the template that
        # produced it and with the next run. Fix the template, or delete this row.
        if expense.recurring_template_id:
            raise ConflictError(
                "This expense was created automatically from a recurring expense. "
                "Edit the recurring expense to change future ones, or delete this "
                "one if it is wrong."
            )

        if "amount" in payload and payload["amount"] is None:
            raise ValidationError("An expense amount is required", field="amount")
        self._assert_references(payload)

        # Swapping the receipt has to move the attachment refcount both ways, or the
        # orphan sweeper will either delete a live file or keep a dead one forever.
        if "receipt_file_id" in payload:
            new_id = payload["receipt_file_id"]
            old_id = expense.receipt_file_id
            if new_id != old_id:
                if new_id:
                    self.storage.attach(new_id)
                if old_id:
                    self.storage.detach(old_id)

        before = {k: getattr(expense, k) for k in payload}
        for key, value in payload.items():
            setattr(expense, key, value)
        expense.updated_by_user_id = self.ctx.user.id if self.ctx.user else None
        self.session.add(expense)

        self.audit(
            AuditAction.UPDATE,
            "expense",
            expense.id,
            f"Expense of {self.get_business().currency} {expense.amount} updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(expense)
        return expense

    def soft_delete(self, expense_id: str) -> Expense:
        """Send an expense to the Trash. Recoverable; nothing else moves."""
        self.require(Permission.EXPENSE_DELETE)
        expense = self.get_scoped(Expense, expense_id, label="Expense")

        expense.deleted_at = utcnow()
        self.session.add(expense)
        if expense.receipt_file_id:
            self.storage.detach(expense.receipt_file_id)

        self.audit(
            AuditAction.DELETE,
            "expense",
            expense.id,
            f"Deleted {self.get_business().currency} {expense.amount} expense "
            f"from {expense.expense_date}",
        )
        self.session.commit()
        self.session.refresh(expense)
        return expense

    def get_deleted(self, expense_id: str) -> Expense:
        self.require(Permission.EXPENSE_DELETE)
        expense = self.session.get(Expense, expense_id)
        if expense is None or expense.deleted_at is None:
            raise NotFoundError("Deleted expense not found")
        self.assert_in_scope(expense.business_id)
        return expense

    def list_deleted(self, page: PageInput | None = None) -> Page[Expense]:
        self.require(Permission.EXPENSE_DELETE)
        stmt = (
            select(Expense)
            .where(
                Expense.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Expense.deleted_at).is_not(None),
            )
            .order_by(col(Expense.deleted_at).desc())
        )
        return paginate(self.session, stmt, page or PageInput())

    def restore(self, expense_id: str) -> Expense:
        expense = self.get_deleted(expense_id)
        expense.deleted_at = None
        self.session.add(expense)
        if expense.receipt_file_id:
            self.storage.attach(expense.receipt_file_id)

        self.audit(
            AuditAction.RESTORE, "expense", expense.id, "Restored expense from Trash"
        )
        self.session.commit()
        self.session.refresh(expense)
        return expense

    def permanent_delete(self, expense_id: str) -> str:
        """Destroy a trashed expense for good."""
        expense = self.get_deleted(expense_id)
        label = f"{expense.expense_date} / {expense.amount}"
        if expense.receipt_file_id:
            # Already detached by soft_delete; this is belt-and-braces for rows that
            # were trashed before that behaviour existed.
            self.storage.detach(expense.receipt_file_id)
        self.session.delete(expense)
        self.session.flush()
        self.audit(
            AuditAction.PURGE, "expense", expense_id, f"Permanently deleted expense ({label})"
        )
        self.session.commit()
        return label

    # --------------------------------------------------------------- receipts
    def upload_receipt(self, expense_id: str, file_id: str) -> Expense:
        """Attach an already-uploaded file as this expense's receipt.

        The bytes arrive through StorageService (app/api/files.py), the same as every
        other attachment in the app -- this only binds the resulting id to the
        expense and moves the refcount.
        """
        self.require(Permission.EXPENSE_WRITE)
        expense = self.get_scoped(Expense, expense_id, label="Expense")

        if not file_id:
            raise ValidationError("A file is required", field="file_id")
        if expense.receipt_file_id == file_id:
            return expense

        previous = expense.receipt_file_id
        self.storage.attach(file_id)
        if previous:
            self.storage.detach(previous)

        expense.receipt_file_id = file_id
        expense.updated_by_user_id = self.ctx.user.id if self.ctx.user else None
        self.session.add(expense)

        self.audit(AuditAction.UPDATE, "expense", expense.id, "Receipt uploaded")
        self.session.commit()
        self.session.refresh(expense)
        return expense

    def remove_receipt(self, expense_id: str) -> Expense:
        self.require(Permission.EXPENSE_WRITE)
        expense = self.get_scoped(Expense, expense_id, label="Expense")

        if not expense.receipt_file_id:
            return expense

        self.storage.detach(expense.receipt_file_id)
        expense.receipt_file_id = None
        expense.updated_by_user_id = self.ctx.user.id if self.ctx.user else None
        self.session.add(expense)

        self.audit(AuditAction.UPDATE, "expense", expense.id, "Receipt deleted")
        self.session.commit()
        self.session.refresh(expense)
        return expense

    # ---------------------------------------------------------------- helpers
    def _validate(self, fields: dict[str, Any]) -> None:
        if "amount" in fields and fields["amount"] is not None:
            try:
                amount = quantize_money(fields["amount"])
            except (InvalidOperation, TypeError, ValueError) as exc:
                raise ValidationError("Amount must be a number", field="amount") from exc
            if amount <= ZERO:
                raise ValidationError(
                    "An expense must be greater than zero", field="amount"
                )
            fields["amount"] = amount

        if "payment_method" in fields and fields["payment_method"] is not None:
            try:
                fields["payment_method"] = PaymentMethod(fields["payment_method"])
            except ValueError as exc:
                raise ValidationError(
                    "Unknown payment method", field="payment_method"
                ) from exc

        if "expense_date" in fields and fields["expense_date"] is not None:
            value = fields["expense_date"]
            if not isinstance(value, date):
                raise ValidationError("Expense date is invalid", field="expense_date")
            # A future-dated expense is almost always a typo in the year. Rent paid
            # in advance is still paid TODAY, which is what this column records.
            if value > today_in(self.get_business().timezone):
                raise ValidationError(
                    "An expense cannot be dated in the future", field="expense_date"
                )
            fields["expense_date"] = value

        for key in ("vendor_name", "reference", "notes", "provider"):
            if key in fields and fields[key] is not None:
                text = str(fields[key]).strip()
                fields[key] = text or None

    def _assert_references(self, fields: dict[str, Any]) -> None:
        """Every id the caller supplied must exist and belong to this tenant.

        Scoped lookups WITHOUT going through the owning services, deliberately.
        Staff hold EXPENSE_WRITE alongside the read permissions, so calling those
        services would work today -- but it would couple the write path to
        permissions it does not conceptually need, and break the moment they are
        unbundled. ``get_scoped`` is itself the tenancy boundary.

        Picking a vendor also SNAPSHOTS its name onto the expense, which is what
        keeps the record readable after the vendor is deleted (models/vendor.py).
        """
        if fields.get("category_id"):
            self.get_scoped(ExpenseCategory, fields["category_id"], label="Expense category")
        if fields.get("cash_account_id"):
            self.get_scoped(CashAccount, fields["cash_account_id"], label="Cash account")
        if fields.get("vendor_id"):
            vendor = self.get_scoped(Vendor, fields["vendor_id"], label="Vendor")
            fields["vendor_name"] = vendor.name
