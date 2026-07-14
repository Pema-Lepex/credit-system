"""The per-business W3Forms access key.

Two things are being pinned here, and they fail in opposite directions:

  * TENANCY -- the key IS the destination inbox (W3Forms has no recipient field), so
    a business must send through its OWN key. Getting this wrong delivers one
    tenant's owner notifications to another tenant's mailbox.
  * SECRECY -- the key is write-only. It must not come back out of the API, and it
    must not be written to the audit log, which is the place nobody thinks to guard.
"""

from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.email.providers.w3forms import W3FormsProvider
from app.email.service import EmailService
from app.graphql.mappers import _mask_secret
from app.models.business import Business
from app.models.retention import AuditLog
from app.services.business import BusinessService
from app.services.base import ServiceContext

KEY = "w3f-live-abcdefghijklmnop-1234"


# --- secrecy ---------------------------------------------------------------
def test_mask_never_reveals_a_usable_key() -> None:
    masked = _mask_secret(KEY)
    assert masked is not None
    assert KEY not in masked
    assert masked.endswith("1234")  # enough to recognise WHICH key
    assert masked.startswith("•")


def test_short_secret_is_fully_masked() -> None:
    """A short key must not have half of itself printed as a 'hint'."""
    masked = _mask_secret("abcd")
    assert masked == "•" * 8
    assert "a" not in masked


def test_mask_of_absent_key_is_none() -> None:
    assert _mask_secret(None) is None


def test_key_is_not_written_to_the_audit_log(
    session: Session, ctx: ServiceContext, business: Business
) -> None:
    BusinessService(ctx).update(business.id, w3forms_access_key=KEY)

    entries = session.exec(select(AuditLog).where(AuditLog.entity_type == "business")).all()
    blob = " ".join(str(e.changes) for e in entries)
    assert KEY not in blob, "the raw key leaked into the audit trail"
    assert "***" in blob, "the audit trail should still record THAT it changed"


# --- storage + the three-state write ---------------------------------------
def test_key_is_stored(ctx: ServiceContext, business: Business) -> None:
    updated = BusinessService(ctx).update(business.id, w3forms_access_key=KEY)
    assert updated.w3forms_access_key == KEY


def test_empty_string_clears_the_key(ctx: ServiceContext, business: Business) -> None:
    """The UI never holds the key, so "" is the only way it can ask to remove one."""
    service = BusinessService(ctx)
    service.update(business.id, w3forms_access_key=KEY)
    cleared = service.update(business.id, w3forms_access_key="")
    assert cleared.w3forms_access_key is None


def test_omitting_the_field_leaves_the_key_alone(
    ctx: ServiceContext, business: Business
) -> None:
    """Saving the settings form without retyping the key must not wipe it."""
    service = BusinessService(ctx)
    service.update(business.id, w3forms_access_key=KEY)
    service.update(business.id, name="Renamed Store")  # key not supplied
    assert service.update(business.id).w3forms_access_key == KEY


# --- tenancy ---------------------------------------------------------------
def test_provider_uses_the_businesss_own_key(
    session: Session, business: Business, monkeypatch: pytest.MonkeyPatch
) -> None:
    business.w3forms_access_key = KEY
    session.add(business)
    session.flush()

    monkeypatch.setattr("app.email.service.get_provider", lambda: W3FormsProvider())
    resolved = EmailService(session)._provider_for(business)

    assert isinstance(resolved, W3FormsProvider)
    assert resolved.access_key == KEY, "business must send through its OWN key"


def test_falls_back_to_env_key_when_business_has_none(
    session: Session, business: Business, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A single-tenant install configured purely by env var must keep working."""
    business.w3forms_access_key = None
    monkeypatch.setattr("app.email.service.get_provider", lambda: W3FormsProvider("env-key"))

    resolved = EmailService(session)._provider_for(business)
    assert resolved.access_key == "env-key"


def test_two_businesses_do_not_share_a_key(
    session: Session, business: Business, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point: tenant A's owner mail must not go to tenant B's inbox."""
    other = Business(
        name="MeLe Store", slug="mele-store", email="owner@mele.bt", w3forms_access_key="key-B"
    )
    business.w3forms_access_key = "key-A"
    session.add_all([business, other])
    session.flush()

    monkeypatch.setattr("app.email.service.get_provider", lambda: W3FormsProvider())
    service = EmailService(session)

    assert service._provider_for(business).access_key == "key-A"
    assert service._provider_for(other).access_key == "key-B"
