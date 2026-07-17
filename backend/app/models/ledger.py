"""LedgerEntry -- the customer account ledger. The only thing that counts money.

WHY THIS TABLE EXISTS
---------------------
A shop customer buys 6-15 times a day and pays once a month. Modelling each of
those purchases as an invoice (models/credit.py) means a Nu.10,000 payment has to
be split across ~400 invoice rows, and the shopkeeper has to answer a question they
never asked: *which cigarette is this paying for?*

They didn't pay for a cigarette. They paid down a BALANCE. This table models that
directly: an append-only list of every event that moved the account, exactly like
the paper khata it replaces and exactly like a bank passbook.

A payment is then one INSERT and one UPDATE -- constant time, whether the customer
has 4 purchases behind them or 40,000.

THREE RULES, AND THEY ARE THE WHOLE DESIGN
-------------------------------------------
R1  APPEND-ONLY. A posted row is never UPDATEd and never DELETEd. Not "by
    convention" -- there is deliberately no ``deleted_at`` on this model (note it
    does NOT inherit TenantEntity, which carries SoftDeleteMixin). Wrong amount?
    Post a REVERSAL and then the correct entry. Both stay visible forever.

    This is not bureaucratic ceremony. It is *why* the design is fast: a payment
    costs two writes precisely because it never reaches back to touch history.
    Mutation and O(n) settlement are the same disease.

R2  ``seq`` IS NOT ``occurred_at``. The two-clock rule, and the detail most
    hand-rolled ledgers get wrong.

      occurred_at -- when it happened in the world. The passbook sorts by this.
                     It may be back-dated: "I forgot to write down yesterday's tea."
      seq         -- the order it entered the books. Monotonic per customer, only
                     ever increasing. ``balance_after`` follows THIS, never the date.

    If balance_after followed occurred_at, one back-dated entry would silently
    invalidate every running balance after it. With two clocks, back-dating is an
    ordinary append. This is how real books work: you post an entry today for a
    thing that happened yesterday.

R3  ONE SIGN CONVENTION. Positive increases what they owe, negative reduces it.
    See LedgerEntryType. A negative *balance* is legal -- the shop is holding an
    advance, which the current Credit model has to clamp away.

WHY balance_after IS STORED
---------------------------
It is not redundancy, it is a checksum on every row. Two independent derivations
must agree with the cached ``customer.balance``: SUM(amount) over the ledger, and
the last row's balance_after. A scheduled job compares all three; any drift means a
write path bypassed LedgerService. (Same safety net as CreditService.verify_integrity,
on a model where the check is one SUM.)

It also makes the passbook render with no arithmetic at all -- select the rows,
show the column.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from sqlmodel import Field, Index, UniqueConstraint

from app.models.base import (
    BusinessScopedMixin,
    TimestampMixin,
    TZDateTime,
    UUIDMixin,
    utcnow,
)
from app.models.enums import LedgerEntryType
from app.models.types import MoneyType


class LedgerEntry(UUIDMixin, BusinessScopedMixin, TimestampMixin, table=True):
    """One movement on one customer's account.

    NOT a TenantEntity: that composes SoftDeleteMixin, and a soft-deletable ledger
    is a contradiction (R1). The mixins are listed explicitly so the absence of
    ``deleted_at`` is a visible decision rather than an oversight someone "fixes"
    later.
    """

    __tablename__ = "ledger_entry"
    __table_args__ = (
        # THE CONCURRENCY GUARD. Two tills serving the same customer at once would
        # otherwise both read balance=X and both post balance_after=X-amount,
        # losing one of them. Under SQLite the global write lock already serialises
        # this; on Postgres LedgerService takes a row lock on the customer -- and
        # this constraint is the backstop that turns a lost update into a failed
        # insert the caller can retry.
        UniqueConstraint("customer_id", "seq", name="uq_ledger_customer_seq"),
        # The passbook read: newest-first for one customer.
        Index("ix_ledger_business_customer_seq", "business_id", "customer_id", "seq"),
        # Statement generation: everything in a period for a business.
        Index("ix_ledger_business_occurred", "business_id", "occurred_at"),
    )

    customer_id: str = Field(
        foreign_key="customer.id", index=True, max_length=32, ondelete="RESTRICT"
    )

    #: Posting order within this customer's account. Assigned by LedgerService as
    #: last_seq + 1, never reused, never reordered. balance_after follows it (R2).
    seq: int = Field(index=True)

    entry_type: LedgerEntryType = Field(max_length=20, index=True)

    #: SIGNED. Positive increases what they owe; negative reduces it.
    amount: Decimal = Field(sa_type=MoneyType)

    #: The account balance immediately after this entry, in seq order. A checksum.
    balance_after: Decimal = Field(sa_type=MoneyType)

    #: When it happened in the world. What the customer's passbook sorts by. May be
    #: earlier than posted_at (back-dating) -- that is expected, not an error.
    occurred_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime, index=True)

    #: When it entered the books. Moves with seq, never backwards.
    posted_at: datetime = Field(default_factory=utcnow, sa_type=TZDateTime)

    # -- provenance: which document caused this entry ------------------------
    # Nullable and deliberately not exclusive: an OPENING_BALANCE has no document
    # at all, and a period-close rollup has hundreds. The ledger is the truth; these
    # are back-references for "show me what this line was".
    credit_id: str | None = Field(
        default=None, foreign_key="credit.id", index=True, max_length=32, ondelete="SET NULL"
    )
    payment_id: str | None = Field(
        default=None, foreign_key="payment.id", index=True, max_length=32, ondelete="SET NULL"
    )

    #: Set on a REVERSAL: the entry this one cancels. The only form of "undo" (R1).
    reverses_id: str | None = Field(
        default=None, foreign_key="ledger_entry.id", index=True, max_length=32
    )

    memo: str | None = Field(default=None, max_length=500)

    #: Who posted it. Null for the scheduler and for backfilled history.
    created_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )

    #: Set when the entry has been rolled into an OPENING_BALANCE and archived.
    #: Archived rows are excluded from the live balance -- the OPENING_BALANCE that
    #: replaced them carries their sum. See LedgerService.close_period.
    archived_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)
    archive_batch_id: str | None = Field(default=None, index=True, max_length=32)


__all__ = ["LedgerEntry", "LedgerEntryType"]
