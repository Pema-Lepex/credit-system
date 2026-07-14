"""Email templates, scheduled reminders, delivery log, and notifications."""

from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Column, Index, UniqueConstraint
from sqlmodel import Field

from app.models.base import TZDateTime, TenantEntity
from app.models.enums import (
    EmailTemplateKind,
    NotificationKind,
    NotificationState,
    ReminderAudience,
    ReminderChannel,
    ReminderStatus,
)


class EmailTemplate(TenantEntity, table=True):
    """A per-business, admin-editable email template.

    ARCHITECTURE NOTE (spec: "do NOT hardcode email templates")
    -----------------------------------------------------------
    Templates live in the database, not in .html files, so the business owner can
    edit subject/body/footer/colours from the Admin Panel without a deploy. On
    first login a business is seeded with a default set (see services/templates.py);
    those seeds are the ONLY place default copy exists, and the owner can overwrite
    every word of it.

    Rendering uses a deliberately tiny ``{{variable}}`` substitution engine rather
    than Jinja. Reason: these templates are user-authored content stored in the DB.
    Handing user-authored strings to Jinja gives you server-side template injection
    (``{{ ''.__class__.__mro__ }}`` -> arbitrary object access). A whitelist-based
    substitution can only ever emit values we chose to expose, and every value is
    HTML-escaped on the way in.
    """

    __tablename__ = "email_template"
    __table_args__ = (
        UniqueConstraint("business_id", "kind", name="uq_template_business_kind"),
    )

    kind: EmailTemplateKind = Field(max_length=32, index=True)
    name: str = Field(max_length=120)

    subject: str = Field(max_length=300)
    body_html: str = Field(default="")     # user-authored, may contain {{variables}}
    footer_html: str | None = Field(default=None)
    signature: str | None = Field(default=None, max_length=1000)

    # Branding overrides; fall back to the business defaults when NULL.
    primary_color: str | None = Field(default=None, max_length=9)
    accent_color: str | None = Field(default=None, max_length=9)
    logo_file_id: str | None = Field(
        default=None, foreign_key="file_asset.id", max_length=32, ondelete="SET NULL"
    )
    show_logo: bool = Field(default=True)

    is_active: bool = Field(default=True)
    is_default: bool = Field(default=True)  # flips to False once the owner edits it


class ScheduledReminder(TenantEntity, table=True):
    """One planned reminder for one credit, to one audience, on one channel.

    ARCHITECTURE NOTE: reminders are *materialised rows*, not computed on the fly
    during the nightly sweep. Three reasons:
      1. Idempotency -- a unique constraint makes double-sending impossible even if
         the scheduler runs twice (restart, overlapping worker, clock change).
      2. Visibility -- the owner can see and cancel what is queued.
      3. Retry -- a failed send has somewhere to record its error and attempt count.
    """

    __tablename__ = "scheduled_reminder"
    __table_args__ = (
        # The idempotency guarantee: at most one reminder per (credit, audience,
        # channel, scheduled day).
        UniqueConstraint(
            "credit_id",
            "audience",
            "channel",
            "scheduled_for",
            name="uq_reminder_credit_audience_channel_date",
        ),
        # The sweep's query: "everything still SCHEDULED and due by now".
        Index("ix_reminder_status_scheduled", "status", "scheduled_for"),
    )

    credit_id: str = Field(foreign_key="credit.id", index=True, max_length=32, ondelete="CASCADE")
    customer_id: str = Field(
        foreign_key="customer.id", index=True, max_length=32, ondelete="CASCADE"
    )

    audience: ReminderAudience = Field(max_length=16)
    channel: ReminderChannel = Field(default=ReminderChannel.EMAIL, max_length=16)

    scheduled_for: date = Field(index=True)
    days_before_due: int = Field(default=0)   # 0 == on the due date; negative == overdue chase

    status: ReminderStatus = Field(default=ReminderStatus.SCHEDULED, max_length=16, index=True)
    sent_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    attempts: int = Field(default=0)
    last_error: str | None = Field(default=None, max_length=1000)


class EmailLog(TenantEntity, table=True):
    """Append-only record of every outbound message.

    Kept separate from Notification: this is the *delivery* record (what we sent,
    to whom, did the provider accept it), while Notification is the *in-app*
    surface. Conflating them makes "resend this email" and "mark as read" fight
    over the same row.
    """

    __tablename__ = "email_log"
    __table_args__ = (Index("ix_emaillog_business_created", "business_id", "created_at"),)

    template_kind: EmailTemplateKind | None = Field(default=None, max_length=32, index=True)
    channel: ReminderChannel = Field(default=ReminderChannel.EMAIL, max_length=16)
    provider: str = Field(max_length=32)   # w3forms | smtp | console

    to_address: str = Field(max_length=255, index=True)
    to_name: str | None = Field(default=None, max_length=160)
    subject: str = Field(max_length=300)
    body_preview: str = Field(default="", max_length=500)  # first 500 chars, not the whole body

    success: bool = Field(default=False, index=True)
    error: str | None = Field(default=None, max_length=1000)
    provider_message_id: str | None = Field(default=None, max_length=200)

    credit_id: str | None = Field(default=None, index=True, max_length=32)
    customer_id: str | None = Field(default=None, index=True, max_length=32)
    payment_id: str | None = Field(default=None, index=True, max_length=32)


class Notification(TenantEntity, table=True):
    """In-app notification centre entry."""

    __tablename__ = "notification"
    __table_args__ = (Index("ix_notif_business_state_created", "business_id", "state", "created_at"),)

    kind: NotificationKind = Field(max_length=32, index=True)
    state: NotificationState = Field(default=NotificationState.UNREAD, max_length=12, index=True)

    title: str = Field(max_length=200)
    message: str = Field(max_length=1000)

    # Deep-link target, e.g. {"type": "credit", "id": "abc..."} -> /credits/abc...
    # A JSON blob rather than a nullable FK per entity type: the notification centre
    # never joins on it, it only needs enough to build a URL.
    link: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    meta: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    # NULL = broadcast to the whole business; set = one specific user.
    user_id: str | None = Field(
        default=None, foreign_key="user.id", index=True, max_length=32, ondelete="CASCADE"
    )

    read_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    archived_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
