"""W3Forms provider -- the free tier. Owner notifications ONLY.

READ THIS BEFORE USING IT FOR CUSTOMER MAIL
-------------------------------------------
W3Forms (web3forms.com) is a *form-to-email relay*. You register an inbox, you get
an access key, and every submission carrying that key is delivered TO THAT INBOX.
The API has no recipient parameter. There is no way -- none -- to make it deliver a
message to a customer's address.

Consequences, stated plainly so nobody has to rediscover them:

  * Owner-facing mail (a new credit was created, a payment landed, an account is
    overdue, data is about to be deleted) works perfectly. The owner IS the
    registered inbox.
  * Customer-facing mail (payment reminders, receipts, overdue notices) DOES NOT
    WORK and cannot be made to work. ``can_send_to_arbitrary_recipients = False``
    declares that, and EmailService refuses such a send with an explicit error
    rather than dropping it on the floor.

THE FIX is ``EMAIL_PROVIDER=smtp`` with any SMTP account (Gmail, Brevo, Resend,
Mailgun -- all have usable free tiers). It is a drop-in: same interface, same
templates, same logs, and ``can_send_to_arbitrary_recipients = True``.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.core.config import settings
from app.email.base import EmailMessage, EmailResult

logger = logging.getLogger(__name__)

# W3Forms is a third party on the public internet: a hung socket must never hang a
# request thread or the nightly reminder sweep.
_TIMEOUT_SECONDS = 10.0
# One retry, for the transient-network case only (DNS blip, reset connection). An
# HTTP error or a {"success": false} body is a real rejection -- retrying it just
# doubles the latency before we report the same failure.
_RETRIES = 1
_RETRY_BACKOFF_SECONDS = 1.0


class W3FormsProvider:
    name = "w3forms"
    can_send_to_arbitrary_recipients = False  # see module docstring -- this is load-bearing

    def __init__(self, access_key: str | None = None) -> None:
        """``access_key`` overrides the environment with a specific business's key.

        This override is what makes W3Forms usable for more than one business. Because
        the key IS the destination inbox (there is no recipient field), a single
        environment key would funnel every tenant's owner notifications into one inbox.
        EmailService passes the business's own key here; the env var remains the
        fallback so a single-tenant install needs no database change.
        """
        self.access_key = access_key or settings.W3FORMS_ACCESS_KEY
        self.endpoint = settings.W3FORMS_ENDPOINT

    def _payload(self, msg: EmailMessage) -> dict[str, Any]:
        # W3Forms treats unknown keys as form fields and renders them in the relayed
        # email body, so the tags become a readable context block for the owner.
        payload: dict[str, Any] = {
            "access_key": self.access_key,
            "subject": msg.subject,
            "from_name": msg.from_name or settings.EMAIL_FROM_NAME,
            "message": msg.html_body,
            # Documented W3Forms extras.
            "botcheck": "",  # honeypot field must be present and empty
        }
        if msg.reply_to:
            payload["replyto"] = msg.reply_to
        # Record who this message was ABOUT, since we cannot address it to them.
        if msg.to_address:
            payload["intended_recipient"] = msg.to_display
        for key, value in msg.tags.items():
            if value is not None:
                payload[f"meta_{key}"] = str(value)
        return payload

    async def send(self, msg: EmailMessage) -> EmailResult:
        if not self.access_key:
            return EmailResult.failed(
                self.name,
                "W3FORMS_ACCESS_KEY is not set. Add it to the environment, or switch "
                "EMAIL_PROVIDER to smtp/console.",
            )

        payload = self._payload(msg)
        last_error = "unknown error"

        for attempt in range(_RETRIES + 1):
            try:
                async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                    response = await client.post(
                        self.endpoint,
                        json=payload,
                        headers={"Accept": "application/json"},
                    )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                # Transient by nature -- worth exactly one retry.
                last_error = f"network error contacting W3Forms: {exc!r}"
                if attempt < _RETRIES:
                    logger.warning("W3Forms send failed (%s); retrying", exc)
                    await asyncio.sleep(_RETRY_BACKOFF_SECONDS)
                    continue
                return EmailResult.failed(self.name, last_error)

            if response.status_code != 200:
                return EmailResult.failed(
                    self.name,
                    f"W3Forms returned HTTP {response.status_code}: {response.text[:300]}",
                )

            # W3Forms answers 200 OK with {"success": false, "message": "..."} for
            # an invalid key or a spam-flagged submission. A naive status-code check
            # would report those as delivered.
            try:
                body: dict[str, Any] = response.json()
            except ValueError:
                return EmailResult.failed(
                    self.name, f"W3Forms returned a non-JSON body: {response.text[:300]}"
                )

            if not body.get("success", False):
                return EmailResult.failed(
                    self.name, f"W3Forms rejected the submission: {body.get('message', body)}"
                )

            return EmailResult.ok(self.name, message_id=body.get("data") or body.get("message"))

        return EmailResult.failed(self.name, last_error)
