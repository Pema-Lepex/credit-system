"""The PDFs a shop hands to a customer: invoice, receipt, account statement.

The receipt tests exist because of a real escape. Making Payment.credit_id nullable
(so a payment can settle the ACCOUNT) broke receipt_pdf for exactly the payments a
shop now makes most often -- it looked up the credit unconditionally and died on
"Credit record not found". Nothing caught it: the download is REST, and no test
asked for a receipt for an account payment.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.errors import NotFoundError
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService
from app.services.reports import ReportService

D = Decimal
PDF_MAGIC = b"%PDF-"


def _text(pdf: bytes) -> str:
    from pypdf import PdfReader
    from io import BytesIO

    return "\n".join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)


def _buy(ctx, customer, amount: str, *, days_ago: int = 0, due_in: int = 30):
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Rice 5kg", quantity=D("1"), unit_price=D(amount))],
        issued_date=date.today() - timedelta(days=days_ago),
        due_date=date.today() + timedelta(days=due_in),
    )


# ---------------------------------------------------------------------------
# Receipts — the regression
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_a_receipt_for_an_account_payment_downloads(ctx, session, customer):
    """THE bug. An account payment names no credit; the receipt must still print."""
    _buy(ctx, customer, "450")
    session.commit()
    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("200")
    )
    session.commit()

    pdf = await ReportService(ctx).receipt_pdf(payment.id)

    assert pdf.startswith(PDF_MAGIC)
    text = _text(pdf)
    assert payment.number in text
    # It says what the money was against -- without inventing a credit number.
    assert "Account balance" in text
    assert customer.name in text


@pytest.mark.asyncio
async def test_a_receipt_for_a_per_credit_payment_still_names_the_credit(
    ctx, session, customer
):
    credit = _buy(ctx, customer, "450")
    session.commit()
    payment = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("200"))
    session.commit()

    text = _text(await ReportService(ctx).receipt_pdf(payment.id))

    assert credit.number in text
    assert "Credit total" in text  # the old path keeps its old shape


@pytest.mark.asyncio
async def test_a_voided_account_payment_receipt_says_so(ctx, session, customer):
    """Handing over a receipt for a reversed payment is how disputes start."""
    _buy(ctx, customer, "450")
    session.commit()
    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("200")
    )
    session.commit()
    PaymentService(ctx).void(ctx, payment.id, reason="Cash never arrived")
    session.commit()

    assert "VOIDED" in _text(await ReportService(ctx).receipt_pdf(payment.id))


@pytest.mark.asyncio
async def test_an_invoice_downloads(ctx, session, customer):
    credit = _buy(ctx, customer, "450")
    session.commit()

    pdf = await ReportService(ctx).invoice_pdf(credit.id)
    assert pdf.startswith(PDF_MAGIC)
    assert credit.number in _text(pdf)


# ---------------------------------------------------------------------------
# The account statement
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_the_statement_shows_what_is_owed_and_paid(ctx, session, customer):
    _buy(ctx, customer, "100", days_ago=40, due_in=-10)  # overdue
    _buy(ctx, customer, "100", days_ago=20)
    _buy(ctx, customer, "450", days_ago=5)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("150"))
    session.commit()

    text = _text(await ReportService(ctx).customer_statement_pdf(customer.id))

    assert customer.name in text
    assert customer.code in text
    # FIFO: 150 settled the first credit and half the second. Settled credits are
    # hidden by default, so the page shows 550 billed / 50 paid / 500 owing.
    assert "Nu. 500.00" in text
    assert "Total still owing" in text


@pytest.mark.asyncio
async def test_settled_credits_are_hidden_by_default_and_shown_on_request(
    ctx, session, customer
):
    """The usual question is "what do I still owe" -- a year of paid rows buries it."""
    first = _buy(ctx, customer, "100", days_ago=40)
    _buy(ctx, customer, "450", days_ago=5)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    default = _text(await ReportService(ctx).customer_statement_pdf(customer.id))
    everything = _text(
        await ReportService(ctx).customer_statement_pdf(customer.id, include_settled=True)
    )

    assert first.number not in default  # settled -> hidden
    assert first.number in everything
    assert "Unpaid credits only" in default
    assert "All credits" in everything


@pytest.mark.asyncio
async def test_the_due_column_is_written_for_a_customer_not_a_developer(
    ctx, session, customer
):
    """"PARTIALLY_PAID" means nothing to the person holding the page."""
    _buy(ctx, customer, "100", days_ago=40, due_in=-12)
    session.commit()

    text = _text(await ReportService(ctx).customer_statement_pdf(customer.id))

    assert "12 days late" in text
    assert "PARTIALLY_PAID" not in text
    assert "OVERDUE" not in text


@pytest.mark.asyncio
async def test_a_settled_account_says_so_rather_than_printing_an_empty_table(
    ctx, session, customer
):
    _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    text = _text(await ReportService(ctx).customer_statement_pdf(customer.id))
    assert "fully settled" in text


@pytest.mark.asyncio
async def test_an_advance_is_explained_on_the_statement(ctx, session, customer):
    """Two numbers on one page must never disagree in silence: the credits total
    zero, but the account is Nu.400 in hand."""
    _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("500"))
    session.commit()

    text = _text(await ReportService(ctx).customer_statement_pdf(customer.id))
    assert "in advance" in text
    assert "Nu. 400.00" in text


@pytest.mark.asyncio
async def test_a_cancelled_credit_is_never_billed_on_the_statement(ctx, session, customer):
    _buy(ctx, customer, "100")
    doomed = _buy(ctx, customer, "999")
    session.commit()
    CreditService(ctx).cancel(ctx, doomed.id, reason="Rang it up twice")
    session.commit()

    text = _text(
        await ReportService(ctx).customer_statement_pdf(customer.id, include_settled=True)
    )
    assert doomed.number not in text


@pytest.mark.asyncio
async def test_the_statement_agrees_with_the_credits_list(ctx, session, customer):
    """The whole point: the page a customer holds cannot contradict the screen."""
    from sqlmodel import select

    from app.models.credit import Credit

    for amount in ("100", "250", "75"):
        _buy(ctx, customer, amount, days_ago=10)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("200"))
    session.commit()

    owed = sum(
        c.remaining_amount for c in session.exec(select(Credit)).all()
    )
    text = _text(await ReportService(ctx).customer_statement_pdf(customer.id))
    assert f"Nu. {owed:,.2f}" in text
    session.refresh(customer)
    assert owed == customer.outstanding_balance


@pytest.mark.asyncio
async def test_another_tenants_customer_has_no_statement(ctx, session):
    from app.models.business import Business
    from app.models.customer import Customer

    other = Business(name="Rival", slug="rival", email="r@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Theirs")
    session.add(theirs)
    session.commit()

    with pytest.raises(NotFoundError):
        await ReportService(ctx).customer_statement_pdf(theirs.id)


# ---------------------------------------------------------------------------
# The payments export — money must never silently vanish from a report
# ---------------------------------------------------------------------------
def test_the_payments_export_includes_account_payments(ctx, session, customer):
    """THE bug: the export inner-joined Credit, so a payment that names no credit
    was dropped from the report entirely — with nothing to say anything was missing.
    """
    from app.services.export import ExportService

    credit = _buy(ctx, customer, "450")
    session.commit()
    direct = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("50"))
    account = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("200")
    )
    session.commit()

    dataset = ExportService(ctx)._payments({})
    numbers = {row[0] for row in dataset.rows}

    assert direct.number in numbers
    assert account.number in numbers, "the account payment vanished from the report"
    assert len(dataset.rows) == 2


def test_the_export_total_matches_the_money_taken(ctx, session, customer):
    """The number a shopkeeper reconciles against their cash drawer."""
    from app.services.export import ExportService

    credit = _buy(ctx, customer, "450")
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("50"))
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("200"))
    session.commit()

    dataset = ExportService(ctx)._payments({})
    assert sum(Decimal(str(row[4])) for row in dataset.rows) == D("250")


def test_an_account_payment_names_its_target_in_the_export(ctx, session, customer):
    """A blank Credit cell reads like data went missing. Say what it settled."""
    from app.services.export import ExportService

    _buy(ctx, customer, "450")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("200"))
    session.commit()

    row = ExportService(ctx)._payments({}).rows[0]
    assert row[1] == "Account balance"
    assert row[2] == customer.name


def test_a_customer_is_still_required_on_every_payment(ctx, session, customer):
    """The Customer join stays INNER on purpose: a payment with no customer is a
    corruption, and silently hiding it would be worse than failing."""
    from app.services.export import ExportService

    _buy(ctx, customer, "450")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("200"))
    session.commit()

    assert all(row[2] for row in ExportService(ctx)._payments({}).rows)
