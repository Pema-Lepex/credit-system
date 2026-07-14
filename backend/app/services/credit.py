"""CreditService -- the core of the product.

INVARIANTS THIS SERVICE OWNS (nothing else may write these columns)
-------------------------------------------------------------------
    I1  grand_total    == subtotal - discount_amount + tax_amount
    I2  amount_paid    == SUM(non-voided payments on this credit)
    I3  remaining      == grand_total - amount_paid,  clamped at >= 0
    I4  status         is a pure function of (remaining, paid, due_date, cancelled)
    I5  customer aggregates and credit score reflect I2/I3 after every change

Any code path that changes money MUST go through ``recalculate()``, which restores
all five together. That is the whole trick: there is exactly one function that can
compute a total, so there is exactly one place a rounding bug can live.

WHY TOTALS ARE STORED, NOT COMPUTED ON READ
--------------------------------------------
See models/credit.py. Short version: the dashboard, the overdue filter, the
customer list and the nightly reminder sweep all need "who owes what" as a
*filterable, sortable, indexable* column. Recomputing it per row per query does not
survive contact with a real dataset. The denormalisation is safe because writes are
funnelled through one service and a nightly integrity job re-derives the values
from the payment ledger and reports any drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, or_
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.credit import Credit, CreditItem
from app.models.customer import Customer
from app.models.enums import AuditAction, CreditStatus, ItemKind
from app.models.types import quantize_money
from app.services.base import BaseService, ServiceContext
from app.services.customer import recompute_aggregates, recompute_credit_score
from app.storage.service import StorageService
from app.utils.dates import today_in
from app.utils.numbering import next_credit_number
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")


@dataclass(slots=True)
class CreditItemInput:
    name: str
    quantity: Decimal
    unit_price: Decimal
    kind: ItemKind = ItemKind.PRODUCT
    product_id: str | None = None
    service_id: str | None = None
    description: str | None = None
    unit: str = "pcs"
    discount_amount: Decimal = ZERO
    tax_percentage: Decimal = ZERO


@dataclass(slots=True)
class CreditFilter:
    search: str | None = None
    status: list[CreditStatus] | None = None
    customer_id: str | None = None
    due_from: date | None = None
    due_to: date | None = None
    issued_from: date | None = None
    issued_to: date | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    overdue_only: bool = False
    include_archived: bool = False


class CreditService(BaseService):
    # ------------------------------------------------------------------ money
    @staticmethod
    def compute_item_totals(item: CreditItem) -> None:
        """Apply the line-item formula. The single source of truth for a line.

        line_subtotal = unit_price * quantity
        taxable       = line_subtotal - discount        <- tax applies AFTER discount,
                                                           which is what tax authorities
                                                           (and customers) expect
        tax_amount    = taxable * tax_pct / 100
        line_total    = taxable + tax_amount
        """
        subtotal = quantize_money(Decimal(item.unit_price) * Decimal(item.quantity))
        discount = quantize_money(item.discount_amount or ZERO)
        if discount > subtotal:
            raise ValidationError(
                f"Discount ({discount}) is larger than the line total ({subtotal}) "
                f"for '{item.name}'",
                field="discount_amount",
            )
        taxable = subtotal - discount
        tax_pct = Decimal(item.tax_percentage or ZERO)
        tax = quantize_money(taxable * tax_pct / Decimal("100"))

        item.line_subtotal = subtotal
        item.tax_amount = tax
        item.line_total = quantize_money(taxable + tax)

    def recalculate(self, credit: Credit, *, today: date | None = None) -> Credit:
        """Restore invariants I1-I4 from the credit's items and payments.

        Idempotent by construction -- calling it twice changes nothing. That matters
        because it is invoked from create, update, payment, void, and the nightly
        integrity job, and none of them should have to reason about ordering.
        """
        # -- I1: totals from the lines -------------------------------------
        subtotal = ZERO
        item_discount = ZERO
        item_tax = ZERO
        for item in credit.items:
            self.compute_item_totals(item)
            subtotal += item.line_subtotal
            item_discount += quantize_money(item.discount_amount or ZERO)
            item_tax += item.tax_amount

        subtotal = quantize_money(subtotal)

        # Credit-level percentages stack on top of the per-line amounts. Applied to
        # the post-line-discount base so a 10% "whole invoice" discount doesn't
        # accidentally discount a line twice.
        base_after_item_discounts = subtotal - item_discount
        credit_discount = ZERO
        if credit.discount_percentage:
            credit_discount = quantize_money(
                base_after_item_discounts * Decimal(credit.discount_percentage) / Decimal("100")
            )

        total_discount = quantize_money(item_discount + credit_discount)
        if total_discount > subtotal:
            raise ValidationError("Total discount exceeds the credit subtotal", field="discount")

        credit_tax = ZERO
        if credit.tax_percentage:
            taxable = subtotal - total_discount
            credit_tax = quantize_money(taxable * Decimal(credit.tax_percentage) / Decimal("100"))

        credit.subtotal = subtotal
        credit.discount_amount = total_discount
        credit.tax_amount = quantize_money(item_tax + credit_tax)
        credit.grand_total = quantize_money(subtotal - total_discount + credit.tax_amount)

        # -- I2: paid, from the ledger (voided payments do not count) --------
        paid = quantize_money(
            sum((p.amount for p in credit.payments if p.voided_at is None), ZERO)
        )
        credit.amount_paid = paid

        # -- I3: remaining, never negative ----------------------------------
        # An overpayment is clamped to 0 remaining rather than stored as negative:
        # a negative "remaining" would flow into the receivables total and quietly
        # understate what every OTHER customer owes. Overpayment is prevented at the
        # payment door (see PaymentService), so this clamp is a belt-and-braces.
        credit.remaining_amount = max(ZERO, quantize_money(credit.grand_total - paid))

        # -- I4: status ------------------------------------------------------
        credit.status = self._derive_status(credit, today=today)
        if credit.status is CreditStatus.PAID and credit.paid_at is None:
            credit.paid_at = utcnow()
        elif credit.status is not CreditStatus.PAID:
            credit.paid_at = None

        self.session.add(credit)
        return credit

    @staticmethod
    def _derive_status(credit: Credit, *, today: date | None = None) -> CreditStatus:
        """I4. Status is derived, never hand-set (except CANCELLED, which is a
        human decision and therefore sticky)."""
        if CreditStatus(credit.status) is CreditStatus.CANCELLED:
            return CreditStatus.CANCELLED

        if credit.remaining_amount <= ZERO and credit.grand_total > ZERO:
            return CreditStatus.PAID
        # A zero-value credit (all lines free) is meaningless as "pending forever".
        if credit.grand_total <= ZERO:
            return CreditStatus.PAID

        reference = today or date.today()
        if credit.due_date < reference:
            return CreditStatus.OVERDUE
        if credit.amount_paid > ZERO:
            return CreditStatus.PARTIALLY_PAID
        return CreditStatus.PENDING

    # ----------------------------------------------------------------- create
    def create(
        self,
        ctx: ServiceContext,
        *,
        customer_id: str,
        items: list[CreditItemInput],
        issued_date: date | None = None,
        due_date: date,
        reminder_date: date | None = None,
        discount_percentage: Decimal | None = None,
        tax_percentage: Decimal | None = None,
        notes: str | None = None,
        photo_file_ids: list[str] | None = None,
        invoice_file_id: str | None = None,
        initial_payment: Decimal | None = None,
    ) -> Credit:
        self.require(Permission.CREDIT_WRITE)
        business = self.get_business()
        today = today_in(business.timezone)
        issued = issued_date or today

        if not items:
            raise ValidationError("A credit record needs at least one item", field="items")
        if due_date < issued:
            raise ValidationError(
                "The due date cannot be before the issue date", field="due_date"
            )

        customer = self._get_customer(customer_id)
        if customer.status.value == "BLOCKED":
            raise ConflictError(
                f"{customer.name} is blocked from taking further credit. "
                "Change their status to Active first."
            )

        credit = Credit(
            business_id=self.scope_id,
            number=next_credit_number(self.session, self.scope_id, on=issued),
            customer_id=customer.id,
            issued_date=issued,
            due_date=due_date,
            reminder_date=reminder_date,
            # Fall back to the business's configured tax rate so the shopkeeper
            # doesn't retype it on every sale, but let an explicit value win.
            tax_percentage=(
                tax_percentage
                if tax_percentage is not None
                else (business.tax_percentage or None)
            ),
            discount_percentage=discount_percentage,
            currency=business.currency,
            notes=notes,
            photo_file_ids=list(photo_file_ids or []),
            invoice_file_id=invoice_file_id,
            created_by_user_id=ctx.user.id if ctx.user else None,
        )
        self.session.add(credit)
        self.session.flush()  # assign credit.id before items reference it

        for position, raw in enumerate(items):
            credit.items.append(self._build_item(raw, credit, position))

        self.recalculate(credit, today=today)

        # Files must be reference-counted or the nightly orphan sweep will delete
        # attachments that are very much still in use.
        storage = StorageService(self.session)
        storage.attach_many(credit.photo_file_ids)
        storage.attach(credit.invoice_file_id)

        self._decrement_stock(items)

        self.session.flush()

        if initial_payment and initial_payment > ZERO:
            # Circular import at module scope (payment imports credit); local import
            # keeps the dependency one-directional where it matters.
            from app.services.payment import PaymentService

            PaymentService(ctx).record(
                ctx, credit_id=credit.id, amount=initial_payment, notes="Paid at time of sale"
            )
            self.session.refresh(credit)

        self._sync_customer(credit.customer_id)
        self.audit(
            AuditAction.CREATE,
            "credit",
            credit.id,
            f"Created credit {credit.number} for {customer.name} "
            f"({business.currency} {credit.grand_total})",
        )
        return credit

    def _build_item(self, raw: CreditItemInput, credit: Credit, position: int) -> CreditItem:
        if raw.quantity <= ZERO:
            raise ValidationError(
                f"Quantity must be greater than zero for '{raw.name}'", field="quantity"
            )
        if raw.unit_price < ZERO:
            raise ValidationError(
                f"Price cannot be negative for '{raw.name}'", field="unit_price"
            )
        return CreditItem(
            business_id=self.scope_id,
            credit_id=credit.id,
            kind=raw.kind,
            product_id=raw.product_id,
            service_id=raw.service_id,
            name=raw.name.strip(),
            description=raw.description,
            unit=raw.unit,
            quantity=Decimal(raw.quantity),
            unit_price=quantize_money(raw.unit_price),
            discount_amount=quantize_money(raw.discount_amount or ZERO),
            tax_percentage=Decimal(raw.tax_percentage or ZERO),
            position=position,
        )

    def _decrement_stock(self, items: list[CreditItemInput]) -> None:
        """Reduce stock for catalog products.

        Deliberately allowed to go negative -- see models/catalog.py. This is a
        credit tracker, not inventory software; blocking a sale because a count is
        stale would be worse than surfacing the discrepancy.
        """
        from app.models.catalog import Product

        for raw in items:
            if raw.kind is not ItemKind.PRODUCT or not raw.product_id:
                continue
            product = self.session.get(Product, raw.product_id)
            if product and product.business_id == self.scope_id:
                product.stock_quantity = Decimal(product.stock_quantity) - Decimal(raw.quantity)
                self.session.add(product)

    # ----------------------------------------------------------------- update
    def update(
        self,
        ctx: ServiceContext,
        credit_id: str,
        *,
        items: list[CreditItemInput] | None = None,
        due_date: date | None = None,
        reminder_date: date | None = None,
        discount_percentage: Decimal | None = None,
        tax_percentage: Decimal | None = None,
        notes: str | None = None,
        photo_file_ids: list[str] | None = None,
        invoice_file_id: str | None = None,
    ) -> Credit:
        self.require(Permission.CREDIT_WRITE)
        credit = self.get(credit_id)

        if CreditStatus(credit.status) is CreditStatus.CANCELLED:
            raise ConflictError("A cancelled credit cannot be edited. Create a new one instead.")

        business = self.get_business()
        today = today_in(business.timezone)
        storage = StorageService(self.session)
        before = {
            "grand_total": str(credit.grand_total),
            "due_date": credit.due_date.isoformat(),
        }

        if items is not None:
            # Replace the line set wholesale. delete-orphan on the relationship means
            # dropping them from the list is enough to delete the rows.
            credit.items.clear()
            self.session.flush()
            for position, raw in enumerate(items):
                credit.items.append(self._build_item(raw, credit, position))

        if due_date is not None:
            if due_date < credit.issued_date:
                raise ValidationError(
                    "The due date cannot be before the issue date", field="due_date"
                )
            credit.due_date = due_date
            # Moving the due date invalidates any reminder already queued for the old
            # one. Drop the stale schedule; the nightly sweep re-plans from scratch.
            self._cancel_pending_reminders(credit.id)

        if reminder_date is not None:
            credit.reminder_date = reminder_date
        if discount_percentage is not None:
            credit.discount_percentage = discount_percentage
        if tax_percentage is not None:
            credit.tax_percentage = tax_percentage
        if notes is not None:
            credit.notes = notes

        if photo_file_ids is not None:
            storage.detach_many(credit.photo_file_ids)
            credit.photo_file_ids = list(photo_file_ids)
            storage.attach_many(credit.photo_file_ids)

        if invoice_file_id is not None and invoice_file_id != credit.invoice_file_id:
            storage.detach(credit.invoice_file_id)
            credit.invoice_file_id = invoice_file_id
            storage.attach(invoice_file_id)

        self.recalculate(credit, today=today)

        # Editing lines can drop the total below what has already been paid.
        if credit.grand_total < credit.amount_paid:
            raise ConflictError(
                f"The new total ({credit.grand_total}) is less than the "
                f"{credit.amount_paid} already paid. Void a payment first, or refund "
                f"the difference."
            )

        self.session.flush()
        self._sync_customer(credit.customer_id)
        self.audit(
            AuditAction.UPDATE,
            "credit",
            credit.id,
            f"Updated credit {credit.number}",
            changes={
                "before": before,
                "after": {
                    "grand_total": str(credit.grand_total),
                    "due_date": credit.due_date.isoformat(),
                },
            },
        )
        return credit

    def cancel(self, ctx: ServiceContext, credit_id: str, reason: str | None = None) -> Credit:
        """Cancel a credit. Refused once money has changed hands.

        A credit with payments against it has a financial history; erasing it with a
        status flip would leave those payments pointing at a cancelled parent and
        silently corrupt the customer's balance. Void the payments first -- an
        explicit, audited act -- and only then cancel.
        """
        self.require(Permission.CREDIT_WRITE)
        credit = self.get(credit_id)

        if credit.amount_paid > ZERO:
            raise ConflictError(
                f"Credit {credit.number} has {credit.amount_paid} paid against it. "
                "Void the payments before cancelling."
            )

        credit.status = CreditStatus.CANCELLED
        credit.notes = f"{credit.notes}\n\nCancelled: {reason}" if reason else credit.notes
        self.session.add(credit)
        self._cancel_pending_reminders(credit.id)
        self.session.flush()
        self._sync_customer(credit.customer_id)
        self.audit(
            AuditAction.UPDATE, "credit", credit.id, f"Cancelled credit {credit.number}: {reason or 'no reason given'}"
        )
        return credit

    def soft_delete(self, ctx: ServiceContext, credit_id: str) -> Credit:
        self.require(Permission.CREDIT_DELETE)
        credit = self.get(credit_id)
        if credit.amount_paid > ZERO:
            raise ConflictError(
                "This credit has payments recorded against it and cannot be deleted. "
                "Cancel it instead, so the payment history survives."
            )

        credit.deleted_at = utcnow()
        self.session.add(credit)

        storage = StorageService(self.session)
        storage.detach_many(credit.photo_file_ids)
        storage.detach(credit.invoice_file_id)

        self._cancel_pending_reminders(credit.id)
        self.session.flush()
        self._sync_customer(credit.customer_id)
        self.audit(AuditAction.DELETE, "credit", credit.id, f"Deleted credit {credit.number}")
        return credit

    # ------------------------------------------------------------------ reads
    def get(self, credit_id: str) -> Credit:
        self.require(Permission.CREDIT_READ)
        credit = self.session.get(Credit, credit_id)
        if credit is None or credit.deleted_at is not None:
            raise NotFoundError("Credit record not found")
        self.assert_in_scope(credit.business_id)
        return credit

    def get_by_number(self, number: str) -> Credit:
        self.require(Permission.CREDIT_READ)
        credit = self.session.exec(
            select(Credit).where(
                Credit.business_id == self.scope_id,
                Credit.number == number,
                col(Credit.deleted_at).is_(None),
            )
        ).first()
        if credit is None:
            raise NotFoundError(f"No credit with number {number}")
        return credit

    def list(
        self,
        filters: CreditFilter | None = None,
        page: PageInput | None = None,
        *,
        sort_by: str = "created_at",
        sort_desc: bool = True,
    ) -> Page[Credit]:
        self.require(Permission.CREDIT_READ)
        stmt = self._base_query(filters or CreditFilter())
        stmt = self._apply_sort(stmt, sort_by, sort_desc)
        return paginate(self.session, stmt, page or PageInput())

    def _base_query(self, f: CreditFilter) -> Select[Any]:
        stmt = select(Credit).where(
            Credit.business_id == self.scope_id,
            col(Credit.deleted_at).is_(None),
        )
        if not f.include_archived:
            # Archived records are in the deletion pipeline and must not appear in
            # day-to-day lists, or the owner will think they still have to chase them.
            stmt = stmt.where(col(Credit.archived_at).is_(None))

        if f.search:
            term = f"%{f.search.strip()}%"
            # Search hits the credit number directly, or the customer's name/phone via
            # a subquery -- cheaper than a join when the term matches no customer.
            customer_ids = select(Customer.id).where(
                Customer.business_id == self.scope_id,
                or_(
                    col(Customer.name).ilike(term),
                    col(Customer.phone).ilike(term),
                    col(Customer.code).ilike(term),
                ),
            )
            stmt = stmt.where(
                or_(
                    col(Credit.number).ilike(term),
                    col(Credit.notes).ilike(term),
                    col(Credit.customer_id).in_(customer_ids),
                )
            )

        if f.status:
            stmt = stmt.where(col(Credit.status).in_([CreditStatus(s) for s in f.status]))
        if f.customer_id:
            stmt = stmt.where(Credit.customer_id == f.customer_id)
        if f.due_from:
            stmt = stmt.where(Credit.due_date >= f.due_from)
        if f.due_to:
            stmt = stmt.where(Credit.due_date <= f.due_to)
        if f.issued_from:
            stmt = stmt.where(Credit.issued_date >= f.issued_from)
        if f.issued_to:
            stmt = stmt.where(Credit.issued_date <= f.issued_to)
        if f.min_amount is not None:
            stmt = stmt.where(Credit.grand_total >= quantize_money(f.min_amount))
        if f.max_amount is not None:
            stmt = stmt.where(Credit.grand_total <= quantize_money(f.max_amount))
        if f.overdue_only:
            stmt = stmt.where(Credit.status == CreditStatus.OVERDUE)
        return stmt

    @staticmethod
    def _apply_sort(stmt: Select[Any], sort_by: str, desc: bool) -> Select[Any]:
        # Whitelist. Interpolating a client-supplied column name into an ORDER BY is
        # an injection vector even through an ORM.
        columns = {
            "created_at": Credit.created_at,
            "due_date": Credit.due_date,
            "issued_date": Credit.issued_date,
            "grand_total": Credit.grand_total,
            "remaining_amount": Credit.remaining_amount,
            "number": Credit.number,
            "status": Credit.status,
        }
        column = columns.get(sort_by, Credit.created_at)
        return stmt.order_by(col(column).desc() if desc else col(column).asc())

    def upcoming_due(self, days: int = 7, limit: int = 10) -> list[Credit]:
        """Credits falling due within the next N days. Powers the dashboard widget."""
        self.require(Permission.CREDIT_READ)
        business = self.get_business()
        today = today_in(business.timezone)
        from datetime import timedelta

        stmt = (
            select(Credit)
            .where(
                Credit.business_id == self.scope_id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                col(Credit.status).in_(list(CreditStatus.open_statuses())),
                Credit.due_date >= today,
                Credit.due_date <= today + timedelta(days=days),
            )
            .order_by(col(Credit.due_date).asc())
            .limit(limit)
        )
        return list(self.session.exec(stmt).all())

    # --------------------------------------------------------------- lifecycle
    def promote_overdue(self, *, business_id: str, today: date) -> int:
        """Flip open credits past their due date to OVERDUE. Returns the count.

        Called nightly by the scheduler. This is why OVERDUE is a stored status
        rather than a computed one -- see enums.CreditStatus.
        """
        stmt = select(Credit).where(
            Credit.business_id == business_id,
            col(Credit.deleted_at).is_(None),
            col(Credit.archived_at).is_(None),
            col(Credit.status).in_([CreditStatus.PENDING, CreditStatus.PARTIALLY_PAID]),
            Credit.due_date < today,
            Credit.remaining_amount > ZERO,
        )
        promoted = 0
        for credit in self.session.exec(stmt).all():
            credit.status = CreditStatus.OVERDUE
            self.session.add(credit)
            promoted += 1
        return promoted

    def verify_integrity(self, *, business_id: str) -> list[dict[str, Any]]:
        """Re-derive every credit's totals from its ledger and report drift.

        The safety net under the denormalisation. Run monthly. If this ever returns
        a non-empty list, a write path bypassed ``recalculate()`` and needs fixing --
        the report tells you exactly which credit and by how much.
        """
        drift: list[dict[str, Any]] = []
        stmt = select(Credit).where(
            Credit.business_id == business_id, col(Credit.deleted_at).is_(None)
        )
        for credit in self.session.exec(stmt).all():
            stored_total = credit.grand_total
            stored_paid = credit.amount_paid
            stored_remaining = credit.remaining_amount

            expected_paid = quantize_money(
                sum((p.amount for p in credit.payments if p.voided_at is None), ZERO)
            )
            expected_remaining = max(ZERO, quantize_money(stored_total - expected_paid))

            if stored_paid != expected_paid or stored_remaining != expected_remaining:
                drift.append(
                    {
                        "credit_id": credit.id,
                        "number": credit.number,
                        "stored_paid": str(stored_paid),
                        "expected_paid": str(expected_paid),
                        "stored_remaining": str(stored_remaining),
                        "expected_remaining": str(expected_remaining),
                    }
                )
                credit.amount_paid = expected_paid
                credit.remaining_amount = expected_remaining
                self.session.add(credit)
        return drift

    # ----------------------------------------------------------------- helpers
    def _get_customer(self, customer_id: str) -> Customer:
        customer = self.session.get(Customer, customer_id)
        if customer is None or customer.deleted_at is not None:
            raise NotFoundError("Customer not found")
        self.assert_in_scope(customer.business_id)
        return customer

    def _sync_customer(self, customer_id: str) -> None:
        """I5. Aggregates and score always follow the money."""
        recompute_aggregates(self.session, customer_id)
        recompute_credit_score(self.session, customer_id)

    def _cancel_pending_reminders(self, credit_id: str) -> None:
        from app.models.communication import ScheduledReminder
        from app.models.enums import ReminderStatus

        stmt = select(ScheduledReminder).where(
            ScheduledReminder.credit_id == credit_id,
            ScheduledReminder.status == ReminderStatus.SCHEDULED,
        )
        for reminder in self.session.exec(stmt).all():
            reminder.status = ReminderStatus.CANCELLED
            self.session.add(reminder)
