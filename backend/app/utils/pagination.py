"""Pagination primitives shared by every list query.

ARCHITECTURE NOTE — offset pagination, honestly labelled
---------------------------------------------------------
We expose page/limit (offset) pagination, because the UI uses TanStack Table with
numbered pages and a total count, and "jump to page 7" is a hard requirement for
that. The cost is real and worth stating: OFFSET makes the database walk and
discard the skipped rows, so page 5000 is slower than page 1.

That cost is bounded here by three things:
  * ``MAX_PAGE_SIZE`` caps a single page at 100 rows (spec: "use pagination for
    every large table").
  * Every list query is filtered by ``business_id`` first, so the offset walk is
    over one tenant's rows, not the whole table.
  * The composite indexes in models/credit.py cover the sort keys the UI actually
    offers, so the walk is an index scan, not a heap scan.

At the scale this app targets (a shop with thousands of credits, not millions),
that is the right trade. If a single tenant ever outgrows it, ``cursor``-style
keyset pagination is the fix, and the ``Page`` shape below already leaves room for
it without changing the GraphQL contract.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import ceil
from typing import Any, Generic, TypeVar

from sqlalchemy import Select, func, select

from app.core.config import settings

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class PageInput:
    page: int = 1
    limit: int = settings.DEFAULT_PAGE_SIZE

    def normalised(self) -> PageInput:
        """Clamp hostile or careless input.

        limit=1000000 would otherwise be an unauthenticated way to make the server
        materialise an entire tenant's data in one query.
        """
        page = max(1, self.page)
        limit = min(max(1, self.limit), settings.MAX_PAGE_SIZE)
        return PageInput(page=page, limit=limit)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.limit


@dataclass(slots=True)
class Page(Generic[T]):
    items: list[T]
    total: int
    page: int
    limit: int

    @property
    def pages(self) -> int:
        return max(1, ceil(self.total / self.limit)) if self.limit else 1

    @property
    def has_next(self) -> bool:
        return self.page < self.pages

    @property
    def has_previous(self) -> bool:
        return self.page > 1


def paginate(session: Any, stmt: Select[Any], page_input: PageInput) -> Page[Any]:
    """Run a SELECT as one COUNT + one windowed fetch."""
    p = page_input.normalised()

    # Count over the same filters but WITHOUT order_by/limit. Sorting a count is
    # pure waste, and some databases reject ORDER BY inside a subquery count.
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    # .scalar(), not .exec(...).one(): ``count_stmt`` is a plain SQLAlchemy Select, and
    # SQLModel's exec() only unwraps its own SelectOfScalar -- for a Select it hands back
    # a Row, which int() cannot take.
    total = int(session.scalar(count_stmt) or 0)

    items = list(session.exec(stmt.offset(p.offset).limit(p.limit)).all())
    return Page(items=items, total=total, page=p.page, limit=p.limit)
