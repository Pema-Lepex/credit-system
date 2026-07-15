"""The list mappers must not fan out into a query per row.

`to_credit`/`to_payment`/`to_customer` fetch each row's relations lazily -- fine for
one row, death by a thousand round trips over a page. The batch mappers
(`to_*_rows`) pre-fetch in a handful of `IN (...)` queries. These tests pin that:
map a page of N rows and assert the query count stays flat as N grows, so an
accidental return to per-row loading fails here instead of on a user's slow page.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.graphql import mappers as m
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.customer import CustomerService
from app.services.payment import PaymentService
from app.utils.pagination import PageInput

NEXT_WEEK = date.today() + timedelta(days=7)


class _Counter:
    def __init__(self) -> None:
        self.count = 0

    def __call__(self, *_args: object, **_kwargs: object) -> None:
        self.count += 1


@pytest.fixture
def count_queries(ctx: ServiceContext) -> Iterator[_Counter]:
    """Count SQL statements executed on the test session's connection."""
    counter = _Counter()
    bind = ctx.session.get_bind()
    event.listen(bind, "after_cursor_execute", counter)
    try:
        yield counter
    finally:
        event.remove(bind, "after_cursor_execute", counter)


def _seed(ctx: ServiceContext, n: int) -> None:
    """n customers, each with one credit and one payment against it."""
    for i in range(n):
        cust = CustomerService(ctx).create(name=f"Cust {i}", phone=f"1700000{i:03d}")
        credit = CreditService(ctx).create(
            ctx,
            customer_id=cust.id,
            due_date=NEXT_WEEK,
            items=[CreditItemInput(name="Rice", quantity=Decimal("1"), unit_price=Decimal("100.00"))],
        )
        PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("40.00"))


def _flat(fn, count_queries: _Counter, ctx: ServiceContext) -> None:
    """Map 3 rows, then 9 rows; the second must not cost ~3x the queries."""
    _seed(ctx, 3)
    ctx.session.expire_all()  # drop the identity-map cache so lazy loads would show
    count_queries.count = 0
    fn(ctx)
    small = count_queries.count

    _seed(ctx, 6)  # 9 total
    ctx.session.expire_all()
    count_queries.count = 0
    fn(ctx)
    large = count_queries.count

    # A per-row mapper would roughly triple. The batch mapper adds a fixed handful of
    # IN() queries regardless of N, so growth must be small and bounded.
    assert large <= small + 2, f"query count grew with rows: {small} -> {large} (N+1 regression)"


def test_credit_list_is_not_n_plus_one(count_queries: _Counter, ctx: ServiceContext) -> None:
    def run(c: ServiceContext) -> None:
        rows = CreditService(c).list(None, _page(), sort_by="created_at", sort_desc=True)
        m.to_credit_rows(c.session, rows.items, today=date.today())

    _flat(run, count_queries, ctx)


def test_payment_list_is_not_n_plus_one(count_queries: _Counter, ctx: ServiceContext) -> None:
    def run(c: ServiceContext) -> None:
        rows = PaymentService(c).list(None, _page(), sort_by="paid_at", sort_desc=True)
        m.to_payment_rows(c.session, rows.items)

    _flat(run, count_queries, ctx)


def test_customer_list_is_not_n_plus_one(count_queries: _Counter, ctx: ServiceContext) -> None:
    def run(c: ServiceContext) -> None:
        rows = CustomerService(c).list(_page())
        m.to_customer_rows(c.session, rows.items)

    _flat(run, count_queries, ctx)


def _page() -> PageInput:
    return PageInput(page=1, limit=50)
