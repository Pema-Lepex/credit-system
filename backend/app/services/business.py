"""BusinessService -- the tenant record and its settings."""

from __future__ import annotations

import logging
from decimal import Decimal, InvalidOperation
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from slugify import slugify
from sqlalchemy import delete as sa_delete
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.errors import ConflictError, NotFoundError, PermissionDeniedError, ValidationError
from app.core.security import Permission, Role
from app.models.base import utcnow
from app.models.business import Business
from app.models.enums import ApprovalStatus, AuditAction, ReminderAudience, RetentionPolicy
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.pagination import Page, PageInput, paginate

log = logging.getLogger(__name__)

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
        "w3forms_access_key",
        "retention_policy",
        "retention_notifications_enabled",
        "storage_quota_mb",
    }
)

# Credentials. Editable, but never echoed back and never written to the audit log in
# the clear -- an audit trail that records secrets is a second place to steal them
# from, and it is the one place nobody thinks to protect.
SECRET_FIELDS: frozenset[str] = frozenset({"w3forms_access_key"})


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

        # A credential has three states, and "" is not the same as absent. The client
        # can never send the current key back (it is never given it), so without an
        # explicit "clear" signal a key could be set but never removed. Empty string
        # is that signal; the field then falls back to the environment key.
        if "w3forms_access_key" in payload:
            payload["w3forms_access_key"] = (payload["w3forms_access_key"] or "").strip() or None

        for key, value in payload.items():
            setattr(business, key, value)
        self.session.add(business)

        changes = diff_fields(before, payload)
        # Record THAT the secret changed, never what it changed to or from.
        for field in SECRET_FIELDS & changes.keys():
            old, new = changes[field]
            changes[field] = ["***" if old else None, "***" if new else None]
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

    # =====================================================================
    # Super Admin panel -- the platform operator's view over ALL tenants.
    # Every method here is SUPER_ADMIN only, guarded twice: the BUSINESS_CREATE/
    # BUSINESS_DELETE permission (which no ADMIN holds) AND an explicit is_super_admin
    # check, matching list_businesses above.
    # =====================================================================
    def _require_super_admin(self, permission: Permission) -> None:
        self.require(permission)
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may perform this action")

    def get_for_admin(self, business_id: str) -> Business:
        """A single tenant for the admin detail view."""
        self._require_super_admin(Permission.BUSINESS_CREATE)
        business = self.session.get(Business, business_id)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")
        return business

    def list_for_admin(
        self,
        page: PageInput | None = None,
        *,
        status: ApprovalStatus | None = None,
        search: str | None = None,
    ) -> Page[Business]:
        """Every store owner on the platform, optionally filtered by approval state."""
        self._require_super_admin(Permission.BUSINESS_CREATE)

        stmt = select(Business).where(Business.deleted_at.is_(None))  # type: ignore[union-attr]
        if status is not None:
            stmt = stmt.where(Business.approval_status == status)
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                col(Business.name).ilike(like)
                | col(Business.slug).ilike(like)
                | col(Business.email).ilike(like)
            )
        stmt = stmt.order_by(col(Business.created_at).desc())
        return paginate(self.session, stmt, page or PageInput())

    def admin_stats(self) -> dict[str, int]:
        """Store-owner counts by approval state, for the super-admin dashboard cards."""
        self._require_super_admin(Permission.BUSINESS_CREATE)
        rows = self.session.execute(
            select(Business.approval_status, func.count())
            .where(Business.deleted_at.is_(None))  # type: ignore[union-attr]
            .group_by(Business.approval_status)
        ).all()
        counts = {ApprovalStatus(status): int(n) for status, n in rows}
        return {
            "total": sum(counts.values()),
            "pending": counts.get(ApprovalStatus.PENDING, 0),
            "approved": counts.get(ApprovalStatus.APPROVED, 0),
            "rejected": counts.get(ApprovalStatus.REJECTED, 0),
            "suspended": counts.get(ApprovalStatus.SUSPENDED, 0),
        }

    def owners_for(self, business_ids: list[str]) -> dict[str, Any]:
        """{business_id: earliest ADMIN user}. One query, so the admin list is N+1-free."""
        from app.models.user import User

        if not business_ids:
            return {}
        rows = self.session.exec(
            select(User)
            .where(
                col(User.business_id).in_(business_ids),
                User.role == Role.ADMIN,
                col(User.deleted_at).is_(None),
            )
            .order_by(col(User.created_at).asc())
        ).all()
        owners: dict[str, Any] = {}
        for user in rows:
            # First (earliest) ADMIN wins -- that is the registrant who founded the shop.
            if user.business_id:
                owners.setdefault(user.business_id, user)
        return owners

    def counts_for(self, business_id: str) -> dict[str, int]:
        """User / customer / credit totals for one tenant (admin detail view)."""
        from app.models.credit import Credit
        from app.models.customer import Customer
        from app.models.user import User

        def _count(model: Any) -> int:
            return int(
                self.session.execute(
                    select(func.count()).where(
                        model.business_id == business_id,
                        col(model.deleted_at).is_(None),
                    )
                ).scalar_one()
            )

        return {
            "users": _count(User),
            "customers": _count(Customer),
            "credits": _count(Credit),
        }

    def set_approval(
        self,
        business_id: str,
        status: ApprovalStatus,
        *,
        reason: str | None = None,
    ) -> Business:
        """Approve / reject / suspend / re-activate a tenant. The heart of the panel.

        A reason is REQUIRED for REJECTED and SUSPENDED -- the owner is shown it after
        login, and "no functionality with no explanation" is a support ticket waiting
        to happen. APPROVED clears any prior reason.
        """
        self._require_super_admin(Permission.BUSINESS_CREATE)

        business = self.session.get(Business, business_id)
        if business is None or business.deleted_at is not None:
            raise NotFoundError("Business not found")

        needs_reason = status in (ApprovalStatus.REJECTED, ApprovalStatus.SUSPENDED)
        clean_reason = (reason or "").strip() or None
        if needs_reason and not clean_reason:
            raise ValidationError("A reason is required", field="reason")

        before = ApprovalStatus(business.approval_status)
        business.approval_status = status
        business.approval_reason = clean_reason if needs_reason else None
        business.approved_at = utcnow()
        business.approved_by_user_id = self.ctx.user.id if self.ctx.user else None
        # Keep the older on/off switch consistent: only an APPROVED tenant is active.
        business.is_active = status is ApprovalStatus.APPROVED
        self.session.add(business)

        self.audit(
            AuditAction.UPDATE,
            "business",
            business.id,
            f"Business '{business.name}' set to {status.value} by platform admin",
            {"approval_status": [before.value, status.value]},
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        return business

    def hard_delete(self, business_id: str) -> str:
        """PERMANENTLY delete a tenant and everything it owns. Irreversible.

        SUPER_ADMIN only. Unlike ``soft_delete`` (which just hides the row), this
        purges every customer, credit, payment, file record, log and user. There is
        no restore. Returns the deleted business's name for the confirmation message.
        """
        self._require_super_admin(Permission.BUSINESS_DELETE)

        business = self.session.get(Business, business_id)
        if business is None:
            raise NotFoundError("Business not found")

        name = business.name
        self._purge_tenant(business_id)
        # There is no tenant audit log to write to -- we just deleted it -- and the
        # super-admin belongs to no business, so the platform trail is the app log.
        log.warning("Super-admin PERMANENTLY deleted business %s ('%s')", business_id, name)
        self.session.commit()
        # The bulk DELETEs above went in at the Core level, so the ORM identity map
        # still holds now-ghost rows (the business, its users). Detach them so any
        # later access on this session re-reads from the DB and sees them gone, rather
        # than raising ObjectDeletedError on a stale instance.
        self.session.expunge_all()
        return name

    def _purge_tenant(self, business_id: str) -> None:
        """Delete every row a tenant owns, children before parents.

        Order is load-bearing: SQLite checks foreign keys immediately, and two FKs are
        RESTRICT (payment -> customer, credit -> customer), so payments and credits
        MUST be gone before their customers. Relying on the business_id CASCADE alone
        would risk a RESTRICT violation mid-cascade, depending on delete order.

        NOTE: physical upload blobs are not removed here -- only their FileAsset rows.
        On the ephemeral/cloud backends this is acceptable (the container or the
        provider's lifecycle reclaims them); a future enhancement could detach each
        asset through StorageService first.
        """
        from app.models.catalog import Category, Product, Service
        from app.models.communication import (
            EmailLog,
            EmailTemplate,
            Notification,
            ScheduledReminder,
        )
        from app.models.credit import Credit, CreditItem, Payment
        from app.models.customer import Customer
        from app.models.file import FileAsset
        from app.models.retention import ArchiveBatch, AuditLog, ExportJob
        from app.models.user import PasswordResetToken, RefreshToken, User

        session = self.session
        ordered: list[Any] = [
            Payment,
            CreditItem,
            ScheduledReminder,
            EmailLog,
            Credit,
            Notification,
            EmailTemplate,
            Product,
            Service,
            Category,
            Customer,
            ArchiveBatch,
            ExportJob,
            FileAsset,
            AuditLog,
        ]
        for model in ordered:
            session.execute(sa_delete(model).where(model.business_id == business_id))

        # User-scoped tokens first (they FK to user), then the users, then the tenant.
        user_ids = list(
            session.exec(select(User.id).where(User.business_id == business_id)).all()
        )
        if user_ids:
            session.execute(sa_delete(RefreshToken).where(col(RefreshToken.user_id).in_(user_ids)))
            session.execute(
                sa_delete(PasswordResetToken).where(col(PasswordResetToken.user_id).in_(user_ids))
            )
        session.execute(sa_delete(User).where(User.business_id == business_id))
        session.execute(sa_delete(Business).where(Business.id == business_id))
