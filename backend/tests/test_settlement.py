"""FIFO settlement: making the Credits list agree with the Account balance.

THE BUG THIS FIXES. An account payment names no credit, so every credit it covered
stayed PENDING with its original balance. The Credits list said a customer owed
money the Account tab said they did not. Both were reading real columns; the
columns disagreed.

THE RULE:
  1. A payment aimed at ONE credit belongs to that credit.
  2. Everything else fills the remaining credits OLDEST FIRST.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import select

from app.models.credit import Credit
from app.models.enums import CreditStatus
from app.services.credit import CreditItemInput, CreditService, apply_settlement
from app.services.payment import PaymentService

D = Decimal


def _buy(ctx, customer, amount: str, *, days_ago: int = 0, due_in: int = 30):
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Goods", quantity=D("1"), unit_price=D(amount))],
        issued_date=date.today() - timedelta(days=days_ago),
        due_date=date.today() + timedelta(days=due_in),
    )


def _credits(session, customer) -> list[Credit]:
    return list(
        session.exec(
            select(Credit)
            .where(Credit.customer_id == customer.id)
            .order_by(Credit.issued_date, Credit.created_at, Credit.id)
        ).all()
    )


# ---------------------------------------------------------------------------
# The reported example, exactly
# ---------------------------------------------------------------------------
def test_150_against_two_100_credits_settles_the_first_and_part_pays_the_second(
    ctx, session, customer
):
    """Customer A: two Nu.100 credits, pays Nu.150.

    Credit 1 -> fully settled. Credit 2 -> Nu.50 remaining, partially settled.
    """
    _buy(ctx, customer, "100", days_ago=10)
    _buy(ctx, customer, "100", days_ago=5)
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("150"))
    session.commit()

    first, second = _credits(session, customer)

    assert first.amount_paid == D("100.00")
    assert first.remaining_amount == D("0.00")
    assert CreditStatus(first.status) is CreditStatus.PAID

    assert second.amount_paid == D("50.00")
    assert second.remaining_amount == D("50.00")
    assert CreditStatus(second.status) is CreditStatus.PARTIALLY_PAID

    session.refresh(customer)
    assert customer.outstanding_balance == D("50.00")
    assert customer.ledger_balance == D("50.00")


def test_oldest_is_settled_first_regardless_of_insertion_order(ctx, session, customer):
    """FIFO follows issued_date, not the order rows happened to be typed in."""
    newer = _buy(ctx, customer, "100", days_ago=1)
    older = _buy(ctx, customer, "100", days_ago=20)  # entered second, happened first
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    session.refresh(older)
    session.refresh(newer)
    assert CreditStatus(older.status) is CreditStatus.PAID
    assert CreditStatus(newer.status) is not CreditStatus.PAID


def test_paying_everything_settles_every_credit(ctx, session, customer):
    for _ in range(400):
        _buy(ctx, customer, "25")
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("10000"))
    session.commit()

    statuses = {CreditStatus(c.status) for c in _credits(session, customer)}
    assert statuses == {CreditStatus.PAID}
    session.refresh(customer)
    assert customer.outstanding_balance == D("0.00")


def test_paying_nothing_leaves_everything_pending(ctx, session, customer):
    _buy(ctx, customer, "100")
    _buy(ctx, customer, "100")
    session.commit()

    assert {CreditStatus(c.status) for c in _credits(session, customer)} == {
        CreditStatus.PENDING
    }


# ---------------------------------------------------------------------------
# Rule 1: an aimed payment wins
# ---------------------------------------------------------------------------
def test_a_payment_aimed_at_a_credit_stays_on_that_credit(ctx, session, customer):
    """"Optionally select which credit" -- the shopkeeper pointed at it, and FIFO
    must not drag their money to an older one."""
    older = _buy(ctx, customer, "100", days_ago=10)
    newer = _buy(ctx, customer, "100", days_ago=5)
    session.commit()

    PaymentService(ctx).record(ctx, credit_id=newer.id, amount=D("100"))
    session.commit()

    session.refresh(older)
    session.refresh(newer)
    assert CreditStatus(newer.status) is CreditStatus.PAID  # the one they chose
    assert CreditStatus(older.status) is CreditStatus.PENDING  # untouched by FIFO
    assert older.amount_paid == D("0.00")


def test_an_account_payment_fills_around_an_aimed_one(ctx, session, customer):
    """Rules 1 and 2 together: the aimed money sticks, the rest flows oldest-first."""
    first = _buy(ctx, customer, "100", days_ago=10)
    second = _buy(ctx, customer, "100", days_ago=5)
    third = _buy(ctx, customer, "100", days_ago=1)
    session.commit()

    PaymentService(ctx).record(ctx, credit_id=second.id, amount=D("100"))  # aimed
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("120"))
    session.commit()

    session.refresh(first)
    session.refresh(second)
    session.refresh(third)

    assert CreditStatus(second.status) is CreditStatus.PAID  # aimed, untouched
    assert first.amount_paid == D("100.00")  # oldest takes the pool first
    assert CreditStatus(first.status) is CreditStatus.PAID
    assert third.amount_paid == D("20.00")  # the remainder
    assert CreditStatus(third.status) is CreditStatus.PARTIALLY_PAID


def test_a_partially_aimed_credit_is_topped_up_from_the_pool(ctx, session, customer):
    credit = _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("60"))
    session.commit()

    session.refresh(credit)
    assert credit.amount_paid == D("100.00")
    assert CreditStatus(credit.status) is CreditStatus.PAID


# ---------------------------------------------------------------------------
# It re-settles when the inputs change — no special cases
# ---------------------------------------------------------------------------
def test_voiding_a_payment_un_settles_the_credits(ctx, session, customer):
    first = _buy(ctx, customer, "100", days_ago=10)
    second = _buy(ctx, customer, "100", days_ago=5)
    session.commit()
    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("150")
    )
    session.commit()
    session.refresh(first)
    assert CreditStatus(first.status) is CreditStatus.PAID

    PaymentService(ctx).void(ctx, payment.id, reason="Cash never arrived")
    session.commit()

    session.refresh(first)
    session.refresh(second)
    assert CreditStatus(first.status) is CreditStatus.PENDING
    assert first.amount_paid == D("0.00")
    assert second.amount_paid == D("0.00")
    session.refresh(customer)
    assert customer.outstanding_balance == D("200.00")


def test_a_new_older_credit_re_settles_the_queue(ctx, session, customer):
    """A back-dated purchase joins the FRONT of the queue and takes the money."""
    newer = _buy(ctx, customer, "100", days_ago=1)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()
    session.refresh(newer)
    assert CreditStatus(newer.status) is CreditStatus.PAID

    # "I forgot to write down last week's rice."
    older = _buy(ctx, customer, "100", days_ago=7)
    session.commit()

    session.refresh(older)
    session.refresh(newer)
    assert CreditStatus(older.status) is CreditStatus.PAID  # oldest gets the money
    assert CreditStatus(newer.status) is CreditStatus.PENDING  # gives it up
    session.refresh(customer)
    assert customer.outstanding_balance == D("100.00")


def test_cancelling_a_credit_frees_its_money_for_the_next_one(ctx, session, customer):
    first = _buy(ctx, customer, "100", days_ago=10)
    second = _buy(ctx, customer, "100", days_ago=5)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()
    session.refresh(second)
    assert CreditStatus(second.status) is CreditStatus.PENDING

    CreditService(ctx).cancel(ctx, first.id, reason="Rang it up twice")
    session.commit()

    session.refresh(second)
    assert CreditStatus(second.status) is CreditStatus.PAID  # the money moved on


def test_settlement_is_idempotent(ctx, session, customer):
    """A pure function of the data: running it twice changes nothing."""
    _buy(ctx, customer, "100", days_ago=10)
    _buy(ctx, customer, "100", days_ago=5)
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("150"))
    session.commit()

    before = [(c.amount_paid, c.remaining_amount, c.status) for c in _credits(session, customer)]
    apply_settlement(session, customer.id, today=date.today())
    apply_settlement(session, customer.id, today=date.today())
    session.commit()
    after = [(c.amount_paid, c.remaining_amount, c.status) for c in _credits(session, customer)]

    assert before == after


def test_an_advance_does_not_over_settle(ctx, session, customer):
    """Paying more than everything owed settles everything, and no more."""
    credit = _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("500"))
    session.commit()

    session.refresh(credit)
    assert credit.amount_paid == D("100.00")  # not 500
    assert credit.remaining_amount == D("0.00")
    session.refresh(customer)
    assert customer.ledger_balance == D("-400.00")  # the advance lives on the account


# ---------------------------------------------------------------------------
# Reminders: nothing settled gets chased
# ---------------------------------------------------------------------------
def test_a_settled_credit_is_not_planned_for_a_reminder(ctx, session, business, customer):
    """The requirement: a credit paid before its due date must never be chased.

    Nothing special is needed for this -- the reminder query already filters on
    open_statuses() AND remaining_amount > 0, so correct settlement is what makes it
    true. This pins that the two agree.
    """
    from app.services.reminder import ReminderService

    business.reminders_enabled = True
    business.reminder_days_before = [3]
    session.add(business)
    paid = _buy(ctx, customer, "100", days_ago=10, due_in=3)
    unpaid = _buy(ctx, customer, "100", days_ago=5, due_in=3)
    session.commit()

    # Covers the OLDER credit only.
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    session.refresh(paid)
    assert CreditStatus(paid.status) is CreditStatus.PAID

    ReminderService(ctx).plan_for_business(business, today=date.today())
    session.commit()

    from app.models.communication import ScheduledReminder

    chased = {
        r.credit_id for r in session.exec(select(ScheduledReminder)).all()
    }
    assert paid.id not in chased  # settled -> never chased
    assert unpaid.id in chased


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------
def test_settlement_never_reaches_another_tenants_credits(ctx, session, customer):
    from app.models.business import Business
    from app.models.customer import Customer

    other = Business(name="Rival", slug="rival", email="r@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Theirs")
    session.add(theirs)
    session.commit()
    their_credit = Credit(
        business_id=other.id,
        customer_id=theirs.id,
        number="CR-2026-9999",
        issued_date=date.today(),
        due_date=date.today() + timedelta(days=30),
        grand_total=D("100"),
        remaining_amount=D("100"),
    )
    session.add(their_credit)
    session.commit()

    _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    session.refresh(their_credit)
    assert their_credit.remaining_amount == D("100")  # untouched
    assert CreditStatus(their_credit.status) is CreditStatus.PENDING
