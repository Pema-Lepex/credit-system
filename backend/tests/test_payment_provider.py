"""Recording WHICH bank or wallet a payment went through.

Also holds the structural guard that every export dataset's rows are the same
width as its headers -- a mismatch there silently shifts every column right of the
mistake, which reads as corrupted data in a spreadsheet a shop owner has opened in
Excel.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from sqlmodel import Session, select

from app.models.credit import Credit
from app.models.customer import Customer
from app.models.enums import CreditStatus, ExportFormat, PaymentMethod
from app.models.expense import Expense
from app.services.base import ServiceContext
from app.services.expense import ExpenseService
from app.services.export import DATASETS, ExportService
from app.services.imports import ImportService
from app.services.payment import PaymentService

TODAY = date.today()


def _credit(session: Session, ctx: ServiceContext, customer: Customer) -> Credit:
    credit = Credit(
        business_id=ctx.business_id,
        number="CR-PROV-0001",
        customer_id=customer.id,
        subtotal=Decimal("5000"),
        grand_total=Decimal("5000"),
        remaining_amount=Decimal("5000"),
        issued_date=TODAY,
        due_date=TODAY,
        status=CreditStatus.PENDING,
        currency="BTN",
    )
    session.add(credit)
    session.commit()
    session.refresh(credit)
    return credit


# ===========================================================================
# Payments
# ===========================================================================
def test_a_payment_records_which_bank(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    credit = _credit(session, ctx, customer)

    payment = PaymentService(ctx).record(
        ctx,
        credit_id=credit.id,
        amount=Decimal("1000"),
        method=PaymentMethod.MOBILE_MONEY,
        provider="Bank of Bhutan",
    )

    assert payment.provider == "Bank of Bhutan"
    assert payment.method == PaymentMethod.MOBILE_MONEY


def test_an_account_payment_records_which_bank(
    ctx: ServiceContext, customer: Customer
) -> None:
    payment = PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("2000"),
        method=PaymentMethod.BANK_TRANSFER,
        provider="Druk PNB Ltd",
    )

    assert payment.provider == "Druk PNB Ltd"


def test_any_provider_name_is_accepted(ctx: ServiceContext, customer: Customer) -> None:
    """Free text, not an enum: the banks a shop uses are a fact about its COUNTRY,
    not about this product. A name we have never heard of must go straight in."""
    payment = PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("50"),
        method=PaymentMethod.MOBILE_MONEY,
        provider="Some Credit Union Nobody Told Us About",
    )

    assert payment.provider == "Some Credit Union Nobody Told Us About"


def test_provider_is_optional_and_blank_becomes_null(
    ctx: ServiceContext, customer: Customer
) -> None:
    """Cash has no provider, and "   " must not be stored as a provider either --
    otherwise a grouped report grows a blank row."""
    plain = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=Decimal("10"), method=PaymentMethod.CASH
    )
    spaces = PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("10"),
        method=PaymentMethod.CASH,
        provider="   ",
    )

    assert plain.provider is None
    assert spaces.provider is None


# ===========================================================================
# Expenses
# ===========================================================================
def test_an_expense_records_which_bank(ctx: ServiceContext) -> None:
    expense = ExpenseService(ctx).create(
        amount="800",
        payment_method=PaymentMethod.MOBILE_MONEY,
        provider="T Bank Ltd",
    )

    assert expense.provider == "T Bank Ltd"


def test_expense_provider_is_trimmed(ctx: ServiceContext) -> None:
    expense = ExpenseService(ctx).create(amount="800", provider="  BNB  ")
    assert expense.provider == "BNB"


def test_the_expense_import_carries_the_provider(
    ctx: ServiceContext, session: Session
) -> None:
    header = (
        "expense_date,amount,category,vendor_name,payment_method,provider,"
        "cash_account,reference,notes"
    )
    report = ImportService(ctx).run(
        ctx,
        dataset="expenses",
        filename="sheet.csv",
        data=(
            f"{header}\n{TODAY.isoformat()},1200,,,MOBILE_MONEY,Bhutan National Bank Ltd,,,"
        ).encode(),
        dry_run=False,
    )

    assert report.ok, [e.message for e in report.errors]
    expense = session.exec(select(Expense)).first()
    assert expense is not None
    assert expense.provider == "Bhutan National Bank Ltd"


# ===========================================================================
# Recurring
# ===========================================================================
def test_a_generated_expense_inherits_the_template_provider(
    ctx: ServiceContext, session: Session
) -> None:
    from app.services.recurring import RecurringExpenseService

    svc = RecurringExpenseService(ctx)
    svc.create(
        "Shop rent",
        amount="10000",
        next_run=TODAY,
        payment_method=PaymentMethod.BANK_TRANSFER,
        provider="Bank of Bhutan",
    )
    svc.run_due(today=TODAY)

    expense = session.exec(select(Expense)).first()
    assert expense is not None
    assert expense.provider == "Bank of Bhutan"


# ===========================================================================
# Exports
# ===========================================================================
def test_the_provider_reaches_the_payment_and_expense_exports(
    ctx: ServiceContext, customer: Customer
) -> None:
    PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("500"),
        method=PaymentMethod.MOBILE_MONEY,
        provider="Bank of Bhutan",
    )
    ExpenseService(ctx).create(amount="200", provider="T Bank Ltd")

    svc = ExportService(ctx)
    payments = svc._build_dataset("payments", {})  # noqa: SLF001
    expenses = svc._build_dataset("expenses", {})  # noqa: SLF001

    assert "Bank / provider" in payments.headers
    assert any("Bank of Bhutan" in str(cell) for row in payments.rows for cell in row)
    assert "Bank / provider" in expenses.headers
    assert any("T Bank Ltd" in str(cell) for row in expenses.rows for cell in row)


@pytest.mark.parametrize("dataset", DATASETS)
def test_every_dataset_row_is_as_wide_as_its_headers(
    ctx: ServiceContext, customer: Customer, dataset: str
) -> None:
    """THE structural guard.

    Adding a cell to a dataset's rows and forgetting its heading (or the reverse)
    shifts every column right of the mistake by one. Nothing raises -- the CSV just
    quietly says the wrong thing, and the first person to notice is a shop owner
    reconciling their books. This test is why that cannot ship.
    """
    PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("500"),
        method=PaymentMethod.MOBILE_MONEY,
        provider="Bank of Bhutan",
    )
    ExpenseService(ctx).create(amount="200", provider="T Bank Ltd")

    built = ExportService(ctx)._build_dataset(dataset, {})  # noqa: SLF001
    width = len(built.headers)

    for index, row in enumerate(built.rows):
        assert len(row) == width, (
            f"{dataset} row {index} has {len(row)} cells but there are "
            f"{width} headers: {built.headers}"
        )


@pytest.mark.asyncio
async def test_a_payments_export_still_generates(
    ctx: ServiceContext, customer: Customer
) -> None:
    """The width guard above checks shape; this checks the renderers still run."""
    PaymentService(ctx).record_to_account(
        ctx,
        customer_id=customer.id,
        amount=Decimal("500"),
        method=PaymentMethod.MOBILE_MONEY,
        provider="Bank of Bhutan",
    )

    job = await ExportService(ctx).create_export(
        ctx, format=ExportFormat.XLSX, datasets=["payments"]
    )

    assert job.state.value in {"READY", "ready"}, job.error
    assert job.size_bytes > 0
