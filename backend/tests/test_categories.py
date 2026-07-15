"""Categories: you can add as many as you like (different names).

A report of "I can only add one category" would show up here — the service and the
model's unique constraint are (business_id, name), so distinct names must all
succeed. Same name is the only thing that is refused.
"""

from __future__ import annotations

import pytest

from app.core.errors import ConflictError
from app.services.base import ServiceContext
from app.services.catalog import CategoryService


def test_many_distinct_categories_can_be_added(ctx: ServiceContext) -> None:
    svc = CategoryService(ctx)
    names = ["Groceries", "Household", "Repairs", "Clothing", "Beverages"]
    for name in names:
        svc.create(name=name, color="#059669", description=f"{name} things")

    listed = {c.name for c in svc.list().items}
    assert listed == set(names)


def test_only_a_duplicate_name_is_refused(ctx: ServiceContext) -> None:
    svc = CategoryService(ctx)
    svc.create(name="Groceries")
    # A different name is fine...
    svc.create(name="Household")
    # ...only the exact same name (per business) is a conflict.
    with pytest.raises(ConflictError):
        svc.create(name="Groceries")

    assert {c.name for c in svc.list().items} == {"Groceries", "Household"}
