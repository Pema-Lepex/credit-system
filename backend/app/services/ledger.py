"""LedgerService -- the only thing allowed to write the customer account ledger.

This is Stage 1 of the ledger migration: the ledger is built and backfilled
ALONGSIDE the existing Credit/Payment model, and nothing depends on it yet. That
is deliberate. ``reconcile`` proves the new model reproduces the old one to the
cent, against real data, before any write path moves over.

WHAT THIS SERVICE OWNS (nothing else may write ledger_entry)
------------------------------------------------------------
    L1  seq is assigned here, as last_seq + 1, per customer, never reused.
    L2  balance_after == previous balance_after + amount, in seq order.
    L3  customer.ledger_balance == the last entry's balance_after.
    L4  entries are appended, never mutated -- corrections are REVERSAL entries.

``post()`` is the single door. Every entry type goes through it, so L1-L3 are
restored by one function and a rounding or ordering bug has exactly one place to
live.

CONCURRENCY
-----------
Two tills serving the SAME customer must not interleave: both would read
balance=X and both post balance_after=X-amount, losing one. Defences, in order:

  1. SQLite serialises writes with a database-level lock. Today, that is enough.
  2. On Postgres, ``_lock_customer`` takes a row lock (SELECT ... FOR UPDATE)
     before reading last_seq.
  3. UNIQUE (customer_id, seq) is the backstop either way -- a lost update becomes
     a failed INSERT the caller can retry, never a silently wrong balance.

Different customers never contend, which is what makes this scale.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import CreditStatus, LedgerEntryType
from app.models.ledger import LedgerEntry
from app.models.types import quantize_money
from app.services.base import BaseService

ZERO = Decimal("0")


@dataclass(slots=True)
class ReconcileRow:
    """One customer's old-model balance vs the ledger's. See ReconcileReport."""

    customer_id: str
    code: str
    name: str
    legacy_outstanding: Decimal  # customer.outstanding_balance (clamped at 0)
    ledger_balance: Decimal      # SUM(ledger.amount) -- may be negative
    entries: int
    agrees: bool
    note: str = ""


@dataclass(slots=True)
class ReconcileReport:
    checked: int = 0
    agreed: int = 0
    rows: list[ReconcileRow] = field(default_factory=list)

    @property
    def disagreed(self) -> list[ReconcileRow]:
        return [r for r in self.rows if not r.agrees]

    @property
    def in_credit(self) -> list[ReconcileRow]:
        """Customers whose true balance is negative -- they have paid ahead.

        These are the interesting ones: the legacy model CLAMPS outstanding_balance
        at zero (see services/customer.recompute_aggregates), so an advance payment
        is invisible there and visible here. They are not errors; they are the thing
        the old model could not represent.
        """
        return [r for r in self.rows if r.ledger_balance < ZERO]

    @property
    def ok(self) -> bool:
        return not self.disagreed


class LedgerService(BaseService):
    # ================================================================== write
    def post(
        self,
        *,
        customer_id: str,
        entry_type: LedgerEntryType,
        amount: Decimal,
        occurred_at: datetime | None = None,
        credit_id: str | None = None,
        payment_id: str | None = None,
        reverses_id: str | None = None,
        memo: str | None = None,
    ) -> LedgerEntry:
        """Append one entry. THE single door into the ledger (L1-L4).

        Does not commit -- the caller owns the transaction, so a sale and the entry
        it posts land together or not at all.
        """
        customer = self._lock_customer(customer_id)
        amount = quantize_money(amount)
        self._check_sign(entry_type, amount)

        last = self._last_entry(customer.id)
        seq = (last.seq if last else 0) + 1
        previous = last.balance_after if last else ZERO

        entry = LedgerEntry(
            business_id=self.scope_id,  # TENANCY BOUNDARY
            customer_id=customer.id,
            seq=seq,
            entry_type=entry_type,
            amount=amount,
            balance_after=quantize_money(previous + amount),  # L2
            # Back-dating is legal and does not touch seq (R2 in models/ledger.py).
            occurred_at=occurred_at or utcnow(),
            posted_at=utcnow(),
            credit_id=credit_id,
            payment_id=payment_id,
            reverses_id=reverses_id,
            memo=memo,
            created_by_user_id=self.ctx.user.id if self.ctx.user else None,
        )
        self.session.add(entry)
        self.session.flush()

        # L3: the cache follows the ledger, never the other way round.
        customer.ledger_balance = entry.balance_after
        customer.ledger_seq = seq
        self.session.add(customer)
        self.session.flush()
        return entry

    def reverse(self, entry_id: str, *, memo: str | None = None) -> LedgerEntry:
        """Cancel an entry by posting its negation. The ONLY undo (L4).

        The original stays visible forever. That is the point: a ledger you can
        edit is a ledger nobody can trust, and "just fix the number" is how a
        balance quietly stops matching the money in the drawer.
        """
        self.require(Permission.PAYMENT_WRITE)
        original = self.session.get(LedgerEntry, entry_id)
        if original is None:
            raise NotFoundError("Ledger entry not found")
        self.assert_in_scope(original.business_id)

        already = self.session.exec(
            select(LedgerEntry).where(LedgerEntry.reverses_id == original.id)
        ).first()
        if already is not None:
            raise ConflictError(
                f"That entry was already reversed on "
                f"{already.posted_at:%d %b %Y}. Post a new entry instead."
            )
        if original.entry_type is LedgerEntryType.REVERSAL:
            raise ConflictError("A reversal cannot itself be reversed. Post a new entry.")

        return self.post(
            customer_id=original.customer_id,
            entry_type=LedgerEntryType.REVERSAL,
            amount=-original.amount,
            reverses_id=original.id,
            memo=memo or f"Reversal of {original.entry_type.value.lower()} #{original.seq}",
        )

    # =================================================================== read
    def balance(self, customer_id: str) -> Decimal:
        """What this customer owes. Positive = owes the shop; negative = in credit.

        Reads the cached column -- O(1), no scan. ``verify`` is what proves the
        cache still equals the ledger.
        """
        self.require(Permission.CUSTOMER_READ)
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        return customer.ledger_balance

    def entries(
        self, customer_id: str, *, limit: int = 100, offset: int = 0
    ) -> list[LedgerEntry]:
        """The passbook, newest first.

        Ordered by seq, NOT occurred_at: seq is the order balance_after was computed
        in, so ordering by anything else would show a running balance that appears to
        jump around. Presentation may group by date; the balance column follows seq.
        """
        self.require(Permission.CUSTOMER_READ)
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        stmt = (
            select(LedgerEntry)
            .where(
                LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                LedgerEntry.customer_id == customer.id,
                col(LedgerEntry.archived_at).is_(None),
            )
            .order_by(col(LedgerEntry.seq).desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.session.exec(stmt).all())

    def derived_balance(self, customer_id: str) -> Decimal:
        """SUM(amount) straight from the ledger -- the slow, authoritative answer.

        Only for verification. Everything user-facing reads the cached column.
        """
        total = self.session.exec(
            select(func.coalesce(func.sum(col(LedgerEntry.amount)), 0)).where(
                LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                LedgerEntry.customer_id == customer_id,
                col(LedgerEntry.archived_at).is_(None),
            )
        ).one()
        return quantize_money(Decimal(total or 0))

    def verify(self, customer_id: str) -> tuple[bool, dict[str, Decimal]]:
        """Three derivations of one number must agree.

        The cached column, SUM(amount), and the last row's balance_after are computed
        independently. If they ever disagree, a write path bypassed post() -- exactly
        the guarantee CreditService.verify_integrity gives today, on a model where the
        check is one SUM.
        """
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        last = self._last_entry(customer_id)
        figures = {
            "cached": customer.ledger_balance,
            "summed": self.derived_balance(customer_id),
            "last_balance_after": last.balance_after if last else ZERO,
        }
        return len(set(figures.values())) == 1, figures

    # ============================================================== backfill
    def backfill_customer(self, customer_id: str) -> int:
        """Build one customer's ledger from their existing credits and payments.

        Idempotent: a customer who already has entries is skipped, so a partial run
        can be repeated safely.

        THE ORDERING RULE. Entries are posted in real chronological order across
        BOTH documents -- a charge on the 3rd, a payment on the 5th, a charge on the
        7th. Posting all credits and then all payments would produce the same final
        balance but a fictional running balance, and the running balance is the whole
        point of a passbook.
        """
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        if self._last_entry(customer.id) is not None:
            return 0

        events: list[tuple[datetime, int, Any]] = []

        # Mirrors _live_credits in services/customer.py exactly: soft-deleted,
        # archived and CANCELLED credits never counted toward the old balance, so
        # they must not count here either -- or reconcile() would report drift that
        # is really a definition mismatch.
        credits = self.session.exec(
            select(Credit).where(
                Credit.business_id == self.scope_id,  # TENANCY BOUNDARY
                Credit.customer_id == customer.id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                Credit.status != CreditStatus.CANCELLED,
            )
        ).all()
        for credit in credits:
            # 0 sorts charges before payments at the same instant: you cannot pay for
            # something before it has been charged.
            events.append((_at(credit.created_at), 0, credit))

        # Mirrors _live_payments: excludes soft-deleted, archived and voided.
        payments = self.session.exec(
            select(Payment).where(
                Payment.business_id == self.scope_id,  # TENANCY BOUNDARY
                Payment.customer_id == customer.id,
                col(Payment.deleted_at).is_(None),
                col(Payment.archived_at).is_(None),
                col(Payment.voided_at).is_(None),
            )
        ).all()
        for payment in payments:
            events.append((_at(payment.paid_at), 1, payment))

        events.sort(key=lambda e: (e[0], e[1]))

        for occurred, _order, doc in events:
            if isinstance(doc, Credit):
                self.post(
                    customer_id=customer.id,
                    entry_type=LedgerEntryType.CHARGE,
                    amount=doc.grand_total,
                    occurred_at=occurred,
                    credit_id=doc.id,
                    memo=f"Credit {doc.number}",
                )
            else:
                self.post(
                    customer_id=customer.id,
                    entry_type=LedgerEntryType.PAYMENT,
                    amount=-doc.amount,  # the sign convention, applied once
                    occurred_at=occurred,
                    payment_id=doc.id,
                    memo=f"Payment {doc.number}",
                )
        return len(events)

    def backfill_business(self) -> int:
        """Build the ledger for every customer of this business. Returns entry count."""
        self.require(Permission.STORAGE_MAINTAIN)
        customers = self.session.exec(
            select(Customer).where(
                Customer.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Customer.deleted_at).is_(None),
            )
        ).all()
        return sum(self.backfill_customer(c.id) for c in customers)

    def reconcile(self) -> ReconcileReport:
        """Prove the ledger reproduces the legacy balances. The gate on Stage 1.

        THE CLAMP. ``customer.outstanding_balance`` is max(0, credits - payments) --
        see services/customer.recompute_aggregates. The ledger does not clamp, so a
        customer who paid ahead legitimately shows a negative balance here while the
        legacy column shows 0. That is not drift; it is the old model losing
        information. The comparison therefore applies the same clamp, and the advances
        are reported separately via ``in_credit``.
        """
        self.require(Permission.CUSTOMER_READ)
        report = ReconcileReport()

        customers = self.session.exec(
            select(Customer).where(
                Customer.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Customer.deleted_at).is_(None),
            )
        ).all()

        for customer in customers:
            derived = self.derived_balance(customer.id)
            entries = int(
                self.session.exec(
                    select(func.count())
                    .select_from(LedgerEntry)
                    .where(LedgerEntry.customer_id == customer.id)
                ).one()
                or 0
            )
            clamped = max(ZERO, derived)
            agrees = clamped == quantize_money(customer.outstanding_balance)

            note = ""
            if agrees and derived < ZERO:
                note = f"Paid ahead by {abs(derived)} — invisible in the legacy column."
            elif not agrees:
                note = f"Legacy says {customer.outstanding_balance}, ledger says {clamped}."

            report.rows.append(
                ReconcileRow(
                    customer_id=customer.id,
                    code=customer.code,
                    name=customer.name,
                    legacy_outstanding=quantize_money(customer.outstanding_balance),
                    ledger_balance=derived,
                    entries=entries,
                    agrees=agrees,
                    note=note,
                )
            )
            report.checked += 1
            report.agreed += int(agrees)

        return report

    # =============================================================== helpers
    def _lock_customer(self, customer_id: str) -> Customer:
        """Fetch the customer, row-locked where the database supports it.

        SQLite ignores FOR UPDATE (its global write lock already serialises writers),
        so this is a no-op there and real protection on Postgres. Either way the
        UNIQUE (customer_id, seq) constraint is the backstop.
        """
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        if self.session.get_bind().dialect.name == "postgresql":
            self.session.exec(
                select(Customer).where(Customer.id == customer_id).with_for_update()
            ).first()
        return customer

    def _last_entry(self, customer_id: str) -> LedgerEntry | None:
        return self.session.exec(
            select(LedgerEntry)
            .where(LedgerEntry.customer_id == customer_id)
            .order_by(col(LedgerEntry.seq).desc())
            .limit(1)
        ).first()

    @staticmethod
    def _check_sign(entry_type: LedgerEntryType, amount: Decimal) -> None:
        """Enforce the one sign convention at the only door into the ledger.

        A CHARGE with a negative amount is a payment wearing a disguise: it would
        balance correctly and make every report about "what did we sell" a lie.
        """
        if entry_type in LedgerEntryType.increases_debt() and amount < ZERO:
            raise ValidationError(
                f"A {entry_type.value} must be positive (it increases what the "
                f"customer owes); got {amount}. To reduce a balance, post a PAYMENT "
                f"or an ADJUSTMENT.",
                field="amount",
            )
        if entry_type in LedgerEntryType.reduces_debt() and amount > ZERO:
            raise ValidationError(
                f"A {entry_type.value} must be negative (it reduces what the customer "
                f"owes); got {amount}.",
                field="amount",
            )
        if amount == ZERO:
            raise ValidationError(
                "A ledger entry of zero moves nothing and would only add noise to the "
                "customer's statement.",
                field="amount",
            )


def _at(value: datetime | None) -> datetime:
    """A sortable timestamp. Backfilled history occasionally has none."""
    from app.utils.dates import ensure_utc

    return ensure_utc(value) if value is not None else utcnow()


__all__ = ["LedgerService", "ReconcileReport", "ReconcileRow"]
