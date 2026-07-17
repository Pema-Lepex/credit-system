"""Customer records.

STORAGE NOTE (spec: "never duplicate customer information")
-----------------------------------------------------------
A customer's name/phone/address live here and NOWHERE else. Credit records and
payments reference ``customer_id``; they never copy the name in. The one apparent
exception is denormalised *aggregates* (``total_credit``, ``total_paid``,
``outstanding_balance``) -- these are derived numbers, not duplicated facts. They
are cached on the row because the customer list and dashboard would otherwise run
a correlated SUM over every credit and payment on every page load. They are
recomputed by CustomerService whenever a credit or payment changes, and a nightly
job re-verifies them.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import UniqueConstraint
from sqlmodel import Field

from app.models.base import TZDateTime, TenantEntity
from app.models.enums import CustomerStatus
from app.models.types import MoneyType


class Customer(TenantEntity, table=True):
    __tablename__ = "customer"
    __table_args__ = (
        # Human-facing customer code, unique per business (not globally).
        UniqueConstraint("business_id", "code", name="uq_customer_business_code"),
    )

    # Human-readable ID shown in the UI and on invoices, e.g. CUST-0007.
    code: str = Field(index=True, max_length=32)

    name: str = Field(index=True, max_length=160)
    phone: str | None = Field(default=None, index=True, max_length=40)
    email: str | None = Field(default=None, index=True, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)

    photo_file_id: str | None = Field(default=None, foreign_key="file_asset.id", max_length=32)
    notes: str | None = Field(default=None, max_length=2000)

    status: CustomerStatus = Field(default=CustomerStatus.ACTIVE, max_length=16, index=True)

    emergency_contact_name: str | None = Field(default=None, max_length=160)
    emergency_contact_phone: str | None = Field(default=None, max_length=40)
    emergency_contact_relation: str | None = Field(default=None, max_length=60)

    # --- Internal credit score (0-100) --------------------------------------
    # NOT a bureau score. A local, explainable heuristic computed by
    # CreditScoreService from this business's own history with this customer:
    # on-time payment ratio, overdue count, average days late, outstanding load.
    # Stored so it can be sorted/filtered on; recomputed on every payment.
    # -- the ledger cache (Stage 1: written by LedgerService, read by nothing yet) --
    #: What this customer owes, per the account ledger. THE difference from
    #: ``outstanding_balance`` above: this one is NOT clamped at zero. A negative
    #: value means the customer has paid ahead and the shop is holding an advance --
    #: a real state that the legacy column cannot represent.
    #:
    #: O(1) by design: "what do they owe?" must never be a scan over 400 rows.
    #: LedgerService is its only writer, and LedgerService.verify proves it still
    #: equals SUM(ledger_entry.amount).
    ledger_balance: Decimal = Field(default=Decimal("0"), sa_type=MoneyType, index=True)
    #: The last seq posted for this customer. Lets post() assign seq without an
    #: ORDER BY over the whole account.
    ledger_seq: int = Field(default=0)

    credit_score: int = Field(default=50, index=True)
    credit_limit: Decimal | None = Field(default=None, sa_type=MoneyType)  # type: ignore[call-overload]

    # --- Cached aggregates (see module docstring) ---------------------------
    total_credit: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    total_paid: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]
    outstanding_balance: Decimal = Field(
        default=Decimal("0"), sa_type=MoneyType, index=True  # type: ignore[call-overload]
    )
    credit_count: int = Field(default=0)
    overdue_count: int = Field(default=0)
    last_credit_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    last_payment_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]

    date_of_birth: date | None = Field(default=None)
