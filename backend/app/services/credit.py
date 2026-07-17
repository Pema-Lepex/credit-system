"""CreditService -- the core of the product.

INVARIANTS THIS SERVICE OWNS (nothing else may write these columns)
-------------------------------------------------------------------
    I1  grand_total    == subtotal - discount_amount + tax_amount
    I2  amount_paid    == payments AIMED at this credit, plus its FIFO share of the
                          customer's account payments  (see apply_settlement)
    I3  remaining      == grand_total - amount_paid,  clamped at >= 0
    I4  status         is a pure function of (remaining, paid, due_date, cancelled)
    I5  customer aggregates and credit score reflect I2/I3 after every change

I2 USED TO SAY "SUM of this credit's own payments", AND THAT WAS THE BUG
------------------------------------------------------------------------
A payment against the ACCOUNT names no credit -- that is the point of it, and why a
shopkeeper settles four hundred purchases with one tap. But under the old I2 those
credits kept their full balance and stayed PENDING, so the Credits list insisted a
customer owed money the Account tab said they did not. Both read real columns; the
columns disagreed.

Now a credit's paid figure is decided by ``apply_settlement`` for the customer as a
whole: aimed payments stick where they were aimed, and everything else fills the
oldest credits first. It is a pure function of the payments and the credits -- no
allocation table, nothing to keep in step, and re-runnable at any time.

Any code path that changes money MUST go through ``recalculate()`` (one credit) or
``apply_settlement()`` (the customer). Both route through ``settle_credit`` for the
arithmetic, so there is exactly one place a rounding bug can live -- and
``_sync_customer`` is the single seam every write path already calls.

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
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import Select, or_
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.business import Business
from app.models.credit import Credit, CreditItem
from app.models.customer import Customer
from app.models.enums import AuditAction, CreditStatus, ItemKind, LedgerEntryType
from app.models.types import quantize_money
from app.services.base import BaseService, ServiceContext
from app.services.customer import recompute_aggregates, recompute_credit_score
from app.storage.service import StorageService
from app.utils.dates import today_in
from app.utils.numbering import next_credit_number
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")


def apply_settlement(
    session: Any, customer_id: str, *, today: date | None = None
) -> list[Credit]:
    """Decide how much of a customer's money has landed on each of their credits.

    THE PROBLEM THIS SOLVES
    -----------------------
    A payment against the ACCOUNT (PaymentService.record_to_account) names no
    credit -- that is the entire point of it, and why a shopkeeper can settle four
    hundred purchases with one tap. But it left every one of those credits sitting
    at PENDING with its original balance, so the Credits list said a customer owed
    money the Account tab said they did not. Both were reading real columns; the
    columns disagreed.

    THE RULE, in the order a shopkeeper would explain it:

      1. A payment made against ONE credit belongs to that credit. The shopkeeper
         pointed at it; we do not know better. This is the "optionally choose which
         credit" case, and it wins.
      2. Whatever is left over -- every account payment -- fills the remaining
         credits OLDEST FIRST. Nobody has to decide anything.

    So Nu.150 against two Nu.100 credits settles the first in full and leaves the
    second Nu.50 short, which is what a person would do with cash on a counter.

    A PURE FUNCTION OF THE DATA
    ---------------------------
    Nothing is stored about the allocation -- no allocation table, no payment ->
    credit links to maintain. Run this twice and nothing changes; run it after any
    write and it is right. That is what keeps the whole system consistent: there is
    no second record of "who paid what" that can drift from the payments themselves.

    It also means a voided payment, an edited credit or a back-dated purchase all
    re-settle correctly with no special case -- they change the inputs, and the
    answer is recomputed from scratch.

    Returns the credits it touched, newest allocation first. Does not commit.
    """
    from app.models.customer import Customer

    customer = session.get(Customer, customer_id)
    if customer is None:
        return []

    credits = list(
        session.exec(
            select(Credit)
            .where(
                Credit.business_id == customer.business_id,  # TENANCY BOUNDARY
                Credit.customer_id == customer_id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                # A cancelled credit never happened -- it takes no money.
                Credit.status != CreditStatus.CANCELLED,
            )
            # FIFO. issued_date is the shopkeeper's truth; created_at and id break
            # ties so the order is total and stable -- two purchases on the same day
            # must not swap places between runs and shuffle which one reads as paid.
            .order_by(
                col(Credit.issued_date).asc(),
                col(Credit.created_at).asc(),
                col(Credit.id).asc(),
            )
        ).all()
    )
    if not credits:
        return []

    direct, pool = _payment_pools(session, customer)

    touched: list[Credit] = []
    for credit in credits:
        # Rule 1: money the shopkeeper aimed at this credit.
        aimed = quantize_money(direct.get(credit.id, ZERO))
        # Rule 2: top it up from the shared pool, oldest credit first.
        shortfall = max(ZERO, quantize_money(credit.grand_total - aimed))
        take = min(shortfall, pool)
        pool = quantize_money(pool - take)

        settle_credit(credit, today=today, allocated=aimed + take)
        session.add(credit)
        touched.append(credit)

    session.flush()
    return touched


def _payment_pools(session: Any, customer: Any) -> tuple[dict[str, Decimal], Decimal]:
    """({credit_id: aimed money}, unaimed money).

    Voided and soft-deleted payments are excluded, exactly as recalculate excludes
    them -- the two must agree or a trashed payment would settle a credit that the
    balance says is still owed.
    """
    from app.models.credit import Payment

    payments = session.exec(
        select(Payment).where(
            Payment.business_id == customer.business_id,  # TENANCY BOUNDARY
            Payment.customer_id == customer.id,
            col(Payment.deleted_at).is_(None),
            col(Payment.archived_at).is_(None),
            col(Payment.voided_at).is_(None),
        )
    ).all()

    direct: dict[str, Decimal] = {}
    pool = ZERO
    for payment in payments:
        if payment.credit_id:
            direct[payment.credit_id] = direct.get(payment.credit_id, ZERO) + payment.amount
        else:
            pool += payment.amount
    return direct, quantize_money(pool)


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


def settle_credit(
    credit: Credit, *, today: date | None = None, allocated: Decimal | None = None
) -> Credit:
    """Restore I1-I4 on one credit. Pure: no session, no I/O, no commit.

    THE single implementation of "what does this credit's money look like". Both
    CreditService.recalculate and apply_settlement route through it, which is what
    makes a rounding or status bug have exactly one place to live.
    """
    # -- I1: totals from the lines -------------------------------------
    subtotal = ZERO
    item_discount = ZERO
    item_tax = ZERO
    for item in credit.items:
        CreditService.compute_item_totals(item)
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

    # -- I2: paid ---------------------------------------------------------
    # ``allocated`` is supplied by apply_settlement, which is the only thing that
    # can answer this properly: a payment made against the ACCOUNT names no
    # credit, so how much of it landed here is a FIFO question about the
    # customer's whole history, not a fact this credit's own payment list knows.
    #
    # Falling back to the direct sum keeps every caller that only wants I1/I3/I4
    # working, and is exactly right for a credit that only has direct payments.
    # Soft-deleted and voided payments never count -- that is what makes "send a
    # payment to Trash" return its amount to the balance, and "restore" put it back.
    paid = (
        quantize_money(allocated)
        if allocated is not None
        else quantize_money(
            sum(
                (
                    p.amount
                    for p in credit.payments
                    if p.voided_at is None and p.deleted_at is None
                ),
                ZERO,
            )
        )
    )
    credit.amount_paid = paid

    # -- I3: remaining, never negative ----------------------------------
    # An overpayment is clamped to 0 remaining rather than stored as negative:
    # a negative "remaining" would flow into the receivables total and quietly
    # understate what every OTHER customer owes. Overpayment is prevented at the
    # payment door (see PaymentService), so this clamp is a belt-and-braces.
    credit.remaining_amount = max(ZERO, quantize_money(credit.grand_total - paid))

    # -- I4: status ------------------------------------------------------
    credit.status = CreditService._derive_status(credit, today=today)
    if credit.status is CreditStatus.PAID and credit.paid_at is None:
        credit.paid_at = utcnow()
    elif credit.status is not CreditStatus.PAID:
        credit.paid_at = None

    return credit


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

    def recalculate(
        self, credit: Credit, *, today: date | None = None, allocated: Decimal | None = None
    ) -> Credit:
        """Restore invariants I1-I4 from the credit's items and payments.

        Idempotent by construction -- calling it twice changes nothing. That matters
        because it is invoked from create, update, payment, void, and the nightly
        integrity job, and none of them should have to reason about ordering.

        ``allocated`` overrides I2 with a figure only ``apply_settlement`` can know
        (see its docstring). Callers that leave it None get the old behaviour: paid
        == the sum of this credit's own payments.

        The arithmetic itself lives in the module-level ``settle_credit`` so that
        ``apply_settlement`` -- which has no ServiceContext and therefore no
        CreditService -- restores the SAME invariants rather than a second copy of
        them that could drift.
        """
        settle_credit(credit, today=today, allocated=allocated)
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

        # DUAL-WRITE (Stage 2): a credit IS a charge against the customer's account.
        #
        # ORDER IS LOAD-BEARING. This posts AFTER recalculate() (so grand_total is
        # final) and BEFORE any initial payment -- because PaymentService.record
        # dual-writes its own PAYMENT entry, and posting the charge afterwards would
        # put a payment at seq 1 and the charge it settles at seq 2. The running
        # balance would still end correct and the passbook would still be nonsense:
        # you cannot pay for something before it has been charged.
        from app.services.ledger import LedgerService  # local: avoids a service cycle

        LedgerService(ctx).restate_document(
            customer_id=credit.customer_id,
            entry_type=LedgerEntryType.CHARGE,
            amount=credit.grand_total,
            credit_id=credit.id,
            memo=f"Credit {credit.number}",
        )

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

    def quick_sale(
        self,
        ctx: ServiceContext,
        *,
        customer_id: str,
        amount: Decimal,
        description: str | None = None,
        occurred_on: date | None = None,
    ) -> Credit:
        """One purchase, in one call: who, how much, and (optionally) what.

        THE COUNTER PATH. A customer is standing there; the shopkeeper has seconds
        and one hand. Everything ``create()`` asks for that this omits is a question
        that has no answer at a counter:

          * items      -> one line, the amount they typed. Itemising a Nu.30
                          cigarette mid-queue is how you get a shopkeeper who uses
                          paper instead.
          * due_date   -> DERIVED, never asked. A purchase is not an invoice; the
                          obligation is the month-end statement (models/statement.py).
                          The date below exists only because Credit.due_date is still
                          NOT NULL -- it is a migration artefact, not a promise
                          anyone made, and it disappears with the column.
          * discount / tax / attachments -> not at a counter. Edit the credit after.

        Everything else is unchanged: it goes through ``create()``, so the ledger
        entry, the customer aggregates, the credit score and the audit trail are all
        exactly as they would be from the full form. This is a shorter QUESTION, not
        a second write path.
        """
        self.require(Permission.CREDIT_WRITE)
        business = self.get_business()
        today = today_in(business.timezone)

        amount = quantize_money(amount)
        if amount <= ZERO:
            raise ValidationError(
                "How much did they take? Enter an amount greater than zero.",
                field="amount",
            )

        issued = occurred_on or today
        if issued > today:
            raise ValidationError(
                "That date is in the future. A sale is recorded when it happens.",
                field="occurred_on",
            )

        return self.create(
            ctx,
            customer_id=customer_id,
            items=[
                CreditItemInput(
                    name=(description or "").strip() or "Goods",
                    quantity=Decimal("1"),
                    unit_price=amount,
                    kind=ItemKind.CUSTOM,  # not a catalog product; it is whatever they said
                )
            ],
            issued_date=issued,
            due_date=self._statement_due_date(business, issued),
            # No tax on a quick sale: the business default would silently inflate a
            # counter price the shopkeeper already quoted to the customer's face.
            tax_percentage=ZERO,
        )

    @staticmethod
    def _statement_due_date(business: Business, issued: date) -> date:
        """When this purchase's STATEMENT will fall due.

        Not a promise about this purchase -- it is the month-end date the purchase
        will be billed on, so the legacy per-credit reminder machinery chases the
        right day while both models coexist. When Credit.due_date is retired, this
        goes with it.
        """
        import calendar

        last = issued.replace(day=calendar.monthrange(issued.year, issued.month)[1])
        return last + timedelta(days=max(0, business.statement_due_days))

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
        # Editing line items moves the total, so the ledger follows with an
        # ADJUSTMENT for the difference -- never by editing the original CHARGE.
        from app.services.ledger import LedgerService

        LedgerService(ctx).adjust_document(
            credit_id=credit.id,
            customer_id=credit.customer_id,
            new_total=credit.grand_total,
            memo=f"Credit {credit.number} amended",
        )
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

        A credit with payments AIMED at it has a financial history; erasing it with a
        status flip would leave those payments pointing at a cancelled parent and
        silently corrupt the customer's balance. Void the payments first -- an
        explicit, audited act -- and only then cancel.

        The guard asks about AIMED payments, not ``amount_paid``. Since settlement
        became FIFO (see apply_settlement), amount_paid can be positive purely
        because an account payment happened to land here -- money nobody attached to
        this credit and which simply flows to the next one when this is cancelled.
        Refusing on that would block a shopkeeper from voiding a mis-rung sale for a
        reason they could neither see nor act on.
        """
        self.require(Permission.CREDIT_WRITE)
        credit = self.get(credit_id)

        aimed = self._aimed_at(credit)
        if aimed > ZERO:
            raise ConflictError(
                f"Credit {credit.number} has {aimed} paid directly against it. "
                "Void those payments before cancelling."
            )

        credit.status = CreditStatus.CANCELLED
        credit.notes = f"{credit.notes}\n\nCancelled: {reason}" if reason else credit.notes
        self.session.add(credit)
        self._cancel_pending_reminders(credit.id)
        self.session.flush()
        # A cancelled credit leaves the legacy aggregates (_live_credits excludes
        # CANCELLED), so it must leave the ledger too -- as a reversal.
        from app.services.ledger import LedgerService

        LedgerService(ctx).reverse_document(
            credit_id=credit.id, memo=f"Cancelled credit {credit.number}"
        )
        self._sync_customer(credit.customer_id)
        self.audit(
            AuditAction.UPDATE, "credit", credit.id, f"Cancelled credit {credit.number}: {reason or 'no reason given'}"
        )
        return credit

    def soft_delete(self, ctx: ServiceContext, credit_id: str) -> Credit:
        self.require(Permission.CREDIT_DELETE)
        credit = self.get(credit_id)
        # AIMED payments only -- see cancel() for why amount_paid is the wrong test.
        if self._aimed_at(credit) > ZERO:
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
        from app.services.ledger import LedgerService

        LedgerService(ctx).reverse_document(
            credit_id=credit.id, memo=f"Credit {credit.number} moved to Trash"
        )
        self._sync_customer(credit.customer_id)
        self.audit(AuditAction.DELETE, "credit", credit.id, f"Deleted credit {credit.number}")
        return credit

    # ----------------------------------------------------------------- trash
    # soft_delete (above) sends a credit to the Trash. These three manage it there:
    # list it, restore it, or destroy it for good. Every one is CREDIT_DELETE, which
    # is an admin-only permission -- staff cannot reach the Trash at all.
    def get_deleted(self, credit_id: str) -> Credit:
        """Fetch a credit that IS in the Trash (the inverse of get())."""
        self.require(Permission.CREDIT_DELETE)
        credit = self.session.get(Credit, credit_id)
        if credit is None or credit.deleted_at is None:
            raise NotFoundError("Deleted credit not found")
        self.assert_in_scope(credit.business_id)
        return credit

    def list_deleted(self, page: PageInput | None = None) -> Page[Credit]:
        """The Trash view: credits with deleted_at set, newest first."""
        self.require(Permission.CREDIT_DELETE)
        stmt = (
            select(Credit)
            .where(
                Credit.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Credit.deleted_at).is_not(None),
            )
            .order_by(col(Credit.deleted_at).desc())
        )
        return paginate(self.session, stmt, page or PageInput())

    def restore(self, credit_id: str, *, today: date | None = None) -> Credit:
        """Bring a credit back out of the Trash, balances and status re-derived."""
        credit = self.get_deleted(credit_id)
        credit.deleted_at = None
        self.session.add(credit)
        self.session.flush()
        # A credit's status can have moved on while it sat in the Trash (its due date
        # may now be in the past). recalculate() re-derives status from the data.
        self.recalculate(credit, today=today)
        self.session.flush()
        # Back into the balance as a NEW charge -- a reversal cannot be un-posted.
        from app.services.ledger import LedgerService

        LedgerService(self.ctx).restate_document(
            customer_id=credit.customer_id,
            entry_type=LedgerEntryType.CHARGE,
            amount=credit.grand_total,
            credit_id=credit.id,
            memo=f"Credit {credit.number} restored from Trash",
        )
        self._sync_customer(credit.customer_id)
        self.audit(AuditAction.UPDATE, "credit", credit.id, f"Restored credit {credit.number}")
        return credit

    def permanent_delete(self, credit_id: str) -> str:
        """Destroy a trashed credit for good. Returns its number for the audit trail.

        Only reachable for a credit already IN the Trash -- you cannot skip the
        soft-delete step. Its line items go with it via the ORM cascade; the customer's
        rolled-up totals are re-synced so the deletion is reflected immediately.
        """
        credit = self.get_deleted(credit_id)
        number = credit.number
        customer_id = credit.customer_id

        # Release any files this credit still referenced, so a hard delete does not
        # strand bytes in storage with a now-dangling reference count.
        storage = StorageService(self.session)
        storage.detach_many(credit.photo_file_ids)
        storage.detach(credit.invoice_file_id)

        self.session.delete(credit)  # cascade removes credit_item rows
        self.session.flush()
        self._sync_customer(customer_id)
        self.audit(AuditAction.DELETE, "credit", credit_id, f"Permanently deleted credit {number}")
        return number

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

    @staticmethod
    def _aimed_at(credit: Credit) -> Decimal:
        """Money a shopkeeper attached to THIS credit by name.

        The counterpart to apply_settlement's rule 1. Distinct from
        ``credit.amount_paid``, which since FIFO also includes whatever share of the
        customer's account payments happens to have flowed here.
        """
        return quantize_money(
            sum(
                (
                    p.amount
                    for p in credit.payments
                    if p.voided_at is None and p.deleted_at is None
                ),
                ZERO,
            )
        )

    def _sync_customer(self, customer_id: str) -> None:
        """I5. Per-credit settlement, then the roll-ups. Order matters.

        apply_settlement decides each credit's amount_paid/remaining/status;
        recompute_aggregates then rolls those up (overdue_count reads the statuses
        this just set). Running them the other way round would count yesterday's
        overdue credits.

        This is the ONE seam every money path already goes through -- create, update,
        cancel, trash, restore, payment, void -- which is why settlement cannot be
        forgotten by a new write path.
        """
        apply_settlement(self.session, customer_id, today=self._today())
        recompute_aggregates(self.session, customer_id)
        recompute_credit_score(self.session, customer_id)

    def _today(self) -> date:
        """Today where the SHOP is. A credit falls overdue on the shopkeeper's
        calendar, not the server's."""
        return today_in(self.get_business().timezone)

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
