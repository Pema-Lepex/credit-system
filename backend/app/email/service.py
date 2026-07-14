"""EmailService -- template + branding + provider + audit log, in one place.

THE CAPABILITY GUARD (the thing this module exists to get right)
----------------------------------------------------------------
W3Forms cannot email a customer (see providers/w3forms.py). The temptation, when the
configured provider cannot reach the intended recipient, is to send it *somewhere*
(to the owner, say) and return success. That is the worst possible behaviour: the
reminder never reaches the customer, the credit goes unpaid, and the system says it
did its job.

So instead, ``send_templated`` checks ``provider.can_send_to_arbitrary_recipients``
BEFORE dispatch, and a customer-bound message on a relay-only provider fails
explicitly: an ``EmailLog`` row with ``success=False`` and an error naming both the
cause and the cure ("configure SMTP"). The failure is visible in the email log, on
the reminder row, and in the owner's notification centre.

The upgrade path is one environment variable: ``EMAIL_PROVIDER=smtp``.

EVERY send writes an EmailLog row -- success, provider rejection, capability refusal,
or unexpected exception. The log is the audit trail; a path that skips it is a bug.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlmodel import Session

from app.core.config import EmailProvider as ProviderKind
from app.core.config import settings
from app.email.base import EmailMessage, EmailProvider, EmailResult
from app.email.renderer import render_email, render_raw
from app.models.business import Business
from app.models.communication import EmailLog
from app.models.enums import EmailTemplateKind, ReminderChannel

logger = logging.getLogger(__name__)

_provider: EmailProvider | None = None


def get_provider() -> EmailProvider:
    """Resolve the configured transport. Cached -- construction reads settings and,
    for SMTP, may build TLS context state we do not want to rebuild per email."""
    global _provider
    if _provider is None:
        if settings.EMAIL_PROVIDER is ProviderKind.w3forms:
            from app.email.providers.w3forms import W3FormsProvider

            _provider = W3FormsProvider()
        elif settings.EMAIL_PROVIDER is ProviderKind.smtp:
            from app.email.providers.smtp import SMTPProvider

            _provider = SMTPProvider()
        else:
            from app.email.providers.console import ConsoleProvider

            _provider = ConsoleProvider()
    return _provider


def reset_provider() -> None:
    """Test hook -- drop the cached provider so a new EMAIL_PROVIDER takes effect."""
    global _provider
    _provider = None


def _capability_error(provider_name: str, to_address: str, kind: EmailTemplateKind | None) -> str:
    what = f"the {kind.value} email" if kind else "this email"
    return (
        f"NOT SENT. The '{provider_name}' provider cannot deliver to arbitrary recipients: "
        f"W3Forms is a form-to-email relay and delivers only to the inbox registered against "
        f"the access key, so {what} for {to_address} could not be delivered. Customer-facing "
        f"email requires a real mail transport: set EMAIL_PROVIDER=smtp and configure "
        f"SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD. Owner notifications continue to "
        f"work on W3Forms."
    )


class EmailService:
    def __init__(self, session: Session, provider: EmailProvider | None = None) -> None:
        self.session = session
        self.provider = provider or get_provider()

    # -- recipient classification -------------------------------------------
    def _is_owner_recipient(self, business: Business, to_address: str) -> bool:
        """Is this address the business's own inbox (i.e. the one a relay reaches)?

        A relay-only provider can serve exactly one address, and this is our best
        knowledge of which. Callers that know better (the reminder sweep knows it is
        mailing the owner) pass ``owner_recipient=True`` explicitly rather than
        relying on this guess.
        """
        candidates = {
            (business.email or "").strip().lower(),
            (business.email_reply_to or "").strip().lower(),
            (settings.EMAIL_FROM_ADDRESS or "").strip().lower(),
        }
        candidates.discard("")
        return to_address.strip().lower() in candidates

    # -- logging -------------------------------------------------------------
    def _log(
        self,
        *,
        business_id: str,
        result: EmailResult,
        to_address: str,
        to_name: str | None,
        subject: str,
        body_preview: str,
        kind: EmailTemplateKind | None,
        credit_id: str | None = None,
        customer_id: str | None = None,
        payment_id: str | None = None,
    ) -> EmailLog:
        """Append the delivery record. Called on EVERY path, including exceptions.

        Flushes but does not commit -- the caller owns the transaction (a request, or
        the scheduler's ``session_scope``), and the log must land in the same
        transaction as the ScheduledReminder status it explains.
        """
        entry = EmailLog(
            business_id=business_id,
            template_kind=kind,
            channel=ReminderChannel.EMAIL,
            provider=result.provider,
            to_address=to_address[:255],
            to_name=(to_name or None) and to_name[:160],
            subject=subject[:300],
            body_preview=body_preview[:500],
            success=result.success,
            error=result.error[:1000] if result.error else None,
            provider_message_id=result.message_id[:200] if result.message_id else None,
            credit_id=credit_id,
            customer_id=customer_id,
            payment_id=payment_id,
        )
        self.session.add(entry)
        self.session.flush()
        return entry

    # -- dispatch ------------------------------------------------------------
    async def _dispatch(
        self,
        *,
        business: Business,
        msg: EmailMessage,
        kind: EmailTemplateKind | None,
        owner_recipient: bool,
        credit_id: str | None = None,
        customer_id: str | None = None,
        payment_id: str | None = None,
    ) -> EmailResult:
        """Guard, send, log. The single choke point every outbound email passes."""
        preview = msg.text_body or msg.html_body

        # THE GUARD. Refuse loudly rather than pretend.
        if not self.provider.can_send_to_arbitrary_recipients and not owner_recipient:
            result = EmailResult.failed(
                self.provider.name, _capability_error(self.provider.name, msg.to_address, kind)
            )
            logger.error(
                "Blocked %s email to %s: provider %r cannot reach arbitrary recipients",
                kind.value if kind else "raw",
                msg.to_address,
                self.provider.name,
            )
            self._log(
                business_id=business.id,
                result=result,
                to_address=msg.to_address,
                to_name=msg.to_name,
                subject=msg.subject,
                body_preview=preview,
                kind=kind,
                credit_id=credit_id,
                customer_id=customer_id,
                payment_id=payment_id,
            )
            return result

        try:
            result = await self.provider.send(msg)
        except Exception as exc:  # noqa: BLE001 -- a provider bug must still be audited
            logger.exception("Email provider %r raised", self.provider.name)
            result = EmailResult.failed(self.provider.name, f"provider raised: {exc!r}")

        self._log(
            business_id=business.id,
            result=result,
            to_address=msg.to_address,
            to_name=msg.to_name,
            subject=msg.subject,
            body_preview=preview,
            kind=kind,
            credit_id=credit_id,
            customer_id=customer_id,
            payment_id=payment_id,
        )
        return result

    # -- public API ----------------------------------------------------------
    async def send_templated(
        self,
        session: Session,
        business: Business,
        kind: EmailTemplateKind,
        to_address: str,
        to_name: str | None,
        context: dict[str, Any],
        *,
        credit_id: str | None = None,
        customer_id: str | None = None,
        payment_id: str | None = None,
        owner_recipient: bool | None = None,
    ) -> EmailResult:
        """Load the template, render it, check reachability, send, log.

        ``owner_recipient`` overrides the address-based guess about whether this mail
        is bound for the business's own inbox; it is what tells a relay-only provider
        that this particular send is legitimate. Leave it ``None`` to infer.

        Never raises for a delivery failure -- returns ``EmailResult(success=False)``
        so the caller (reminder sweep, payment flow) can record and continue.
        """
        # ``session`` is in the signature because callers pass theirs explicitly; if
        # it differs from the one this service was built with, honour the caller's.
        if session is not self.session:
            self.session = session

        # Imported here, not at module scope: services/templates.py imports the
        # renderer (via app.email), so a top-level import would close a cycle.
        from app.services.templates import TemplateService

        template = TemplateService(self.session).get_by_kind(business.id, kind)

        if not template.is_active:
            result = EmailResult.failed(
                self.provider.name,
                f"The {kind.value} template is switched off for this business.",
            )
            self._log(
                business_id=business.id,
                result=result,
                to_address=to_address,
                to_name=to_name,
                subject=f"[disabled] {kind.value}",
                body_preview="",
                kind=kind,
                credit_id=credit_id,
                customer_id=customer_id,
                payment_id=payment_id,
            )
            return result

        # Resolve the logo here (needs a session) so the renderer stays pure.
        ctx = dict(context)
        if "logo_url" not in ctx:
            ctx["logo_url"] = self._logo_url(template.logo_file_id or business.logo_file_id)

        subject, html_body, text_body = render_email(template, business, ctx)

        msg = EmailMessage(
            to_address=to_address,
            to_name=to_name,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            from_name=business.email_from_name or business.name or settings.EMAIL_FROM_NAME,
            from_address=settings.EMAIL_FROM_ADDRESS,
            reply_to=business.email_reply_to or business.email,
            tags={
                "template_kind": kind.value,
                "business_id": business.id,
                "credit_id": credit_id,
                "customer_id": customer_id,
                "payment_id": payment_id,
            },
        )

        is_owner = (
            owner_recipient
            if owner_recipient is not None
            else self._is_owner_recipient(business, to_address)
        )
        return await self._dispatch(
            business=business,
            msg=msg,
            kind=kind,
            owner_recipient=is_owner,
            credit_id=credit_id,
            customer_id=customer_id,
            payment_id=payment_id,
        )

    async def send_raw(
        self,
        session: Session,
        business: Business,
        *,
        to_address: str,
        subject: str,
        body_html: str,
        to_name: str | None = None,
        owner_recipient: bool | None = None,
        credit_id: str | None = None,
        customer_id: str | None = None,
        payment_id: str | None = None,
    ) -> EmailResult:
        """Send system mail that has no EmailTemplate row (password reset, test send).

        Still branded, still logged, still guarded -- it takes the same path as
        templated mail, minus the template lookup.
        """
        if session is not self.session:
            self.session = session

        subject, html_body, text_body = render_raw(
            subject=subject,
            body_html=body_html,
            business=business,
            logo_url=self._logo_url(business.logo_file_id),
        )

        msg = EmailMessage(
            to_address=to_address,
            to_name=to_name,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
            from_name=business.email_from_name or business.name or settings.EMAIL_FROM_NAME,
            from_address=settings.EMAIL_FROM_ADDRESS,
            reply_to=business.email_reply_to or business.email,
            tags={"business_id": business.id, "raw": True},
        )

        is_owner = (
            owner_recipient
            if owner_recipient is not None
            else self._is_owner_recipient(business, to_address)
        )
        return await self._dispatch(
            business=business,
            msg=msg,
            kind=None,
            owner_recipient=is_owner,
            credit_id=credit_id,
            customer_id=customer_id,
            payment_id=payment_id,
        )

    # -- helpers -------------------------------------------------------------
    def _logo_url(self, file_id: str | None) -> str | None:
        """Absolute-ish URL for the logo, or None. A broken logo must never break a
        send, so any storage failure degrades to the text header."""
        if not file_id:
            return None
        try:
            from app.storage.service import StorageService

            return StorageService(self.session).url_for_id(file_id)
        except Exception:  # noqa: BLE001
            logger.warning("Could not resolve logo %s; sending without it", file_id)
            return None
