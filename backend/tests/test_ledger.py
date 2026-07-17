"""The customer account ledger (Stage 1).

The point of Stage 1 is a single claim: **the ledger reproduces the existing
balances exactly, on real data, before anything depends on it.** ``test_reconcile_*``
is that claim. Everything else pins the invariants that make it stay true.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.models.credit import Payment
from app.models.customer import Customer
from app.models.enums import LedgerEntryType
from app.models.ledger import LedgerEntry
from app.services.credit import CreditItemInput, CreditService
from app.services.ledger import LedgerService
from app.services.payment import PaymentService

D = Decimal


def _buy(ctx, customer, amount: str, *, days_ago: int = 0):
    """One purchase, the way the shop records it today."""
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Cigarettes", quantity=D("1"), unit_price=D(amount))],
        issued_date=date.today() - timedelta(days=days_ago),
        due_date=date.today() + timedelta(days=30),
    )


def _wipe_ledger(session, customer):
    """Erase the ledger for a customer, leaving their credits/payments intact.

    Simulates a shop whose history PREDATES the ledger -- which is the only state
    backfill exists for. Since Stage 2 dual-writes, documents created in a test are
    already in the ledger, so this is how you get back to the pre-migration world.
    """
    for entry in session.exec(select(LedgerEntry).where(LedgerEntry.customer_id == customer.id)).all():
        session.delete(entry)
    customer.ledger_balance = D("0")
    customer.ledger_seq = 0
    session.add(customer)
    session.commit()


# ---------------------------------------------------------------------------
# post(): the single door
# ---------------------------------------------------------------------------
def test_a_charge_increases_the_balance(ctx, session, customer):
    svc = LedgerService(ctx)
    entry = svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30"))
    session.commit()

    assert entry.seq == 1
    assert entry.amount == D("30.00")
    assert entry.balance_after == D("30.00")
    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")
    assert customer.ledger_seq == 1


def test_a_payment_reduces_the_balance(ctx, session, customer):
    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("100"))
    entry = svc.post(customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("-40"))
    session.commit()

    assert entry.seq == 2
    assert entry.balance_after == D("60.00")
    session.refresh(customer)
    assert customer.ledger_balance == D("60.00")


def test_the_running_balance_is_correct_over_many_entries(ctx, session, customer):
    """The shape this whole design exists for: many small charges, one payment."""
    svc = LedgerService(ctx)
    for _ in range(400):
        svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("25"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("10000.00")
    assert customer.ledger_seq == 400

    # ...and settling it is ONE entry, not 400 updates.
    entry = svc.post(
        customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("-10000")
    )
    session.commit()

    assert entry.seq == 401
    assert entry.balance_after == D("0.00")
    session.refresh(customer)
    assert customer.ledger_balance == D("0.00")

    ok, figures = svc.verify(customer.id)
    assert ok, figures


def test_overpayment_leaves_the_customer_in_credit(ctx, session, customer):
    """The state the legacy model cannot represent: the shop holds an advance.

    services/customer.recompute_aggregates clamps outstanding_balance at zero, so
    paying ahead is invisible there. Here it is just a negative balance.
    """
    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("100"))
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("-500"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("-400.00")


def test_seq_is_per_customer_not_global(ctx, session, business, customer):
    other = Customer(business_id=business.id, code="CUST-0002", name="Pema")
    session.add(other)
    session.commit()
    session.refresh(other)

    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("10"))
    first_for_other = svc.post(
        customer_id=other.id, entry_type=LedgerEntryType.CHARGE, amount=D("10")
    )
    session.commit()

    # Each account counts from 1 — which is why two customers never contend.
    assert first_for_other.seq == 1


# ---------------------------------------------------------------------------
# The sign convention
# ---------------------------------------------------------------------------
def test_a_negative_charge_is_refused(ctx, customer):
    """A CHARGE with a negative amount is a payment in disguise: it would balance
    correctly and make every "what did we sell" report a lie."""
    with pytest.raises(ValidationError, match="must be positive"):
        LedgerService(ctx).post(
            customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("-30")
        )


def test_a_positive_payment_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="must be negative"):
        LedgerService(ctx).post(
            customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("30")
        )


def test_a_zero_entry_is_refused(ctx, customer):
    with pytest.raises(ValidationError, match="moves nothing"):
        LedgerService(ctx).post(
            customer_id=customer.id, entry_type=LedgerEntryType.ADJUSTMENT, amount=D("0")
        )


def test_an_adjustment_may_go_either_way(ctx, session, customer):
    """Corrections and returns are exactly why ADJUSTMENT is in neither sign set."""
    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.ADJUSTMENT, amount=D("50"))
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.ADJUSTMENT, amount=D("-20"))
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")


# ---------------------------------------------------------------------------
# Append-only (R1 / L4)
# ---------------------------------------------------------------------------
def test_reverse_appends_a_negation_and_keeps_the_original(ctx, session, customer):
    svc = LedgerService(ctx)
    charge = svc.post(
        customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30")
    )
    session.commit()

    reversal = svc.reverse(charge.id, memo="Rang customer's item by mistake")
    session.commit()

    assert reversal.entry_type is LedgerEntryType.REVERSAL
    assert reversal.amount == D("-30.00")
    assert reversal.reverses_id == charge.id
    assert reversal.balance_after == D("0.00")

    # The original is untouched and still visible — that is the whole point.
    session.refresh(charge)
    assert charge.amount == D("30.00")
    assert session.exec(select(LedgerEntry)).all().__len__() == 2


def test_an_entry_cannot_be_reversed_twice(ctx, session, customer):
    svc = LedgerService(ctx)
    charge = svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30"))
    session.commit()
    svc.reverse(charge.id)
    session.commit()

    with pytest.raises(ConflictError, match="already reversed"):
        svc.reverse(charge.id)


def test_a_reversal_cannot_be_reversed(ctx, session, customer):
    svc = LedgerService(ctx)
    charge = svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30"))
    session.commit()
    reversal = svc.reverse(charge.id)
    session.commit()

    with pytest.raises(ConflictError, match="cannot itself be reversed"):
        svc.reverse(reversal.id)


def test_the_ledger_has_no_soft_delete(ctx):
    """A soft-deletable ledger is a contradiction. Pinned so nobody 'fixes' it by
    switching LedgerEntry to TenantEntity."""
    assert not hasattr(LedgerEntry, "deleted_at")


# ---------------------------------------------------------------------------
# The two clocks (R2)
# ---------------------------------------------------------------------------
def test_back_dating_does_not_disturb_the_running_balance(ctx, session, customer):
    """THE detail hand-rolled ledgers get wrong.

    "I forgot to write down yesterday's tea" must be an ordinary append. If
    balance_after followed occurred_at, this entry would invalidate every balance
    after it.
    """
    from app.models.base import utcnow

    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("100"))
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("-40"))

    yesterday = utcnow() - timedelta(days=1)
    late = svc.post(
        customer_id=customer.id,
        entry_type=LedgerEntryType.CHARGE,
        amount=D("15"),
        occurred_at=yesterday,
        memo="Forgot to write down yesterday's tea",
    )
    session.commit()

    # It is the newest POSTING (seq 3) even though it is the oldest EVENT.
    assert late.seq == 3
    assert late.occurred_at < late.posted_at
    assert late.balance_after == D("75.00")  # 100 - 40 + 15, in posting order

    session.refresh(customer)
    assert customer.ledger_balance == D("75.00")
    ok, figures = svc.verify(customer.id)
    assert ok, figures


def test_the_passbook_is_ordered_by_seq(ctx, session, customer):
    """Ordering by occurred_at would show a running balance that jumps around."""
    from app.models.base import utcnow

    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("100"))
    svc.post(
        customer_id=customer.id,
        entry_type=LedgerEntryType.CHARGE,
        amount=D("15"),
        occurred_at=utcnow() - timedelta(days=5),
    )
    session.commit()

    rows = svc.entries(customer.id)
    assert [r.seq for r in rows] == [2, 1]
    assert [r.balance_after for r in rows] == [D("115.00"), D("100.00")]


# ---------------------------------------------------------------------------
# verify(): the integrity net
# ---------------------------------------------------------------------------
def test_verify_agrees_across_three_derivations(ctx, session, customer):
    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30"))
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("25"))
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.PAYMENT, amount=D("-10"))
    session.commit()

    ok, figures = svc.verify(customer.id)
    assert ok
    assert figures == {
        "cached": D("45.00"),
        "summed": D("45.00"),
        "last_balance_after": D("45.00"),
    }


def test_verify_catches_a_tampered_cache(ctx, session, customer):
    """If anything writes customer.ledger_balance without going through post(),
    this is what notices."""
    svc = LedgerService(ctx)
    svc.post(customer_id=customer.id, entry_type=LedgerEntryType.CHARGE, amount=D("30"))
    session.commit()

    customer.ledger_balance = D("999")
    session.add(customer)
    session.commit()

    ok, figures = svc.verify(customer.id)
    assert not ok
    assert figures["cached"] == D("999.00")
    assert figures["summed"] == D("30.00")


# ---------------------------------------------------------------------------
# Backfill + reconcile: the gate on Stage 1
# ---------------------------------------------------------------------------
def test_backfill_reproduces_the_legacy_balance(ctx, session, customer):
    """THE Stage 1 claim, in miniature: build the ledger from existing documents
    and land on the same number the old model reports."""
    _buy(ctx, customer, "30")
    _buy(ctx, customer, "25")
    _buy(ctx, customer, "60")
    session.commit()

    session.refresh(customer)
    legacy = customer.outstanding_balance
    assert legacy == D("115.00")

    _wipe_ledger(session, customer)  # pretend this history predates the ledger
    entries = LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    assert entries == 3
    session.refresh(customer)
    assert customer.ledger_balance == legacy

    report = LedgerService(ctx).reconcile()
    assert report.ok
    assert report.agreed == report.checked


def test_backfill_interleaves_charges_and_payments_chronologically(ctx, session, customer):
    """Posting all credits then all payments would give the same FINAL balance but a
    fictional running balance — and the running balance is the point of a passbook."""
    credit = _buy(ctx, customer, "100", days_ago=10)
    session.commit()
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()
    _buy(ctx, customer, "50", days_ago=1)
    session.commit()

    _wipe_ledger(session, customer)
    LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    rows = sorted(session.exec(select(LedgerEntry)).all(), key=lambda e: e.seq)
    assert [e.entry_type for e in rows] == [
        LedgerEntryType.CHARGE,
        LedgerEntryType.PAYMENT,
        LedgerEntryType.CHARGE,
    ]
    assert [e.balance_after for e in rows] == [D("100.00"), D("60.00"), D("110.00")]

    session.refresh(customer)
    assert customer.ledger_balance == customer.outstanding_balance == D("110.00")


def test_backfill_is_idempotent(ctx, session, customer):
    """A partial run must be safely repeatable."""
    _buy(ctx, customer, "30")
    session.commit()
    _wipe_ledger(session, customer)

    svc = LedgerService(ctx)
    assert svc.backfill_customer(customer.id) == 1
    session.commit()
    assert svc.backfill_customer(customer.id) == 0  # skipped, not doubled
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")


def test_backfill_ignores_cancelled_credits(ctx, session, customer):
    """Must mirror _live_credits in services/customer.py exactly, or reconcile()
    reports drift that is really a definition mismatch."""
    _buy(ctx, customer, "30")
    doomed = _buy(ctx, customer, "999")
    session.commit()
    CreditService(ctx).cancel(ctx, doomed.id, reason="Customer changed their mind")
    session.commit()

    _wipe_ledger(session, customer)
    LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("30.00")
    assert LedgerService(ctx).reconcile().ok


def test_backfill_ignores_voided_payments(ctx, session, customer):
    credit = _buy(ctx, customer, "100")
    session.commit()
    payment = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=D("40"))
    session.commit()
    PaymentService(ctx).void(ctx, payment.id, reason="Recorded against the wrong customer")
    session.commit()

    _wipe_ledger(session, customer)
    LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    session.refresh(customer)
    assert customer.ledger_balance == D("100.00")
    assert LedgerService(ctx).reconcile().ok


def test_reconcile_reports_an_advance_rather_than_calling_it_drift(ctx, session, customer):
    """The clamp, surfaced.

    A customer who paid ahead has outstanding_balance == 0 (clamped) but a negative
    ledger balance. That is not drift — it is the old model losing information, and
    reconcile has to say so rather than fail.
    """
    credit = _buy(ctx, customer, "100")
    session.commit()
    # Bypass PaymentService's overpayment guard to manufacture the state the legacy
    # model clamps away — this is exactly the history a real backfill can meet.
    from app.models.base import utcnow

    session.add(
        Payment(
            business_id=customer.business_id,
            number="PAY-LEGACY-1",
            credit_id=credit.id,
            customer_id=customer.id,
            amount=D("250"),
            balance_after=D("0"),
            paid_at=utcnow(),
        )
    )
    session.commit()

    from app.services.customer import recompute_aggregates

    recompute_aggregates(session, customer.id)
    session.commit()
    session.refresh(customer)
    assert customer.outstanding_balance == D("0.00")  # clamped

    _wipe_ledger(session, customer)
    LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    report = LedgerService(ctx).reconcile()
    assert report.ok  # the clamped comparison still agrees
    assert len(report.in_credit) == 1
    row = report.in_credit[0]
    assert row.ledger_balance == D("-150.00")
    assert "Paid ahead" in row.note


def test_reconcile_flags_a_real_disagreement(ctx, session, customer):
    _buy(ctx, customer, "30")
    session.commit()

    # Corrupt the legacy column: reconcile must not shrug.
    customer.outstanding_balance = D("777")
    session.add(customer)
    session.commit()

    report = LedgerService(ctx).reconcile()
    assert not report.ok
    assert report.disagreed[0].legacy_outstanding == D("777.00")
    assert report.disagreed[0].ledger_balance == D("30.00")


def test_backfill_of_a_realistic_month_reconciles(ctx, session, customer):
    """The actual shape of the problem: ~400 purchases, one salary-day payment."""
    total = D("0")
    for i in range(120):
        amount = D("30") if i % 3 else D("25")
        _buy(ctx, customer, str(amount), days_ago=(i % 28))
        total += amount
    session.commit()

    _wipe_ledger(session, customer)
    entries = LedgerService(ctx).backfill_customer(customer.id)
    session.commit()

    assert entries == 120
    session.refresh(customer)
    assert customer.ledger_balance == total == customer.outstanding_balance

    ok, _ = LedgerService(ctx).verify(customer.id)
    assert ok
    assert LedgerService(ctx).reconcile().ok


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------
def test_cannot_post_to_another_tenants_customer(ctx, session):
    from app.models.business import Business

    other = Business(name="Rival Shop", slug="rival-shop", email="rival@x.bt")
    session.add(other)
    session.commit()
    theirs = Customer(business_id=other.id, code="CUST-0001", name="Their Customer")
    session.add(theirs)
    session.commit()
    session.refresh(theirs)

    with pytest.raises(NotFoundError):
        LedgerService(ctx).post(
            customer_id=theirs.id, entry_type=LedgerEntryType.CHARGE, amount=D("30")
        )


def test_reconcile_only_sees_its_own_business(ctx, session, customer):
    from app.models.business import Business

    other = Business(name="Rival Shop", slug="rival-shop", email="rival@x.bt")
    session.add(other)
    session.commit()
    session.add(Customer(business_id=other.id, code="CUST-0001", name="Theirs"))
    session.commit()

    _buy(ctx, customer, "30")
    session.commit()

    report = LedgerService(ctx).reconcile()
    assert report.checked == 1
    assert report.rows[0].name == customer.name
