"""CashAccount -- where the money physically lives. Phase 2.

"Cash in the till", "Bank of Bhutan", "the mobile money wallet". A payment lands in
one; an expense comes out of one. Both references are OPTIONAL, so a shop that does
not care never has to think about it and every existing record stays valid.

WHY THE BALANCE IS DERIVED, NOT STORED
---------------------------------------
The spec lists a ``balance`` field. This model instead stores ``opening_balance``
and computes the current balance as:

    opening_balance + SUM(payments into it) - SUM(expenses out of it)

A stored, mutable counter would have to be updated by every write path that can
move money: recording a payment, voiding one, trashing one, restoring one,
permanently deleting one, and the same five for expenses. Eleven places, each of
which silently corrupts the balance forever if it is missed -- and the codebase
already documents this exact failure mode for ``customer.outstanding_balance``,
which needs a scheduled job to detect drift.

Deriving it means the number cannot be wrong. There is no reconciliation because
there is nothing to reconcile: the balance IS the sum of the movements. The spec
says "maintain running balances, no reconciliation" -- this is the reading of that
sentence that cannot rot.

COST: one indexed SUM per account per read. With the handful of accounts a shop
has, that is cheaper than the integrity job the stored version would require. If a
shop ever has enough movement for this to matter, the fix is a materialised
balance with the ledger's ``balance_after`` checksum pattern -- not an unguarded
counter.
"""

from __future__ import annotations

from decimal import Decimal

from sqlmodel import Field, UniqueConstraint

from app.models.base import TenantEntity
from app.models.types import MoneyType


class CashAccount(TenantEntity, table=True):
    __tablename__ = "cash_account"
    __table_args__ = (
        UniqueConstraint("business_id", "name", name="uq_cash_account_business_name"),
    )

    name: str = Field(index=True, max_length=120)
    description: str | None = Field(default=None, max_length=500)

    #: What was in it before this system started tracking it. May be negative --
    #: an overdrawn bank account is a real thing a shop can have.
    opening_balance: Decimal = Field(default=Decimal("0"), sa_type=MoneyType)  # type: ignore[call-overload]

    is_active: bool = Field(default=True, index=True)
    #: Manual ordering for the picker; ties broken by name. Lower sorts first.
    sort_order: int = Field(default=0, index=True)
