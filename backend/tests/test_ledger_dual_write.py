"""Stage 2: account payments, and the two models staying in step.

Stage 1 proved the ledger could REPRODUCE the legacy balances. Stage 2 makes it
track them LIVE, so the claim under test here is:

    after any sequence of ordinary operations, reconcile() is still green.

If a write path ever moves the legacy balance without posting to the ledger, these
are what notice -- which is what makes it safe to run both models at once.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import select

from app.core.errors import ConflictError, ValidationError
from app.models.credit import Payment
from app.models.enums import CreditStatus, LedgerEntryType, PaymentMethod
from app.models.ledger import LedgerEntry
from app.services.credit import CreditItemInput, CreditService
from app.services.ledger import LedgerService
from app.services.payment import PaymentService

D = Decimal


def _buy(ctx, customer, amount: str, *, days_ago: int = 0):
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Cigarettes", quantity=D("1"), unit_price=D(amount))],
        issued_date=date.today() - timedelta(days=days_ago),
        due_date=date.today() + timedelta(days=30),
    )


def _assert_in_step(ctx, session, customer):
    """The Stage 2 contract: both models agree, and the ledger agrees with itself."""
    session.refresh(customer)
    report = LedgerService(ctx).reconcile()
    assert report.ok, [r.note for r in report.disagreed]
    ok, figures = LedgerService(ctx).verify(customer.id)
    assert ok, figures


# ---------------------------------------------------------------------------
# The point of Stage 2: paying the ACCOUNT
# ---------------------------------------------------------------------------
def test_a_payment_can_be_recorded_without_naming_a_credit(ctx, session, customer):
    """THE change. Nu.10,000 on salary day, against 400 purchases, no allocation."""
    for _ in range(400):
        _buy(ctx, customer, "25")
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("10000.00")

    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("10000")
    )
    session.commit()

    assert payment.credit_id is None  # names no invoice — the whole point
    session.refresh(customer)
    assert customer.ledger_balance == D("0.00")
    # ...and the legacy column agrees, because recompute_aggregates sums payments
    # by customer_id rather than through credits.
    assert customer.outstanding_balance == D("0.00")
    _assert_in_step(ctx, session, customer)


def test_an_account_payment_costs_one_ledger_entry(ctx, session, customer):
    """Not 400 updates. The entire performance argument, asserted."""
    for _ in range(50):
        _buy(ctx, customer, "20")
    session.commit()
    before = len(session.exec(select(LedgerEntry)).all())

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("1000"))
    session.commit()

    after = session.exec(select(LedgerEntry)).all()
    assert len(after) == before + 1
    assert after[-1].entry_type is LedgerEntryType.PAYMENT


def test_a_partial_account_payment_just_leaves_a_balance(ctx, session, customer):
    """Partial and full are the same operation -- there is no status to juggle."""
    _buy(ctx, customer, "500")
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("200"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("300.00")
    _assert_in_step(ctx, session, customer)


def test_an_account_payment_may_leave_the_customer_in_credit(ctx, session, customer):
    """Advances are legal against an ACCOUNT -- unlike against one invoice.

    The legacy column clamps this to zero and loses it; reconcile reports it as an
    advance rather than as drift.
    """
    _buy(ctx, customer, "100")
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("500"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("-400.00")
    assert customer.outstanding_balance == D("0.00")  # clamped, as ever

    report = LedgerService(ctx).reconcile()
    assert report.ok
    assert len(report.in_credit) == 1
    assert "Paid ahead" in report.in_credit[0].note


def test_the_receipt_balance_is_the_customers_not_a_credits(ctx, session, customer):
    _buy(ctx, customer, "500")
    session.commit()

    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("200"), method=PaymentMethod.MOBILE_MONEY
    )
    session.commit()

    assert payment.balance_after == D("300.00")  # what the customer still owes


def test_an_account_payment_of_zero_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="greater than zero"):
        PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("0"))


# ---------------------------------------------------------------------------
# Dual-write: the legacy paths keep the ledger live
# ---------------------------------------------------------------------------
def test_creating_a_credit_posts_a_charge(ctx, session, customer):
    credit = _buy(ctx, customer, "30")
    session.commit()

    entry = session.exec(select(LedgerEntry)).one()
    assert entry.entry_type is LedgerEntryType.CHARGE
    assert entry.amount == D("30.00")
    assert entry.credit_id == credit.id
    _assert_in_step(ctx, session, customer)


def test_recording_a_legacy_payment_posts_a_payment(ctx, session, customer):
    credit = _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()

    entries = sorted(session.exec(select(LedgerEntry)).all(), key=lambda e: e.seq)
    assert [e.entry_type for e in entries] == [
        LedgerEntryType.CHARGE,
        LedgerEntryType.PAYMENT,
    ]
    assert entries[-1].balance_after == D("60.00")
    _assert_in_step(ctx, session, customer)


def test_an_initial_payment_lands_after_its_charge(ctx, session, customer):
    """You cannot pay for something before it has been charged."""
    CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Rice", quantity=D("1"), unit_price=D("500"))],
        due_date=date.today() + timedelta(days=30),
        initial_payment=D("200"),
    )
    session.commit()

    entries = sorted(session.exec(select(LedgerEntry)).all(), key=lambda e: e.seq)
    assert [e.entry_type for e in entries] == [
        LedgerEntryType.CHARGE,
        LedgerEntryType.PAYMENT,
    ]
    assert [e.balance_after for e in entries] == [D("500.00"), D("300.00")]
    _assert_in_step(ctx, session, customer)


def test_cancelling_a_credit_reverses_its_charge(ctx, session, customer):
    _buy(ctx, customer, "30")
    doomed = _buy(ctx, customer, "999")
    session.commit()

    CreditService(ctx).cancel(ctx, doomed.id, reason="Rang it up twice")
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")
    # The charge is still visible, alongside its reversal — never deleted.
    types = [e.entry_type for e in session.exec(select(LedgerEntry)).all()]
    assert types.count(LedgerEntryType.REVERSAL) == 1
    _assert_in_step(ctx, session, customer)


def test_voiding_a_payment_reverses_its_entry(ctx, session, customer):
    credit = _buy(ctx, customer, "100")
    session.commit()
    payment = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()

    PaymentService(ctx).void(ctx, payment.id, reason="Counted the cash wrong")
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("100.00")  # the money came back
    _assert_in_step(ctx, session, customer)


def test_voiding_an_account_payment_works_without_a_credit(ctx, session, customer):
    """The path that would have crashed on payment.credit_id being None."""
    _buy(ctx, customer, "100")
    session.commit()
    payment = PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("60")
    )
    session.commit()

    PaymentService(ctx).void(ctx, payment.id, reason="Customer's transfer bounced")
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("100.00")
    _assert_in_step(ctx, session, customer)


def test_editing_a_credit_posts_the_difference(ctx, session, customer):
    """The total moved, so the ledger follows -- with an ADJUSTMENT, not an edit."""
    credit = _buy(ctx, customer, "900")
    session.commit()

    CreditService(ctx).update(
        ctx,
        credit.id,
        items=[CreditItemInput(name="Cigarettes", quantity=D("1"), unit_price=D("750"))],
    )
    session.commit()

    entries = sorted(session.exec(select(LedgerEntry)).all(), key=lambda e: e.seq)
    assert entries[-1].entry_type is LedgerEntryType.ADJUSTMENT
    assert entries[-1].amount == D("-150.00")
    session.refresh(customer)
    assert customer.ledger_balance == D("750.00")
    _assert_in_step(ctx, session, customer)


def test_editing_a_credit_without_changing_the_total_posts_nothing(ctx, session, customer):
    """No money moved, so no entry. A ledger full of zero-deltas is noise."""
    credit = _buy(ctx, customer, "900")
    session.commit()
    before = len(session.exec(select(LedgerEntry)).all())

    CreditService(ctx).update(ctx, credit.id, notes="Customer asked for a receipt")
    session.commit()

    assert len(session.exec(select(LedgerEntry)).all()) == before


def test_trashing_and_restoring_a_credit_round_trips(ctx, session, customer):
    _buy(ctx, customer, "30")
    doomed = _buy(ctx, customer, "70")
    session.commit()

    CreditService(ctx).soft_delete(ctx, doomed.id)
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")
    _assert_in_step(ctx, session, customer)

    CreditService(ctx).restore(doomed.id)
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("100.00")
    _assert_in_step(ctx, session, customer)


def test_trashing_and_restoring_a_payment_round_trips(ctx, session, customer):
    credit = _buy(ctx, customer, "100")
    session.commit()
    payment = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()

    PaymentService(ctx).soft_delete(ctx, payment.id)
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("100.00")
    _assert_in_step(ctx, session, customer)

    PaymentService(ctx).restore(ctx, payment.id)
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("60.00")
    _assert_in_step(ctx, session, customer)


# ---------------------------------------------------------------------------
# The claim: a real day, and the two models still agree
# ---------------------------------------------------------------------------
def test_a_realistic_month_stays_in_step(ctx, session, customer):
    """Everything a shop actually does, in one sequence: buy repeatedly, correct a
    mistake, cancel a duplicate, take an advance on salary day."""
    for day in range(28):
        for _ in range(6):
            _buy(ctx, customer, "30", days_ago=27 - day)
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("5040.00")  # 28 * 6 * 30

    duplicate = _buy(ctx, customer, "30")
    session.commit()
    CreditService(ctx).cancel(ctx, duplicate.id, reason="Rang it up twice")
    session.commit()

    mistake = _buy(ctx, customer, "900")
    session.commit()
    CreditService(ctx).update(
        ctx,
        mistake.id,
        items=[CreditItemInput(name="Rice 5kg", quantity=D("1"), unit_price=D("670"))],
    )
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("5710.00")  # 5040 + 670

    # Salary day: one payment, against the account.
    PaymentService(ctx).record_to_account(
        ctx, customer_id=customer.id, amount=D("5710"), reference="July salary"
    )
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("0.00")
    assert customer.outstanding_balance == D("0.00")
    _assert_in_step(ctx, session, customer)


def test_backfilled_history_and_live_writes_coexist(ctx, session, customer):
    """Rollout order must not matter: backfill first or dual-write first, you
    converge on the same balance."""
    old = _buy(ctx, customer, "100")
    session.commit()

    # Simulate a customer whose history predates the ledger.
    for entry in session.exec(
        select(LedgerEntry).where(LedgerEntry.customer_id == customer.id)
    ).all():
        session.delete(entry)
    customer.ledger_balance = D("0")
    customer.ledger_seq = 0
    session.add(customer)
    session.commit()

    # A live write lands FIRST, before anyone remembers to backfill.
    _buy(ctx, customer, "30")
    session.commit()
    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")  # the old charge is still missing

    # The backfill catches up, skipping the document already posted.
    posted = LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    assert posted == 1  # only the old credit
    session.refresh(customer)
    assert customer.ledger_balance == D("130.00")
    _assert_in_step(ctx, session, customer)
    assert old.id in {
        e.credit_id for e in session.exec(select(LedgerEntry)).all() if e.credit_id
    }


def test_legacy_per_credit_payments_still_refuse_overpayment(ctx, session, customer):
    """Stage 2 must not weaken the old path: against ONE invoice, overpaying is
    still a mistake worth catching at the counter."""
    credit = _buy(ctx, customer, "100")
    session.commit()

    with pytest.raises(ConflictError, match="more than the"):
        PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("500"))


def test_an_account_payment_settles_the_credits_it_covers(ctx, session, customer):
    """This test used to assert the opposite, and the opposite was a bug.

    An account payment names no credit -- but the credits it covers must still show
    as settled, or the Credits list says a customer owes money the Account tab says
    they do not. Both were reading real columns; the columns disagreed. See
    apply_settlement.
    """
    credit = _buy(ctx, customer, "100")
    session.commit()

    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("100"))
    session.commit()

    session.refresh(credit)
    assert credit.amount_paid == D("100.00")
    assert credit.remaining_amount == D("0.00")
    assert CreditStatus(credit.status) is CreditStatus.PAID
    assert credit.paid_at is not None

    session.refresh(customer)
    assert customer.ledger_balance == D("0.00")
    assert customer.outstanding_balance == D("0.00")
    _assert_in_step(ctx, session, customer)


def test_account_payments_appear_in_the_customers_payment_list(ctx, session, customer):
    """credit_id IS NULL must not make a payment invisible."""
    _buy(ctx, customer, "100")
    session.commit()
    PaymentService(ctx).record_to_account(ctx, customer_id=customer.id, amount=D("60"))
    session.commit()

    from app.services.payment import PaymentFilter

    page = PaymentService(ctx).list(PaymentFilter(customer_id=customer.id))
    assert len(page.items) == 1
    assert page.items[0].credit_id is None


def test_the_payment_model_allows_a_null_credit_id(ctx, session, customer):
    """The schema change itself: pinned so nobody restores the NOT NULL."""
    from app.models.base import utcnow

    payment = Payment(
        business_id=customer.business_id,
        number="PAY-TEST-1",
        credit_id=None,
        customer_id=customer.id,
        amount=D("10"),
        balance_after=D("0"),
        paid_at=utcnow(),
    )
    session.add(payment)
    session.commit()  # would raise IntegrityError before this stage
    assert payment.credit_id is None
