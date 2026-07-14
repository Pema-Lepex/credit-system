"""Human-facing document numbers: CUST-0007, CR-2026-0042, PAY-2026-0117.

ARCHITECTURE NOTE — why not just show the UUID
-----------------------------------------------
The primary key is a UUID (good for merging, bad for humans). A shopkeeper reading
a number down the phone needs something short and sequential, and the spec requires
searching by "Credit Number".

Sequence is per-business and derived with MAX(...)+1 inside the caller's
transaction. Under SQLite that is safe: writes are serialised by the database-level
write lock, so two concurrent credit creations cannot both read the same MAX. On
Postgres, the UNIQUE(business_id, number) constraint is the real guarantee -- a
racing duplicate fails the insert rather than silently reusing a number, and the
caller retries. Correctness here comes from the constraint, not from the read.
"""

from __future__ import annotations

import re
from datetime import date

from sqlalchemy import func
from sqlmodel import Session, select

from app.models.credit import Credit, Payment
from app.models.customer import Customer

_DIGITS = re.compile(r"(\d+)$")


def _next_sequence(session: Session, model: type, business_id: str, prefix: str) -> int:
    """Highest numeric suffix currently in use for this prefix, plus one."""
    rows = session.exec(
        select(model.number).where(  # type: ignore[attr-defined]
            model.business_id == business_id,  # type: ignore[attr-defined]
            model.number.like(f"{prefix}%"),  # type: ignore[attr-defined]
        )
    ).all()
    highest = 0
    for value in rows:
        match = _DIGITS.search(str(value))
        if match:
            highest = max(highest, int(match.group(1)))
    return highest + 1


def next_customer_code(session: Session, business_id: str) -> str:
    prefix = "CUST-"
    rows = session.exec(
        select(Customer.code).where(
            Customer.business_id == business_id,
            Customer.code.like(f"{prefix}%"),  # type: ignore[attr-defined]
        )
    ).all()
    highest = 0
    for value in rows:
        match = _DIGITS.search(str(value))
        if match:
            highest = max(highest, int(match.group(1)))
    return f"{prefix}{highest + 1:04d}"


def next_credit_number(session: Session, business_id: str, *, on: date | None = None) -> str:
    """CR-<year>-NNNN. Restarts each year, which is what a paper ledger does."""
    year = (on or date.today()).year
    prefix = f"CR-{year}-"
    seq = _next_sequence(session, Credit, business_id, prefix)
    return f"{prefix}{seq:04d}"


def next_payment_number(session: Session, business_id: str, *, on: date | None = None) -> str:
    year = (on or date.today()).year
    prefix = f"PAY-{year}-"
    seq = _next_sequence(session, Payment, business_id, prefix)
    return f"{prefix}{seq:04d}"


def count_for_business(session: Session, model: type, business_id: str) -> int:
    return int(
        session.exec(
            select(func.count()).select_from(model).where(
                model.business_id == business_id,  # type: ignore[attr-defined]
                model.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
        ).one()
    )
