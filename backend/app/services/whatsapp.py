"""WhatsAppService -- compose a click-to-chat link for a credit reminder.

WHAT THIS IS, AND WHAT IT IS DEFINITELY NOT
--------------------------------------------
This does NOT send anything. It cannot. It builds a `https://wa.me/<number>?text=…`
link; the owner opens it, WhatsApp appears with the message already written, and
THEY tap Send. Every message costs a human tap.

That is not a shortcoming to be engineered away -- it is the entire reason this is
free. The alternatives, and why they are not here:

  * WhatsApp Cloud API -- can send from a server, unattended. But since 2025-07-01
    Meta bills per message, and a payment reminder is the exact case they bill for:
    a business-initiated utility template with no open 24-hour customer service
    window. It also needs Meta business verification and a dedicated number that
    can no longer be used in the normal WhatsApp app -- a real loss for a shop with
    one phone. If a shop wants unattended sending, that is the upgrade, and it
    slots in as another provider behind ReminderChannel.WHATSAPP.
  * Baileys / whatsapp-web.js -- free and unattended by driving a real WhatsApp
    session. Against WhatsApp's ToS, and the ban lands on the SHOP'S number, not
    ours. We will not gamble a customer's business line to save a cent.

WHO THE MESSAGE COMES FROM
--------------------------
Whichever WhatsApp account is signed in on the device that opens the link. NOT
`business.whatsapp_number` -- a wa.me link has no sender parameter, so that field
cannot influence delivery and is never read here. If a STAFF user opens the link on
their own phone, it sends from their personal number. Nothing in the link can
prevent that; the UI says so rather than implying otherwise.

WHY A BAD NUMBER IS AN ERROR AND NOT A GUESS
--------------------------------------------
wa.me needs a full international number. Given the local number "17723391" there is
no sound way to infer the country: `business.country` is free text, and recovering a
dial code from the shop's own number needs a code table we do not have. Guessing
wrong sends a customer's payment details to a stranger who happens to own that
number in another country. So we refuse, and name the fix.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import quote

from app.core.errors import NotFoundError, ValidationError
from app.core.security import Permission
from app.email.renderer import html_to_text, render
from app.models.business import Business
from app.models.credit import Credit
from app.models.customer import Customer
from app.models.enums import AuditAction, CreditStatus, EmailTemplateKind
from app.services.base import BaseService
from app.services.templates import TemplateService
from app.utils.dates import today_in

# WhatsApp itself accepts far more, but a wa.me URL travels through the browser's
# address bar and some Android intent handlers truncate long ones. A reminder that
# needs more than this is not a reminder.
MAX_MESSAGE_CHARS = 1500

_NON_DIAL = re.compile(r"[^\d+]")


@dataclass(frozen=True, slots=True)
class WhatsAppLink:
    """Everything the UI needs to offer one tap-to-send reminder."""

    url: str
    text: str
    to_phone: str  # E.164 digits, no '+', as wa.me wants it
    customer_name: str


class WhatsAppService(BaseService):
    def reminder_link(self, credit_id: str) -> WhatsAppLink:
        """Build the click-to-chat link for one credit's reminder.

        Requires REMINDER_SEND -- the same permission as sending one by email. It
        composes a message addressed to a customer on the shop's behalf, which is
        the same act regardless of which app carries it.
        """
        self.require(Permission.REMINDER_SEND)

        credit = self.session.get(Credit, credit_id)
        if credit is None or credit.deleted_at is not None:
            raise NotFoundError("Credit record not found")
        self.assert_in_scope(credit.business_id)

        customer = self.session.get(Customer, credit.customer_id)
        if customer is None or customer.deleted_at is not None:
            raise NotFoundError("Customer not found")

        business = self.get_business()
        phone = self._resolve_phone(customer)
        text = self._compose(business, credit, customer)

        # quote() with no safe list: a '&' or '#' in a shop's name would otherwise
        # terminate the query string and silently truncate the message.
        url = f"https://wa.me/{phone}?text={quote(text, safe='')}"

        self.audit(
            AuditAction.REMINDER,
            "credit",
            credit.id,
            f"WhatsApp reminder composed for {customer.name} ({credit.number})",
        )
        return WhatsAppLink(url=url, text=text, to_phone=phone, customer_name=customer.name)

    # -- phone ---------------------------------------------------------------
    def _resolve_phone(self, customer: Customer) -> str:
        if not customer.phone or not customer.phone.strip():
            raise ValidationError(
                f"{customer.name} has no phone number. Add one in international "
                f"format (e.g. +975 17 72 33 91) before sending a WhatsApp reminder.",
                field="phone",
            )
        phone = normalize_phone(customer.phone)
        if phone is None:
            raise ValidationError(
                f"'{customer.phone}' has no country code, so WhatsApp cannot tell which "
                f"country it belongs to. Edit {customer.name} and save the number in "
                f"international format, e.g. +975 17 72 33 91.",
                field="phone",
            )
        return phone

    # -- message -------------------------------------------------------------
    def _compose(self, business: Business, credit: Credit, customer: Customer) -> str:
        """Render the owner's WhatsApp template down to plain text.

        Deliberately the SAME template machinery the emails use, so the copy stays
        editable from the admin panel (a hardcoded message here would be exactly
        the thing the spec forbids). It is a separate template kind rather than a
        reuse of REMINDER because the email one says "reply to this email" and runs
        to several paragraphs -- correct in an inbox, wrong in a chat.
        """
        kind = (
            EmailTemplateKind.WHATSAPP_OVERDUE
            if CreditStatus(credit.status) is CreditStatus.OVERDUE
            else EmailTemplateKind.WHATSAPP_REMINDER
        )
        template = TemplateService(self.session).get_by_kind(business.id, kind)

        # escape=False: this is plain text bound for a chat, not HTML. Escaping here
        # would put a literal "&amp;" in the shop's name in front of the customer.
        body = render(template.body_html, self._context(business, credit, customer), escape=False)
        text = html_to_text(body).strip()

        if len(text) > MAX_MESSAGE_CHARS:
            text = text[: MAX_MESSAGE_CHARS - 1].rstrip() + "…"
        return text

    def _context(
        self, business: Business, credit: Credit, customer: Customer
    ) -> dict[str, str]:
        today = today_in(business.timezone)
        days = (credit.due_date - today).days
        money = _money(business)
        return {
            "customer_name": customer.name,
            "customer_phone": customer.phone or "",
            "business_name": business.name,
            "business_phone": business.phone or "",
            "credit_number": credit.number,
            "amount": money(credit.grand_total),
            "amount_paid": money(credit.amount_paid),
            "remaining": money(credit.remaining_amount),
            "due_date": credit.due_date.strftime("%d %b %Y"),
            "days_until_due": str(max(0, days)),
            "days_overdue": str(abs(min(0, days))),
        }


def _money(business: Business):
    symbol = business.currency_symbol or business.currency

    def fmt(value) -> str:
        return f"{symbol} {value:,.2f}"

    return fmt


def normalize_phone(raw: str) -> str | None:
    """A phone number as wa.me wants it: digits only, country code included, no '+'.

    Returns None when the number is not in international format -- the caller turns
    that into an error naming the customer. See the module docstring for why this
    never guesses a country.
    """
    if not raw:
        return None
    compact = _NON_DIAL.sub("", raw.strip())

    if compact.startswith("+"):
        digits = compact[1:]
    elif compact.startswith("00"):
        # The other international prefix: 00975… is the same as +975….
        digits = compact[2:]
    else:
        return None

    # 7 is the shortest national number in use anywhere; 15 is E.164's hard ceiling.
    # Anything outside that is a typo, and a typo here reaches a stranger.
    if not digits.isdigit() or not (7 <= len(digits) <= 15):
        return None
    return digits


__all__ = ["MAX_MESSAGE_CHARS", "WhatsAppLink", "WhatsAppService", "normalize_phone"]
