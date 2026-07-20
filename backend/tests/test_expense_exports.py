"""The expense/P&L download path, end to end.

These are the tests behind the Download PDF/Excel/CSV buttons on the Profit & Loss
page. The frontend does not render any of these files itself -- it asks the server
for an export job and then fetches the bytes -- so if these reach READY with a
non-empty payload, the buttons work.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest

from app.models.enums import ExportFormat, ReportPeriod
from app.services.base import ServiceContext
from app.services.expense import ExpenseCategoryService, ExpenseService
from app.services.export import DATASETS, ExportService


@pytest.fixture
def spending(ctx: ServiceContext) -> None:
    """A few expenses across two categories, so the groupings are non-trivial."""
    categories = ExpenseCategoryService(ctx)
    expenses = ExpenseService(ctx)
    rent = categories.create(name="Rent")
    fuel = categories.create(name="Fuel")

    expenses.create(amount="10000", category_id=rent.id, vendor_name="Landlord")
    expenses.create(amount="1500", category_id=fuel.id, vendor_name="Druk Fuel")
    expenses.create(amount="800")  # uncategorised, no vendor


def test_the_new_datasets_are_on_the_whitelist() -> None:
    """The frontend's EXPORT_DATASETS list must stay a subset of this one."""
    for name in (
        "expenses",
        "expense_summary",
        "profit_loss",
        "cash_flow",
        "aging_receivable",
        "tax_summary",
    ):
        assert name in DATASETS


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fmt", [ExportFormat.CSV, ExportFormat.XLSX, ExportFormat.JSON, ExportFormat.PDF]
)
@pytest.mark.parametrize(
    "dataset",
    [
        "expenses",
        "expense_summary",
        "profit_loss",
        "cash_flow",
        "aging_receivable",
        "tax_summary",
    ],
)
async def test_every_dataset_exports_in_every_format(
    ctx: ServiceContext, spending: None, fmt: ExportFormat, dataset: str
) -> None:
    """24 combinations. Each must reach READY -- a FAILED job is a dead button."""
    job = await ExportService(ctx).create_export(
        ctx,
        format=fmt,
        datasets=[dataset],
        filters={"start": date(2020, 1, 1), "end": date.today()},
    )

    assert job.state.value in {"READY", "ready"}, job.error
    assert job.size_bytes > 0


@pytest.mark.asyncio
async def test_the_profit_loss_page_bundle_exports(
    ctx: ServiceContext, spending: None
) -> None:
    """The exact three datasets the Download buttons send, together."""
    job = await ExportService(ctx).create_export(
        ctx,
        format=ExportFormat.PDF,
        datasets=["profit_loss", "expense_summary", "expenses"],
        filters={"start": date(2020, 1, 1), "end": date.today()},
    )

    assert job.state.value in {"READY", "ready"}, job.error
    assert job.size_bytes > 0


def test_the_expenses_dataset_carries_the_rows(ctx: ServiceContext, spending: None) -> None:
    dataset = ExportService(ctx)._build_dataset(  # noqa: SLF001 -- unit-testing the builder
        "expenses", {"start": date(2020, 1, 1), "end": date.today()}
    )

    assert dataset.row_count == 3
    assert dataset.headers[0] == "Date"
    # An uncategorised expense must still appear, labelled -- not silently dropped.
    labels = {row[1] for row in dataset.rows}
    assert "Uncategorised" in labels
    assert {"Rent", "Fuel"} <= labels


def test_the_profit_loss_dataset_states_its_basis(ctx: ServiceContext, spending: None) -> None:
    """The 'cash basis, not an accounting statement' caveat must survive into the
    downloaded file, not only the screen."""
    dataset = ExportService(ctx)._build_dataset(  # noqa: SLF001
        "profit_loss", {"period": ReportPeriod.MONTHLY.value}
    )

    items = {str(row[0]): row[1] for row in dataset.rows}
    assert "Cash basis" in str(items["Basis"])
    assert Decimal(str(items["Operating expenses"])) == Decimal("12300")
    # Revenue is zero here (no payments), so net profit is the expenses, negated.
    assert Decimal(str(items["Net profit"])) == Decimal("-12300")


def test_the_expense_summary_groups_three_ways(ctx: ServiceContext, spending: None) -> None:
    dataset = ExportService(ctx)._build_dataset(  # noqa: SLF001
        "expense_summary", {"period": ReportPeriod.MONTHLY.value}
    )

    groupings = {str(row[0]) for row in dataset.rows}
    assert groupings == {"Category", "Vendor", "Method"}
