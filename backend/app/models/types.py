"""Custom column types shared by the models.

ARCHITECTURE NOTE — why money is not a float or a NUMERIC
---------------------------------------------------------
SQLite has no true decimal type: a ``NUMERIC(14,2)`` column with a fractional
value is stored with REAL affinity, i.e. as a float. That is how you end up with
a customer owing 249.99999999999997, and how balances drift after a few hundred
partial payments.

``MoneyType`` therefore stores money as an INTEGER number of minor units (cents)
and hands Python a ``Decimal`` with 2 dp. Integers are exact in both SQLite and
Postgres, so the migration path stays lossless (BigInteger on both). All
arithmetic in the service layer is done on ``Decimal``, quantised via
``quantize_money``.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import BigInteger, Dialect
from sqlalchemy.types import TypeDecorator

MONEY_SCALE = Decimal("0.01")
_MINOR_UNITS = 100


def quantize_money(value: Decimal | int | float | str) -> Decimal:
    """Round to 2 dp using bankers-unfriendly ROUND_HALF_UP (what invoices expect)."""
    return Decimal(str(value)).quantize(MONEY_SCALE, rounding=ROUND_HALF_UP)


class MoneyType(TypeDecorator[Decimal]):
    """Decimal in Python, exact integer minor units in the database."""

    impl = BigInteger
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Dialect) -> int | None:  # noqa: ARG002
        if value is None:
            return None
        return int(quantize_money(value) * _MINOR_UNITS)

    def process_result_value(self, value: Any, dialect: Dialect) -> Decimal | None:  # noqa: ARG002
        if value is None:
            return None
        return quantize_money(Decimal(int(value)) / _MINOR_UNITS)
