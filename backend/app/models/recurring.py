"""RecurringExpenseTemplate -- "the rent, every month". Phase 2.

WHAT THIS IS AND IS NOT
-----------------------
A template is a STANDING INSTRUCTION, not an expense. It holds the shape of a
repeating cost and the date it is next owed; the scheduler turns it into real
``Expense`` rows as those dates arrive. Deleting a template stops future
generation and touches nothing already generated -- exactly like cancelling a
standing order at a bank.

IDEMPOTENCY, WHICH IS THE WHOLE PROBLEM
----------------------------------------
The scheduler in this codebase makes a hard promise: every job can run twice with
no ill effect (see app/scheduler/jobs.py). For a generator that promise is the
difference between "the rent was recorded" and "the rent was recorded four times
because the host restarted".

It is enforced STRUCTURALLY, by a unique index on
``(recurring_template_id, expense_date)`` over on ``Expense`` -- not by the job
remembering what it did. A second run tries to insert a row that already exists and
is refused by the database. Both SQLite and Postgres treat NULLs as distinct in a
unique index, so manually recorded expenses (template id NULL) are completely
unaffected and any number of them may share a date.

``next_run`` advancing is therefore a convenience, not the safety mechanism. If it
somehow fails to advance, the constraint still prevents a duplicate.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlmodel import Field, Index

from app.models.base import TenantEntity
from app.models.enums import ExpenseFrequency, PaymentMethod
from app.models.types import MoneyType


class RecurringExpenseTemplate(TenantEntity, table=True):
    __tablename__ = "recurring_expense_template"
    __table_args__ = (
        # The generator's hot query: "which templates are due, for this business".
        Index("ix_recurring_business_next_run", "business_id", "next_run"),
    )

    #: What the owner calls it -- "Shop rent", "Electricity". Shown in the list and
    #: copied onto the generated expense's notes so the origin is obvious there.
    name: str = Field(index=True, max_length=200)

    category_id: str | None = Field(
        default=None,
        foreign_key="expense_category.id",
        index=True,
        max_length=32,
        ondelete="SET NULL",
    )
    vendor_id: str | None = Field(
        default=None, foreign_key="vendor.id", index=True, max_length=32, ondelete="SET NULL"
    )
    #: Snapshot, for the same reason Expense keeps one -- see models/vendor.py.
    vendor_name: str | None = Field(default=None, max_length=200)

    cash_account_id: str | None = Field(
        default=None,
        foreign_key="cash_account.id",
        index=True,
        max_length=32,
        ondelete="SET NULL",
    )

    amount: Decimal = Field(sa_type=MoneyType)  # type: ignore[call-overload]
    payment_method: PaymentMethod = Field(default=PaymentMethod.CASH, max_length=20)

    frequency: ExpenseFrequency = Field(default=ExpenseFrequency.MONTHLY, max_length=12, index=True)
    #: The next date an expense is owed. Local calendar date, like Expense.expense_date.
    next_run: date = Field(index=True)

    #: The day of the month the owner actually chose, for MONTHLY/YEARLY.
    #:
    #: Without it, a "rent on the 31st" template DRIFTS: February clamps it to the
    #: 28th, and every later month then advances from the 28th, so the rent is
    #: permanently three days early after one short month. Keeping the original day
    #: means each month clamps from the ANCHOR, not from wherever the last one
    #: landed -- 31, 28, 31, 30, 31 -- which is what a standing order does.
    anchor_day: int | None = Field(default=None)
    #: Stop generating after this date. None means "until cancelled".
    end_date: date | None = Field(default=None)

    is_active: bool = Field(default=True, index=True)
    notes: str | None = Field(default=None, max_length=1000)

    #: Bookkeeping for the UI ("last generated 1 Jul"). Never used for control flow --
    #: the unique constraint is what prevents a double-generation.
    last_run_at: date | None = Field(default=None)
