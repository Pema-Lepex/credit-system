"""Statement -- the monthly bill, and the only thing here with a due date.

WHY THIS EXISTS
---------------
A pan-shop customer takes 6-15 things a day and pays once, on salary day. The
current model gives every one of those purchases its own due date, status and
reminder schedule -- four hundred obligations a month where the shop and the
customer both believe there is exactly one.

A statement is that one. "Your July account: Nu.9,880, due 10 August." It is what a
credit card sends, what a utility sends, and what the paper khata's month-end page
already was.

WHAT IT IS NOT: an invoice you allocate payments to. Nothing is ever paid *against*
a statement. It is a SNAPSHOT of the ledger over a window -- opening, charges,
payments, closing -- and it is settled when the account balance says it is. That is
the whole point of balance-forward accounting: see models/ledger.py.

DERIVED, NOT AUTHORITATIVE
--------------------------
Every number on a statement can be recomputed from the ledger. It is stored anyway,
for two reasons that matter at scale:

  * Month-end reporting reads N statements instead of N million ledger entries.
  * A statement is a document that was SENT. If it said Nu.9,880 on 1 August, it
    must still say Nu.9,880 next year -- even after a back-dated correction lands
    in the period. A recomputed statement would silently rewrite what the customer
    was told, which is the one thing a statement exists not to do.

So: closed statements are immutable. A correction to a closed period appears in the
NEXT statement as an adjustment, exactly as a credit card does it.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlmodel import Field, Index, UniqueConstraint

from app.models.base import (
    BusinessScopedMixin,
    TimestampMixin,
    TZDateTime,
    UUIDMixin,
)
from app.models.enums import StatementStatus
from app.models.types import MoneyType


class Statement(UUIDMixin, BusinessScopedMixin, TimestampMixin, table=True):
    """One customer's account for one period.

    NOT a TenantEntity: like LedgerEntry, it composes its mixins explicitly so the
    absence of ``deleted_at`` is a visible decision. A statement that was sent to a
    customer cannot be deleted -- superseding it is the next statement's job.
    """

    __tablename__ = "statement"
    __table_args__ = (
        # One statement per customer per period. This is what makes generation
        # idempotent: re-running the month-end job cannot double-bill anyone.
        UniqueConstraint("customer_id", "period_start", name="uq_statement_customer_period"),
        Index("ix_statement_business_period", "business_id", "period_start"),
        Index("ix_statement_business_status_due", "business_id", "status", "due_date"),
    )

    customer_id: str = Field(
        foreign_key="customer.id", index=True, max_length=32, ondelete="RESTRICT"
    )

    #: Human reference, e.g. ST-2026-07-0042. What a customer quotes on the phone.
    number: str = Field(index=True, max_length=40)

    period_start: date = Field(index=True)
    period_end: date = Field(index=True)  # inclusive

    # -- the snapshot ---------------------------------------------------------
    #: Balance carried in from the previous period.
    opening_balance: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)
    #: Everything they took this period (sum of positive ledger amounts).
    charges: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)
    #: Everything they paid this period (as a POSITIVE number -- a statement reads
    #: "you paid 5,710", not "you paid -5,710").
    payments: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)
    #: opening + charges - payments. What the statement asks them for.
    closing_balance: Decimal = Field(default=Decimal("0"), sa_type=MoneyType, index=True)
    #: How many ledger entries this covers. Lets the UI say "42 purchases".
    entry_count: int = Field(default=0)

    #: THE due date. The one in the whole system that a customer actually agreed to.
    due_date: date = Field(index=True)

    status: StatementStatus = Field(default=StatementStatus.OPEN, max_length=16, index=True)
    issued_at: datetime | None = Field(default=None, sa_type=TZDateTime)
    settled_at: datetime | None = Field(default=None, sa_type=TZDateTime)

    #: When a reminder for THIS statement last went out. One per customer per month,
    #: instead of one per purchase.
    last_reminded_at: datetime | None = Field(default=None, sa_type=TZDateTime)


__all__ = ["Statement", "StatementStatus"]
