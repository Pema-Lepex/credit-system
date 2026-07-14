"""The money engine. If any of these fail, someone is owed the wrong amount.

These tests exist to protect the five invariants documented at the top of
services/credit.py. They are deliberately arithmetic-heavy and boring: this is the
part of the system where "looks right" is not good enough.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.core.errors import ConflictError, ValidationError
from app.models.business import Business
from app.models.customer import Customer
from app.models.enums import CreditStatus, PaymentMethod
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService

TODAY = date.today()
NEXT_WEEK = TODAY + timedelta(days=7)


def item(name: str, qty: str, price: str, **kw: object) -> CreditItemInput:
    return CreditItemInput(
        name=name, quantity=Decimal(qty), unit_price=Decimal(price), **kw  # type: ignore[arg-type]
    )


def test_line_totals_and_grand_total(ctx: ServiceContext, customer: Customer) -> None:
    """subtotal - discount + tax, computed per line then rolled up."""
    credit = CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        due_date=NEXT_WEEK,
        items=[
            item("Rice 5kg", "3", "250.00"),                        # 750.00
            item("Cooking oil", "2", "180.50"),                     # 361.00
            item("Sugar", "1", "95.25", discount_amount=Decimal("5.25")),  # 90.00
        ],
    )
    # 750.00 + 361.00 + 95.25 = 1206.25 subtotal; 5.25 discount
    assert credit.subtotal == Decimal("1206.25")
    assert credit.discount_amount == Decimal("5.25")
    assert credit.tax_amount == Decimal("0.00")
    assert credit.grand_total == Decimal("1201.00")
    assert credit.remaining_amount == Decimal("1201.00")
    assert credit.amount_paid == Decimal("0.00")
    assert credit.status is CreditStatus.PENDING


def test_tax_applies_after_discount(ctx: ServiceContext, customer: Customer) -> None:
    """Tax is charged on the discounted price, not the list price."""
    credit = CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        due_date=NEXT_WEEK,
        items=[
            item("Widget", "1", "100.00", discount_amount=Decimal("20.00"),
                 tax_percentage=Decimal("10")),
        ],
    )
    # taxable = 100 - 20 = 80; tax = 8.00; total = 88.00
    assert credit.subtotal == Decimal("100.00")
    assert credit.discount_amount == Decimal("20.00")
    assert credit.tax_amount == Decimal("8.00")
    assert credit.grand_total == Decimal("88.00")


def test_partial_payment_moves_status_and_balance(
    ctx: ServiceContext, customer: Customer, session: Session
) -> None:
    credits = CreditService(ctx)
    payments = PaymentService(ctx)

    credit = credits.create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK,
        items=[item("Rice", "4", "250.00")],  # 1000.00
    )
    assert credit.grand_total == Decimal("1000.00")

    payments.record(ctx, credit_id=credit.id, amount=Decimal("400.00"),
                    method=PaymentMethod.CASH)
    session.refresh(credit)

    assert credit.amount_paid == Decimal("400.00")
    assert credit.remaining_amount == Decimal("600.00")
    assert credit.status is CreditStatus.PARTIALLY_PAID

    payments.record(ctx, credit_id=credit.id, amount=Decimal("600.00"))
    session.refresh(credit)

    assert credit.amount_paid == Decimal("1000.00")
    assert credit.remaining_amount == Decimal("0.00")
    assert credit.status is CreditStatus.PAID
    assert credit.paid_at is not None


def test_overpayment_is_refused(ctx: ServiceContext, customer: Customer) -> None:
    """The shopkeeper must find out at the counter, not silently later."""
    credit = CreditService(ctx).create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK,
        items=[item("Rice", "1", "100.00")],
    )
    with pytest.raises(ConflictError, match="more than"):
        PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("100.01"))


def test_void_restores_the_balance_and_reopens_the_credit(
    ctx: ServiceContext, customer: Customer, session: Session
) -> None:
    """Voiding a payment on a settled credit must reopen it -- money is owed again."""
    credits, payments = CreditService(ctx), PaymentService(ctx)

    credit = credits.create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK,
        items=[item("Rice", "1", "500.00")],
    )
    payment = payments.record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    session.refresh(credit)
    assert credit.status is CreditStatus.PAID

    payments.void(ctx, payment.id, reason="Cheque bounced")
    session.refresh(credit)

    assert credit.amount_paid == Decimal("0.00")
    assert credit.remaining_amount == Decimal("500.00")
    assert credit.status is CreditStatus.PENDING
    assert credit.paid_at is None

    # The payment row SURVIVES -- history is never rewritten.
    history = payments.history_for_credit(credit.id)
    assert len(history) == 1
    assert history[0].is_void
    assert history[0].void_reason == "Cheque bounced"


def test_no_float_drift_over_many_partial_payments(
    ctx: ServiceContext, customer: Customer, session: Session
) -> None:
    """The reason money is stored as integer minor units.

    Ten payments of 0.1-ish values against a 100.00 credit must land EXACTLY on
    zero. With float-backed storage this accumulates error and the customer ends up
    owing 0.00000000001 forever -- a credit that can never be marked paid.
    """
    credits, payments = CreditService(ctx), PaymentService(ctx)
    credit = credits.create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK,
        items=[item("Thing", "1", "100.00")],
    )

    for _ in range(10):
        payments.record(ctx, credit_id=credit.id, amount=Decimal("10.00"))
    session.refresh(credit)

    assert credit.amount_paid == Decimal("100.00")
    assert credit.remaining_amount == Decimal("0.00")
    assert credit.status is CreditStatus.PAID

    # 0.1 + 0.2 == 0.30000000000000004 in float. Not here.
    c2 = credits.create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK,
        items=[item("A", "1", "0.10"), item("B", "1", "0.20")],
    )
    assert c2.grand_total == Decimal("0.30")


def test_customer_aggregates_follow_the_money(
    ctx: ServiceContext, customer: Customer, session: Session
) -> None:
    credits, payments = CreditService(ctx), PaymentService(ctx)

    credits.create(ctx, customer_id=customer.id, due_date=NEXT_WEEK,
                   items=[item("A", "1", "300.00")])
    credit = credits.create(ctx, customer_id=customer.id, due_date=NEXT_WEEK,
                            items=[item("B", "1", "700.00")])
    payments.record(ctx, credit_id=credit.id, amount=Decimal("200.00"))

    session.refresh(customer)
    assert customer.total_credit == Decimal("1000.00")
    assert customer.total_paid == Decimal("200.00")
    assert customer.outstanding_balance == Decimal("800.00")
    assert customer.credit_count == 2


def test_overdue_promotion(ctx: ServiceContext, customer: Customer, session: Session,
                           business: Business) -> None:
    credits = CreditService(ctx)
    credit = credits.create(
        ctx, customer_id=customer.id,
        issued_date=TODAY - timedelta(days=30),
        due_date=TODAY - timedelta(days=1),   # due yesterday
        items=[item("Rice", "1", "500.00")],
    )
    assert credit.status is CreditStatus.OVERDUE  # derived at creation

    # And the nightly job is idempotent about it.
    promoted = credits.promote_overdue(business_id=business.id, today=TODAY)
    session.refresh(credit)
    assert credit.status is CreditStatus.OVERDUE
    assert promoted == 0  # already overdue; nothing to promote


def test_cannot_delete_a_credit_that_has_payments(
    ctx: ServiceContext, customer: Customer
) -> None:
    credits, payments = CreditService(ctx), PaymentService(ctx)
    credit = credits.create(ctx, customer_id=customer.id, due_date=NEXT_WEEK,
                            items=[item("A", "1", "100.00")])
    payments.record(ctx, credit_id=credit.id, amount=Decimal("50.00"))

    with pytest.raises(ConflictError, match="Cancel it instead"):
        credits.soft_delete(ctx, credit.id)


def test_discount_larger_than_line_is_rejected(
    ctx: ServiceContext, customer: Customer
) -> None:
    with pytest.raises(ValidationError, match="larger than"):
        CreditService(ctx).create(
            ctx, customer_id=customer.id, due_date=NEXT_WEEK,
            items=[item("A", "1", "50.00", discount_amount=Decimal("60.00"))],
        )


def test_integrity_check_detects_and_repairs_drift(
    ctx: ServiceContext, customer: Customer, session: Session, business: Business
) -> None:
    """The safety net under the stored-totals denormalisation."""
    credits, payments = CreditService(ctx), PaymentService(ctx)
    credit = credits.create(ctx, customer_id=customer.id, due_date=NEXT_WEEK,
                            items=[item("A", "1", "1000.00")])
    payments.record(ctx, credit_id=credit.id, amount=Decimal("250.00"))
    session.commit()

    # Simulate a rogue write path that bypassed CreditService.
    credit.amount_paid = Decimal("999.00")
    credit.remaining_amount = Decimal("1.00")
    session.add(credit)
    session.commit()

    drift = credits.verify_integrity(business_id=business.id)
    assert len(drift) == 1
    assert drift[0]["stored_paid"] == "999.00"
    assert drift[0]["expected_paid"] == "250.00"

    session.commit()
    session.refresh(credit)
    assert credit.amount_paid == Decimal("250.00")     # repaired
    assert credit.remaining_amount == Decimal("750.00")
