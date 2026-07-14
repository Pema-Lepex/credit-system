"""Business (tenant) and its settings.

NOTE — no ``from __future__ import annotations`` in this module, deliberately.
That import stringifies EVERY annotation, including ``list["User"]`` on the
Relationship below. SQLModel then cannot see the ``list[...]`` wrapper (it gets one
opaque string), so it hands SQLAlchemy the literal text ``list['User']`` as the
relationship target and mapper configuration dies with:

    InvalidRequestError: expression "relationship("list['User']")" seems to be
    using a generic class as the argument to relationship()

Without the future import, ``list["User"]`` evaluates to ``list[ForwardRef('User')]``
-- SQLModel unwraps the list, and SQLAlchemy resolves the "User" forward reference
against its class registry. Every model module that declares a Relationship must
therefore avoid the future import. Modules with no Relationship (customer, catalog,
file, ...) keep it.
"""

from decimal import Decimal
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, Column
from sqlmodel import Field, Relationship

from app.models.base import BaseEntity
from app.models.enums import ReminderAudience, RetentionPolicy

if TYPE_CHECKING:
    from app.models.user import User


class Business(BaseEntity, table=True):
    """A tenant. Every domain row hangs off exactly one of these.

    ARCHITECTURE NOTE: settings are split across three groups (profile, reminders,
    storage/retention) but kept on ONE row rather than in a settings table. A
    business always loads all of its settings together, so a join would buy
    nothing, and a single row keeps the update path atomic.
    """

    __tablename__ = "business"

    # --- Identity -----------------------------------------------------------
    name: str = Field(index=True, max_length=160)
    slug: str = Field(unique=True, index=True, max_length=180)
    description: str | None = Field(default=None, max_length=2000)

    # NOTE: deliberately NOT a foreign key.
    #
    # FileAsset.business_id already points at Business, so a FK here would close a
    # cycle: business -> file_asset -> business. SQLite tolerates that; PostgreSQL
    # cannot create the two tables in any valid order and CREATE TABLE fails
    # outright -- which would break the very Postgres migration path this project
    # promises. (Alembic warns: "unresolvable cycles between tables".)
    #
    # The alternative -- deferrable constraints via use_alter=True -- adds real
    # complexity for a reference that the application already manages: StorageService
    # reference-counts every attach/detach, and the orphan sweep reclaims anything
    # unreferenced. The integrity this FK would enforce is enforced in code, on a
    # path that has to exist anyway.
    logo_file_id: str | None = Field(default=None, index=True, max_length=32)

    # --- Contact ------------------------------------------------------------
    email: str | None = Field(default=None, index=True, max_length=255)
    phone: str | None = Field(default=None, max_length=40)
    whatsapp_number: str | None = Field(default=None, max_length=40)
    website: str | None = Field(default=None, max_length=255)

    # --- Social -------------------------------------------------------------
    facebook_url: str | None = Field(default=None, max_length=255)
    instagram_url: str | None = Field(default=None, max_length=255)
    tiktok_url: str | None = Field(default=None, max_length=255)

    # --- Location -----------------------------------------------------------
    address: str | None = Field(default=None, max_length=500)
    city: str | None = Field(default=None, max_length=120)
    country: str | None = Field(default=None, max_length=120)
    google_maps_url: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None)
    longitude: float | None = Field(default=None)

    # --- Localisation -------------------------------------------------------
    # Defaults target the primary market (Bhutan). Every one of these is editable per
    # business in Settings -> Localisation, so a shop elsewhere just changes them.
    #
    # currency_symbol is stored separately and is NOT cosmetic: Intl renders BTN as
    # "BTN 1,234.50" under en-US, and only reaches "Nu." under dz-BT, which also
    # switches the digits to Tibetan numerals. The frontend therefore takes the
    # grouping from `locale` and the symbol from this column. See frontend/src/lib/format.ts.
    currency: str = Field(default="BTN", max_length=3)          # ISO-4217
    currency_symbol: str = Field(default="Nu.", max_length=8)
    timezone: str = Field(default="Asia/Thimphu", max_length=64)  # IANA
    locale: str = Field(default="en", max_length=10)
    tax_percentage: Decimal = Field(default=Decimal("0"), max_digits=5, decimal_places=2)

    # Opening hours: {"mon": {"open": "09:00", "close": "18:00", "closed": false}, ...}
    # JSON rather than a WorkingHours table -- it is read as an opaque blob by the
    # UI, never queried by field, so a table would be seven joins for nothing.
    working_hours: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    # --- Reminder preferences ----------------------------------------------
    reminders_enabled: bool = Field(default=True)
    # Days *before* the due date to fire a reminder. Spec asks for 1/3/7 + custom;
    # a list makes "custom" free rather than three booleans plus an escape hatch.
    reminder_days_before: list[int] = Field(
        default_factory=lambda: [7, 3, 1], sa_column=Column(JSON)
    )
    reminder_audience: ReminderAudience = Field(default=ReminderAudience.BOTH, max_length=16)
    reminder_send_hour: int = Field(default=9)   # business-local hour, 0-23
    notify_owner_on_overdue: bool = Field(default=True)
    notify_owner_on_payment: bool = Field(default=True)

    # --- Email identity (per-business, overrides the platform default) ------
    email_from_name: str | None = Field(default=None, max_length=120)
    email_reply_to: str | None = Field(default=None, max_length=255)
    email_signature: str | None = Field(default=None, max_length=1000)
    brand_color: str = Field(default="#4F46E5", max_length=9)   # #RRGGBB[AA]

    # --- W3Forms access key (per-business, NOT in the environment) -----------
    #
    # WHY THIS ONE CREDENTIAL LIVES IN THE DATABASE AND SMTP'S DOES NOT
    # -----------------------------------------------------------------
    # It looks inconsistent to keep SMTP_PASSWORD in the environment and this in a
    # table. The difference is what the credential MEANS.
    #
    # An SMTP password is a login to a shared transport; the recipient is carried in
    # the message. One relay can serve every business, so the secret is deployment
    # config and belongs in the environment.
    #
    # A W3Forms access key has no recipient parameter at all -- the key IS the
    # destination inbox. So a single key in the environment would deliver EVERY
    # business's owner notifications to ONE inbox: the deployment owner's. Tenant A's
    # overdue alerts would land in tenant B's mail. On a multi-tenant install that is
    # not a preference, it is a tenancy leak, and no amount of env config fixes it.
    # The key has to be per-business because the thing it identifies is per-business.
    #
    # It is never returned raw over the API (see graphql/mappers.py: the field is
    # exposed masked, and is write-only). Falls back to settings.W3FORMS_ACCESS_KEY
    # when a business has not set its own, which keeps a single-tenant install working
    # with nothing but an env var.
    w3forms_access_key: str | None = Field(default=None, max_length=255)

    # --- Retention / storage ------------------------------------------------
    retention_policy: RetentionPolicy = Field(default=RetentionPolicy.DAYS_30, max_length=16)
    retention_notifications_enabled: bool = Field(default=True)
    storage_quota_mb: int = Field(default=500)   # soft cap; warns, does not block

    # --- Platform -----------------------------------------------------------
    is_active: bool = Field(default=True, index=True)

    users: list["User"] = Relationship(
        back_populates="business",
        sa_relationship_kwargs={"foreign_keys": "User.business_id"},
    )

    @property
    def retention_days(self) -> "int | None":
        return RetentionPolicy(self.retention_policy).days
