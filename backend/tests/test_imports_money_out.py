"""Bulk import for suppliers and expenses.

Same rule under test as the rest of the importer -- R1 from
app/services/imports.py: a sheet is validated in full and then written in full, or
it is not written at all. Most of these ask one question: "did anything land when
it shouldn't have?"
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import Session, select

from app.models.enums import PaymentMethod
from app.models.expense import Expense, ExpenseCategory
from app.models.vendor import Vendor
from app.services.base import ServiceContext
from app.services.cash_account import CashAccountService
from app.services.imports import DATASETS, ImportService
from app.services.vendor import VendorService

TODAY = date.today()
YESTERDAY = (TODAY - timedelta(days=1)).isoformat()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()

VENDOR_HEADER = "name,phone,email,address,notes"
EXPENSE_HEADER = (
    "expense_date,amount,category,vendor_name,payment_method,cash_account,reference,notes"
)


def _csv(*lines: str) -> bytes:
    return "\n".join(lines).encode("utf-8")


def _run(ctx: ServiceContext, dataset: str, data: bytes, *, dry_run: bool = False):
    return ImportService(ctx).run(
        ctx, dataset=dataset, filename="sheet.csv", data=data, dry_run=dry_run
    )


def _expenses(session: Session) -> list[Expense]:
    return list(session.exec(select(Expense).order_by(Expense.expense_date)).all())


def _vendors(session: Session) -> list[Vendor]:
    return list(session.exec(select(Vendor).order_by(Vendor.name)).all())


# ===========================================================================
# Registration
# ===========================================================================
def test_both_datasets_are_importable() -> None:
    assert "vendors" in DATASETS
    assert "expenses" in DATASETS


def test_templates_download_for_the_new_datasets(ctx: ServiceContext) -> None:
    """A template that does not generate is a dead button on the import page."""
    for dataset in ("vendors", "expenses"):
        for fmt in ("csv", "xlsx"):
            data, filename, _mime = ImportService(ctx).template(dataset, fmt)
            assert data, f"{dataset}.{fmt} template was empty"
            assert dataset in filename


# ===========================================================================
# Suppliers
# ===========================================================================
def test_imports_suppliers(ctx: ServiceContext, session: Session) -> None:
    report = _run(
        ctx,
        "vendors",
        _csv(
            VENDOR_HEADER,
            "Thimphu Wholesale,+975 17 11 22 33,sales@tw.bt,Norzin Lam,Tuesdays",
            "Druk Fuel,,,,",
        ),
    )

    assert report.ok
    assert report.created == 2
    rows = _vendors(session)
    assert [v.name for v in rows] == ["Druk Fuel", "Thimphu Wholesale"]
    assert rows[1].email == "sales@tw.bt"


def test_a_supplier_duplicated_inside_the_sheet_stops_the_batch(
    ctx: ServiceContext, session: Session
) -> None:
    """The second row is still in flight, so the database cannot catch it."""
    report = _run(
        ctx,
        "vendors",
        _csv(VENDOR_HEADER, "Druk Fuel,,,,", "druk fuel,,,,"),
    )

    assert not report.ok
    assert any("row 2" in e.message for e in report.errors)
    assert _vendors(session) == []  # R1: nothing landed


def test_a_supplier_that_already_exists_stops_the_batch(
    ctx: ServiceContext, session: Session
) -> None:
    VendorService(ctx).create("Druk Fuel")

    report = _run(ctx, "vendors", _csv(VENDOR_HEADER, "Good Co,,,,", "Druk Fuel,,,,"))

    assert not report.ok
    assert len(_vendors(session)) == 1  # only the pre-existing one


def test_a_supplier_needs_a_name(ctx: ServiceContext, session: Session) -> None:
    report = _run(ctx, "vendors", _csv(VENDOR_HEADER, ",+975 17 11 22 33,,,"))

    assert not report.ok
    assert _vendors(session) == []


# ===========================================================================
# Expenses
# ===========================================================================
def test_imports_expenses_and_creates_categories_as_they_appear(
    ctx: ServiceContext, session: Session
) -> None:
    report = _run(
        ctx,
        "expenses",
        _csv(
            EXPENSE_HEADER,
            f"{YESTERDAY},12000,Rent,,BANK_TRANSFER,,INV-1,July rent",
            f"{YESTERDAY},450.50,Fuel,,CASH,,,",
            f"{YESTERDAY},300,Fuel,,,,,",
        ),
    )

    assert report.ok, [e.message for e in report.errors]
    assert report.created == 3

    rows = _expenses(session)
    assert [r.amount for r in rows] == [
        Decimal("12000.00"),
        Decimal("450.50"),
        Decimal("300.00"),
    ]
    # Two rows said "Fuel" -- that must be ONE category, not two.
    categories = session.exec(select(ExpenseCategory)).all()
    assert sorted(c.name for c in categories) == ["Fuel", "Rent"]
    # Blank method falls back to CASH.
    assert rows[2].payment_method == PaymentMethod.CASH


def test_category_matching_is_case_insensitive(
    ctx: ServiceContext, session: Session
) -> None:
    _run(
        ctx,
        "expenses",
        _csv(
            EXPENSE_HEADER,
            f"{YESTERDAY},100,Rent,,,,,",
            f"{YESTERDAY},200,rent,,,,,",
            f"{YESTERDAY},300,RENT,,,,,",
        ),
    )

    assert len(session.exec(select(ExpenseCategory)).all()) == 1


def test_a_dry_run_writes_nothing_at_all(ctx: ServiceContext, session: Session) -> None:
    """Including the categories -- a preview that creates rows is not a preview."""
    report = _run(
        ctx,
        "expenses",
        _csv(EXPENSE_HEADER, f"{YESTERDAY},12000,Rent,,,,,"),
        dry_run=True,
    )

    assert report.ok
    assert report.created == 0
    assert _expenses(session) == []
    assert session.exec(select(ExpenseCategory)).all() == []


def test_a_supplier_is_matched_by_name(ctx: ServiceContext, session: Session) -> None:
    vendor = VendorService(ctx).create("Thimphu Wholesale")

    _run(
        ctx,
        "expenses",
        _csv(EXPENSE_HEADER, f"{YESTERDAY},900,,Thimphu Wholesale,,,,"),
    )

    expense = _expenses(session)[0]
    assert expense.vendor_id == vendor.id
    assert expense.vendor_name == "Thimphu Wholesale"


def test_an_unknown_supplier_is_kept_as_text_not_refused(
    ctx: ServiceContext, session: Session
) -> None:
    """A one-off purchase from a shop you will never use again must not force the
    owner to create a supplier record first."""
    report = _run(
        ctx,
        "expenses",
        _csv(EXPENSE_HEADER, f"{YESTERDAY},900,,Some Random Shop,,,,"),
    )

    assert report.ok
    expense = _expenses(session)[0]
    assert expense.vendor_id is None
    assert expense.vendor_name == "Some Random Shop"


def test_a_cash_account_must_already_exist(
    ctx: ServiceContext, session: Session
) -> None:
    """Unlike a category, an account carries a balance -- it is never invented."""
    report = _run(
        ctx,
        "expenses",
        _csv(EXPENSE_HEADER, f"{YESTERDAY},900,,,,Nonexistent Account,,"),
    )

    assert not report.ok
    assert any("no account called" in e.message for e in report.errors)
    assert _expenses(session) == []


def test_a_known_cash_account_is_linked(ctx: ServiceContext, session: Session) -> None:
    account = CashAccountService(ctx).create("Cash drawer")

    _run(ctx, "expenses", _csv(EXPENSE_HEADER, f"{YESTERDAY},900,,,,Cash drawer,,"))

    assert _expenses(session)[0].cash_account_id == account.id


def test_a_future_dated_expense_stops_the_batch(
    ctx: ServiceContext, session: Session
) -> None:
    report = _run(
        ctx,
        "expenses",
        _csv(
            EXPENSE_HEADER,
            f"{YESTERDAY},100,,,,,,",
            f"{TOMORROW},200,,,,,,",
        ),
    )

    assert not report.ok
    assert any("in the future" in e.message for e in report.errors)
    assert _expenses(session) == []  # R1: the GOOD row did not land either


def test_a_zero_or_negative_amount_stops_the_batch(
    ctx: ServiceContext, session: Session
) -> None:
    for amount in ("0", "-50"):
        report = _run(ctx, "expenses", _csv(EXPENSE_HEADER, f"{YESTERDAY},{amount},,,,,,"))
        assert not report.ok, f"{amount} should have been refused"
    assert _expenses(session) == []


def test_an_unknown_payment_method_names_the_valid_ones(
    ctx: ServiceContext, session: Session
) -> None:
    report = _run(
        ctx, "expenses", _csv(EXPENSE_HEADER, f"{YESTERDAY},100,,,TELEPATHY,,,")
    )

    assert not report.ok
    assert any("MOBILE_MONEY" in e.message for e in report.errors)
    assert _expenses(session) == []


def test_a_lowercase_method_is_accepted(ctx: ServiceContext, session: Session) -> None:
    """Nobody types enum casing into a spreadsheet."""
    report = _run(
        ctx, "expenses", _csv(EXPENSE_HEADER, f"{YESTERDAY},100,,,bank transfer,,,")
    )

    assert report.ok, [e.message for e in report.errors]
    assert _expenses(session)[0].payment_method == PaymentMethod.BANK_TRANSFER


def test_date_and_amount_are_both_required(ctx: ServiceContext, session: Session) -> None:
    assert not _run(ctx, "expenses", _csv(EXPENSE_HEADER, ",100,,,,,,")).ok
    assert not _run(ctx, "expenses", _csv(EXPENSE_HEADER, f"{YESTERDAY},,,,,,,")).ok
    assert _expenses(session) == []


def test_imported_expenses_reach_the_reports(
    ctx: ServiceContext, session: Session
) -> None:
    """The point of the whole feature: a shop that imports its history sees a
    populated P&L on day one instead of an empty one."""
    from app.models.enums import ReportPeriod
    from app.services.accounting import AccountingService

    _run(
        ctx,
        "expenses",
        _csv(
            EXPENSE_HEADER,
            f"{TODAY.isoformat()},1000,Rent,,,,,",
            f"{TODAY.isoformat()},500,Fuel,,,,,",
        ),
    )

    report = AccountingService(ctx).expense_report(ReportPeriod.MONTHLY)

    assert report.total == Decimal("1500.00")
    assert {r.label for r in report.by_category} == {"Rent", "Fuel"}


def test_the_importer_is_tenant_scoped(
    ctx: ServiceContext, other_ctx: ServiceContext, session: Session
) -> None:
    VendorService(ctx).create("Druk Fuel")

    # The other tenant's importer sees none of ours, so the same name is free.
    report = _run(other_ctx, "vendors", _csv(VENDOR_HEADER, "Druk Fuel,,,,"))

    assert report.ok
    assert len(_vendors(session)) == 2  # one per business
