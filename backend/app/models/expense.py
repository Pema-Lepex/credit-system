"""Business expenses -- money going OUT of the shop.

WHY THIS DOES NOT TOUCH THE LEDGER
----------------------------------
``models/ledger.py`` is the *customer account* ledger: every row belongs to a
customer, carries a per-customer ``seq``, and stores a ``balance_after`` that acts
as a checksum on that customer's balance. An expense belongs to no customer, so
posting one there would need a nullable ``customer_id`` and would break both
invariants for the sake of sharing a table.

So an Expense is its own record of the event, and the reports read this table
directly. That keeps the spec's two hard rules -- "expenses must not modify
customer balances" and "no general ledger / double entry" -- true by construction
rather than by discipline.

VENDORS
-------
An expense carries BOTH ``vendor_id`` and ``vendor_name``. The name is snapshotted
at the moment of recording, so deleting a vendor leaves last year's expenses still
saying who they were paid to: the FK goes NULL, the text remains. It is also the
only value when the owner typed a name without picking a vendor at all. See
models/vendor.py.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlmodel import Field, Index, UniqueConstraint

from app.models.base import TenantEntity
from app.models.enums import PaymentMethod
from app.models.types import MoneyType


class ExpenseCategory(TenantEntity, table=True):
    """A spending bucket: Rent, Utilities, Salaries, Fuel...

    Deliberately a separate table from catalog ``Category`` rather than a reuse of
    it. They are unique on the same (business_id, name) pair but mean opposite
    things -- "Fuel" as a thing you sell is not "Fuel" as a thing you spend on --
    and sharing one table would put both in every category dropdown in the app.
    """

    __tablename__ = "expense_category"
    __table_args__ = (
        UniqueConstraint("business_id", "name", name="uq_expense_category_business_name"),
    )

    name: str = Field(index=True, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    color: str | None = Field(default=None, max_length=9)  # UI chip colour
    is_active: bool = Field(default=True, index=True)
    #: Manual ordering for the picker; ties broken by name. Lower sorts first.
    sort_order: int = Field(default=0, index=True)


class Expense(TenantEntity, table=True):
    """One outgoing payment: what it was for, how much, and who to.

    ``expense_date`` is a calendar DATE, not an instant, matching ``Credit.issued_date``
    rather than ``Payment.paid_at``. A shop owner records "the rent, on the 1st" --
    there is no meaningful time-of-day, and storing one would force every report to
    convert timezones to answer a question nobody asked. Reports therefore compare
    it against LOCAL dates; see app/services/reports.py.
    """

    __tablename__ = "expense"
    __table_args__ = (
        Index("ix_expense_business_date", "business_id", "expense_date"),
        # THE IDEMPOTENCY GUARANTEE for recurring expenses. A template may produce at
        # most one expense per date, so re-running the generator (a restart, an
        # overlapping deploy, a "Run now" click) cannot double-charge the shop.
        # NULLs are distinct in a unique index on both SQLite and Postgres, so
        # manually recorded expenses are unaffected and may freely share a date.
        # See models/recurring.py.
        #
        # A unique INDEX rather than a table-level UniqueConstraint on purpose:
        # adding a constraint to an existing SQLite table forces a full table
        # rebuild (Alembic batch mode), whereas an index is a plain CREATE. This way
        # the schema is byte-identical whether it was created fresh by init_db or
        # reached by migration -- which a rebuild would not have guaranteed.
        Index(
            "uq_expense_template_run",
            "recurring_template_id",
            "expense_date",
            unique=True,
        ),
    )

    category_id: str | None = Field(
        default=None,
        foreign_key="expense_category.id",
        index=True,
        max_length=32,
        ondelete="SET NULL",
    )

    amount: Decimal = Field(sa_type=MoneyType)  # type: ignore[call-overload]

    # THE THREE COLUMNS BELOW CARRY NO DATABASE-LEVEL FOREIGN KEY, on purpose.
    #
    # They were added to an existing table by migration e6b3c9d15a72. SQLite cannot
    # ALTER in a constraint, so giving them real FKs would have meant Alembic batch
    # mode -- a copy-and-move rebuild of `expense`, and of `payment` for its
    # matching column. Rebuilding the payments table on a live database is a far
    # bigger risk than the constraint is worth.
    #
    # And the constraint buys almost nothing here: ON DELETE SET NULL only fires on
    # a HARD delete, while every one of these parents is soft-deleted. CategoryService
    # already documents this exact gap and hand-detaches its members instead. So do
    # VendorService, CashAccountService and RecurringExpenseService -- which is also
    # where the scope check lives, and where every other integrity rule in this
    # codebase lives anyway.
    vendor_id: str | None = Field(default=None, index=True, max_length=32)

    #: Snapshot of the vendor's name at the time of recording, and the fallback when
    #: the vendor row is later deleted. Also the only value when no vendor was picked.
    vendor_name: str | None = Field(default=None, index=True, max_length=200)

    #: Which pot the money came out of. Optional -- a shop that does not track
    #: accounts never has to pick one.
    cash_account_id: str | None = Field(default=None, index=True, max_length=32)

    #: Set when the scheduler generated this row from a standing instruction. Such
    #: expenses are not editable -- correct the template, or delete this row.
    recurring_template_id: str | None = Field(default=None, index=True, max_length=32)

    payment_method: PaymentMethod = Field(default=PaymentMethod.CASH, max_length=20, index=True)
    expense_date: date = Field(index=True)

    reference: str | None = Field(default=None, index=True, max_length=120)
    notes: str | None = Field(default=None, max_length=1000)

    receipt_file_id: str | None = Field(
        default=None, foreign_key="file_asset.id", max_length=32, ondelete="SET NULL"
    )

    created_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )
    updated_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )
