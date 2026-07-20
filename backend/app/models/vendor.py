"""Vendor -- the other side of an expense. Phase 2.

WHY NOT REUSE ``Customer``
--------------------------
They carry the same five contact fields, and that is where the similarity stops.
A Customer has a balance, a credit score, a credit limit, statements and a ledger;
a Vendor has none of those and never will, because money flows the other way. One
table would mean every customer query filtering out vendors (and vice versa), a
nullable half of the schema, and a real risk of a vendor turning up in the "who
owes us money" list.

THE FALLBACK RULE
-----------------
``Expense`` keeps BOTH ``vendor_id`` and ``vendor_name``. The name is snapshotted
onto the expense when it is recorded, so deleting a vendor leaves last year's
expenses still saying who they were paid to -- the FK goes NULL, the text remains.
Same reasoning as ``CreditItem``'s price snapshot: a historical record must not
change because a live row it points at was edited.
"""

from __future__ import annotations

from sqlmodel import Field, UniqueConstraint

from app.models.base import TenantEntity


class Vendor(TenantEntity, table=True):
    __tablename__ = "vendor"
    __table_args__ = (UniqueConstraint("business_id", "name", name="uq_vendor_business_name"),)

    name: str = Field(index=True, max_length=200)
    phone: str | None = Field(default=None, index=True, max_length=40)
    email: str | None = Field(default=None, index=True, max_length=255)
    address: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)

    is_active: bool = Field(default=True, index=True)
