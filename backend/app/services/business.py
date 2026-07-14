"""BusinessService -- the tenant record and its settings."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from slugify import slugify
from sqlmodel import Session, col, select

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.business import Business
from app.models.enums import AuditAction, ReminderAudience, RetentionPolicy
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.pagination import Page, PageInput, paginate

# Fields a caller may set through create/update. Anything not on this list (id,
# timestamps, deleted_at) is not settable from the outside -- an allow-list, so a
# new column is not accidentally mass-assignable the day it is added.
EDITABLE_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "description",
        "logo_file_id",
        "email",
        "phone",
        "whatsapp_number",
        "website",
        "facebook_url",
        "instagram_url",
        "tiktok_url",
        "address",
        "city",
        "country",
        "google_maps_url",
        "latitude",
        "longitude",
        "currency",
        "currency_symbol",
        "timezone",
        "locale",
        "tax_percentage",
        "working_hours",
        "reminders_enabled",
        "reminder_days_before",
        "reminder_audience",
        "reminder_send_hour",
        "notify_owner_on_overdue",
        "notify_owner_on_payment",
        "email_from_name",
        "email_reply_to",
        "email_signature",
        "brand_color",
        "retention_policy",
        "retention_notifications_enabled",
        "storage_quota_mb",
    }
)


def unique_slug(session: Session, name: str) -> str:
    """``Ram's Grocery`` -> ``rams-grocery``, ``rams-grocery-2`` if taken.

    Uniqueness is checked against ALL businesses including soft-deleted ones: the
    slug is a URL, and recycling a deleted shop's URL would silently redirect its
    old links to a different business.
    """
    base = slugify(name)[:150] or "business"
    candidate = base
    n = 2
    while session.exec(select(Business).where(Business.slug == candidate)).first() is not None:
        candidate = f"{base}-{n}"
        n += 1
    return candidate


def _validate(fields: dict[str, Any]) -> None:
    """Validate whatever subset of the settings is present. Raises ValidationError."""
    if "currency" in fields and fields["currency"] is not None:
        code = str(fields["currency"]).strip().upper()
        if len(code) != 3 or not code.isalpha():
            raise ValidationError(
                "Currency must be a 3-letter ISO code, e.g. USD or BTN", field="currency"
            )
        fields["currency"] = code

    if "timezone" in fields and fields["timezone"] is not None:
        tz = str(fields["timezone"]).strip()
        try:
            ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            raise ValidationError(
                f"'{tz}' is not a valid IANA timezone (e.g. Asia/Thimphu)", field="timezone"
            ) from exc
        fields["timezone"] = tz

    if "tax_percentage" in fields and fields["tax_percentage"] is not None:
        try:
            tax = Decimal(str(fields["tax_percentage"]))
        except (InvalidOperation, TypeError) as exc:
            raise ValidationError("Tax percentage must be a number", field="tax_percentage") from exc
        if tax < 0 or tax > 100:
            raise ValidationError(
                "Tax percentage must be between 0 and 100", field="tax_percentage"
            )
        fields["tax_percentage"] = tax

    if "reminder_days_before" in fields and fields["reminder_days_before"] is not None:
        raw = fields["reminder_days_before"]
        if not isinstance(raw, (list, tuple)):
            raise ValidationError(
                "Reminder days must be a list of whole numbers", field="reminder_days_before"
            )
        days: list[int] = []
        for value in raw:
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError(
                    "Reminder days must be whole numbers", field="reminder_days_before"
                )
            if value <= 0:
                raise ValidationError(
                    "Reminder days must be greater than zero (they count backwards from the due date)",
                    field="reminder_days_before",
                )
            days.append(value)
        # Sorted descending + de-duplicated: the scheduler walks this list and would
        # otherwise fire "7 days before" twice if the owner typed 7 in twice.
        fields["reminder_days_before"] = sorted(set(days), reverse=True)

    if "reminder_send_hour" in fields and fields["reminder_send_hour"] is not None:
        hour = fields["reminder_send_hour"]
        if isinstance(hour, bool) or not isinstance(hour, int) or not 0 <= hour <= 23:
            raise ValidationError(
                "Reminder hour must be between 0 and 23", field="reminder_send_hour"
            )

    if "reminder_audience" in fields and fields["reminder_audience"] is not None:
        try:
            fields["reminder_audience"] = ReminderAudience(fields["reminder_audience"])
        except ValueError as exc:
            raise ValidationError("Unknown reminder audience", field="reminder_audience") from exc

    if "retention_policy" in fields and fields["retention_policy"] is not None:
        try:
            fields["retention_policy"] = RetentionPolicy(fields["retention_policy"])
        except ValueError as exc:
            raise ValidationError("Unknown retention policy", field="retention_policy") from exc

    if "storage_quota_mb" in fields and fields["storage_quota_mb"] is not None:
        quota = fields["storage_quota_mb"]
        if isinstance(quota, bool) or not isinstance(quota, int) or quota <= 0:
            raise ValidationError("Storage quota must be a positive number of MB", field="storage_quota_mb")


class BusinessService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self.storage = StorageService(self.session)

    # -- read ----------------------------------------------------------------
    def get(self, business_id: str | None = None) -> Business:
        self.require(Permission.BUSINESS_READ)
        # No id supplied => "my business". An id supplied by an ADMIN/STAFF is run
        # through scope_id, which rejects anything but their own.
        target = business_id or self.scope_id
        if not self.is_super_admin and target != self.scope_id:
            raise PermissionDeniedError("Cross-business access is not permitted")

        business = self.session.get(Business, target)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")
        return business

    def get_by_slug(self, slug: str) -> Business:
        business = self.session.exec(
            select(Business).where(
                Business.slug == slug,
                Business.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()
        if business is None:
            raise NotFoundError("Business not found")
        return business

    def list_businesses(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> Page[Business]:
        """Platform-wide listing. SUPER_ADMIN only -- it is the one query in the
        codebase that is deliberately not tenant-scoped."""
        self.require(Permission.BUSINESS_CREATE)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may list businesses")

        stmt = select(Business).where(Business.deleted_at.is_(None))  # type: ignore[union-attr]
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                col(Business.name).ilike(like)
                | col(Business.slug).ilike(like)
                | col(Business.email).ilike(like)
            )
        if is_active is not None:
            stmt = stmt.where(Business.is_active == is_active)

        stmt = stmt.order_by(col(Business.created_at).desc())
        return paginate(self.session, stmt, page or PageInput())

    # -- write ---------------------------------------------------------------
    def create(self, name: str, **fields: Any) -> Business:
        self.require(Permission.BUSINESS_CREATE)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may create a business")

        name = (name or "").strip()
        if not name:
            raise ValidationError("Business name is required", field="name")

        payload = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS and k != "name"}
        _validate(payload)

        business = Business(name=name, slug=unique_slug(self.session, name), **payload)
        self.session.add(business)
        self.session.flush()

        if business.logo_file_id:
            self.storage.attach(business.logo_file_id)

        self.audit(
            AuditAction.CREATE,
            "business",
            business.id,
            f"Business '{business.name}' created",
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business

    def update(self, business_id: str | None = None, **fields: Any) -> Business:
        self.require(Permission.BUSINESS_UPDATE)
        target = business_id or self.scope_id
        if not self.is_super_admin and target != self.scope_id:
            raise PermissionDeniedError("Cross-business access is not permitted")

        business = self.session.get(Business, target)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")

        payload = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
        if not payload:
            return business
        _validate(payload)

        before = {k: getattr(business, k) for k in payload}

        # The logo is a reference-counted file, not a plain column: swapping it must
        # release the old asset or it lingers on disk forever with a refcount of 1.
        if "logo_file_id" in payload and payload["logo_file_id"] != business.logo_file_id:
            self.storage.detach(business.logo_file_id)
            self.storage.attach(payload["logo_file_id"])

        if "name" in payload:
            new_name = str(payload["name"]).strip()
            if not new_name:
                raise ValidationError("Business name is required", field="name")
            payload["name"] = new_name
            # The slug is intentionally NOT regenerated on rename: it is a stable
            # public identifier and changing it would break every link already out
            # in the world. Renaming the shop is not re-founding it.

        for key, value in payload.items():
            setattr(business, key, value)
        self.session.add(business)

        changes = diff_fields(before, payload)
        self.audit(
            AuditAction.UPDATE,
            "business",
            business.id,
            f"Business '{business.name}' updated",
            changes,
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business

    def deactivate(self, business_id: str) -> Business:
        """Suspend a tenant. Data is retained; nobody can sign in."""
        self.require(Permission.BUSINESS_DELETE)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may deactivate a business")

        business = self.session.get(Business, business_id)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")

        business.is_active = False
        self.session.add(business)
        self.audit(
            AuditAction.UPDATE,
            "business",
            business.id,
            f"Business '{business.name}' deactivated",
            {"is_active": [True, False]},
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business

    def activate(self, business_id: str) -> Business:
        self.require(Permission.BUSINESS_DELETE)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may activate a business")

        business = self.session.get(Business, business_id)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")

        business.is_active = True
        self.session.add(business)
        self.audit(
            AuditAction.UPDATE,
            "business",
            business.id,
            f"Business '{business.name}' activated",
            {"is_active": [False, True]},
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business

    def soft_delete(self, business_id: str) -> Business:
        self.require(Permission.BUSINESS_DELETE)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may delete a business")

        business = self.session.get(Business, business_id)
        if business is None:
            raise NotFoundError("Business not found")
        if business.deleted_at is not None:
            raise ConflictError("That business is already deleted")

        business.deleted_at = utcnow()
        business.is_active = False
        self.session.add(business)
        self.audit(
            AuditAction.DELETE,
            "business",
            business.id,
            f"Business '{business.name}' soft-deleted",
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business
