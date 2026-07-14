"""ReminderService -- the feature the whole product exists for.

THE DESIGN, AND WHY
-------------------
A reminder is a *materialised row* (ScheduledReminder), not something computed on
the fly at send time. The nightly sweep does two separate things:

    PLAN  -- for every open credit, work out which reminders SHOULD exist, and
             insert the missing ones. Idempotent: a UNIQUE constraint on
             (credit, audience, channel, scheduled_for) makes a double-run a no-op.
    SEND  -- take everything still SCHEDULED whose date has arrived, and send it.

Splitting them is what makes the system safe to run repeatedly. A server restart, a
clock change, an overlapping worker, a manual re-trigger from the admin panel --
none of them can double-send, because the sending step consumes rows and the
planning step cannot create a duplicate.

It also makes reminders *visible*: the owner can see what is queued for tomorrow
and cancel it, which you cannot do with a system that decides what to send at the
moment it sends it.

WHO GETS REMINDED
-----------------
The spec requires reminding BOTH the owner and the customer before the due date.
Those are different emails to different people with different framing, so each is
its own row with its own audience. The owner's is a digest-style "these 4 credits
are due"; the customer's is a single polite notice about their own balance.

THE W3FORMS CONSTRAINT (important, and honest)
----------------------------------------------
W3Forms can only deliver to the inbox registered against the access key, so with
EMAIL_PROVIDER=w3forms the OWNER reminders work and the CUSTOMER reminders cannot
be delivered. Rather than silently dropping them, we mark them FAILED with an
explicit error telling the owner to configure SMTP. Set EMAIL_PROVIDER=smtp and
customer reminders start working with no other change.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlmodel import col, select

from app.core.errors import NotFoundError
from app.core.security import Permission
from app.email.service import EmailService
from app.models.base import utcnow
from app.models.business import Business
from app.models.communication import ScheduledReminder
from app.models.credit import Credit
from app.models.customer import Customer
from app.models.enums import (
    AuditAction,
    CreditStatus,
    EmailTemplateKind,
    ReminderAudience,
    ReminderChannel,
    ReminderStatus,
)
from app.services.base import BaseService, ServiceContext
from app.services.notification import NotificationService
from app.utils.dates import today_in
from app.utils.pagination import Page, PageInput, paginate


@dataclass(slots=True)
class SweepResult:
    planned: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def merge(self, other: SweepResult) -> None:
        self.planned += other.planned
        self.sent += other.sent
        self.failed += other.failed
        self.skipped += other.skipped
        self.errors.extend(other.errors)


class ReminderService(BaseService):
    # ------------------------------------------------------------------ plan
    def plan_for_business(self, business: Business, *, today: date | None = None) -> int:
        """Create any missing ScheduledReminder rows. Returns how many were added.

        Safe to run as often as you like -- see the module docstring.
        """
        if not business.reminders_enabled:
            return 0

        today = today or today_in(business.timezone)
        offsets = self._offsets_for(business)

        open_credits = self.session.exec(
            select(Credit).where(
                Credit.business_id == business.id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                col(Credit.status).in_(list(CreditStatus.open_statuses())),
                Credit.remaining_amount > Decimal("0"),
                # Nothing to remind about more than the longest lead time away, and
                # we do not chase credits that fell due long ago -- that is a
                # collections problem, not a reminder problem.
                Credit.due_date >= today - timedelta(days=30),
                Credit.due_date <= today + timedelta(days=max(offsets, default=0) + 1),
            )
        ).all()

        audiences = self._audiences_for(business)
        planned = 0

        for credit in open_credits:
            # An explicit reminder_date on the credit overrides the business default:
            # "remind me on the 5th" beats "7 days before".
            days_list = (
                [(credit.due_date - credit.reminder_date).days]
                if credit.reminder_date
                else list(offsets)
            )

            for days_before in days_list:
                scheduled_for = credit.due_date - timedelta(days=days_before)
                # Don't plan reminders for dates that have already passed -- sending
                # a "due in 7 days" notice about a credit that was due yesterday is
                # worse than sending nothing.
                if scheduled_for < today:
                    continue

                for audience in audiences:
                    if self._exists(credit.id, audience, scheduled_for):
                        continue
                    # A customer with no email address cannot be emailed. Skip
                    # silently rather than queueing a row that can only ever fail.
                    if audience is ReminderAudience.CUSTOMER and not self._customer_email(credit):
                        continue

                    self.session.add(
                        ScheduledReminder(
                            business_id=business.id,
                            credit_id=credit.id,
                            customer_id=credit.customer_id,
                            audience=audience,
                            channel=ReminderChannel.EMAIL,
                            scheduled_for=scheduled_for,
                            days_before_due=days_before,
                            status=ReminderStatus.SCHEDULED,
                        )
                    )
                    planned += 1

        self.session.flush()
        return planned

    def _offsets_for(self, business: Business) -> list[int]:
        raw = business.reminder_days_before or [7, 3, 1]
        # Defensive: this is a JSON column an admin can edit. Bad data here would
        # otherwise blow up the nightly job for every business.
        return sorted({int(d) for d in raw if isinstance(d, int | float) and 0 <= int(d) <= 365})

    @staticmethod
    def _audiences_for(business: Business) -> list[ReminderAudience]:
        pref = ReminderAudience(business.reminder_audience)
        if pref is ReminderAudience.BOTH:
            return [ReminderAudience.CUSTOMER, ReminderAudience.OWNER]
        return [pref]

    def _exists(self, credit_id: str, audience: ReminderAudience, on: date) -> bool:
        return (
            self.session.exec(
                select(ScheduledReminder.id).where(
                    ScheduledReminder.credit_id == credit_id,
                    ScheduledReminder.audience == audience,
                    ScheduledReminder.channel == ReminderChannel.EMAIL,
                    ScheduledReminder.scheduled_for == on,
                )
            ).first()
            is not None
        )

    def _customer_email(self, credit: Credit) -> str | None:
        customer = self.session.get(Customer, credit.customer_id)
        return customer.email if customer else None

    # ------------------------------------------------------------------ send
    async def send_due(
        self, business: Business, *, today: date | None = None, ctx: ServiceContext | None = None
    ) -> SweepResult:
        """Send every reminder whose day has arrived."""
        today = today or today_in(business.timezone)
        result = SweepResult()

        due = self.session.exec(
            select(ScheduledReminder).where(
                ScheduledReminder.business_id == business.id,
                ScheduledReminder.status == ReminderStatus.SCHEDULED,
                ScheduledReminder.scheduled_for <= today,
            )
        ).all()

        # Owner reminders are batched into ONE digest email per day. A shopkeeper
        # with 40 credits due tomorrow needs one email listing them, not 40 emails.
        owner_batch: list[ScheduledReminder] = []
        customer_items: list[ScheduledReminder] = []

        for reminder in due:
            credit = self.session.get(Credit, reminder.credit_id)
            if credit is None or not self._still_needs_reminding(credit):
                # Paid, cancelled or deleted since it was planned. Not a failure.
                reminder.status = ReminderStatus.SKIPPED
                self.session.add(reminder)
                result.skipped += 1
                continue

            if ReminderAudience(reminder.audience) is ReminderAudience.OWNER:
                owner_batch.append(reminder)
            else:
                customer_items.append(reminder)

        for reminder in customer_items:
            await self._send_customer(business, reminder, result)

        if owner_batch:
            await self._send_owner_digest(business, owner_batch, result)

        self.session.flush()
        return result

    @staticmethod
    def _still_needs_reminding(credit: Credit) -> bool:
        return (
            credit.deleted_at is None
            and credit.archived_at is None
            and CreditStatus(credit.status) in CreditStatus.open_statuses()
            and credit.remaining_amount > Decimal("0")
        )

    async def _send_customer(
        self, business: Business, reminder: ScheduledReminder, result: SweepResult
    ) -> None:
        credit = self.session.get(Credit, reminder.credit_id)
        customer = self.session.get(Customer, reminder.customer_id)
        if credit is None or customer is None or not customer.email:
            reminder.status = ReminderStatus.SKIPPED
            self.session.add(reminder)
            result.skipped += 1
            return

        days = (credit.due_date - reminder.scheduled_for).days
        kind = (
            EmailTemplateKind.OVERDUE_NOTICE
            if CreditStatus(credit.status) is CreditStatus.OVERDUE
            else EmailTemplateKind.REMINDER
        )

        outcome = await EmailService(self.session).send_templated(
            self.session,
            business,
            kind,
            to_address=customer.email,
            to_name=customer.name,
            context=self._context_for(business, credit, customer, days),
            credit_id=credit.id,
            customer_id=customer.id,
        )
        self._record(reminder, outcome.success, outcome.error, result)

        # Surface the outcome in the notification centre. A FAILED reminder matters
        # more than a successful one -- with EMAIL_PROVIDER=w3forms every customer
        # reminder fails, and the owner has to be able to SEE that rather than
        # assuming their customers were contacted.
        NotificationService(self.session).notify_reminder_sent(
            business.id,
            customer_name=customer.name,
            credit_id=credit.id,
            credit_number=credit.number,
            success=outcome.success,
            error=outcome.error,
        )

    async def _send_owner_digest(
        self, business: Business, reminders: list[ScheduledReminder], result: SweepResult
    ) -> None:
        owner_email = business.email
        if not owner_email:
            for reminder in reminders:
                reminder.status = ReminderStatus.SKIPPED
                self.session.add(reminder)
                result.skipped += 1
            return

        lines: list[str] = []
        total = Decimal("0")
        by_credit: dict[str, ScheduledReminder] = {}
        for reminder in reminders:
            credit = self.session.get(Credit, reminder.credit_id)
            customer = self.session.get(Customer, reminder.customer_id)
            if credit is None or customer is None:
                continue
            by_credit[credit.id] = reminder
            total += credit.remaining_amount
            # Plain text, not HTML. The renderer escapes every substituted value
            # (templates are user-authored, so unescaped injection would be an XSS
            # hole), and the ADMIN_NOTIFICATION template renders this inside a <pre>
            # where the newlines survive escaping.
            lines.append(
                f"{credit.due_date.strftime('%d %b')}  "
                f"{credit.number:<14}  "
                f"{customer.name:<22.22}  "
                f"{business.currency_symbol}{credit.remaining_amount:>10}  "
                f"{customer.phone or '-'}"
            )

        # owner_recipient=True: we KNOW this is the owner's inbox, so a relay-only
        # provider (W3Forms) can legitimately deliver it. Don't make it guess.
        outcome = await EmailService(self.session).send_templated(
            self.session,
            business,
            EmailTemplateKind.ADMIN_NOTIFICATION,
            to_address=owner_email,
            to_name=business.name,
            owner_recipient=True,
            context={
                "business_name": business.name,
                "record_count": str(len(lines)),
                "amount": f"{business.currency_symbol}{total}",
                "remaining": f"{business.currency_symbol}{total}",
                "credit_summary": "\n".join(lines),
                "currency": business.currency,
            },
        )
        for reminder in by_credit.values():
            self._record(reminder, outcome.success, outcome.error, result)

    def _record(
        self, reminder: ScheduledReminder, success: bool, error: str | None, result: SweepResult
    ) -> None:
        reminder.attempts += 1
        if success:
            reminder.status = ReminderStatus.SENT
            reminder.sent_at = utcnow()
            result.sent += 1
        else:
            # Stay SCHEDULED for the first two attempts so a transient SMTP blip
            # retries tomorrow instead of silently dropping the reminder forever.
            reminder.status = (
                ReminderStatus.FAILED if reminder.attempts >= 3 else ReminderStatus.SCHEDULED
            )
            reminder.last_error = (error or "Unknown error")[:1000]
            result.failed += 1
            if error:
                result.errors.append(error)
        self.session.add(reminder)

    def _context_for(
        self, business: Business, credit: Credit, customer: Customer, days: int
    ) -> dict[str, str]:
        symbol = business.currency_symbol
        return {
            "customer_name": customer.name,
            "customer_phone": customer.phone or "",
            "customer_email": customer.email or "",
            "credit_number": credit.number,
            "invoice_number": credit.number,
            "amount": f"{symbol}{credit.remaining_amount}",
            "remaining": f"{symbol}{credit.remaining_amount}",
            "grand_total": f"{symbol}{credit.grand_total}",
            "amount_paid": f"{symbol}{credit.amount_paid}",
            "due_date": credit.due_date.strftime("%d %B %Y"),
            "days_until_due": str(max(0, days)),
            "business_name": business.name,
            "business_phone": business.phone or "",
            "business_email": business.email or "",
            "business_address": business.address or "",
            "currency": business.currency,
            "payment_link": "",  # populated once online payment is wired up
        }

    # -------------------------------------------------------------- admin API
    def send_now(self, ctx: ServiceContext, credit_id: str) -> ScheduledReminder:
        """Queue an immediate reminder for one credit (the 'Send reminder' button)."""
        self.require(Permission.REMINDER_SEND)
        credit = self.session.get(Credit, credit_id)
        if credit is None or credit.deleted_at is not None:
            raise NotFoundError("Credit record not found")
        self.assert_in_scope(credit.business_id)

        business = self.get_business()
        today = today_in(business.timezone)

        reminder = ScheduledReminder(
            business_id=business.id,
            credit_id=credit.id,
            customer_id=credit.customer_id,
            audience=ReminderAudience.CUSTOMER,
            channel=ReminderChannel.EMAIL,
            scheduled_for=today,
            days_before_due=(credit.due_date - today).days,
            status=ReminderStatus.SCHEDULED,
        )
        self.session.add(reminder)
        self.session.flush()
        self.audit(
            AuditAction.REMINDER,
            "credit",
            credit.id,
            f"Manual reminder queued for credit {credit.number}",
        )
        return reminder

    def cancel(self, ctx: ServiceContext, reminder_id: str) -> ScheduledReminder:
        self.require(Permission.REMINDER_SEND)
        reminder = self.session.get(ScheduledReminder, reminder_id)
        if reminder is None:
            raise NotFoundError("Reminder not found")
        self.assert_in_scope(reminder.business_id)
        reminder.status = ReminderStatus.CANCELLED
        self.session.add(reminder)
        return reminder

    def list(
        self,
        page: PageInput | None = None,
        *,
        status: list[ReminderStatus] | None = None,
        credit_id: str | None = None,
    ) -> Page[ScheduledReminder]:
        self.require(Permission.CREDIT_READ)
        stmt = select(ScheduledReminder).where(ScheduledReminder.business_id == self.scope_id)
        if status:
            stmt = stmt.where(col(ScheduledReminder.status).in_(status))
        if credit_id:
            stmt = stmt.where(ScheduledReminder.credit_id == credit_id)
        stmt = stmt.order_by(col(ScheduledReminder.scheduled_for).desc())
        return paginate(self.session, stmt, page or PageInput())

    def upcoming_count(self) -> dict[str, int]:
        rows = self.session.exec(
            select(ScheduledReminder.status).where(
                ScheduledReminder.business_id == self.scope_id
            )
        ).all()
        counts: dict[str, int] = defaultdict(int)
        for status in rows:
            counts[str(status)] += 1
        return dict(counts)
