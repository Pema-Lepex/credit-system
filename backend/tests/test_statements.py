"""Stage 4: monthly statements.

The claim: a month of buying and one salary-day payment produce ONE document with
ONE due date — and closing the month twice cannot bill anyone twice.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.errors import ValidationError
from app.models.base import utcnow
from app.models.enums import LedgerEntryType, StatementStatus
from app.services.ledger import LedgerService
from app.services.statement import StatementService, month_bounds, previous_month

D = Decimal


def _at(day: date):
    from datetime import datetime, time

    from app.utils.dates import ensure_utc

    return ensure_utc(datetime.combine(day, time(12, 0)))


def _charge(ctx, customer, amount: str, on: date):
    return LedgerService(ctx).post(
        customer_id=customer.id,
        entry_type=LedgerEntryType.CHARGE,
        amount=D(amount),
        occurred_at=_at(on),
        memo="Cigarettes",
    )


def _pay(ctx, customer, amount: str, on: date):
    return LedgerService(ctx).post(
        customer_id=customer.id,
        entry_type=LedgerEntryType.PAYMENT,
        amount=-D(amount),
        occurred_at=_at(on),
        memo="Salary",
    )


# A period safely in the past, so `close_period` never trips its "not finished yet"
# guard however long this test suite lives.
LAST_MONTH_START, LAST_MONTH_END = previous_month(date.today())
TWO_MONTHS_AGO_START, TWO_MONTHS_AGO_END = previous_month(LAST_MONTH_START)


# ---------------------------------------------------------------------------
# Period arithmetic
# ---------------------------------------------------------------------------
def test_month_bounds_covers_the_whole_month():
    start, end = month_bounds(date(2026, 7, 17))
    assert start == date(2026, 7, 1)
    assert end == date(2026, 7, 31)


def test_month_bounds_handles_february_in_a_leap_year():
    start, end = month_bounds(date(2028, 2, 10))
    assert (start, end) == (date(2028, 2, 1), date(2028, 2, 29))


def test_previous_month_from_the_first_of_a_month():
    """The month-end job runs on the 1st and must bill the month that just ended."""
    assert previous_month(date(2026, 8, 1)) == (date(2026, 7, 1), date(2026, 7, 31))


def test_previous_month_across_a_year_boundary():
    assert previous_month(date(2026, 1, 5)) == (date(2025, 12, 1), date(2025, 12, 31))


# ---------------------------------------------------------------------------
# Closing a period
# ---------------------------------------------------------------------------
def test_a_month_of_buying_becomes_one_statement(ctx, session, customer):
    """THE point of Stage 4: 168 purchases, one document, one due date."""
    day = LAST_MONTH_START
    while day <= LAST_MONTH_END:
        for _ in range(6):
            _charge(ctx, customer, "30", day)
        day += timedelta(days=1)
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()

    assert result.created == 1
    statement = result.statements[0]
    days = (LAST_MONTH_END - LAST_MONTH_START).days + 1
    assert statement.entry_count == days * 6
    assert statement.charges == D(str(days * 6 * 30)) + D("0.00")
    assert statement.opening_balance == D("0.00")
    assert statement.payments == D("0.00")
    assert statement.closing_balance == statement.charges
    assert statement.status is StatementStatus.ISSUED


def test_opening_plus_charges_minus_payments_equals_closing(ctx, session, customer):
    """The one equation a statement makes."""
    _charge(ctx, customer, "500", TWO_MONTHS_AGO_START + timedelta(days=3))
    session.commit()
    _charge(ctx, customer, "300", LAST_MONTH_START + timedelta(days=2))
    _pay(ctx, customer, "200", LAST_MONTH_START + timedelta(days=20))
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()
    s = result.statements[0]

    assert s.opening_balance == D("500.00")  # carried in from the earlier month
    assert s.charges == D("300.00")
    assert s.payments == D("200.00")  # POSITIVE on a statement
    assert s.closing_balance == D("600.00")
    assert s.opening_balance + s.charges - s.payments == s.closing_balance


def test_the_due_date_comes_from_the_business_cycle(ctx, session, business, customer):
    business.statement_due_days = 10
    session.add(business)
    _charge(ctx, customer, "100", LAST_MONTH_END)
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()

    assert result.statements[0].due_date == LAST_MONTH_END + timedelta(days=10)


def test_closing_twice_does_not_bill_twice(ctx, session, customer):
    """R1. The month-end job must be safe to re-run at 2am after a failure."""
    _charge(ctx, customer, "100", LAST_MONTH_START + timedelta(days=1))
    session.commit()

    first = StatementService(ctx).close_period()
    session.commit()
    second = StatementService(ctx).close_period()
    session.commit()

    assert first.created == 1
    assert second.created == 0
    assert second.skipped == 1

    from app.models.statement import Statement
    from sqlmodel import select

    assert len(session.exec(select(Statement)).all()) == 1


def test_a_customer_with_no_activity_and_no_balance_gets_no_statement(ctx, session, customer):
    """300 customers should not receive 300 'you owe nothing' letters."""
    result = StatementService(ctx).close_period()
    session.commit()

    assert result.created == 0
    assert result.nothing_to_bill == 1


def test_a_dormant_customer_who_still_owes_money_does_get_one(ctx, session, customer):
    """No purchases this month, but the debt is still there — chase it."""
    _charge(ctx, customer, "800", TWO_MONTHS_AGO_START + timedelta(days=4))
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()

    assert result.created == 1
    s = result.statements[0]
    assert s.entry_count == 0
    assert s.opening_balance == D("800.00")
    assert s.closing_balance == D("800.00")


def test_a_settled_period_is_issued_as_settled(ctx, session, customer):
    _charge(ctx, customer, "500", LAST_MONTH_START + timedelta(days=1))
    _pay(ctx, customer, "500", LAST_MONTH_START + timedelta(days=25))
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()
    s = result.statements[0]

    assert s.closing_balance == D("0.00")
    assert s.status is StatementStatus.SETTLED
    assert s.settled_at is not None


def test_a_period_that_has_not_finished_is_refused(ctx, session, customer):
    """Billing a running month produces a number that is wrong by lunchtime."""
    start, end = month_bounds(date.today())
    with pytest.raises(ValidationError, match="has not finished yet"):
        StatementService(ctx).close_period(period_start=start, period_end=end)


def test_a_backwards_period_is_refused(ctx):
    with pytest.raises(ValidationError, match="ends before it starts"):
        StatementService(ctx).close_period(
            period_start=date(2026, 7, 31), period_end=date(2026, 7, 1)
        )


def test_statement_numbers_restart_each_month(ctx, session, business, customer):
    from app.models.customer import Customer

    other = Customer(business_id=business.id, code="CUST-0002", name="Pema")
    session.add(other)
    session.commit()
    session.refresh(other)

    _charge(ctx, customer, "100", LAST_MONTH_START + timedelta(days=1))
    _charge(ctx, other, "200", LAST_MONTH_START + timedelta(days=1))
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()

    numbers = sorted(s.number for s in result.statements)
    assert numbers == [
        f"ST-{LAST_MONTH_START:%Y-%m}-0001",
        f"ST-{LAST_MONTH_START:%Y-%m}-0002",
    ]


def test_one_customer_can_be_billed_alone(ctx, session, business, customer):
    from app.models.customer import Customer

    other = Customer(business_id=business.id, code="CUST-0002", name="Pema")
    session.add(other)
    session.commit()
    session.refresh(other)
    _charge(ctx, customer, "100", LAST_MONTH_START + timedelta(days=1))
    _charge(ctx, other, "200", LAST_MONTH_START + timedelta(days=1))
    session.commit()

    result = StatementService(ctx).close_period(customer_id=customer.id)
    session.commit()

    assert result.created == 1
    assert result.statements[0].customer_id == customer.id


# ---------------------------------------------------------------------------
# Settlement (R3): derived from the balance, never allocated
# ---------------------------------------------------------------------------
def test_paying_the_balance_settles_the_statement(ctx, session, customer):
    _charge(ctx, customer, "9880", LAST_MONTH_START + timedelta(days=2))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    # Salary day, after the period closed. Nothing is allocated to the statement.
    _pay(ctx, customer, "9880", date.today())
    session.commit()

    changed = StatementService(ctx).refresh_statuses()
    session.commit()

    assert changed == 1
    from app.models.statement import Statement
    from sqlmodel import select

    statement = session.exec(select(Statement)).one()
    assert statement.status is StatementStatus.SETTLED
    assert statement.settled_at is not None


def test_a_statement_stays_settled_even_after_new_purchases(ctx, session, customer):
    """The subtlety in R3. They paid July in full and have since bought more —
    July is still settled; the new charges belong to August."""
    _charge(ctx, customer, "5000", LAST_MONTH_START + timedelta(days=2))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    _pay(ctx, customer, "5000", date.today())
    _charge(ctx, customer, "2000", date.today())  # this month's shopping
    session.commit()

    StatementService(ctx).refresh_statuses()
    session.commit()

    from app.models.statement import Statement
    from sqlmodel import select

    statement = session.exec(select(Statement)).one()
    assert statement.status is StatementStatus.SETTLED
    session.refresh(customer)
    assert customer.ledger_balance == D("2000.00")  # they owe, but not for July


def test_an_unpaid_statement_past_its_due_date_goes_overdue(ctx, session, business, customer):
    business.statement_due_days = 0  # due the day the period closed
    session.add(business)
    _charge(ctx, customer, "500", LAST_MONTH_START + timedelta(days=1))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    changed = StatementService(ctx).refresh_statuses()
    session.commit()

    assert changed == 1
    from app.models.statement import Statement
    from sqlmodel import select

    assert session.exec(select(Statement)).one().status is StatementStatus.OVERDUE


def test_a_partial_payment_leaves_the_statement_issued(ctx, session, business, customer):
    # A due date still in the future, so this isolates "partly paid" from "late".
    # With the default 10 days, last month's statement is already past due by the
    # time this test runs on any day after the 10th — which is correct behaviour,
    # just not what this test is about.
    business.statement_due_days = 90
    session.add(business)
    _charge(ctx, customer, "1000", LAST_MONTH_START + timedelta(days=1))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    _pay(ctx, customer, "400", date.today())
    session.commit()
    StatementService(ctx).refresh_statuses()
    session.commit()

    from app.models.statement import Statement
    from sqlmodel import select

    assert session.exec(select(Statement)).one().status is StatementStatus.ISSUED


# ---------------------------------------------------------------------------
# Immutability (R2)
# ---------------------------------------------------------------------------
def test_a_backdated_charge_does_not_rewrite_a_closed_statement(ctx, session, customer):
    """R2, and the reason the numbers are stored rather than recomputed.

    The customer was told 500. A correction posted afterwards must not silently
    change what they were told — it lands in the next statement.
    """
    _charge(ctx, customer, "500", LAST_MONTH_START + timedelta(days=1))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    from app.models.statement import Statement
    from sqlmodel import select

    before = session.exec(select(Statement)).one().closing_balance
    assert before == D("500.00")

    # "I forgot to write down a chai from the 3rd."
    _charge(ctx, customer, "40", LAST_MONTH_START + timedelta(days=3))
    session.commit()

    after = session.exec(select(Statement)).one().closing_balance
    assert after == D("500.00")  # unchanged — the document said 500


# ---------------------------------------------------------------------------
# Reads + tenancy
# ---------------------------------------------------------------------------
def test_entries_for_returns_the_detail_behind_the_total(ctx, session, customer):
    _charge(ctx, customer, "30", LAST_MONTH_START + timedelta(days=1))
    _charge(ctx, customer, "25", LAST_MONTH_START + timedelta(days=2))
    _charge(ctx, customer, "99", date.today())  # this month — must NOT appear
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()

    entries = StatementService(ctx).entries_for(result.statements[0].id)
    assert [e.amount for e in entries] == [D("30.00"), D("25.00")]


def test_statements_list_newest_first(ctx, session, customer):
    _charge(ctx, customer, "100", TWO_MONTHS_AGO_START + timedelta(days=1))
    session.commit()
    StatementService(ctx).close_period(
        period_start=TWO_MONTHS_AGO_START, period_end=TWO_MONTHS_AGO_END
    )
    _charge(ctx, customer, "200", LAST_MONTH_START + timedelta(days=1))
    session.commit()
    StatementService(ctx).close_period()
    session.commit()

    page = StatementService(ctx).list(customer_id=customer.id)
    assert [s.period_start for s in page.items] == [LAST_MONTH_START, TWO_MONTHS_AGO_START]


def test_another_tenants_statement_is_not_readable(ctx, session):
    from app.models.business import Business
    from app.models.customer import Customer
    from app.models.statement import Statement
    from app.core.errors import NotFoundError

    other = Business(name="Rival", slug="rival", email="r@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Theirs")
    session.add(theirs)
    session.commit()
    statement = Statement(
        business_id=other.id,
        customer_id=theirs.id,
        number="ST-2026-07-0001",
        period_start=LAST_MONTH_START,
        period_end=LAST_MONTH_END,
        due_date=LAST_MONTH_END,
    )
    session.add(statement)
    session.commit()

    with pytest.raises(NotFoundError):
        StatementService(ctx).get(statement.id)


def test_closing_only_bills_this_businesss_customers(ctx, session, customer):
    from app.models.business import Business
    from app.models.customer import Customer

    other = Business(name="Rival", slug="rival", email="r@x.bt")
    session.add(other)
    session.commit()
    session.add(Customer(business_id=other.id, code="CUST-0001", name="Theirs"))
    session.commit()

    _charge(ctx, customer, "100", LAST_MONTH_START + timedelta(days=1))
    session.commit()

    result = StatementService(ctx).close_period()
    session.commit()
    assert result.created == 1
    assert result.statements[0].customer_id == customer.id
