"""The Trash: soft-delete -> restore / permanent-delete, for credits and payments.

The money invariant is the whole point of these tests. A payment in the Trash must
NOT count toward what a credit has been paid -- otherwise "delete a payment" would
leave the outstanding balance wrong until it was destroyed for good. Restoring must
put the amount back. Permanent-delete must not move the balance again (the soft-delete
already did).

Access is admin-only: the services require CREDIT_DELETE / PAYMENT_DELETE, which staff
do not hold. That is covered in test_tenancy_and_auth.py for the soft-delete door; here
we prove the balance arithmetic and the round-trips.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.core.errors import ConflictError, NotFoundError
from app.models.customer import Customer
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService

NEXT_WEEK = date.today() + timedelta(days=7)


def _item(name: str, qty: str, price: str) -> CreditItemInput:
    return CreditItemInput(name=name, quantity=Decimal(qty), unit_price=Decimal(price))


def _credit(ctx: ServiceContext, customer: Customer, price: str = "1000.00"):
    return CreditService(ctx).create(
        ctx, customer_id=customer.id, due_date=NEXT_WEEK, items=[_item("Rice", "1", price)]
    )


# --- payment trash: the money invariant ------------------------------------
def test_trashing_a_payment_returns_its_amount_to_the_balance(
    ctx: ServiceContext, customer: Customer
) -> None:
    credit = _credit(ctx, customer, "1000.00")
    pay = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("400.00"))
    ctx.session.refresh(credit)
    assert (credit.amount_paid, credit.remaining_amount) == (Decimal("400.00"), Decimal("600.00"))

    PaymentService(ctx).soft_delete(ctx, pay.id)
    ctx.session.refresh(credit)
    # The 400 is back on the balance, and the payment is out of sight.
    assert (credit.amount_paid, credit.remaining_amount) == (Decimal("0.00"), Decimal("1000.00"))
    assert PaymentService(ctx).list_deleted().total == 1


def test_restoring_a_payment_reapplies_it(ctx: ServiceContext, customer: Customer) -> None:
    credit = _credit(ctx, customer, "1000.00")
    pay = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("400.00"))
    PaymentService(ctx).soft_delete(ctx, pay.id)

    PaymentService(ctx).restore(ctx, pay.id)
    ctx.session.refresh(credit)
    assert (credit.amount_paid, credit.remaining_amount) == (Decimal("400.00"), Decimal("600.00"))
    assert PaymentService(ctx).list_deleted().total == 0


def test_restore_refused_if_it_would_overpay(ctx: ServiceContext, customer: Customer) -> None:
    """Someone recorded a replacement payment while this one sat in the Trash."""
    credit = _credit(ctx, customer, "1000.00")
    first = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("1000.00"))
    PaymentService(ctx).soft_delete(ctx, first.id)
    # Fully paid again by a different payment.
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("1000.00"))

    with pytest.raises(ConflictError, match="overpay"):
        PaymentService(ctx).restore(ctx, first.id)


def test_permanent_delete_payment_does_not_move_the_balance(
    ctx: ServiceContext, customer: Customer
) -> None:
    credit = _credit(ctx, customer, "1000.00")
    pay = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("400.00"))
    PaymentService(ctx).soft_delete(ctx, pay.id)  # balance already back to 0/1000

    PaymentService(ctx).permanent_delete(pay.id)
    ctx.session.refresh(credit)
    assert (credit.amount_paid, credit.remaining_amount) == (Decimal("0.00"), Decimal("1000.00"))
    assert PaymentService(ctx).list_deleted().total == 0


def test_a_trashed_payment_is_gone_from_the_active_list(
    ctx: ServiceContext, customer: Customer
) -> None:
    credit = _credit(ctx, customer, "1000.00")
    pay = PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("400.00"))
    assert PaymentService(ctx).list().total == 1
    PaymentService(ctx).soft_delete(ctx, pay.id)
    assert PaymentService(ctx).list().total == 0


# --- credit trash ----------------------------------------------------------
def test_credit_trash_round_trip(ctx: ServiceContext, customer: Customer) -> None:
    credit = _credit(ctx, customer, "500.00")
    CreditService(ctx).soft_delete(ctx, credit.id)

    assert CreditService(ctx).list().total == 0          # gone from active
    assert CreditService(ctx).list_deleted().total == 1  # present in Trash

    CreditService(ctx).restore(credit.id)
    assert CreditService(ctx).list().total == 1
    assert CreditService(ctx).list_deleted().total == 0


def test_permanent_delete_credit_is_final(ctx: ServiceContext, customer: Customer) -> None:
    credit = _credit(ctx, customer, "500.00")
    cid = credit.id
    CreditService(ctx).soft_delete(ctx, cid)

    number = CreditService(ctx).permanent_delete(cid)
    assert number == credit.number
    assert CreditService(ctx).list_deleted().total == 0
    # The row is truly gone.
    with pytest.raises(NotFoundError):
        CreditService(ctx).get_deleted(cid)


def test_cannot_permanent_delete_a_credit_that_is_not_in_the_trash(
    ctx: ServiceContext, customer: Customer
) -> None:
    """You must soft-delete first; there is no skip-the-Trash path."""
    credit = _credit(ctx, customer, "500.00")
    with pytest.raises(NotFoundError):
        CreditService(ctx).permanent_delete(credit.id)
