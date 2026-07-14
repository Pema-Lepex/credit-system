"""Concrete transports implementing ``app.email.base.EmailProvider``.

    console  -> logs the email; always succeeds.          (dev/tests)
    w3forms  -> free relay; OWNER inbox only.             can_send_to_arbitrary_recipients=False
    smtp     -> any SMTP server; reaches customers.       can_send_to_arbitrary_recipients=True

Selection happens in ``app.email.service.get_provider()`` from settings.EMAIL_PROVIDER.
Nothing outside that factory should import a provider class directly.
"""

from __future__ import annotations

from app.email.providers.console import ConsoleProvider
from app.email.providers.smtp import SMTPProvider
from app.email.providers.w3forms import W3FormsProvider

__all__ = ["ConsoleProvider", "SMTPProvider", "W3FormsProvider"]
