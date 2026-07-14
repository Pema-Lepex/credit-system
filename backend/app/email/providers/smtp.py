"""SMTP provider -- the one that can actually email customers.

This is the drop-in upgrade from W3Forms. Set:

    EMAIL_PROVIDER=smtp
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=587
    SMTP_USER=you@example.com
    SMTP_PASSWORD=<app password>
    SMTP_USE_TLS=true

...and customer reminders, receipts and overdue notices start working with no other
code change: same templates, same rendering, same EmailLog.

WHY stdlib smtplib AND NOT aiosmtplib
-------------------------------------
aiosmtplib is not in requirements.txt, and adding a dependency for one file is a
poor trade when the standard library already does the job. ``smtplib`` is blocking,
so every call is wrapped in ``asyncio.to_thread``: the SMTP conversation (which can
take seconds against a slow relay) runs on a worker thread and the event loop keeps
serving requests. Swapping in aiosmtplib later is a change to ``_send_blocking``
only -- nothing outside this file knows.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
from email.message import EmailMessage as MIMEEmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import settings
from app.email.base import EmailMessage, EmailResult

logger = logging.getLogger(__name__)

_TIMEOUT_SECONDS = 20.0


class SMTPProvider:
    name = "smtp"
    can_send_to_arbitrary_recipients = True  # the whole point of this provider

    def __init__(self) -> None:
        self.host = settings.SMTP_HOST
        self.port = settings.SMTP_PORT
        self.user = settings.SMTP_USER
        self.password = settings.SMTP_PASSWORD
        self.use_tls = settings.SMTP_USE_TLS

    def _build_mime(self, msg: EmailMessage) -> tuple[MIMEEmailMessage, str]:
        """Build a proper multipart/alternative: text first, HTML second.

        Order matters -- a MIME client shows the LAST part it can render, so the
        plain-text fallback must precede the HTML. Clients that can't do HTML (and
        spam filters, which score text-only mail poorly) get a real message rather
        than an empty body.
        """
        mime = MIMEEmailMessage()
        message_id = make_msgid()

        from_address = msg.from_address or settings.EMAIL_FROM_ADDRESS
        from_name = msg.from_name or settings.EMAIL_FROM_NAME

        mime["Message-ID"] = message_id
        mime["From"] = formataddr((from_name, from_address))
        mime["To"] = formataddr((msg.to_name or "", msg.to_address))
        mime["Subject"] = msg.subject
        if msg.reply_to:
            mime["Reply-To"] = msg.reply_to

        # set_content -> text/plain, then add_alternative(subtype="html") promotes
        # the whole thing to multipart/alternative in the right order.
        mime.set_content(msg.text_body or "This message requires an HTML-capable email client.")
        mime.add_alternative(msg.html_body, subtype="html")
        return mime, message_id

    def _send_blocking(self, mime: MIMEEmailMessage) -> None:
        """The blocking SMTP conversation. Only ever called inside a thread."""
        assert self.host is not None  # guarded by send()

        if self.use_tls:
            # STARTTLS on the submission port (587): connect in the clear, then
            # upgrade. Port 465 is implicit TLS and needs SMTP_SSL instead.
            if self.port == 465:
                context = ssl.create_default_context()
                with smtplib.SMTP_SSL(
                    self.host, self.port, timeout=_TIMEOUT_SECONDS, context=context
                ) as server:
                    self._login_and_send(server, mime)
                return
            with smtplib.SMTP(self.host, self.port, timeout=_TIMEOUT_SECONDS) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()  # re-greet: the server's capability list changes after TLS
                self._login_and_send(server, mime)
            return

        with smtplib.SMTP(self.host, self.port, timeout=_TIMEOUT_SECONDS) as server:
            self._login_and_send(server, mime)

    def _login_and_send(self, server: smtplib.SMTP, mime: MIMEEmailMessage) -> None:
        # An open relay (local MailHog/Mailpit in dev) needs no credentials.
        if self.user and self.password:
            server.login(self.user, self.password)
        server.send_message(mime)

    async def send(self, msg: EmailMessage) -> EmailResult:
        if not self.host:
            return EmailResult.failed(
                self.name,
                "SMTP_HOST is not set. Configure SMTP_HOST/SMTP_PORT/SMTP_USER/"
                "SMTP_PASSWORD to send email.",
            )

        mime, message_id = self._build_mime(msg)
        try:
            # to_thread: smtplib is blocking, and the event loop must keep running.
            await asyncio.to_thread(self._send_blocking, mime)
        except smtplib.SMTPAuthenticationError as exc:
            return EmailResult.failed(
                self.name,
                f"SMTP authentication failed for {self.user!r}: {exc!r}. "
                "Gmail requires an app password, not the account password.",
            )
        except smtplib.SMTPRecipientsRefused as exc:
            return EmailResult.failed(
                self.name, f"Recipient refused by the server: {msg.to_address} ({exc!r})"
            )
        except (smtplib.SMTPException, OSError, ssl.SSLError) as exc:
            # OSError covers DNS failure / connection refused / timeout.
            logger.warning("SMTP send to %s failed: %r", msg.to_address, exc)
            return EmailResult.failed(self.name, f"SMTP send failed: {exc!r}")

        return EmailResult.ok(self.name, message_id=message_id)
