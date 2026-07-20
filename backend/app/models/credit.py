"""Credit records, their line items, and payments. The heart of the system.

MONEY MODEL (read this before touching any total)
-------------------------------------------------
Per line item:
    line_subtotal = unit_price * quantity
    line_total    = line_subtotal - line_discount + line_tax

Per credit:
    subtotal      = SUM(line_subtotal)
    discount      = SUM(line_discount) + credit-level discount
    tax           = SUM(line_tax)      + credit-level tax
    grand_total   = subtotal - discount + tax
    amount_paid   = SUM(payment.amount)              <- never edited by hand
    remaining     = grand_total - amount_paid        <- never edited by hand

``amount_paid`` and ``remaining_amount`` are STORED, not computed on read. That is
a deliberate denormalisation: the dashboard, the customer list, the overdue filter
and the reminder sweep all filter and sort on "who still owes money", and none of
them can afford a correlated subquery over the payments table at scale. The
invariant is protected by making CreditService the only writer -- nothing else may
set these two columns -- and by a nightly integrity check that recomputes them
from the payment ledger and reports drift.

Payments are an append-only ledger. Correcting a payment means voiding it and
recording a new one, so history is never rewritten (an auditor's requirement, and
the only way "Payment History" can be trusted).

No ``from __future__ import annotations`` here -- see the note in models/business.py.
It breaks SQLModel's Relationship resolution.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import JSON, Column, Index, UniqueConstraint
from sqlmodel import Field, Relationship

from app.models.base import TZDateTime, TenantEntity
from app.models.enums import CreditStatus, ItemKind, PaymentMethod
from app.models.types import MoneyType


class Credit(TenantEntity, table=True):
    __tablename__ = "credit"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_credit_business_number"),
        # The reminder sweep and the overdue promoter both ask:
        # "open credits for this business due on/before date X". One composite
        # index serves both, and the dashboard's Today's Due card as well.
        Index("ix_credit_business_status_due", "business_id", "status", "due_date"),
        Index("ix_credit_business_customer", "business_id", "customer_id"),
    )

    # Human-facing credit/invoice number, unique per business, e.g. CR-2026-0042.
    number: str = Field(index=True, max_length=40)

    customer_id: str = Field(
        foreign_key="customer.id", index=True, max_length=32, ondelete="RESTRICT"
    )

    # --- Money (all quantised to 2dp, stored as integer minor units) --------
    subtotal: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    discount_amount: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    tax_amount: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    grand_total: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    amount_paid: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    remaining_amount: Decimal = Field(
        default=Decimal("0"), sa_type=MoneyType, index=True  # type: ignore[call-overload]
    )

    # Credit-level (not per-line) adjustments, kept so the UI can round-trip them.
    discount_percentage: Decimal | None = Field(default=None, max_digits=5, decimal_places=2)
    tax_percentage: Decimal | None = Field(default=None, max_digits=5, decimal_places=2)

    currency: str = Field(default="USD", max_length=3)

    # --- Dates --------------------------------------------------------------
    issued_date: date = Field(index=True)
    due_date: date = Field(index=True)
    # Explicit override; when NULL the scheduler derives reminder dates from the
    # business's reminder_days_before list.
    reminder_date: date | None = Field(default=None, index=True)
    paid_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]

    status: CreditStatus = Field(default=CreditStatus.PENDING, max_length=20, index=True)

    notes: str | None = Field(default=None, max_length=2000)

    # Attachments (file_asset ids). Photo of the handwritten ledger page, the
    # signed invoice, etc.
    photo_file_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    invoice_file_id: str | None = Field(
        default=None, foreign_key="file_asset.id", max_length=32, ondelete="SET NULL"
    )

    created_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )

    # Archival bookkeeping (see models/retention.py). Non-NULL => this record is
    # in the deletion pipeline and must be hidden from normal lists.
    archived_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    archive_batch_id: str | None = Field(default=None, index=True, max_length=32)

    items: list["CreditItem"] = Relationship(
        back_populates="credit",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"},
    )
    payments: list["Payment"] = Relationship(
        back_populates="credit",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "lazy": "selectin"},
    )

    @property
    def is_open(self) -> bool:
        return CreditStatus(self.status) in CreditStatus.open_statuses()

    def days_until_due(self, today: date) -> int:
        return (self.due_date - today).days


class CreditItem(TenantEntity, table=True):
    """One line on a credit record.

    ARCHITECTURE NOTE — the name/price snapshot is NOT a normalisation failure.
    ``product_id`` links to the catalog, but ``name`` and ``unit_price`` are copied
    onto the line at creation time. That is intentional: if the shop raises the
    price of rice next month, last month's credit must still say what the customer
    actually agreed to owe. Historical documents must be immutable; live catalog
    rows are not. This is the one place where copying is correct.
    """

    __tablename__ = "credit_item"

    credit_id: str = Field(foreign_key="credit.id", index=True, max_length=32, ondelete="CASCADE")

    kind: ItemKind = Field(default=ItemKind.PRODUCT, max_length=12)
    product_id: str | None = Field(
        default=None, foreign_key="product.id", max_length=32, ondelete="SET NULL"
    )
    service_id: str | None = Field(
        default=None, foreign_key="service.id", max_length=32, ondelete="SET NULL"
    )

    name: str = Field(max_length=200)              # snapshot -- see docstring
    description: str | None = Field(default=None, max_length=500)
    unit: str = Field(default="pcs", max_length=20)

    quantity: Decimal = Field(default=Decimal("1"), max_digits=12, decimal_places=3)
    unit_price: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]

    discount_amount: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    tax_percentage: Decimal = Field(default=Decimal("0"), max_digits=5, decimal_places=2)
    tax_amount: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]

    line_subtotal: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    line_total: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]

    position: int = Field(default=0)  # display order

    credit: Optional["Credit"] = Relationship(back_populates="items")


class Payment(TenantEntity, table=True):
    """An append-only entry in the payment ledger.

    ``balance_after`` is the running balance at the moment of payment. Storing it
    means the payment history renders without replaying the whole ledger, and it
    preserves what the receipt said even if an earlier payment is later voided.
    """

    __tablename__ = "payment"
    __table_args__ = (
        UniqueConstraint("business_id", "number", name="uq_payment_business_number"),
        Index("ix_payment_business_paid_at", "business_id", "paid_at"),
    )

    number: str = Field(index=True, max_length=40)   # e.g. PAY-2026-0117

    #: NULLABLE, and that is the whole point of the ledger migration.
    #:
    #: This column used to be required, which forced the model to assert "every
    #: payment settles one credit". A shop customer buys 6-15 times a day and pays
    #: once a month against their BALANCE -- they are not paying for a cigarette.
    #: Requiring credit_id meant a Nu.10,000 payment had to be split across ~400
    #: invoice rows, answering a question the shopkeeper never asked.
    #:
    #: NULL == an ACCOUNT payment: it reduces what the customer owes, full stop.
    #: See PaymentService.record_to_account. Non-NULL is the legacy per-credit path,
    #: still supported so nothing that exists today breaks.
    #:
    #: ondelete stays CASCADE for the rows that DO name a credit; an account payment
    #: has no parent to cascade from and is only reachable via customer_id.
    credit_id: str | None = Field(
        default=None, foreign_key="credit.id", index=True, max_length=32, ondelete="CASCADE"
    )
    customer_id: str = Field(
        foreign_key="customer.id", index=True, max_length=32, ondelete="RESTRICT"
    )

    amount: Decimal = Field(sa_type=MoneyType)  # type: ignore[call-overload]
    balance_after: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]

    method: PaymentMethod = Field(default=PaymentMethod.CASH, max_length=20, index=True)

    #: WHICH bank / wallet / operator, when the method alone is not enough.
    #:
    #: FREE TEXT, not an enum, and that is deliberate. The banks a shop deals with
    #: are a fact about its COUNTRY, not about this product -- baking Bhutan's six
    #: into the schema would make the app unusable anywhere else and would need a
    #: migration every time a bank rebrands. The UI offers a suggested list and
    #: accepts anything typed, which is the same shape as Expense.vendor_name.
    provider: str | None = Field(default=None, index=True, max_length=120)
    reference: str | None = Field(default=None, index=True, max_length=120)  # cheque no, txn id
    notes: str | None = Field(default=None, max_length=1000)

    paid_at: datetime = Field(sa_type=TZDateTime, index=True)  # type: ignore[call-overload]

    receipt_file_id: str | None = Field(
        default=None, foreign_key="file_asset.id", max_length=32, ondelete="SET NULL"
    )
    received_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )

    #: Which pot the money went into (Phase 2). OPTIONAL and nullable: every payment
    #: recorded before cash accounts existed has NULL here and stays perfectly valid,
    #: and a shop that does not track accounts never has to pick one. Cash account
    #: balances are derived by summing this column -- see models/cash_account.py.
    #: No database-level FK, deliberately -- adding one to this existing table would
    #: have required an Alembic batch rebuild of `payment`, the most valuable table
    #: in the product. See the matching note in models/expense.py.
    cash_account_id: str | None = Field(default=None, index=True, max_length=32)

    # --- Void (instead of edit/delete) --------------------------------------
    # Voiding reverses the payment's effect on the credit and the customer's
    # aggregates, but the row survives so the history stays truthful.
    voided_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    void_reason: str | None = Field(default=None, max_length=500)

    archived_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    archive_batch_id: str | None = Field(default=None, index=True, max_length=32)

    credit: Optional["Credit"] = Relationship(back_populates="payments")

    @property
    def is_void(self) -> bool:
        return self.voided_at is not None
