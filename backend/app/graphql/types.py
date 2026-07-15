"""GraphQL object types.

ARCHITECTURE NOTE — why these are hand-written and not auto-derived from SQLModel
---------------------------------------------------------------------------------
Strawberry can generate types straight from the ORM models. We deliberately don't,
because the database schema and the public API are different contracts that must be
free to change independently:

  * ``User.hashed_password`` must never be reachable from the API. With auto-derived
    types, a field added to a model is *exposed by default*, and a leak is one
    careless migration away. Here, exposure is opt-in: a field appears in the API
    only because someone typed it in this file.
  * Money is Decimal in Python. JSON has no decimal type, and JavaScript's Number
    silently mangles large/precise values. Every money field crosses the wire as a
    STRING and is parsed with care on the frontend.
  * The API can present computed fields (``daysUntilDue``, ``isOverdue``,
    ``photoUrls``) that have no column behind them.

The cost is that this file must be kept in step with the models by hand. That is a
feature: it forces a decision every time the shape of the API would change.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, NewType

import strawberry

from app.core.security import Role
from app.models import enums

# GraphQL's built-in ``Int`` is a 32-bit signed integer — its max is ~2.15e9, about
# 2 GB. Byte counts blow straight past that: a business's storage allowance, and
# especially ``databaseBytes`` (the size of the WHOLE Postgres database across every
# tenant), are routinely tens of gigabytes. Serializing such a value through ``Int``
# does not truncate — graphql-core raises, and the ENTIRE query fails as the opaque
# "Internal server error". ``BigInt`` is a custom scalar with no 32-bit cap: it emits
# the integer straight into JSON, which JavaScript reads losslessly up to 2**53
# (~9 PB) — far beyond any real byte count here. Use it for every byte field.
BigInt = strawberry.scalar(
    NewType("BigInt", int),
    serialize=lambda value: int(value),
    parse_value=lambda value: int(value),
)

# ---------------------------------------------------------------------------
# Enums -- registered with Strawberry so they appear in the schema (and so the
# frontend gets real union types, not `string`).
# ---------------------------------------------------------------------------
ApprovalStatus = strawberry.enum(enums.ApprovalStatus)
CreditStatus = strawberry.enum(enums.CreditStatus)
CustomerStatus = strawberry.enum(enums.CustomerStatus)
PaymentMethod = strawberry.enum(enums.PaymentMethod)
ItemKind = strawberry.enum(enums.ItemKind)
ReminderChannel = strawberry.enum(enums.ReminderChannel)
ReminderAudience = strawberry.enum(enums.ReminderAudience)
ReminderStatus = strawberry.enum(enums.ReminderStatus)
EmailTemplateKind = strawberry.enum(enums.EmailTemplateKind)
NotificationKind = strawberry.enum(enums.NotificationKind)
NotificationState = strawberry.enum(enums.NotificationState)
FileKind = strawberry.enum(enums.FileKind)
RetentionPolicy = strawberry.enum(enums.RetentionPolicy)
ArchiveState = strawberry.enum(enums.ArchiveState)
ExportFormat = strawberry.enum(enums.ExportFormat)
ExportState = strawberry.enum(enums.ExportState)
ReportPeriod = strawberry.enum(enums.ReportPeriod)
AuditAction = strawberry.enum(enums.AuditAction)


RoleEnum = strawberry.enum(Role)


# ---------------------------------------------------------------------------
# Money
# ---------------------------------------------------------------------------
def money(value: Decimal | int | float | None) -> str:
    """Serialise money for the wire.

    ALWAYS a string, always 2dp. JSON numbers are IEEE-754 doubles: 0.1 + 0.2 is
    famously not 0.3, and a balance of 1234567.89 is not exactly representable. A
    string crosses the wire losslessly, and the frontend formats it for display
    without ever doing arithmetic on a float.
    """
    if value is None:
        return "0.00"
    return f"{Decimal(str(value)):.2f}"


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------
@strawberry.type
class PageInfo:
    total: int
    page: int
    limit: int
    pages: int
    has_next: bool
    has_previous: bool


@strawberry.type
class FileAssetType:
    id: strawberry.ID
    kind: FileKind  # type: ignore[valid-type]
    filename: str
    url: str
    thumbnail_url: str | None
    content_type: str
    size_bytes: BigInt
    original_size_bytes: BigInt
    bytes_saved: BigInt
    width: int | None
    height: int | None
    created_at: datetime


@strawberry.type
class UserType:
    id: strawberry.ID
    email: str
    full_name: str
    phone: str | None
    role: str
    business_id: strawberry.ID | None
    is_active: bool
    avatar_url: str | None
    theme: str
    language: str
    last_login_at: datetime | None
    created_at: datetime
    # Sent to the client so the UI can hide actions the user cannot perform.
    # NOT a security control -- the server re-checks every one of these on every
    # call. This is purely so the interface doesn't offer buttons that will 403.
    permissions: list[str]
    # The approval state of the user's business, surfaced on the user so the frontend
    # can gate the whole app off `me` without a second (blocked) business query. For a
    # SUPER_ADMIN (no tenant) this is APPROVED. See BaseService's approval gate.
    approval_status: str
    approval_reason: str | None


@strawberry.type
class BusinessType:
    id: strawberry.ID
    name: str
    slug: str
    description: str | None
    logo_url: str | None

    email: str | None
    phone: str | None
    whatsapp_number: str | None
    website: str | None
    facebook_url: str | None
    instagram_url: str | None
    tiktok_url: str | None

    address: str | None
    city: str | None
    country: str | None
    google_maps_url: str | None
    latitude: float | None
    longitude: float | None

    currency: str
    currency_symbol: str
    timezone: str
    locale: str
    tax_percentage: str
    working_hours: strawberry.scalars.JSON

    reminders_enabled: bool
    reminder_days_before: list[int]
    reminder_audience: ReminderAudience  # type: ignore[valid-type]
    reminder_send_hour: int
    notify_owner_on_overdue: bool
    notify_owner_on_payment: bool

    email_from_name: str | None
    email_reply_to: str | None
    email_signature: str | None
    brand_color: str

    # The W3Forms key is WRITE-ONLY. There is deliberately no field here that returns
    # it, because a credential that is never sent to a client cannot be stolen from
    # one -- not by an XSS, not by a logged GraphQL response, not by a screenshot of
    # the settings page. The UI needs only two things to render its state, and these
    # are they: whether a key exists, and enough of it to recognise which one.
    has_w3forms_access_key: bool
    w3forms_access_key_hint: str | None  # e.g. "••••••••a1b2"

    retention_policy: RetentionPolicy  # type: ignore[valid-type]
    retention_notifications_enabled: bool
    storage_quota_mb: int

    is_active: bool
    created_at: datetime


@strawberry.type
class UserPage:
    items: list[UserType]
    page_info: PageInfo


@strawberry.type
class BusinessPage:
    items: list[BusinessType]
    page_info: PageInfo


# ---------------------------------------------------------------------------
# Super Admin panel
# ---------------------------------------------------------------------------
@strawberry.type
class AdminBusinessType:
    """A store owner as the SUPER_ADMIN sees it: the business plus its owner.

    Deliberately a separate, narrower type from BusinessType. The admin panel is a
    different contract -- it never needs the tenant's reminder/branding/retention
    settings, and it DOES need the owner's identity (name/email/phone/last login),
    which BusinessType has no business exposing to a tenant looking at their own row.
    The heavier counts are populated only on the detail view (null in the list).
    """

    id: strawberry.ID
    name: str
    slug: str
    description: str | None
    email: str | None
    phone: str | None
    address: str | None
    city: str | None
    country: str | None

    approval_status: ApprovalStatus  # type: ignore[valid-type]
    approval_reason: str | None
    approved_at: datetime | None
    is_active: bool
    created_at: datetime

    # The registrant / owner (earliest ADMIN of the business), if any.
    owner_name: str | None
    owner_email: str | None
    owner_phone: str | None
    owner_last_login_at: datetime | None

    # Detail-only aggregates; null in list responses to keep the listing cheap.
    user_count: int | None
    customer_count: int | None
    credit_count: int | None


@strawberry.type
class AdminBusinessPage:
    items: list[AdminBusinessType]
    page_info: PageInfo


@strawberry.type
class AdminStats:
    """Dashboard cards for the super-admin: store owners by approval state."""

    total_store_owners: int
    pending: int
    approved: int
    rejected: int
    suspended: int


@strawberry.type
class PlatformSettingsType:
    """The super-admin's own settings. The W3Forms key is write-only: only whether
    it is set and a masked tail are ever returned (same rule as the business key)."""

    has_w3forms_access_key: bool
    w3forms_access_key_hint: str | None


@strawberry.type
class CustomerType:
    id: strawberry.ID
    code: str
    name: str
    phone: str | None
    email: str | None
    address: str | None
    city: str | None
    latitude: float | None
    longitude: float | None
    photo_url: str | None
    photo_thumbnail_url: str | None
    notes: str | None
    status: CustomerStatus  # type: ignore[valid-type]

    emergency_contact_name: str | None
    emergency_contact_phone: str | None
    emergency_contact_relation: str | None

    credit_score: int
    credit_limit: str | None

    total_credit: str
    total_paid: str
    outstanding_balance: str
    credit_count: int
    overdue_count: int
    last_credit_at: datetime | None
    last_payment_at: datetime | None
    created_at: datetime


@strawberry.type
class CustomerPage:
    items: list[CustomerType]
    page_info: PageInfo


@strawberry.type
class CustomerScore:
    """The score AND the reasons for it.

    A shopkeeper looking at "34" has to be able to see why, or the number is just an
    accusation. CustomerService.score_breakdown returns the same pair.
    """

    customer_id: strawberry.ID
    score: int
    reasons: list[str]


@strawberry.type
class CategoryType:
    id: strawberry.ID
    name: str
    description: str | None
    color: str | None
    created_at: datetime


@strawberry.type
class ProductType:
    id: strawberry.ID
    name: str
    sku: str | None
    barcode: str | None
    description: str | None
    category_id: strawberry.ID | None
    category: CategoryType | None
    price: str
    cost_price: str | None
    tax_percentage: str | None
    stock_quantity: str
    low_stock_threshold: str | None
    unit: str
    image_urls: list[str]
    is_active: bool
    is_low_stock: bool
    created_at: datetime


@strawberry.type
class ProductPage:
    items: list[ProductType]
    page_info: PageInfo


@strawberry.type
class ServiceType:
    id: strawberry.ID
    name: str
    code: str | None
    description: str | None
    category_id: strawberry.ID | None
    category: CategoryType | None
    price: str
    tax_percentage: str | None
    duration_minutes: int | None
    is_active: bool
    created_at: datetime


@strawberry.type
class ServicePage:
    items: list[ServiceType]
    page_info: PageInfo


@strawberry.type
class CreditItemType:
    id: strawberry.ID
    kind: ItemKind  # type: ignore[valid-type]
    product_id: strawberry.ID | None
    service_id: strawberry.ID | None
    name: str
    description: str | None
    unit: str
    quantity: str
    unit_price: str
    discount_amount: str
    tax_percentage: str
    tax_amount: str
    line_subtotal: str
    line_total: str
    position: int


@strawberry.type
class PaymentType:
    id: strawberry.ID
    number: str
    credit_id: strawberry.ID
    customer_id: strawberry.ID
    customer_name: str | None
    credit_number: str | None
    amount: str
    balance_after: str
    method: PaymentMethod  # type: ignore[valid-type]
    reference: str | None
    notes: str | None
    paid_at: datetime
    receipt_url: str | None
    is_void: bool
    voided_at: datetime | None
    void_reason: str | None
    created_at: datetime


@strawberry.type
class PaymentPage:
    items: list[PaymentType]
    page_info: PageInfo


@strawberry.type
class CreditType:
    id: strawberry.ID
    number: str
    customer_id: strawberry.ID
    customer: CustomerType | None

    subtotal: str
    discount_amount: str
    tax_amount: str
    grand_total: str
    amount_paid: str
    remaining_amount: str
    discount_percentage: str | None
    tax_percentage: str | None
    currency: str

    issued_date: date
    due_date: date
    reminder_date: date | None
    paid_at: datetime | None

    status: CreditStatus  # type: ignore[valid-type]
    notes: str | None

    photo_urls: list[str]
    invoice_url: str | None

    items: list[CreditItemType]
    payments: list[PaymentType]

    # Computed for the client so the UI never has to do date maths (and never gets
    # it wrong across a timezone boundary).
    days_until_due: int
    is_overdue: bool

    created_at: datetime
    updated_at: datetime


@strawberry.type
class CreditPage:
    items: list[CreditType]
    page_info: PageInfo


@strawberry.type
class EmailTemplateType:
    id: strawberry.ID
    kind: EmailTemplateKind  # type: ignore[valid-type]
    name: str
    subject: str
    body_html: str
    footer_html: str | None
    signature: str | None
    primary_color: str | None
    accent_color: str | None
    show_logo: bool
    is_active: bool
    is_default: bool
    updated_at: datetime


@strawberry.type
class TemplateVariableType:
    name: str
    description: str
    example: str


@strawberry.type
class NotificationType:
    id: strawberry.ID
    kind: NotificationKind  # type: ignore[valid-type]
    state: NotificationState  # type: ignore[valid-type]
    title: str
    message: str
    link: strawberry.scalars.JSON
    read_at: datetime | None
    created_at: datetime


@strawberry.type
class NotificationPage:
    items: list[NotificationType]
    page_info: PageInfo
    unread_count: int


@strawberry.type
class ScheduledReminderType:
    id: strawberry.ID
    credit_id: strawberry.ID
    customer_id: strawberry.ID
    audience: ReminderAudience  # type: ignore[valid-type]
    channel: ReminderChannel  # type: ignore[valid-type]
    scheduled_for: date
    days_before_due: int
    status: ReminderStatus  # type: ignore[valid-type]
    sent_at: datetime | None
    attempts: int
    last_error: str | None


@strawberry.type
class ReminderPage:
    items: list[ScheduledReminderType]
    page_info: PageInfo


# ---------------------------------------------------------------------------
# Auth payloads
# ---------------------------------------------------------------------------
@strawberry.type
class AuthPayload:
    access_token: str
    refresh_token: str
    user: UserType


@strawberry.type
class MessagePayload:
    """A deliberately uninformative success response.

    Used for password reset. It says the same thing whether or not the address is
    registered -- otherwise the endpoint is a free account-enumeration oracle.
    """

    success: bool
    message: str


# ---------------------------------------------------------------------------
# Dashboard / analytics
# ---------------------------------------------------------------------------
@strawberry.type
class StatCard:
    value: str
    count: int
    delta_percent: float | None  # vs the previous comparable period; None = no baseline


@strawberry.type
class DashboardSummary:
    total_customers: int
    active_customers: int
    total_credits: int
    total_credit_value: str
    overdue_count: int
    overdue_amount: str
    due_today_count: int
    due_today_amount: str
    total_revenue: str
    pending_revenue: str
    collections_this_month: str
    collections_last_month: str
    collections_delta_percent: float | None
    currency: str
    currency_symbol: str


@strawberry.type
class MonthlyPoint:
    month: str          # "2026-07"
    label: str          # "Jul"
    credit_issued: str
    collected: str
    overdue_amount: str


@strawberry.type
class TopCustomer:
    customer_id: strawberry.ID
    name: str
    outstanding: str
    total_credit: str
    credit_count: int
    credit_score: int


@strawberry.type
class MethodBreakdown:
    method: PaymentMethod  # type: ignore[valid-type]
    total: str
    count: int


@strawberry.type
class ActivityItem:
    kind: str            # "credit" | "payment"
    id: strawberry.ID
    label: str
    amount: str
    customer_name: str
    at: datetime


@strawberry.type
class Dashboard:
    summary: DashboardSummary
    monthly: list[MonthlyPoint]
    overdue_trend: list[MonthlyPoint]
    top_customers: list[TopCustomer]
    latest_activity: list[ActivityItem]
    upcoming_due: list[CreditType]
    collections_by_method: list[MethodBreakdown]


# ---------------------------------------------------------------------------
# Search (spec: global search across customer / phone / invoice / credit number)
# ---------------------------------------------------------------------------
@strawberry.type
class SearchHit:
    kind: str            # "customer" | "credit" | "payment" | "product"
    id: strawberry.ID
    title: str
    subtitle: str
    amount: str | None
    status: str | None


@strawberry.type
class SearchResults:
    hits: list[SearchHit]
    total: int


# ---------------------------------------------------------------------------
# Storage & retention
# ---------------------------------------------------------------------------
@strawberry.type
class StorageBreakdown:
    label: str
    bytes: BigInt  # 64-bit: a single kind's total can exceed 2 GB
    count: int


@strawberry.type
class StorageUsage:
    database_bytes: BigInt  # 64-bit: whole-database size, tens of GB at scale
    uploads_bytes: BigInt
    total_bytes: BigInt
    quota_bytes: BigInt  # the 5 GB default alone overflows a 32-bit Int
    percent_used: float
    over_quota: bool
    bytes_saved_by_compression: BigInt

    breakdown: list[StorageBreakdown]

    customer_count: int
    credit_count: int
    payment_count: int
    product_count: int
    service_count: int
    image_count: int
    export_count: int


@strawberry.type
class MaintenanceResult:
    operation: str
    success: bool
    message: str
    bytes_freed: BigInt  # 64-bit: a cleanup can free more than 2 GB
    rows_affected: int


@strawberry.type
class ArchiveBatchType:
    id: strawberry.ID
    state: ArchiveState  # type: ignore[valid-type]
    credit_count: int
    payment_count: int
    record_count: int
    storage_bytes: BigInt  # 64-bit: an archived batch can exceed 2 GB
    retention_policy: str
    delete_scheduled_for: datetime
    days_until_deletion: int
    warnings_sent: list[int]
    postponed_count: int
    export_id: strawberry.ID | None
    can_restore: bool
    created_at: datetime


@strawberry.type
class ArchiveBatchPage:
    items: list[ArchiveBatchType]
    page_info: PageInfo


@strawberry.type
class RetentionPreview:
    credits: int
    payments: int
    records: int
    policy: RetentionPolicy  # type: ignore[valid-type]


@strawberry.type
class ExportJobType:
    id: strawberry.ID
    format: ExportFormat  # type: ignore[valid-type]
    state: ExportState  # type: ignore[valid-type]
    datasets: list[str]
    row_count: int
    size_bytes: BigInt
    download_url: str | None
    expires_at: datetime | None
    error: str | None
    created_at: datetime


@strawberry.type
class ExportJobPage:
    items: list[ExportJobType]
    page_info: PageInfo


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
@strawberry.type
class ReportRow:
    label: str
    credits_issued: str
    credits_count: int
    collected: str
    payments_count: int


@strawberry.type
class ReportSummary:
    period: ReportPeriod  # type: ignore[valid-type]
    start_date: date
    end_date: date
    total_issued: str
    total_issued_count: int
    total_collected: str
    total_collected_count: int
    outstanding: str
    overdue_amount: str
    overdue_count: int
    rows: list[ReportRow]
    top_customers: list[TopCustomer]
    by_method: list[MethodBreakdown]


@strawberry.type
class AuditLogType:
    id: strawberry.ID
    action: AuditAction  # type: ignore[valid-type]
    entity_type: str
    entity_id: strawberry.ID | None
    summary: str
    changes: strawberry.scalars.JSON
    actor_label: str
    created_at: datetime


@strawberry.type
class AuditLogPage:
    items: list[AuditLogType]
    page_info: PageInfo


def page_info(page: Any) -> PageInfo:
    return PageInfo(
        total=page.total,
        page=page.page,
        limit=page.limit,
        pages=page.pages,
        has_next=page.has_next,
        has_previous=page.has_previous,
    )
