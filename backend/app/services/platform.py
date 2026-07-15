"""Platform settings — the super-admin's own configuration.

Two entry points, deliberately separate because they have different callers:

* ``PlatformService`` — the SUPER_ADMIN reading/writing the settings from the panel.
  Guarded, and the write records nothing raw (the key is a secret).
* ``resolve_registration_notice_key`` — a plain function used during registration to
  find which W3Forms key to notify the operator with. It runs as the REGISTERING
  user, not the super-admin, so it must NOT be gated. It reads the DB key, then falls
  back to the environment.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session, select

from app.core.config import settings
from app.core.errors import PermissionDeniedError
from app.models.platform import PlatformSetting
from app.services.base import BaseService

_SINGLETON_KEY = "platform"


def get_platform_setting(session: Session) -> PlatformSetting:
    """The one settings row, created on first access. No authorisation — callers gate."""
    row = session.exec(
        select(PlatformSetting).where(PlatformSetting.key == _SINGLETON_KEY)
    ).first()
    if row is None:
        row = PlatformSetting(key=_SINGLETON_KEY)
        session.add(row)
        session.flush()
    return row


def resolve_registration_notice_key(session: Session) -> str | None:
    """Which W3Forms key to notify the super-admin with when a shop registers.

    Dashboard-configured key wins; otherwise the environment key (either the
    dedicated one or the shared fallback). Runs during registration, so it is
    intentionally unauthenticated — it reveals nothing, it only chooses a transport.
    """
    row = session.exec(
        select(PlatformSetting).where(PlatformSetting.key == _SINGLETON_KEY)
    ).first()
    if row is not None and row.w3forms_access_key:
        return row.w3forms_access_key
    return settings.SUPER_ADMIN_W3FORMS_ACCESS_KEY or settings.W3FORMS_ACCESS_KEY


class PlatformService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)

    def _require_super_admin(self) -> None:
        # No permission maps to a platform-only surface, so the check is direct:
        # the caller must be the SUPER_ADMIN, full stop.
        if not self.is_super_admin:
            raise PermissionDeniedError("Only a platform administrator may do this")

    def get(self) -> PlatformSetting:
        self._require_super_admin()
        return get_platform_setting(self.session)

    def update(self, *, w3forms_access_key: str | None) -> PlatformSetting:
        """Set the platform W3Forms key. Empty string clears it; None leaves it alone.

        The caller (resolver) passes None when the field was omitted, and "" when the
        operator cleared it — the same three-state convention Business settings use.
        """
        self._require_super_admin()
        row = get_platform_setting(self.session)

        if w3forms_access_key is not None:
            row.w3forms_access_key = w3forms_access_key.strip() or None
            self.session.add(row)

        # Platform action: no tenant to file an audit row under (audit is tenant-scoped
        # and the super-admin belongs to no business), and a secret is never recorded
        # in the clear anyway.
        self.session.commit()
        self.session.refresh(row)
        return row
