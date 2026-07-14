"""Shared model mixins.

ARCHITECTURE NOTES
------------------
* **UUID primary keys, stored as 32-char hex strings.** Sequential integers leak
  business volume ("customer #4" tells a competitor you have four customers) and
  collide when merging data from multiple SQLite files during a cloud migration.
  Hex strings work identically on SQLite and Postgres.

* **Soft delete everywhere** (``deleted_at``). The retention policy requires that
  nothing is destroyed immediately; a row must be archivable, downloadable, and
  restorable until it is genuinely purged. Every query helper filters on
  ``deleted_at IS NULL`` by default.

* **Tenant scoping** (``BusinessScopedMixin``). Every business-owned table carries
  an indexed ``business_id``. This is the seam that turns the app multi-tenant and
  makes "thousands of businesses" a pagination problem rather than a rewrite.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Timezone-aware UTC now.

    Everything is stored in UTC; the business's timezone is applied only at the
    display/reporting edge. Mixing local times in the DB is the classic source of
    "the reminder fired a day late" bugs.
    """
    return datetime.now(UTC)


# ``timezone=True`` keeps tz-awareness on Postgres. SQLite has no tz-aware type,
# so we normalise on read in app.utils.dates.ensure_utc().
TZDateTime = DateTime(timezone=True)


class UUIDMixin(SQLModel):
    id: str = Field(default_factory=new_id, primary_key=True, max_length=32)


class TimestampMixin(SQLModel):
    created_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TZDateTime,  # type: ignore[call-overload]
        nullable=False,
        index=True,
    )
    updated_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TZDateTime,  # type: ignore[call-overload]
        nullable=False,
        sa_column_kwargs={"onupdate": utcnow},
    )


class SoftDeleteMixin(SQLModel):
    deleted_at: datetime | None = Field(
        default=None,
        sa_type=TZDateTime,  # type: ignore[call-overload]
        nullable=True,
        index=True,
    )

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class BusinessScopedMixin(SQLModel):
    business_id: str = Field(
        foreign_key="business.id",
        index=True,
        nullable=False,
        max_length=32,
        ondelete="CASCADE",
    )


class BaseEntity(UUIDMixin, TimestampMixin, SoftDeleteMixin):
    """Standalone entity: identity + audit timestamps + soft delete."""


class TenantEntity(UUIDMixin, BusinessScopedMixin, TimestampMixin, SoftDeleteMixin):
    """Entity owned by exactly one business. The default for domain tables."""
