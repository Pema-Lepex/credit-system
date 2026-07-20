"""The notification centre must fill up even when email is completely broken.

THE BUG THESE TESTS PIN
-----------------------
Notifications were a side effect of successfully sending mail. The only producer on
the reminder path was ReminderService._send_customer, which needs the customer to
have an email address AND the CUSTOMER audience to be enabled -- and with
EMAIL_PROVIDER=w3forms (the default in this deployment) customer mail cannot be
delivered at all. The owner digest produced no notification whatsoever, and
promote_overdue flipped credits to OVERDUE in total silence.

Net effect: an owner with W3Forms configured saw an empty bell forever, while
credits went overdue behind their back.

The rule these tests enforce: EMAIL IS A CHANNEL, THE NOTIFICATION IS THE RECORD.
A notification must never depend on a mail send succeeding.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session, select

from app.core.config import EmailProvider, settings
from app.models.business import Business
from app.models.communication import Notification
from app.models.customer import Customer
from app.models.enums import NotificationKind, ReminderAudience
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.notification import NotificationService
from app.services.payment import PaymentService
from app.services.reminder import ReminderService
from app.services.templates import seed_default_templates

TODAY = date.today()


@pytest.fixture(autouse=True)
def console_email() -> None:
    settings.EMAIL_PROVIDER = EmailProvider.console


def _credit(ctx: ServiceContext, customer: Customer, due_in_days: int, amount: str = "1000.00"):
    due = TODAY + timedelta(days=due_in_days)
    issued = min(TODAY, due)
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        issued_date=issued,
        due_date=due,
        items=[CreditItemInput(name="Rice", quantity=Decimal("1"), unit_price=Decimal(amount))],
    )


def _notifications(session: Session) -> list[Notification]:
    return list(session.exec(select(Notification)).all())


def test_overdue_promotion_raises_a_notification(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """A credit going overdue is the single most important event in the product.

    The credit is issued due in 3 days and then time is moved forward, because that
    is the real scenario: _derive_status already stamps a back-dated credit OVERDUE
    at creation, so only a credit that ELAPSES into overdue goes through
    promote_overdue -- which is the path the nightly sweep uses.
    """
    credit = _credit(ctx, customer, due_in_days=3)
    session.commit()

    later = TODAY + timedelta(days=6)  # three days past due
    promoted = CreditService(ctx).promote_overdue(business_id=business.id, today=later)
    session.commit()

    assert promoted == 1
    overdue = [n for n in _notifications(session) if n.kind == NotificationKind.CREDIT_OVERDUE]
    assert len(overdue) == 1, "a credit went overdue and the owner was never told"
    assert customer.name in overdue[0].title
    assert overdue[0].link == {"type": "credit", "id": credit.id}
    assert overdue[0].meta["days_overdue"] == 3


def test_owner_digest_notifies_even_with_no_owner_email(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """The regression that started this: no business.email meant total silence.

    Previously _send_owner_digest returned early before creating anything.
    """
    seed_default_templates(session, business.id)
    business.email = None  # nowhere to send mail
    business.reminder_audience = ReminderAudience.OWNER
    business.reminder_days_before = [3]
    session.add(business)
    session.commit()

    _credit(ctx, customer, due_in_days=3)
    service = ReminderService(ctx)
    service.plan_for_business(business, today=TODAY)
    session.commit()

    asyncio.run(service.send_due(business, today=TODAY, ctx=ctx))
    session.commit()

    digests = [n for n in _notifications(session) if n.kind == NotificationKind.REMINDER_SENT]
    assert len(digests) == 1, "no mail address must not mean no notification"
    assert "1 credit due" in digests[0].title
    assert digests[0].link == {"url": "/credits"}


def test_owner_digest_notifies_when_the_email_send_fails(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session, monkeypatch
) -> None:
    """W3Forms misconfigured, SMTP down -- the bell still has to light up."""
    seed_default_templates(session, business.id)
    business.reminder_audience = ReminderAudience.OWNER
    business.reminder_days_before = [3]
    session.add(business)
    session.commit()

    _credit(ctx, customer, due_in_days=3)
    service = ReminderService(ctx)
    service.plan_for_business(business, today=TODAY)
    session.commit()

    from app.email.service import EmailService

    async def _explode(*args, **kwargs):
        raise RuntimeError("mail provider is down")

    monkeypatch.setattr(EmailService, "send_templated", _explode)

    with pytest.raises(RuntimeError):
        asyncio.run(service.send_due(business, today=TODAY, ctx=ctx))

    # The notification is created BEFORE the send is attempted, so it survives even
    # this -- a total provider failure -- as an uncommitted-but-present row.
    digests = [n for n in _notifications(session) if n.kind == NotificationKind.REMINDER_SENT]
    assert len(digests) == 1, "a failed send must still leave a notification behind"


def test_payment_raises_a_notification(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    credit = _credit(ctx, customer, due_in_days=7, amount="1000.00")
    session.commit()

    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("400.00"))
    session.commit()

    paid = [n for n in _notifications(session) if n.kind == NotificationKind.PAYMENT_RECEIVED]
    assert len(paid) == 1
    assert customer.name in paid[0].title
    assert "600" in paid[0].message, "the remaining balance belongs in the message"


def test_notifications_are_visible_to_every_user_in_the_business(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """Everything the sweep raises is a broadcast (user_id IS NULL), so a second
    member of staff sees it too -- otherwise the bell is empty for everyone but the
    one account that happened to trigger the event."""
    _credit(ctx, customer, due_in_days=1)
    session.commit()
    CreditService(ctx).promote_overdue(business_id=business.id, today=TODAY + timedelta(days=2))
    session.commit()

    service = NotificationService(session)
    assert service.unread_count(business.id, user_id="some-other-staff-id") >= 1
