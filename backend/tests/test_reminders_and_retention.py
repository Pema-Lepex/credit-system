"""The reminder sweep and the retention pipeline -- the two automated systems.

These are the features that run while nobody is watching, which is exactly why they
need tests. A reminder that silently doesn't send, or a purge that deletes data the
owner was never warned about, are both invisible until they are catastrophic.
"""

from __future__ import annotations

import asyncio
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session, select

from app.core.config import EmailProvider, settings
from app.models.business import Business
from app.models.communication import ScheduledReminder
from app.models.customer import Customer
from app.models.enums import (
    ArchiveState,
    AuditAction,
    CreditStatus,
    ReminderAudience,
    ReminderStatus,
    RetentionPolicy,
)
from app.models.retention import AuditLog
from app.services.base import ServiceContext
from app.services.credit import CreditItemInput, CreditService
from app.services.payment import PaymentService
from app.services.reminder import ReminderService
from app.services.retention import RetentionService
from app.services.templates import seed_default_templates

TODAY = date.today()


@pytest.fixture(autouse=True)
def console_email() -> None:
    """Never touch the network in a test."""
    settings.EMAIL_PROVIDER = EmailProvider.console


def _credit(ctx: ServiceContext, customer: Customer, due_in_days: int, amount: str = "1000.00"):
    due = TODAY + timedelta(days=due_in_days)
    # A back-dated due date needs a back-dated issue date -- the service (correctly)
    # refuses a credit that was due before it was issued.
    issued = min(TODAY, due)
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        issued_date=issued,
        due_date=due,
        items=[CreditItemInput(name="Rice", quantity=Decimal("1"), unit_price=Decimal(amount))],
    )


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------
def test_plans_a_reminder_for_each_configured_offset(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    business.reminder_days_before = [7, 3, 1]
    business.reminder_audience = ReminderAudience.BOTH
    session.add(business)
    session.commit()

    _credit(ctx, customer, due_in_days=7)

    planned = ReminderService(ctx).plan_for_business(business, today=TODAY)
    session.commit()

    # 3 offsets x 2 audiences (customer + owner) = 6
    assert planned == 6
    rows = session.exec(select(ScheduledReminder)).all()
    assert len(rows) == 6
    assert {r.days_before_due for r in rows} == {7, 3, 1}
    assert {ReminderAudience(r.audience) for r in rows} == {
        ReminderAudience.CUSTOMER,
        ReminderAudience.OWNER,
    }


def test_planning_is_idempotent(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """The whole design rests on this: running the sweep twice must not double-send."""
    _credit(ctx, customer, due_in_days=7)
    service = ReminderService(ctx)

    first = service.plan_for_business(business, today=TODAY)
    session.commit()
    second = service.plan_for_business(business, today=TODAY)
    session.commit()
    third = service.plan_for_business(business, today=TODAY)
    session.commit()

    assert first > 0
    assert second == 0, "re-planning created duplicate reminders"
    assert third == 0
    assert len(session.exec(select(ScheduledReminder)).all()) == first


def test_sends_only_what_is_due_today(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    seed_default_templates(session, business.id)
    business.reminder_days_before = [7, 1]
    business.reminder_audience = ReminderAudience.CUSTOMER
    session.add(business)
    session.commit()

    _credit(ctx, customer, due_in_days=7)   # the "7 days before" reminder is due TODAY
    service = ReminderService(ctx)
    service.plan_for_business(business, today=TODAY)
    session.commit()

    result = asyncio.run(service.send_due(business, today=TODAY, ctx=ctx))
    session.commit()

    assert result.sent == 1        # only the 7-day one; the 1-day is still in the future
    assert result.failed == 0

    rows = session.exec(select(ScheduledReminder)).all()
    sent = [r for r in rows if ReminderStatus(r.status) is ReminderStatus.SENT]
    scheduled = [r for r in rows if ReminderStatus(r.status) is ReminderStatus.SCHEDULED]
    assert len(sent) == 1
    assert len(scheduled) == 1
    assert sent[0].sent_at is not None


def test_a_paid_credit_is_skipped_not_sent(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """The customer settled up after the reminder was queued. Do not chase them."""
    seed_default_templates(session, business.id)
    business.reminder_audience = ReminderAudience.CUSTOMER
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=7)
    service = ReminderService(ctx)
    service.plan_for_business(business, today=TODAY)
    session.commit()

    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("1000.00"))
    session.commit()
    assert credit.status is CreditStatus.PAID

    result = asyncio.run(service.send_due(business, today=TODAY, ctx=ctx))
    session.commit()

    assert result.sent == 0
    assert result.skipped >= 1


def test_customer_without_an_email_is_never_queued(
    ctx: ServiceContext, business: Business, session: Session
) -> None:
    silent = Customer(business_id=business.id, code="CUST-0002", name="No Email", phone="123")
    session.add(silent)
    session.commit()

    business.reminder_audience = ReminderAudience.CUSTOMER
    session.add(business)
    session.commit()

    _credit(ctx, silent, due_in_days=7)
    planned = ReminderService(ctx).plan_for_business(business, today=TODAY)
    session.commit()

    assert planned == 0, "queued a reminder that could only ever fail"


# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------
def test_open_credits_are_never_archived(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """Archiving a debt someone still owes would be vandalism, not housekeeping."""
    business.retention_policy = RetentionPolicy.DAYS_30
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-90)   # ancient AND unpaid
    session.commit()
    assert credit.status is CreditStatus.OVERDUE

    # Age it well past the retention window.
    from app.models.base import utcnow

    credit.updated_at = utcnow() - timedelta(days=365)
    session.add(credit)
    session.commit()

    batch = RetentionService(ctx).archive_eligible(business)
    assert batch is None, "archived a credit that is still owed"


def test_closed_credits_past_the_window_are_archived_not_deleted(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    from app.models.base import utcnow

    business.retention_policy = RetentionPolicy.DAYS_30
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-60, amount="500.00")
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    session.commit()
    assert credit.status is CreditStatus.PAID

    credit.updated_at = utcnow() - timedelta(days=90)
    session.add(credit)
    session.commit()

    batch = RetentionService(ctx).archive_eligible(business)
    session.commit()

    assert batch is not None
    assert batch.state is ArchiveState.ARCHIVED
    assert batch.credit_count == 1
    assert batch.payment_count == 1

    # The record still EXISTS -- it is hidden, not destroyed.
    session.refresh(credit)
    assert credit.archived_at is not None
    assert credit.archive_batch_id == batch.id
    assert credit.deleted_at is None


def test_purge_refuses_when_the_owner_was_never_warned(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    """If our mail server was down for a week, that is our failure -- not consent."""
    from app.models.base import utcnow

    business.retention_policy = RetentionPolicy.DAYS_30
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-60, amount="500.00")
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    credit.updated_at = utcnow() - timedelta(days=90)
    session.add(credit)
    session.commit()

    service = RetentionService(ctx)
    batch = service.archive_eligible(business)
    session.commit()
    assert batch is not None
    assert batch.warnings_sent == []          # nobody has been told

    # Force the deletion date into the past.
    batch.delete_scheduled_for = utcnow() - timedelta(days=1)
    session.add(batch)
    session.commit()

    purged_batches, purged_records = service.purge_due(business)
    session.commit()

    assert purged_batches == 0, "purged data the owner was never warned about"
    assert purged_records == 0
    session.refresh(credit)
    assert credit.id is not None              # still there


def test_purge_after_warning_deletes_and_audits(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    from app.models.base import utcnow
    from app.models.credit import Credit

    seed_default_templates(session, business.id)
    business.retention_policy = RetentionPolicy.DAYS_30
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-60, amount="500.00")
    credit_id = credit.id
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    credit.updated_at = utcnow() - timedelta(days=90)
    session.add(credit)
    session.commit()

    service = RetentionService(ctx)
    batch = service.archive_eligible(business)
    session.commit()
    assert batch is not None

    # The owner IS warned.
    asyncio.run(service.send_warnings(business))
    session.commit()
    session.refresh(batch)
    assert batch.warnings_sent, "no warning was recorded"

    batch.delete_scheduled_for = utcnow() - timedelta(days=1)
    session.add(batch)
    session.commit()

    purged_batches, purged_records = service.purge_due(business)
    session.commit()

    assert purged_batches == 1
    assert purged_records == 2                       # 1 credit + 1 payment
    assert session.get(Credit, credit_id) is None    # genuinely gone

    session.refresh(batch)
    assert batch.state is ArchiveState.DELETED

    # The purge is on the permanent record (spec: all deletions must be logged).
    purge_logs = session.exec(
        select(AuditLog).where(AuditLog.action == AuditAction.PURGE)
    ).all()
    assert len(purge_logs) == 1
    assert "PERMANENTLY DELETED" in purge_logs[0].summary


def test_owner_can_postpone_and_restore(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    from app.models.base import utcnow

    business.retention_policy = RetentionPolicy.DAYS_30
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-60, amount="500.00")
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    credit.updated_at = utcnow() - timedelta(days=90)
    session.add(credit)
    session.commit()

    service = RetentionService(ctx)
    batch = service.archive_eligible(business)
    session.commit()
    assert batch is not None

    before = batch.delete_scheduled_for
    service.postpone(ctx, batch.id, days=60)
    session.commit()
    session.refresh(batch)

    assert batch.state is ArchiveState.POSTPONED
    assert batch.delete_scheduled_for > before
    assert batch.warnings_sent == []   # the warning ladder resets, so they get told again

    service.restore(ctx, batch.id)
    session.commit()
    session.refresh(batch)
    session.refresh(credit)

    assert batch.state is ArchiveState.RESTORED
    assert credit.archived_at is None   # back in the normal lists
    assert credit.archive_batch_id is None


def test_never_policy_archives_nothing(
    ctx: ServiceContext, business: Business, customer: Customer, session: Session
) -> None:
    from app.models.base import utcnow

    business.retention_policy = RetentionPolicy.NEVER
    session.add(business)

    credit = _credit(ctx, customer, due_in_days=-60, amount="500.00")
    PaymentService(ctx).record(ctx, credit_id=credit.id, amount=Decimal("500.00"))
    credit.updated_at = utcnow() - timedelta(days=3650)
    session.add(credit)
    session.commit()

    assert RetentionService(ctx).archive_eligible(business) is None
