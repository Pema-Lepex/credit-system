"""PaymentService -- the append-only payment ledger.

WHY PAYMENTS ARE NEVER EDITED OR DELETED
-----------------------------------------
A payment is a claim about something that happened in the physical world: a
customer handed over 500 in cash on Tuesday. Editing that row rewrites history. If
the amount was wrong, the truth is not "it was always 300" -- the truth is "we
recorded 500, that was a mistake, and here is the correction".

So: ``void()`` marks the original as reversed (keeping it, with a reason and a
timestamp), and a new payment records what actually happened. The customer's
statement then reads like a bank statement, which is exactly what a shopkeeper
arguing with a customer about a balance needs it to.

Overpayment is refused at this door (rather than clamped later) so that the
shopkeeper finds out at the counter, while the customer is still standing there.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import or_
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import AuditAction, CreditStatus, LedgerEntryType, PaymentMethod
from app.models.types import quantize_money
from app.services.base import BaseService, ServiceContext
from app.services.credit import CreditService
from app.services.customer import recompute_aggregates, recompute_credit_score
from app.services.ledger import LedgerService
from app.storage.service import StorageService
from app.utils.dates import ensure_utc, today_in
from app.utils.numbering import next_payment_number
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")


@dataclass(slots=True)
class PaymentFilter:
    search: str | None = None
    credit_id: str | None = None
    customer_id: str | None = None
    method: list[PaymentMethod] | None = None
    date_from: date | None = None
    date_to: date | None = None
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    include_voided: bool = False


class PaymentService(BaseService):
    # -------------------------------------------------------- account payment
    def record_to_account(
        self,
        ctx: ServiceContext,
        *,
        customer_id: str,
        amount: Decimal,
        method: PaymentMethod = PaymentMethod.CASH,
        paid_at: datetime | None = None,
        reference: str | None = None,
        notes: str | None = None,
        receipt_file_id: str | None = None,
    ) -> Payment:
        """Record a payment against the customer's BALANCE. Stage 2's whole point.

        This is what a shop actually does: the customer hands over Nu.10,000 on
        salary day, and it pays down what they owe. It is not a payment for the
        cigarette they bought on the 3rd, and this method never asks which one --
        ``record()`` (below) is the legacy path that must.

        COST: one Payment row and one ledger entry. Constant, whether the customer
        has 4 purchases behind them or 40,000. Nothing walks their credits.

        OVERPAYMENT IS ALLOWED HERE, deliberately -- unlike ``record()``, which
        refuses it. Against one invoice, paying more than it is worth is a mistake.
        Against an account it is an ADVANCE: a real thing shops take on salary day,
        which lands as a negative balance. The legacy ``outstanding_balance`` clamps
        that to zero and loses it; the ledger keeps it.
        """
        self.require(Permission.PAYMENT_WRITE)
        business = self.get_business()
        customer = self.get_scoped(Customer, customer_id, label="Customer")

        amount = quantize_money(amount)
        if amount <= ZERO:
            raise ValidationError("A payment must be greater than zero", field="amount")

        when = ensure_utc(paid_at) if paid_at else utcnow()

        payment = Payment(
            business_id=self.scope_id,
            number=next_payment_number(self.session, self.scope_id, on=when.date()),
            credit_id=None,  # THE point: this payment names no invoice
            customer_id=customer.id,
            amount=amount,
            method=method,
            reference=reference,
            notes=notes,
            paid_at=when,
            receipt_file_id=receipt_file_id,
            received_by_user_id=ctx.user.id if ctx.user else None,
        )
        self.session.add(payment)
        self.session.flush()

        entry = LedgerService(ctx).post(
            customer_id=customer.id,
            entry_type=LedgerEntryType.PAYMENT,
            amount=-amount,  # the sign convention, applied once
            occurred_at=when,
            payment_id=payment.id,
            memo=f"Payment {payment.number} ({method.value})",
        )

        # For an account payment this is the CUSTOMER's balance -- which is what the
        # receipt should say. (On the legacy path it is the credit's remaining
        # amount; see record(). Different questions, same column, because the two
        # paths coexist during the migration.)
        payment.balance_after = entry.balance_after
        self.session.add(payment)

        if receipt_file_id:
            StorageService(self.session).attach(receipt_file_id)

        self.session.flush()
        # Keeps the legacy aggregates right too: recompute_aggregates sums payments
        # by customer_id, not through credits, so an account payment already lowers
        # outstanding_balance correctly with no changes there.
        self._sync_customer(customer.id)

        self.audit(
            AuditAction.CREATE,
            "payment",
            payment.id,
            f"Recorded {business.currency} {amount} to {customer.name}'s account "
            f"({method.value}); balance now {entry.balance_after}",
        )
        return payment

    # ----------------------------------------------------------------- record
    def record(
        self,
        ctx: ServiceContext,
        *,
        credit_id: str,
        amount: Decimal,
        method: PaymentMethod = PaymentMethod.CASH,
        paid_at: datetime | None = None,
        reference: str | None = None,
        notes: str | None = None,
        receipt_file_id: str | None = None,
    ) -> Payment:
        """Record a payment against a credit and restore every downstream invariant."""
        self.require(Permission.PAYMENT_WRITE)
        business = self.get_business()
        today = today_in(business.timezone)

        credit = self.session.get(Credit, credit_id)
        if credit is None or credit.deleted_at is not None:
            raise NotFoundError("Credit record not found")
        self.assert_in_scope(credit.business_id)

        amount = quantize_money(amount)
        if amount <= ZERO:
            raise ValidationError("A payment must be greater than zero", field="amount")

        if CreditStatus(credit.status) is CreditStatus.CANCELLED:
            raise ConflictError("Cannot record a payment against a cancelled credit")

        # Refuse overpayment here, at the counter -- not silently downstream.
        if amount > credit.remaining_amount:
            raise ConflictError(
                f"Payment of {business.currency} {amount} is more than the "
                f"{business.currency} {credit.remaining_amount} outstanding on "
                f"{credit.number}. Record {credit.remaining_amount} to settle it in full."
            )

        when = ensure_utc(paid_at) if paid_at else utcnow()

        payment = Payment(
            business_id=self.scope_id,
            number=next_payment_number(self.session, self.scope_id, on=when.date()),
            credit_id=credit.id,
            customer_id=credit.customer_id,
            amount=amount,
            method=method,
            reference=reference,
            notes=notes,
            paid_at=when,
            receipt_file_id=receipt_file_id,
            received_by_user_id=ctx.user.id if ctx.user else None,
        )
        self.session.add(payment)
        credit.payments.append(payment)
        self.session.flush()

        # CreditService owns the totals -- we never touch credit.amount_paid directly.
        CreditService(ctx).recalculate(credit, today=today)

        # Snapshot the balance AFTER recalculation, so the receipt says what the
        # customer's balance actually was at that moment. Doing this before the
        # recalc would print a stale figure on the receipt.
        payment.balance_after = credit.remaining_amount
        self.session.add(payment)

        if receipt_file_id:
            StorageService(self.session).attach(receipt_file_id)

        # DUAL-WRITE (Stage 2). The legacy path keeps its per-credit semantics AND
        # posts to the ledger, so the two models never drift apart while both exist.
        # Without this the ledger would go stale the moment anyone took a payment
        # the old way, and reconcile() would start reporting drift that is really
        # just a missing hook.
        LedgerService(ctx).post(
            customer_id=credit.customer_id,
            entry_type=LedgerEntryType.PAYMENT,
            amount=-amount,
            occurred_at=when,
            payment_id=payment.id,
            memo=f"Payment {payment.number} on {credit.number}",
        )

        self.session.flush()
        self._sync_customer(credit.customer_id)

        self.audit(
            AuditAction.CREATE,
            "payment",
            payment.id,
            f"Recorded {business.currency} {amount} on {credit.number} "
            f"({method.value}); balance now {credit.remaining_amount}",
        )
        return payment

    # ------------------------------------------------------------------- void
    def void(self, ctx: ServiceContext, payment_id: str, reason: str) -> Payment:
        """Reverse a payment without erasing it."""
        self.require(Permission.PAYMENT_DELETE)
        payment = self.get(payment_id)

        if payment.voided_at is not None:
            raise ConflictError(f"Payment {payment.number} is already voided")
        if not reason or not reason.strip():
            raise ValidationError(
                "A reason is required to void a payment -- it becomes part of the "
                "permanent record.",
                field="reason",
            )

        business = self.get_business()
        today = today_in(business.timezone)

        payment.voided_at = utcnow()
        payment.void_reason = reason.strip()
        self.session.add(payment)
        self.session.flush()

        # DUAL-WRITE: the legacy aggregates drop a voided payment (_live_payments),
        # so the ledger has to give the money back too -- as a REVERSAL, never by
        # editing the original.
        LedgerService(ctx).reverse_document(
            payment_id=payment.id, memo=f"Voided payment {payment.number}: {reason.strip()}"
        )

        # credit_id is None for an account payment (Stage 2) -- there is no invoice
        # to recalculate, and the customer's balance already moved via the ledger.
        credit = self.session.get(Credit, payment.credit_id) if payment.credit_id else None
        if credit is not None:
            self.session.refresh(credit)
            # Voiding can reopen a PAID credit. recalculate() re-derives the status
            # from the remaining balance, so a settled credit correctly returns to
            # PENDING/PARTIALLY_PAID/OVERDUE without any special-casing here.
            CreditService(ctx).recalculate(credit, today=today)
            self.session.flush()
        self._sync_customer(payment.customer_id)

        if payment.receipt_file_id:
            StorageService(self.session).detach(payment.receipt_file_id)

        self.audit(
            AuditAction.UPDATE,
            "payment",
            payment.id,
            f"Voided payment {payment.number} ({business.currency} {payment.amount}): {reason}",
        )
        return payment

    # ----------------------------------------------------------------- trash
    # void() reverses a payment but keeps it visible on the credit as "voided". These
    # send it to the Trash instead: hidden from the credit, its amount returned to the
    # outstanding balance, recoverable, and destroyable for good. All PAYMENT_DELETE
    # (admin-only). recalculate() already excludes deleted_at payments (see
    # CreditService), so the balance follows automatically.
    def _recalc_credit(self, ctx: ServiceContext, credit_id: str | None) -> None:
        # None == an account payment: it has no invoice to re-derive. The caller
        # still syncs the customer, which is where its money actually lives.
        credit = self.session.get(Credit, credit_id) if credit_id else None
        if credit is None:
            return
        self.session.refresh(credit)
        CreditService(ctx).recalculate(credit, today=today_in(self.get_business().timezone))
        self.session.flush()
        self._sync_customer(credit.customer_id)

    def soft_delete(self, ctx: ServiceContext, payment_id: str) -> Payment:
        """Send a payment to the Trash. Its amount returns to the credit's balance."""
        self.require(Permission.PAYMENT_DELETE)
        payment = self.get(payment_id)  # get() already refuses an already-deleted one

        payment.deleted_at = utcnow()
        self.session.add(payment)
        self.session.flush()
        # Trashing a payment returns its amount to the balance in the legacy model
        # (recalculate excludes deleted_at rows), so the ledger must lose it too.
        LedgerService(ctx).reverse_document(
            payment_id=payment.id, memo=f"Payment {payment.number} moved to Trash"
        )
        self._recalc_credit(ctx, payment.credit_id)
        self._sync_customer(payment.customer_id)

        if payment.receipt_file_id:
            StorageService(self.session).detach(payment.receipt_file_id)

        self.audit(
            AuditAction.DELETE, "payment", payment.id,
            f"Deleted payment {payment.number} ({self.get_business().currency} {payment.amount})",
        )
        return payment

    def get_deleted(self, payment_id: str) -> Payment:
        self.require(Permission.PAYMENT_DELETE)
        payment = self.session.get(Payment, payment_id)
        if payment is None or payment.deleted_at is None:
            raise NotFoundError("Deleted payment not found")
        self.assert_in_scope(payment.business_id)
        return payment

    def list_deleted(self, page: PageInput | None = None) -> Page[Payment]:
        """The Trash view for payments: deleted_at set, newest first."""
        self.require(Permission.PAYMENT_DELETE)
        stmt = (
            select(Payment)
            .where(
                Payment.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Payment.deleted_at).is_not(None),
            )
            .order_by(col(Payment.deleted_at).desc())
        )
        return paginate(self.session, stmt, page or PageInput())

    def restore(self, ctx: ServiceContext, payment_id: str) -> Payment:
        """Bring a payment back from the Trash and re-apply it to the balance.

        Refused if re-applying it would overpay the credit -- e.g. someone recorded a
        replacement payment while this one sat in the Trash. Restoring blindly would
        push amount_paid past grand_total.
        """
        payment = self.get_deleted(payment_id)
        credit = self.session.get(Credit, payment.credit_id)
        if credit is not None:
            already_paid = quantize_money(
                sum(
                    (p.amount for p in credit.payments
                     if p.voided_at is None and p.deleted_at is None),
                    Decimal("0"),
                )
            )
            if already_paid + payment.amount > credit.grand_total:
                raise ConflictError(
                    f"Restoring {payment.number} would overpay credit {credit.number}. "
                    "Void or delete the newer payment first."
                )

        payment.deleted_at = None
        self.session.add(payment)
        self.session.flush()
        # Back out of the Trash: a NEW entry, because a REVERSAL cannot be un-posted.
        LedgerService(ctx).restate_document(
            customer_id=payment.customer_id,
            entry_type=LedgerEntryType.PAYMENT,
            amount=-payment.amount,
            payment_id=payment.id,
            memo=f"Payment {payment.number} restored from Trash",
        )
        self._recalc_credit(ctx, payment.credit_id)
        self._sync_customer(payment.customer_id)
        self.audit(AuditAction.UPDATE, "payment", payment.id, f"Restored payment {payment.number}")
        return payment

    def permanent_delete(self, payment_id: str) -> str:
        """Destroy a trashed payment for good. The balance already excludes it."""
        payment = self.get_deleted(payment_id)
        number = payment.number
        self.session.delete(payment)
        self.session.flush()
        self.audit(
            AuditAction.DELETE, "payment", payment_id, f"Permanently deleted payment {number}"
        )
        return number

    # ------------------------------------------------------------------ reads
    def get(self, payment_id: str) -> Payment:
        self.require(Permission.PAYMENT_READ)
        payment = self.session.get(Payment, payment_id)
        if payment is None or payment.deleted_at is not None:
            raise NotFoundError("Payment not found")
        self.assert_in_scope(payment.business_id)
        return payment

    def list(
        self,
        filters: PaymentFilter | None = None,
        page: PageInput | None = None,
        *,
        sort_by: str = "paid_at",
        sort_desc: bool = True,
    ) -> Page[Payment]:
        self.require(Permission.PAYMENT_READ)
        f = filters or PaymentFilter()
        stmt = select(Payment).where(
            Payment.business_id == self.scope_id,
            col(Payment.deleted_at).is_(None),
            col(Payment.archived_at).is_(None),
        )

        if not f.include_voided:
            stmt = stmt.where(col(Payment.voided_at).is_(None))
        if f.credit_id:
            stmt = stmt.where(Payment.credit_id == f.credit_id)
        if f.customer_id:
            stmt = stmt.where(Payment.customer_id == f.customer_id)
        if f.method:
            stmt = stmt.where(col(Payment.method).in_([PaymentMethod(m) for m in f.method]))
        if f.date_from:
            stmt = stmt.where(col(Payment.paid_at) >= f.date_from)
        if f.date_to:
            stmt = stmt.where(col(Payment.paid_at) <= f.date_to)
        if f.min_amount is not None:
            stmt = stmt.where(Payment.amount >= quantize_money(f.min_amount))
        if f.max_amount is not None:
            stmt = stmt.where(Payment.amount <= quantize_money(f.max_amount))
        if f.search:
            term = f"%{f.search.strip()}%"
            customer_ids = select(Customer.id).where(
                Customer.business_id == self.scope_id,
                or_(col(Customer.name).ilike(term), col(Customer.phone).ilike(term)),
            )
            stmt = stmt.where(
                or_(
                    col(Payment.number).ilike(term),
                    col(Payment.reference).ilike(term),
                    col(Payment.customer_id).in_(customer_ids),
                )
            )

        columns = {
            "paid_at": Payment.paid_at,
            "amount": Payment.amount,
            "created_at": Payment.created_at,
            "number": Payment.number,
        }
        column = columns.get(sort_by, Payment.paid_at)
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    def history_for_credit(self, credit_id: str) -> list[Payment]:
        """Every payment on a credit, voided ones included.

        The history view SHOWS voids (struck through) rather than hiding them --
        that is the whole point of an append-only ledger.
        """
        self.require(Permission.PAYMENT_READ)
        stmt = (
            select(Payment)
            .where(
                Payment.business_id == self.scope_id,
                Payment.credit_id == credit_id,
                col(Payment.deleted_at).is_(None),
            )
            .order_by(col(Payment.paid_at).asc())
        )
        return list(self.session.exec(stmt).all())

    # ---------------------------------------------------------------- helpers
    def _sync_customer(self, customer_id: str) -> None:
        recompute_aggregates(self.session, customer_id)
        recompute_credit_score(self.session, customer_id)
