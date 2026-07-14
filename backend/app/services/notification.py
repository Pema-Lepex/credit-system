"""NotificationService -- the in-app notification centre.

ARCHITECTURE NOTE — broadcasts
------------------------------
``Notification.user_id`` is nullable, and NULL means "everyone in this business".
Most events (a payment landed, a credit went overdue) belong to the shop, not to one
staff member, and duplicating a row per user would mean fanning out N inserts on
every event and re-fanning whenever a user is added. So the visibility rule, applied
to every read query in this module, is:

    user_id == me  OR  user_id IS NULL

Getting this wrong in one query is how a business-wide alert becomes invisible, so
it lives in exactly one place: ``_visible_to``.

The honest cost: a broadcast has ONE ``read_at``, so when any user marks it read it
is read for everybody. That is the right trade for a shop with two or three staff.
Per-user read state on a shared notification needs a join table
(``notification_read(notification_id, user_id, read_at)``), which is a schema change,
not a query change -- do it when someone actually complains.

Notifications are IN-APP ONLY. They never send email; that is EmailService's job.
Keeping them separate is what lets "the reminder email failed" be a notification.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, func, or_
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models.base import utcnow
from app.models.communication import Notification
from app.models.enums import NotificationKind, NotificationState
from app.utils.pagination import Page, PageInput, paginate


class NotificationService:
    def __init__(self, session: Session) -> None:
        self.session = session

    # -- visibility ----------------------------------------------------------
    @staticmethod
    def _visible_to(user_id: str | None) -> ColumnElement[bool]:
        """The one true visibility predicate: mine, plus the business's broadcasts."""
        if user_id is None:
            # No user in context (scheduler, admin tooling): broadcasts only.
            return col(Notification.user_id).is_(None)
        return or_(
            col(Notification.user_id) == user_id,
            col(Notification.user_id).is_(None),
        )

    def _get(self, business_id: str, notification_id: str, user_id: str | None) -> Notification:
        notification = self.session.get(Notification, notification_id)
        if (
            notification is None
            or notification.business_id != business_id
            or notification.is_deleted
        ):
            raise NotFoundError("Notification not found")
        # A notification addressed to another user is not yours to read or archive.
        if notification.user_id is not None and user_id is not None:
            if notification.user_id != user_id:
                raise NotFoundError("Notification not found")
        return notification

    # -- create --------------------------------------------------------------
    def create(
        self,
        business_id: str,
        kind: NotificationKind,
        title: str,
        message: str,
        *,
        user_id: str | None = None,
        link: dict[str, Any] | None = None,
        meta: dict[str, Any] | None = None,
    ) -> Notification:
        """Create one notification. ``user_id=None`` broadcasts it to the business.

        Flushes, does not commit -- the caller owns the transaction, so a notification
        never outlives the event that caused it.
        """
        notification = Notification(
            business_id=business_id,
            user_id=user_id,
            kind=kind,
            state=NotificationState.UNREAD,
            title=title[:200],
            message=message[:1000],
            link=link or {},
            meta=meta or {},
        )
        self.session.add(notification)
        self.session.flush()
        return notification

    # -- read ----------------------------------------------------------------
    def list(
        self,
        business_id: str,
        *,
        user_id: str | None = None,
        state: NotificationState | None = None,
        kind: NotificationKind | None = None,
        page: PageInput | None = None,
    ) -> Page[Notification]:
        stmt = select(Notification).where(
            Notification.business_id == business_id,
            col(Notification.deleted_at).is_(None),
            self._visible_to(user_id),
        )
        if state is not None:
            stmt = stmt.where(Notification.state == state)
        if kind is not None:
            stmt = stmt.where(Notification.kind == kind)

        stmt = stmt.order_by(col(Notification.created_at).desc())
        return paginate(self.session, stmt, page or PageInput())

    def unread_count(self, business_id: str, *, user_id: str | None = None) -> int:
        """COUNT(*), not len(fetch-everything): this backs the badge in the header, so
        it is polled constantly and must never materialise the rows it is counting."""
        stmt = (
            select(func.count())
            .select_from(Notification)
            .where(
                Notification.business_id == business_id,
                Notification.state == NotificationState.UNREAD,
                col(Notification.deleted_at).is_(None),
                self._visible_to(user_id),
            )
        )
        return int(self.session.exec(stmt).one())  # type: ignore[call-overload]

    # -- state transitions ---------------------------------------------------
    def mark_read(
        self, business_id: str, notification_id: str, *, user_id: str | None = None
    ) -> Notification:
        notification = self._get(business_id, notification_id, user_id)
        # Archived stays archived: reading an archived item should not resurrect it
        # into the active list.
        if notification.state is NotificationState.UNREAD:
            notification.state = NotificationState.READ
            notification.read_at = utcnow()
            self.session.add(notification)
            self.session.flush()
        return notification

    def mark_all_read(self, business_id: str, *, user_id: str | None = None) -> int:
        """Mark every visible UNREAD notification as read. Returns how many changed.

        Deliberately a loop over ORM objects rather than a bulk UPDATE: the row count
        is small (a notification centre nobody reads is a notification centre with a
        badge, not a million rows), and the ORM path keeps ``updated_at`` correct.
        """
        stmt = select(Notification).where(
            Notification.business_id == business_id,
            Notification.state == NotificationState.UNREAD,
            col(Notification.deleted_at).is_(None),
            self._visible_to(user_id),
        )
        now = utcnow()
        changed = 0
        for notification in self.session.exec(stmt).all():
            notification.state = NotificationState.READ
            notification.read_at = now
            self.session.add(notification)
            changed += 1
        self.session.flush()
        return changed

    def archive(
        self, business_id: str, notification_id: str, *, user_id: str | None = None
    ) -> Notification:
        notification = self._get(business_id, notification_id, user_id)
        notification.state = NotificationState.ARCHIVED
        notification.archived_at = utcnow()
        if notification.read_at is None:
            notification.read_at = notification.archived_at  # archiving implies seen
        self.session.add(notification)
        self.session.flush()
        return notification

    def delete(
        self, business_id: str, notification_id: str, *, user_id: str | None = None
    ) -> None:
        """Soft delete -- consistent with every other table, and it keeps the row
        available to an audit query."""
        notification = self._get(business_id, notification_id, user_id)
        notification.deleted_at = utcnow()
        self.session.add(notification)
        self.session.flush()

    # ----------------------------------------------------------------------
    # Convenience constructors
    #
    # Call sites should never hand-write a title/message: the copy would drift, and
    # the deep-link ``link`` blob has to match what the frontend router expects.
    # These are the vocabulary of the notification centre.
    # ----------------------------------------------------------------------
    def notify_payment_received(
        self,
        business_id: str,
        *,
        customer_name: str,
        amount: Decimal | str,
        credit_id: str,
        credit_number: str | None = None,
        payment_id: str | None = None,
        remaining: Decimal | str | None = None,
        user_id: str | None = None,
    ) -> Notification:
        tail = f" {remaining} still outstanding." if remaining is not None else ""
        return self.create(
            business_id,
            NotificationKind.PAYMENT_RECEIVED,
            title=f"Payment received from {customer_name}",
            message=f"{customer_name} paid {amount}.{tail}",
            user_id=user_id,
            link={"type": "credit", "id": credit_id},
            meta={
                "amount": str(amount),
                "remaining": str(remaining) if remaining is not None else None,
                "credit_number": credit_number,
                "payment_id": payment_id,
            },
        )

    def notify_credit_overdue(
        self,
        business_id: str,
        *,
        customer_name: str,
        amount: Decimal | str,
        credit_id: str,
        credit_number: str | None = None,
        days_overdue: int = 0,
        user_id: str | None = None,
    ) -> Notification:
        when = (
            "is overdue today"
            if days_overdue <= 0
            else f"is {days_overdue} day{'s' if days_overdue != 1 else ''} overdue"
        )
        return self.create(
            business_id,
            NotificationKind.CREDIT_OVERDUE,
            title=f"{customer_name}'s credit {when}",
            message=f"{amount} is outstanding on {credit_number or 'this credit'}. {when.capitalize()}.",
            user_id=user_id,
            link={"type": "credit", "id": credit_id},
            meta={
                "amount": str(amount),
                "days_overdue": days_overdue,
                "credit_number": credit_number,
            },
        )

    def notify_reminder_sent(
        self,
        business_id: str,
        *,
        customer_name: str,
        credit_id: str,
        credit_number: str | None = None,
        channel: str = "EMAIL",
        success: bool = True,
        error: str | None = None,
        user_id: str | None = None,
    ) -> Notification:
        """Covers the FAILED case too -- a reminder that did not go out is exactly the
        thing the owner needs to see (e.g. W3Forms cannot reach customers)."""
        if success:
            title = f"Reminder sent to {customer_name}"
            message = f"A payment reminder for {credit_number or 'their credit'} was delivered."
        else:
            title = f"Reminder to {customer_name} FAILED"
            message = (
                f"The reminder for {credit_number or 'their credit'} could not be sent. "
                f"{error or 'See the email log for details.'}"
            )
        return self.create(
            business_id,
            NotificationKind.REMINDER_SENT if success else NotificationKind.SYSTEM,
            title=title,
            message=message,
            user_id=user_id,
            link={"type": "credit", "id": credit_id},
            meta={
                "channel": channel,
                "success": success,
                "error": error,
                "credit_number": credit_number,
            },
        )

    def notify_data_deletion_warning(
        self,
        business_id: str,
        *,
        record_count: int,
        deletion_date: date | str,
        batch_id: str | None = None,
        user_id: str | None = None,
    ) -> Notification:
        when = deletion_date.isoformat() if isinstance(deletion_date, date) else deletion_date
        return self.create(
            business_id,
            NotificationKind.DATA_DELETION_WARNING,
            title=f"{record_count} archived records will be deleted on {when}",
            message=(
                f"Your retention policy will permanently delete {record_count} archived "
                f"records on {when}. You can download, postpone or restore them before then."
            ),
            user_id=user_id,
            link={"type": "archive", "id": batch_id} if batch_id else {"type": "archive"},
            meta={"record_count": record_count, "deletion_date": when, "batch_id": batch_id},
        )

    def notify_export_ready(
        self,
        business_id: str,
        *,
        export_id: str,
        filename: str,
        download_url: str | None = None,
        expires_in_hours: int | None = None,
        user_id: str | None = None,
    ) -> Notification:
        expiry = f" The link expires in {expires_in_hours} hours." if expires_in_hours else ""
        return self.create(
            business_id,
            NotificationKind.EXPORT_READY,
            title="Your export is ready",
            message=f"{filename} is ready to download.{expiry}",
            user_id=user_id,   # exports are personal: only whoever asked for it cares
            link={"type": "export", "id": export_id},
            meta={"filename": filename, "download_url": download_url, "export_id": export_id},
        )

    def notify_storage_warning(
        self,
        business_id: str,
        *,
        used_mb: float,
        quota_mb: int,
        user_id: str | None = None,
    ) -> Notification:
        percent = int(round((used_mb / quota_mb) * 100)) if quota_mb else 100
        return self.create(
            business_id,
            NotificationKind.STORAGE_WARNING,
            title=f"Storage {percent}% full",
            message=(
                f"You are using {used_mb:.0f} MB of your {quota_mb} MB. Deleting old "
                f"exports and archived photos is the quickest way to free space."
            ),
            user_id=user_id,
            link={"type": "settings", "id": "storage"},
            meta={"used_mb": used_mb, "quota_mb": quota_mb, "percent": percent},
        )
