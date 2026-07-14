"""Console provider -- writes the rendered email to the log and always succeeds.

The default in development and tests. It is declared
``can_send_to_arbitrary_recipients = True`` on purpose: it "delivers" everything, so
the capability guard in EmailService must never block a dev run. What it must not do
is run in production -- ``Settings.assert_production_ready()`` refuses to boot with
EMAIL_PROVIDER=console for exactly that reason.
"""

from __future__ import annotations

import logging
import uuid

from app.email.base import EmailMessage, EmailResult

logger = logging.getLogger("app.email.console")


class ConsoleProvider:
    name = "console"
    can_send_to_arbitrary_recipients = True

    async def send(self, msg: EmailMessage) -> EmailResult:
        message_id = f"console-{uuid.uuid4().hex[:16]}"
        logger.info(
            "\n"
            "===================== EMAIL (console provider) =====================\n"
            "To:       %s\n"
            "From:     %s\n"
            "Reply-To: %s\n"
            "Subject:  %s\n"
            "Tags:     %s\n"
            "--------------------------- TEXT ----------------------------------\n"
            "%s\n"
            "--------------------------- HTML (%d bytes) -----------------------\n"
            "%s\n"
            "====================================================================",
            msg.to_display,
            msg.from_name or "-",
            msg.reply_to or "-",
            msg.subject,
            msg.tags or {},
            msg.text_body or "(none)",
            len(msg.html_body),
            msg.html_body,
        )
        return EmailResult.ok(self.name, message_id=message_id)
