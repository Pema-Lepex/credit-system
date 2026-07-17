"""The ledger over GraphQL -- the layer the account screen actually talks to.

These exist because of a real escape: `customerLedger` shipped with a missing
import and 500'd on the first request, while every service-level test stayed green.
A resolver is code too, and the schema is the only place its wiring is exercised.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.graphql.schema import schema
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService

D = Decimal


class _Ctx:
    """Minimal stand-in for GraphQLContext: what the resolvers actually touch."""

    def __init__(self, session, user):
        self.session = session
        self.user = user
        self.request = None

    def service_ctx(self, business_id: str | None = None):
        from app.services.base import ServiceContext

        return ServiceContext(session=self.session, user=self.user, business_id=business_id)


async def _run(session, admin, query: str, **variables):
    result = await schema.execute(
        query, variable_values=variables or None, context_value=_Ctx(session, admin)
    )
    assert result.errors is None, [str(e) for e in result.errors]
    return result.data


def _buy(ctx, customer, amount: str):
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Cigarettes", quantity=D("1"), unit_price=D(amount))],
        due_date=date.today() + timedelta(days=30),
    )


LEDGER_QUERY = """
query L($id: ID!, $page: PageInput) {
  customerLedger(customerId: $id, page: $page) {
    pageInfo { total page pages hasNext }
    items { seq entryType amount balanceAfter memo creditId paymentId reversesId }
  }
}
"""


@pytest.mark.asyncio
async def test_customer_ledger_returns_the_passbook(ctx, session, admin, customer):
    _buy(ctx, customer, "30")
    _buy(ctx, customer, "25")
    session.commit()

    data = await _run(session, admin, LEDGER_QUERY, id=customer.id)
    page = data["customerLedger"]

    assert page["pageInfo"]["total"] == 2
    # Newest first, by seq -- never by date, or the running balance jumps around.
    assert [e["seq"] for e in page["items"]] == [2, 1]
    assert [e["balanceAfter"] for e in page["items"]] == ["55.00", "30.00"]


@pytest.mark.asyncio
async def test_the_amount_keeps_its_sign_on_the_wire(ctx, session, admin, customer):
    """The UI puts a row in the charge or payment column from this sign alone."""
    credit = _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()

    data = await _run(session, admin, LEDGER_QUERY, id=customer.id)
    items = {e["entryType"]: e["amount"] for e in data["customerLedger"]["items"]}

    assert items["CHARGE"] == "100.00"
    assert items["PAYMENT"] == "-40.00"


@pytest.mark.asyncio
async def test_money_crosses_the_wire_as_strings(ctx, session, admin, customer):
    """Never JSON numbers: 0.1 + 0.2 is not 0.3, and a balance must survive exactly."""
    _buy(ctx, customer, "1234567.89")
    session.commit()

    data = await _run(session, admin, LEDGER_QUERY, id=customer.id)
    entry = data["customerLedger"]["items"][0]
    assert entry["amount"] == "1234567.89"
    assert isinstance(entry["balanceAfter"], str)


@pytest.mark.asyncio
async def test_the_passbook_paginates(ctx, session, admin, customer):
    for _ in range(30):
        _buy(ctx, customer, "10")
    session.commit()

    data = await _run(session, admin, LEDGER_QUERY, id=customer.id, page={"page": 1, "limit": 10})
    page = data["customerLedger"]

    assert page["pageInfo"] == {"total": 30, "page": 1, "pages": 3, "hasNext": True}
    assert len(page["items"]) == 10
    assert page["items"][0]["seq"] == 30  # newest first


@pytest.mark.asyncio
async def test_a_reversal_is_visible_beside_what_it_cancelled(ctx, session, admin, customer):
    """Append-only, surfaced: the UI must be able to show both."""
    doomed = _buy(ctx, customer, "999")
    session.commit()
    CreditService(ctx).cancel(ctx, doomed.id, reason="Rang it up twice")
    session.commit()

    data = await _run(session, admin, LEDGER_QUERY, id=customer.id)
    items = data["customerLedger"]["items"]

    assert [e["entryType"] for e in items] == ["REVERSAL", "CHARGE"]
    assert items[0]["reversesId"] is not None
    assert items[0]["balanceAfter"] == "0.00"


@pytest.mark.asyncio
async def test_ledger_balance_is_exposed_on_the_customer(ctx, session, admin, customer):
    """The number the balance card renders."""
    _buy(ctx, customer, "30")
    session.commit()

    data = await _run(
        session,
        admin,
        "query C($id: ID!) { customer(id: $id) { ledgerBalance outstandingBalance } }",
        id=customer.id,
    )
    assert data["customer"]["ledgerBalance"] == "30.00"
    assert data["customer"]["outstandingBalance"] == "30.00"


@pytest.mark.asyncio
async def test_an_advance_shows_negative_on_the_ledger_and_zero_on_the_legacy_field(
    ctx, session, admin, customer
):
    """Exactly the divergence the balance card exists to show correctly."""
    _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("500"))
    session.commit()

    data = await _run(
        session,
        admin,
        "query C($id: ID!) { customer(id: $id) { ledgerBalance outstandingBalance } }",
        id=customer.id,
    )
    assert data["customer"]["ledgerBalance"] == "-400.00"
    assert data["customer"]["outstandingBalance"] == "0.00"  # clamped, loses the advance


# ---------------------------------------------------------------------------
# The mutation
# ---------------------------------------------------------------------------
RECORD = """
mutation P($input: AccountPaymentInput!) {
  recordAccountPayment(input: $input) { number amount balanceAfter method }
}
"""


@pytest.mark.asyncio
async def test_record_account_payment_over_graphql(ctx, session, admin, customer):
    """The whole point, end to end through the schema: pay 400 purchases at once."""
    for _ in range(400):
        _buy(ctx, customer, "25")
    session.commit()

    data = await _run(
        session,
        admin,
        RECORD,
        input={"customerId": customer.id, "amount": "10000", "reference": "July salary"},
    )
    payment = data["recordAccountPayment"]

    assert payment["amount"] == "10000.00"
    assert payment["balanceAfter"] == "0.00"  # the CUSTOMER's balance, not a credit's

    session.refresh(customer)
    assert customer.ledger_balance == D("0.00")


@pytest.mark.asyncio
async def test_the_account_payment_appears_in_the_passbook(ctx, session, admin, customer):
    _buy(ctx, customer, "500")
    session.commit()

    await _run(
        session, admin, RECORD, input={"customerId": customer.id, "amount": "200"}
    )
    data = await _run(session, admin, LEDGER_QUERY, id=customer.id)
    newest = data["customerLedger"]["items"][0]

    assert newest["entryType"] == "PAYMENT"
    assert newest["amount"] == "-200.00"
    assert newest["balanceAfter"] == "300.00"
    assert newest["creditId"] is None  # names no invoice
    assert newest["paymentId"] is not None


@pytest.mark.asyncio
async def test_the_payments_list_survives_an_account_payment(ctx, session, admin, customer):
    """A regression, and a nasty one.

    PaymentType.creditId was non-nullable, so the FIRST account payment made the
    entire payments list return "Internal server error" -- every row, not just that
    one. The service tests all passed; only asking for the field through the schema
    finds it.
    """
    credit = _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))  # legacy
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("25"))
    session.commit()

    data = await _run(
        session,
        admin,
        "query { payments { items { number creditId creditNumber } } }",
    )
    rows = {r["number"]: r for r in data["payments"]["items"]}
    assert len(rows) == 2

    legacy = next(r for r in rows.values() if r["creditId"] is not None)
    account = next(r for r in rows.values() if r["creditId"] is None)
    assert legacy["creditNumber"] == credit.number
    assert account["creditNumber"] is None  # names no invoice, and says so


@pytest.mark.asyncio
async def test_a_single_account_payment_serialises(ctx, session, admin, customer):
    _buy(ctx, customer, "100")
    session.commit()
    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("25")
    )
    session.commit()

    data = await _run(
        session,
        admin,
        "query P($id: ID!) { payment(id: $id) { number creditId creditNumber } }",
        id=payment.id,
    )
    assert data["payment"]["creditId"] is None


@pytest.mark.asyncio
async def test_a_bad_amount_is_rejected_with_a_readable_message(session, admin, customer):
    result = await schema.execute(
        RECORD,
        variable_values={"input": {"customerId": customer.id, "amount": "nonsense"}},
        context_value=_Ctx(session, admin),
    )
    assert result.errors
    assert "amount" in str(result.errors[0]).lower()


@pytest.mark.asyncio
async def test_another_tenants_ledger_is_not_readable(session, admin):
    """The tenancy boundary on a route that returns a customer's whole financial
    history."""
    from app.models.business import Business
    from app.models.customer import Customer

    other = Business(name="Rival Shop", slug="rival-shop", email="rival@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Their Customer")
    session.add(theirs)
    session.commit()

    result = await schema.execute(
        LEDGER_QUERY,
        variable_values={"id": theirs.id},
        context_value=_Ctx(session, admin),
    )
    assert result.errors
    assert "not found" in str(result.errors[0]).lower()
