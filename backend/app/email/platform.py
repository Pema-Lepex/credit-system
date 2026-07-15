"""Platform-operator notifications -- mail to the super-admin, not to any tenant.

The one message here is "a new store owner just registered". It is delivered to the
super-admin's own inbox through W3Forms using SUPER_ADMIN_W3FORMS_ACCESS_KEY, which
is precisely what W3Forms is good at: the key IS the destination inbox, and that
inbox is the operator's. (This is owner-facing mail -- the case W3Forms CAN handle.)

It does NOT go through EmailService: that service is tenant-scoped (it loads the
business's templates, branding and per-business key). A platform notice belongs to
no tenant, so it talks to the provider directly.

BEST-EFFORT BY CONTRACT: a failure to notify must NEVER fail a registration. The
caller awaits this and it swallows every error into the log.
"""

from __future__ import annotations

import logging
from datetime import datetime

from app.core.config import settings
from app.email.base import EmailMessage
from app.email.providers.w3forms import W3FormsProvider

log = logging.getLogger("app.email.platform")


async def notify_super_admin_new_registration(
    *,
    business_name: str,
    owner_name: str,
    email: str,
    phone: str | None,
    registered_at: datetime,
) -> None:
    """Email the super-admin that a new store owner has registered. Never raises."""
    # The platform key first; fall back to the shared env key so a single-tenant
    # install with only W3FORMS_ACCESS_KEY set still gets the notice.
    key = settings.SUPER_ADMIN_W3FORMS_ACCESS_KEY or settings.W3FORMS_ACCESS_KEY
    if not key:
        log.info("No super-admin W3Forms key set; skipping new-registration notice.")
        return

    when = registered_at.strftime("%Y-%m-%d %H:%M UTC")
    html = (
        "<h2>New Store Owner Registration</h2>"
        "<p>A new store owner has just signed up and is awaiting approval.</p>"
        "<table cellpadding='6' style='border-collapse:collapse'>"
        f"<tr><td><b>Business Name</b></td><td>{business_name}</td></tr>"
        f"<tr><td><b>Owner Name</b></td><td>{owner_name}</td></tr>"
        f"<tr><td><b>Email</b></td><td>{email}</td></tr>"
        f"<tr><td><b>Phone</b></td><td>{phone or '—'}</td></tr>"
        f"<tr><td><b>Registration Date</b></td><td>{when}</td></tr>"
        "</table>"
        "<p>Open the Super Admin panel to review and approve this account.</p>"
    )

    msg = EmailMessage(
        to_address=settings.SUPER_ADMIN_EMAIL or "super-admin",
        to_name="Super Administrator",
        subject=f"New store owner registered: {business_name}",
        html_body=html,
        from_name=settings.EMAIL_FROM_NAME,
        from_address=settings.EMAIL_FROM_ADDRESS,
        # W3Forms renders unknown keys into the relayed email, so these become a
        # readable summary block even in a plain mail client.
        tags={
            "type": "new_registration",
            "business_name": business_name,
            "owner_name": owner_name,
            "email": email,
            "phone": phone or "",
            "registered_at": when,
        },
    )

    try:
        result = await W3FormsProvider(access_key=key).send(msg)
        if not result.success:
            log.warning("New-registration notice to super-admin failed: %s", result.error)
        else:
            log.info("New-registration notice sent to super-admin for %s", business_name)
    except Exception:  # noqa: BLE001 -- a notification must never break registration
        log.exception("New-registration notice raised")
