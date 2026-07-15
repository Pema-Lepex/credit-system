"""Platform-wide settings — the super-admin's own configuration.

Unlike everything else in this app, this row belongs to NO business. There is exactly
one of it (a fixed ``key`` guarantees uniqueness), and only the SUPER_ADMIN reads or
writes it. Today it holds one thing: the W3Forms access key used to email the operator
when a new store owner registers — kept here so the super-admin can manage it from the
dashboard instead of an environment variable.
"""

from __future__ import annotations

from sqlmodel import Field

from app.models.base import BaseEntity


class PlatformSetting(BaseEntity, table=True):
    __tablename__ = "platform_setting"

    # A single-row table. The fixed key means an upsert can never create a second row,
    # and the service always addresses "the" settings without an id to track.
    key: str = Field(default="platform", unique=True, index=True, max_length=32)

    # W3Forms access key whose registered inbox IS the super-admin's. Used only to
    # notify the operator of new registrations. Never returned raw over the API — the
    # mapper exposes only whether it is set and a masked hint (same discipline as
    # Business.w3forms_access_key).
    w3forms_access_key: str | None = Field(default=None, max_length=255)
