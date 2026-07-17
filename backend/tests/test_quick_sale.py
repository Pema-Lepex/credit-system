"""Quick-add sale — the counter path, and its GraphQL surface.

The claim: recording a purchase takes one call with three facts (who, how much,
what), and produces EXACTLY what the full form would — same ledger entry, same
aggregates, same audit trail. A shorter question, not a second write path.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import select

from app.core.errors import ValidationError
from app.graphql.schema import schema
from app.models.enums import ItemKind, LedgerEntryType
from app.models.ledger import LedgerEntry
from app.services.credit import CreditItemInput, CreditService
from app.services.ledger import LedgerService

D = Decimal


class _Ctx:
    def __init__(self, session, user):
        self.session, self.user, self.request = session, user, None

    def service_ctx(self, business_id: str | None = None):
        from app.services.base import ServiceContext

        return ServiceContext(session=self.session, user=self.user, business_id=business_id)


async def _gql(session, admin, query: str, **variables):
    result = await schema.execute(
        query, variable_values=variables or None, context_value=_Ctx(session, admin)
    )
    assert result.errors is None, [str(e) for e in result.errors]
    return result.data


# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------
def test_a_quick_sale_needs_only_who_and_how_much(ctx, session, customer):
    credit = CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("30"))
    session.commit()

    assert credit.grand_total == D("30.00")
    assert len(credit.items) == 1
    assert credit.items[0].name == "Goods"  # no description typed at the counter
    assert credit.items[0].quantity == D("1")
    assert credit.items[0].kind is ItemKind.CUSTOM

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")


def test_a_description_becomes_the_line_item(ctx, session, customer):
    credit = CreditService(ctx).quick_sale(
        ctx, customer_id=customer.id, amount=D("450"), description="Rice 5kg"
    )
    session.commit()
    assert credit.items[0].name == "Rice 5kg"


def test_a_quick_sale_posts_the_same_ledger_entry_as_the_full_form(ctx, session, customer):
    """The point: this is a shorter QUESTION, not a second write path."""
    CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("30"))
    session.commit()

    entry = session.exec(select(LedgerEntry)).one()
    assert entry.entry_type is LedgerEntryType.CHARGE
    assert entry.amount == D("30.00")
    assert entry.credit_id is not None

    ok, figures = LedgerService(ctx).verify(customer.id)
    assert ok, figures
    assert LedgerService(ctx).reconcile().ok


def test_the_due_date_is_derived_from_the_statement_cycle(ctx, session, business, customer):
    """A purchase is not an invoice. Nobody is asked for a due date, and the date
    that lands is the month-end statement's — not a promise about this cigarette."""
    business.statement_due_days = 10
    session.add(business)
    session.commit()

    credit = CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("30"))
    session.commit()

    today = date.today()
    month_end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
    assert credit.due_date == month_end + timedelta(days=10)


def test_a_quick_sale_carries_no_tax(ctx, session, business, customer):
    """The business default would silently inflate a price already quoted aloud."""
    business.tax_percentage = D("10")
    session.add(business)
    session.commit()

    credit = CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    assert credit.tax_amount == D("0.00")
    assert credit.grand_total == D("100.00")  # exactly what the shopkeeper said


def test_fifteen_quick_sales_in_a_day_land_correctly(ctx, session, customer):
    """The actual shape of the problem."""
    for _ in range(15):
        CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("30"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("450.00")
    assert customer.ledger_seq == 15
    assert LedgerService(ctx).reconcile().ok


def test_a_backdated_quick_sale_is_allowed(ctx, session, customer):
    """"I forgot to write down yesterday's tea." """
    yesterday = date.today() - timedelta(days=1)
    credit = CreditService(ctx).quick_sale(
        ctx, customer_id=customer.id, amount=D("20"), occurred_on=yesterday
    )
    session.commit()
    assert credit.issued_date == yesterday


def test_a_future_dated_quick_sale_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="in the future"):
        CreditService(ctx).quick_sale(
            ctx,
            customer_id=customer.id,
            amount=D("20"),
            occurred_on=date.today() + timedelta(days=1),
        )


def test_a_zero_quick_sale_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="greater than zero"):
        CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("0"))


def test_a_negative_quick_sale_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="greater than zero"):
        CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("-30"))


def test_a_blocked_customer_is_still_refused(ctx, session, customer):
    """quick_sale delegates to create(), so every rule it enforces still holds."""
    from app.core.errors import ConflictError
    from app.models.enums import CustomerStatus

    customer.status = CustomerStatus.BLOCKED
    session.add(customer)
    session.commit()

    with pytest.raises(ConflictError, match="blocked"):
        CreditService(ctx).quick_sale(ctx, customer_id=customer.id, amount=D("30"))


def test_quick_sale_and_the_full_form_produce_the_same_credit(ctx, session, customer):
    """Belt and braces on 'not a second write path'."""
    quick = CreditService(ctx).quick_sale(
        ctx, customer_id=customer.id, amount=D("450"), description="Rice 5kg"
    )
    session.commit()
    full = CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[
            CreditItemInput(
                name="Rice 5kg",
                quantity=D("1"),
                unit_price=D("450"),
                kind=ItemKind.CUSTOM,
            )
        ],
        due_date=quick.due_date,
        tax_percentage=D("0"),
    )
    session.commit()

    assert quick.grand_total == full.grand_total
    assert quick.subtotal == full.subtotal
    assert quick.tax_amount == full.tax_amount
    assert quick.status == full.status


# ---------------------------------------------------------------------------
# GraphQL
# ---------------------------------------------------------------------------
QUICK_SALE = """
mutation Q($input: QuickSaleInput!) {
  quickSale(input: $input) {
    number grandTotal dueDate status
    items { name quantity unitPrice }
  }
}
"""


@pytest.mark.asyncio
async def test_quick_sale_over_graphql(session, admin, customer):
    data = await _gql(
        session,
        admin,
        QUICK_SALE,
        input={"customerId": customer.id, "amount": "30", "description": "Cigarettes"},
    )
    credit = data["quickSale"]

    assert credit["grandTotal"] == "30.00"
    assert credit["items"] == [{"name": "Cigarettes", "quantity": "1", "unitPrice": "30.00"}]

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")


@pytest.mark.asyncio
async def test_quick_sale_without_a_description_over_graphql(session, admin, customer):
    data = await _gql(session, admin, QUICK_SALE, input={"customerId": customer.id, "amount": "25"})
    assert data["quickSale"]["items"][0]["name"] == "Goods"


@pytest.mark.asyncio
async def test_a_bad_amount_is_rejected_readably(session, admin, customer):
    result = await schema.execute(
        QUICK_SALE,
        variable_values={"input": {"customerId": customer.id, "amount": "nonsense"}},
        context_value=_Ctx(session, admin),
    )
    assert result.errors
    assert "amount" in str(result.errors[0]).lower()


@pytest.mark.asyncio
async def test_another_tenants_customer_cannot_be_sold_to(session, admin):
    from app.models.business import Business
    from app.models.customer import Customer

    other = Business(name="Rival", slug="rival", email="r@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Theirs")
    session.add(theirs)
    session.commit()

    result = await schema.execute(
        QUICK_SALE,
        variable_values={"input": {"customerId": theirs.id, "amount": "30"}},
        context_value=_Ctx(session, admin),
    )
    assert result.errors
    assert "not found" in str(result.errors[0]).lower()
