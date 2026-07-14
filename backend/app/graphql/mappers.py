"""ORM model -> Strawberry type. Pure functions, no I/O beyond file-URL lookups.

WHY A HAND-WRITTEN MAPPING LAYER
--------------------------------
types.py explains why the API types are not auto-derived from the models. This is
the other half of that decision: the only way a column reaches a client is if a
function in this file puts it there. ``User.hashed_password``, ``RefreshToken``,
``PasswordResetToken.token_hash`` and every other secret are unreachable from the
API because nothing here reads them.

MONEY
-----
Every money column goes through ``money()`` (Decimal -> "1234.56"). A float never
leaves this module. Percentages and quantities are NOT money -- they are plain
Decimals and are stringified with ``_plain()``, which does not force 2dp onto a
quantity of 1.5 kg.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import strawberry
from sqlmodel import Session

from app.core.security import Role, permissions_for
from app.email.renderer import TemplateVariable
from app.models.business import Business
from app.models.catalog import Category, Product, Service
from app.models.communication import EmailTemplate, Notification, ScheduledReminder
from app.models.credit import Credit, CreditItem, Payment
from app.models.customer import Customer
from app.models.enums import ArchiveState, ExportState
from app.models.file import FileAsset
from app.models.retention import ArchiveBatch, AuditLog, ExportJob
from app.models.user import User
from app.graphql.types import (
    ArchiveBatchType,
    AuditLogType,
    BusinessType,
    CategoryType,
    CreditItemType,
    CreditType,
    CustomerType,
    EmailTemplateType,
    ExportJobType,
    FileAssetType,
    NotificationType,
    PaymentType,
    ProductType,
    ScheduledReminderType,
    ServiceType,
    TemplateVariableType,
    UserType,
    money,
)
from app.storage.service import StorageService
from app.utils.dates import ensure_utc

ZERO = Decimal("0")


# ---------------------------------------------------------------------------
# Scalar helpers
# ---------------------------------------------------------------------------
def _plain(value: Decimal | None) -> str | None:
    """A non-money Decimal (a tax %, a quantity of 1.5 kg) as a string.

    Deliberately NOT ``money()``: forcing 2dp onto ``stock_quantity`` would print
    "1.50" for a decimal that the model stores to 3 places, and would imply a
    currency where there is none.
    """
    if value is None:
        return None
    return format(Decimal(value), "f")


def _money_or_none(value: Decimal | None) -> str | None:
    """Money that is genuinely optional (credit_limit, cost_price).

    ``money(None)`` returns "0.00" -- correct for a total that has no rows yet, WRONG
    for "this customer has no credit limit". None must survive as None.
    """
    return None if value is None else money(value)


def _url(session: Session, file_id: str | None, *, thumb: bool = False) -> str | None:
    return StorageService(session).url_for_id(file_id, thumb=thumb)


def _urls(session: Session, file_ids: list[str] | None) -> list[str]:
    storage = StorageService(session)
    return [url for fid in (file_ids or []) if (url := storage.url_for_id(fid))]


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def to_user(session: Session, user: User) -> UserType:
    return UserType(
        id=strawberry.ID(user.id),
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        role=Role(user.role).value,
        business_id=strawberry.ID(user.business_id) if user.business_id else None,
        is_active=user.is_active,
        avatar_url=_url(session, user.avatar_file_id),
        theme=user.theme,
        language=user.language,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
        # UI affordance only -- the server re-checks every permission on every call.
        permissions=sorted(p.value for p in permissions_for(user.role)),
    )


def _mask_secret(secret: str | None, visible: int = 4) -> str | None:
    """Render a credential as a recognisable stub, never as a usable value.

    Only the LAST few characters survive, and only when the secret is long enough that
    those characters are not most of it -- masking "abc" as "••c" would give away a
    third of a short key for nothing. The point is to let an admin confirm WHICH key is
    installed, not to let anyone reconstruct it.
    """
    if not secret:
        return None
    if len(secret) <= visible * 2:
        return "•" * 8
    return f"{'•' * 8}{secret[-visible:]}"


def to_business(session: Session, business: Business) -> BusinessType:
    return BusinessType(
        id=strawberry.ID(business.id),
        name=business.name,
        slug=business.slug,
        description=business.description,
        logo_url=_url(session, business.logo_file_id),
        email=business.email,
        phone=business.phone,
        whatsapp_number=business.whatsapp_number,
        website=business.website,
        facebook_url=business.facebook_url,
        instagram_url=business.instagram_url,
        tiktok_url=business.tiktok_url,
        address=business.address,
        city=business.city,
        country=business.country,
        google_maps_url=business.google_maps_url,
        latitude=business.latitude,
        longitude=business.longitude,
        currency=business.currency,
        currency_symbol=business.currency_symbol,
        timezone=business.timezone,
        locale=business.locale,
        # A tax rate is a percentage, not an amount of money.
        tax_percentage=_plain(business.tax_percentage) or "0",
        working_hours=business.working_hours or {},
        reminders_enabled=business.reminders_enabled,
        reminder_days_before=list(business.reminder_days_before or []),
        reminder_audience=business.reminder_audience,
        reminder_send_hour=business.reminder_send_hour,
        notify_owner_on_overdue=business.notify_owner_on_overdue,
        notify_owner_on_payment=business.notify_owner_on_payment,
        email_from_name=business.email_from_name,
        email_reply_to=business.email_reply_to,
        email_signature=business.email_signature,
        brand_color=business.brand_color,
        # Never the key itself -- only its existence and a recognisable tail.
        has_w3forms_access_key=bool(business.w3forms_access_key),
        w3forms_access_key_hint=_mask_secret(business.w3forms_access_key),
        retention_policy=business.retention_policy,
        retention_notifications_enabled=business.retention_notifications_enabled,
        storage_quota_mb=business.storage_quota_mb,
        is_active=business.is_active,
        created_at=business.created_at,
    )


# ---------------------------------------------------------------------------
# Customers & catalog
# ---------------------------------------------------------------------------
def to_customer(session: Session, customer: Customer) -> CustomerType:
    return CustomerType(
        id=strawberry.ID(customer.id),
        code=customer.code,
        name=customer.name,
        phone=customer.phone,
        email=customer.email,
        address=customer.address,
        city=customer.city,
        latitude=customer.latitude,
        longitude=customer.longitude,
        photo_url=_url(session, customer.photo_file_id),
        photo_thumbnail_url=_url(session, customer.photo_file_id, thumb=True),
        notes=customer.notes,
        status=customer.status,
        emergency_contact_name=customer.emergency_contact_name,
        emergency_contact_phone=customer.emergency_contact_phone,
        emergency_contact_relation=customer.emergency_contact_relation,
        credit_score=customer.credit_score,
        credit_limit=_money_or_none(customer.credit_limit),
        total_credit=money(customer.total_credit),
        total_paid=money(customer.total_paid),
        outstanding_balance=money(customer.outstanding_balance),
        credit_count=customer.credit_count,
        overdue_count=customer.overdue_count,
        last_credit_at=customer.last_credit_at,
        last_payment_at=customer.last_payment_at,
        created_at=customer.created_at,
    )


def to_category(category: Category) -> CategoryType:
    return CategoryType(
        id=strawberry.ID(category.id),
        name=category.name,
        description=category.description,
        color=category.color,
        created_at=category.created_at,
    )


def _category_of(session: Session, category_id: str | None) -> CategoryType | None:
    """Resolve a catalog row's category.

    ``session.get`` hits SQLAlchemy's identity map, so listing 100 products that
    share 5 categories issues 5 queries, not 100.
    """
    if not category_id:
        return None
    category = session.get(Category, category_id)
    return to_category(category) if category is not None else None


def to_product(session: Session, product: Product) -> ProductType:
    threshold = product.low_stock_threshold
    return ProductType(
        id=strawberry.ID(product.id),
        name=product.name,
        sku=product.sku,
        barcode=product.barcode,
        description=product.description,
        category_id=strawberry.ID(product.category_id) if product.category_id else None,
        category=_category_of(session, product.category_id),
        price=money(product.price),
        cost_price=_money_or_none(product.cost_price),
        tax_percentage=_plain(product.tax_percentage),
        stock_quantity=_plain(product.stock_quantity) or "0",
        low_stock_threshold=_plain(threshold),
        unit=product.unit,
        image_urls=_urls(session, product.image_file_ids),
        is_active=product.is_active,
        # A product with no threshold has opted out of stock warnings -- it is never
        # "low", however little of it there is.
        is_low_stock=threshold is not None and product.stock_quantity <= threshold,
        created_at=product.created_at,
    )


def to_service(session: Session, service: Service) -> ServiceType:
    return ServiceType(
        id=strawberry.ID(service.id),
        name=service.name,
        code=service.code,
        description=service.description,
        category_id=strawberry.ID(service.category_id) if service.category_id else None,
        category=_category_of(session, service.category_id),
        price=money(service.price),
        tax_percentage=_plain(service.tax_percentage),
        duration_minutes=service.duration_minutes,
        is_active=service.is_active,
        created_at=service.created_at,
    )


# ---------------------------------------------------------------------------
# Credits & payments
# ---------------------------------------------------------------------------
def to_credit_item(item: CreditItem) -> CreditItemType:
    return CreditItemType(
        id=strawberry.ID(item.id),
        kind=item.kind,
        product_id=strawberry.ID(item.product_id) if item.product_id else None,
        service_id=strawberry.ID(item.service_id) if item.service_id else None,
        name=item.name,
        description=item.description,
        unit=item.unit,
        quantity=_plain(item.quantity) or "0",
        unit_price=money(item.unit_price),
        discount_amount=money(item.discount_amount),
        tax_percentage=_plain(item.tax_percentage) or "0",
        tax_amount=money(item.tax_amount),
        line_subtotal=money(item.line_subtotal),
        line_total=money(item.line_total),
        position=item.position,
    )


def to_payment(session: Session, payment: Payment) -> PaymentType:
    customer = session.get(Customer, payment.customer_id)
    credit = session.get(Credit, payment.credit_id)
    return PaymentType(
        id=strawberry.ID(payment.id),
        number=payment.number,
        credit_id=strawberry.ID(payment.credit_id),
        customer_id=strawberry.ID(payment.customer_id),
        customer_name=customer.name if customer else None,
        credit_number=credit.number if credit else None,
        amount=money(payment.amount),
        balance_after=money(payment.balance_after),
        method=payment.method,
        reference=payment.reference,
        notes=payment.notes,
        paid_at=payment.paid_at,
        receipt_url=_url(session, payment.receipt_file_id),
        is_void=payment.voided_at is not None,
        voided_at=payment.voided_at,
        void_reason=payment.void_reason,
        created_at=payment.created_at,
    )


def to_credit(
    session: Session,
    credit: Credit,
    *,
    today: date | None = None,
    with_customer: bool = True,
) -> CreditType:
    """Map a credit, computing the two things the UI must never derive itself.

    ``today`` should be the business's local today (``today_in(business.timezone)``);
    a client in another timezone computing "days until due" from a UTC timestamp gets
    it wrong by a day for half the world.
    """
    reference = today or datetime.now(UTC).date()
    customer = session.get(Customer, credit.customer_id) if with_customer else None

    remaining = credit.remaining_amount
    return CreditType(
        id=strawberry.ID(credit.id),
        number=credit.number,
        customer_id=strawberry.ID(credit.customer_id),
        customer=to_customer(session, customer) if customer is not None else None,
        subtotal=money(credit.subtotal),
        discount_amount=money(credit.discount_amount),
        tax_amount=money(credit.tax_amount),
        grand_total=money(credit.grand_total),
        amount_paid=money(credit.amount_paid),
        remaining_amount=money(remaining),
        discount_percentage=_plain(credit.discount_percentage),
        tax_percentage=_plain(credit.tax_percentage),
        currency=credit.currency,
        issued_date=credit.issued_date,
        due_date=credit.due_date,
        reminder_date=credit.reminder_date,
        paid_at=credit.paid_at,
        status=credit.status,
        notes=credit.notes,
        photo_urls=_urls(session, credit.photo_file_ids),
        invoice_url=_url(session, credit.invoice_file_id),
        items=[to_credit_item(i) for i in sorted(credit.items, key=lambda i: i.position)],
        payments=[
            to_payment(session, p)
            for p in sorted(credit.payments, key=lambda p: ensure_utc(p.paid_at))
        ],
        days_until_due=(credit.due_date - reference).days,
        # Settled or cancelled is never overdue, however old the due date is.
        is_overdue=remaining > ZERO and credit.due_date < reference,
        created_at=credit.created_at,
        updated_at=credit.updated_at,
    )


# ---------------------------------------------------------------------------
# Communication
# ---------------------------------------------------------------------------
def to_notification(notification: Notification) -> NotificationType:
    return NotificationType(
        id=strawberry.ID(notification.id),
        kind=notification.kind,
        state=notification.state,
        title=notification.title,
        message=notification.message,
        link=notification.link or {},
        read_at=notification.read_at,
        created_at=notification.created_at,
    )


def to_email_template(template: EmailTemplate) -> EmailTemplateType:
    return EmailTemplateType(
        id=strawberry.ID(template.id),
        kind=template.kind,
        name=template.name,
        subject=template.subject,
        body_html=template.body_html,
        footer_html=template.footer_html,
        signature=template.signature,
        primary_color=template.primary_color,
        accent_color=template.accent_color,
        show_logo=template.show_logo,
        is_active=template.is_active,
        is_default=template.is_default,
        updated_at=template.updated_at,
    )


def to_template_variable(variable: TemplateVariable) -> TemplateVariableType:
    return TemplateVariableType(
        name=variable.name,
        description=variable.description,
        example=variable.example,
    )


def to_reminder(reminder: ScheduledReminder) -> ScheduledReminderType:
    return ScheduledReminderType(
        id=strawberry.ID(reminder.id),
        credit_id=strawberry.ID(reminder.credit_id),
        customer_id=strawberry.ID(reminder.customer_id),
        audience=reminder.audience,
        channel=reminder.channel,
        scheduled_for=reminder.scheduled_for,
        days_before_due=reminder.days_before_due,
        status=reminder.status,
        sent_at=reminder.sent_at,
        attempts=reminder.attempts,
        last_error=reminder.last_error,
    )


# ---------------------------------------------------------------------------
# Retention, exports, audit, files
# ---------------------------------------------------------------------------
def to_archive_batch(batch: ArchiveBatch, *, now: datetime | None = None) -> ArchiveBatchType:
    moment = now or datetime.now(UTC)
    scheduled = ensure_utc(batch.delete_scheduled_for)
    state = ArchiveState(batch.state)
    return ArchiveBatchType(
        id=strawberry.ID(batch.id),
        state=state,
        credit_count=batch.credit_count,
        payment_count=batch.payment_count,
        record_count=batch.record_count,
        storage_bytes=batch.storage_bytes,
        retention_policy=batch.retention_policy,
        delete_scheduled_for=scheduled,
        # Floored at 0: "-3 days until deletion" is not a thing a UI can render.
        days_until_deletion=max(0, (scheduled - moment).days),
        warnings_sent=list(batch.warnings_sent or []),
        postponed_count=batch.postponed_count,
        export_id=strawberry.ID(batch.export_id) if batch.export_id else None,
        # Once purged, the rows are gone. Nothing brings them back.
        can_restore=state is not ArchiveState.DELETED,
        created_at=batch.created_at,
    )


def to_export_job(session: Session, job: ExportJob) -> ExportJobType:
    state = ExportState(job.state)
    expired = job.expires_at is not None and datetime.now(UTC) >= ensure_utc(job.expires_at)
    # A URL is offered only for a file that is actually still there: a READY job past
    # its TTL is dead even though the sweep has not run yet.
    url = (
        _url(session, job.file_id)
        if state is ExportState.READY and job.file_id and not expired
        else None
    )
    return ExportJobType(
        id=strawberry.ID(job.id),
        format=job.format,
        state=state,
        datasets=list(job.datasets or []),
        row_count=job.row_count,
        size_bytes=job.size_bytes,
        download_url=url,
        expires_at=job.expires_at,
        error=job.error,
        created_at=job.created_at,
    )


def to_audit_log(log: AuditLog) -> AuditLogType:
    return AuditLogType(
        id=strawberry.ID(log.id),
        action=log.action,
        entity_type=log.entity_type,
        entity_id=strawberry.ID(log.entity_id) if log.entity_id else None,
        summary=log.summary,
        changes=log.changes or {},
        actor_label=log.actor_label,
        created_at=log.created_at,
        # ip_address / user_agent are deliberately NOT exposed: the audit trail keeps
        # them for a forensic query, not for the notification pane.
    )


def to_file_asset(session: Session, asset: FileAsset) -> FileAssetType:
    storage = StorageService(session)
    saved = asset.original_size_bytes - asset.size_bytes
    return FileAssetType(
        id=strawberry.ID(asset.id),
        kind=asset.kind,
        filename=asset.original_filename,
        url=storage.url_for(asset) or "",
        thumbnail_url=storage.url_for(asset, thumb=True) if asset.thumbnail_key else None,
        content_type=asset.content_type,
        size_bytes=asset.size_bytes,
        original_size_bytes=asset.original_size_bytes,
        # Clamped: an already-optimised PNG can come out bigger, and a negative
        # "bytes saved" would drag the storage dashboard's total below the truth.
        bytes_saved=max(0, saved),
        width=asset.width,
        height=asset.height,
        created_at=asset.created_at,
    )
