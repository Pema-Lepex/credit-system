"""TemplateService -- the seeds, and the CRUD around them.

ARCHITECTURE NOTE (spec: "do NOT hardcode email templates")
------------------------------------------------------------
This module is the ONLY place default email copy exists. Templates are DB rows; a
new business is seeded with one row per ``EmailTemplateKind`` on first login, and
from that moment the owner owns every word. Editing a template flips ``is_default``
to False, which is what lets ``reset_to_default`` know it has something to restore
and what stops a future seed run from clobbering an owner's edits.

ON THE COPY ITSELF
------------------
A payment reminder is a delicate thing. The shop owner will see this customer again
next week -- these emails have to sound like a person who wants to be paid AND wants
to keep the relationship. So: no threats, no red, no capital letters, no "IMMEDIATE
ACTION REQUIRED". State the number, state the date, offer help, thank them. The
overdue notice is firmer, but it still assumes the customer simply forgot, because
they usually have.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlmodel import Session, select

from app.core.errors import NotFoundError
from app.email.renderer import render_email
from app.models.business import Business
from app.models.communication import EmailTemplate
from app.models.enums import EmailTemplateKind

# --- Shared inline styles for the seed copy -------------------------------------
# The renderer leaves real HTML alone, so the defaults ship as HTML. Inline styles
# only: Outlook and Gmail cannot be relied on to honour a <style> block.
_P = 'style="margin:0 0 16px 0;"'
_LEAD = 'style="margin:0 0 20px 0;font-size:17px;line-height:26px;"'
_MUTED = 'style="margin:0 0 16px 0;color:#6b7280;font-size:13px;line-height:20px;"'


def _summary(rows: list[tuple[str, str]], *, highlight: int | None = None) -> str:
    """A key/value panel (table-based -- it has to survive Outlook)."""
    cells = []
    for index, (label, value) in enumerate(rows):
        weight = "700" if index == highlight else "500"
        size = "18px" if index == highlight else "15px"
        cells.append(
            f'<tr>'
            f'<td style="padding:6px 0;font-size:14px;color:#6b7280;">{label}</td>'
            f'<td align="right" style="padding:6px 0;font-size:{size};font-weight:{weight};'
            f'color:#111827;">{value}</td>'
            f"</tr>"
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'bgcolor="#f9fafb" style="background-color:#f9fafb;border:1px solid #e5e7eb;'
        'border-radius:10px;margin:0 0 20px 0;"><tr><td style="padding:16px 20px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="font-family:Helvetica,Arial,sans-serif;">'
        + "".join(cells)
        + "</table></td></tr></table>"
    )


@dataclass(frozen=True, slots=True)
class _DefaultTemplate:
    kind: EmailTemplateKind
    name: str
    subject: str
    body_html: str
    signature: str | None = None


# --------------------------------------------------------------------------
# THE DEFAULT COPY -- the only place it lives
# --------------------------------------------------------------------------
DEFAULT_TEMPLATES: tuple[_DefaultTemplate, ...] = (
    _DefaultTemplate(
        kind=EmailTemplateKind.REMINDER,
        name="Payment reminder",
        subject="A friendly reminder from {{business_name}} — {{amount}} due {{due_date}}",
        body_html=(
            f"<p {_LEAD}>Hello {{{{customer_name}}}},</p>"
            f"<p {_P}>Just a gentle reminder that a payment to {{{{business_name}}}} is coming "
            f"up in <strong>{{{{days_until_due}}}} days</strong>. Here are the details, so you "
            f"have everything in one place:</p>"
            + _summary(
                [
                    ("Reference", "{{credit_number}}"),
                    ("Original amount", "{{amount}}"),
                    ("Already paid", "{{amount_paid}}"),
                    ("Due date", "{{due_date}}"),
                    ("Amount still due", "{{remaining}}"),
                ],
                highlight=4,
            )
            + f"<p {_P}>If you have already sent this payment, thank you — please ignore this "
            f"message, and our apologies for the crossed wires.</p>"
            f"<p {_P}>If anything about this doesn't look right, or if the timing is difficult "
            f"this month, just reply to this email or call us on {{{{business_phone}}}}. We are "
            f"always happy to work something out.</p>"
            f"<p {_P}>Thank you for your custom — we appreciate it.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.OVERDUE_NOTICE,
        name="Overdue notice",
        subject="Payment overdue — {{remaining}} on {{credit_number}}",
        body_html=(
            f"<p {_LEAD}>Hello {{{{customer_name}}}},</p>"
            f"<p {_P}>Our records show that a payment to {{{{business_name}}}} was due on "
            f"<strong>{{{{due_date}}}}</strong> and is still outstanding. We know these things "
            f"are easy to lose track of, so here is a summary:</p>"
            + _summary(
                [
                    ("Reference", "{{credit_number}}"),
                    ("Was due", "{{due_date}}"),
                    ("Already paid", "{{amount_paid}}"),
                    ("Amount outstanding", "{{remaining}}"),
                ],
                highlight=3,
            )
            + f"<p {_P}>Could you let us know when you expect to settle this? A short reply is "
            f"all we need — and if paying the full amount at once is difficult right now, please "
            f"tell us. We would much rather agree a plan with you than let this sit.</p>"
            f"<p {_P}>You can reach us any time on {{{{business_phone}}}} or at "
            f"{{{{business_email}}}}.</p>"
            f"<p {_P}>If your payment is already on its way, please accept our thanks and "
            f"disregard this notice.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.PAYMENT_CONFIRMATION,
        name="Payment confirmation",
        subject="Thank you — we received your payment of {{payment_amount}}",
        body_html=(
            f"<p {_LEAD}>Thank you, {{{{customer_name}}}}.</p>"
            f"<p {_P}>We have received your payment of <strong>{{{{payment_amount}}}}</strong> "
            f"and it has been applied to your account.</p>"
            + _summary(
                [
                    ("Reference", "{{credit_number}}"),
                    ("Payment received", "{{payment_amount}}"),
                    ("Date", "{{payment_date}}"),
                    ("Method", "{{payment_method}}"),
                    ("Remaining balance", "{{remaining}}"),
                ],
                highlight=4,
            )
            + f"<p {_P}>If the remaining balance above shows zero, your account is fully settled "
            f"— thank you for taking care of it.</p>"
            f"<p {_P}>Any questions, just reply to this email or call {{{{business_phone}}}}.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.RECEIPT,
        name="Payment receipt",
        subject="Your receipt from {{business_name}} — {{payment_amount}}",
        body_html=(
            f"<p {_LEAD}>Hello {{{{customer_name}}}},</p>"
            f"<p {_P}>Here is your receipt for the payment you made to {{{{business_name}}}}. "
            f"Please keep it for your records.</p>"
            + _summary(
                [
                    ("Receipt for", "{{invoice_number}}"),
                    ("Credit reference", "{{credit_number}}"),
                    ("Date", "{{payment_date}}"),
                    ("Method", "{{payment_method}}"),
                    ("Total credit", "{{grand_total}}"),
                    ("Paid to date", "{{amount_paid}}"),
                    ("Amount paid", "{{payment_amount}}"),
                ],
                highlight=6,
            )
            + f"<p {_P}>Outstanding balance after this payment: "
            f"<strong>{{{{remaining}}}}</strong>.</p>"
            f"<p {_MUTED}>This receipt was generated automatically. If any detail is wrong, "
            f"please contact us at {{{{business_email}}}} and we will correct it.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.WELCOME,
        name="Welcome",
        subject="Welcome to {{business_name}}",
        body_html=(
            f"<p {_LEAD}>Welcome, {{{{customer_name}}}}.</p>"
            f"<p {_P}>Thank you for opening an account with {{{{business_name}}}}. We have you "
            f"on our books, and from now on you will be able to take goods and services on "
            f"credit and settle up when it suits you.</p>"
            f"<p {_P}>A few things worth knowing:</p>"
            f'<ul style="margin:0 0 16px 0;padding-left:20px;color:#1f2937;">'
            f'<li style="margin:0 0 8px 0;">We will send you a friendly reminder a few days '
            f"before anything is due — you will never be caught out.</li>"
            f'<li style="margin:0 0 8px 0;">Every payment you make gets a receipt by '
            f"email.</li>"
            f'<li style="margin:0 0 8px 0;">If you ever need more time, tell us early. We are '
            f"reasonable people.</li>"
            f"</ul>"
            f"<p {_P}>You can always reach us on {{{{business_phone}}}} or at "
            f"{{{{business_email}}}}.</p>"
            f"<p {_P}>We are glad to have you with us.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.ADMIN_NOTIFICATION,
        name="Owner notification",
        # This template is a DIGEST, not a single-credit alert. ReminderService batches
        # every credit due on a given day into ONE email to the owner -- a shopkeeper
        # with 40 credits due tomorrow needs one summary, not forty notifications. The
        # variables here are therefore the batch ones (record_count, amount,
        # credit_summary), NOT customer_name/credit_number, which have no meaning when
        # the mail is about many customers at once.
        subject="{{business_name}}: {{record_count}} credit(s) due — {{amount}} outstanding",
        body_html=(
            f"<p {_LEAD}>You have {{{{record_count}}}} credit(s) coming due</p>"
            f"<p {_P}>Here is today's summary from your Credit Management System. The "
            f"customers below have been reminded automatically where an email address is "
            f"on file.</p>"
            + _summary(
                [
                    ("Credits due", "{{record_count}}"),
                    ("Total outstanding", "{{amount}}"),
                ],
                highlight=1,
            )
            # The per-credit detail is rendered inside a <pre> block. The renderer
            # HTML-escapes every substituted value (it must -- templates are
            # user-authored, and unescaped injection would be an XSS hole), which
            # would swallow a <br>. Inside <pre>, newlines survive escaping and the
            # list still lays out correctly.
            + '<pre style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;'
            'font-size:13px;line-height:1.6;background:#F4F4F5;color:#18181B;'
            'padding:16px;border-radius:10px;overflow-x:auto;white-space:pre-wrap;'
            'margin:16px 0;">{{credit_summary}}</pre>'
            + f"<p {_MUTED}>You are receiving this because owner notifications are switched on "
            f"in your business settings. You can change which events notify you, or turn them "
            f"off entirely, in Settings &rarr; Reminders.</p>"
        ),
    ),
    _DefaultTemplate(
        kind=EmailTemplateKind.DATA_DELETION_WARNING,
        name="Data deletion warning",
        subject="Action needed: {{record_count}} records will be deleted on {{deletion_date}}",
        body_html=(
            f"<p {_LEAD}>Your archived records are about to be deleted.</p>"
            f"<p {_P}>Under your retention policy, <strong>{{{{record_count}}}} archived "
            f"records</strong> belonging to {{{{business_name}}}} are scheduled for permanent "
            f"deletion on <strong>{{{{deletion_date}}}}</strong>.</p>"
            + _summary(
                [
                    ("Records affected", "{{record_count}}"),
                    ("Deletion date", "{{deletion_date}}"),
                    ("Storage in use", "{{storage_used}}"),
                ],
                highlight=1,
            )
            + f"<p {_P}>This cannot be undone once it happens. You have three options, and doing "
            f"nothing chooses the first one:</p>"
            f'<ul style="margin:0 0 16px 0;padding-left:20px;color:#1f2937;">'
            f'<li style="margin:0 0 8px 0;"><strong>Let them go.</strong> They will be deleted '
            f"on the date above.</li>"
            f'<li style="margin:0 0 8px 0;"><strong>Download them first.</strong> Export a full '
            f"copy from the archive page before the date.</li>"
            f'<li style="margin:0 0 8px 0;"><strong>Postpone or restore.</strong> Push the '
            f"deletion back, or bring the records back into your active list.</li>"
            f"</ul>"
            f"<p {_MUTED}>Retention keeps your database small and fast. You can change the "
            f"policy at any time in Settings &rarr; Data &amp; retention.</p>"
        ),
    ),
)

_DEFAULTS_BY_KIND: dict[EmailTemplateKind, _DefaultTemplate] = {
    t.kind: t for t in DEFAULT_TEMPLATES
}

# Every kind must have a seed, or a business would hit "template not found" at the
# worst possible moment (mid reminder sweep). Fail at import, not at send time.
assert set(_DEFAULTS_BY_KIND) == set(EmailTemplateKind), (
    "Every EmailTemplateKind needs a default template: missing "
    f"{set(EmailTemplateKind) - set(_DEFAULTS_BY_KIND)}"
)


# --------------------------------------------------------------------------
# Seeding
# --------------------------------------------------------------------------
def seed_default_templates(session: Session, business_id: str) -> list[EmailTemplate]:
    """Create the default template set for a business. Idempotent.

    Called once per business at signup (app/services/auth.py imports this by name).
    Idempotent because a business must never end up with two templates of one kind
    (there is a unique constraint) and because re-running the seeder after a new
    EmailTemplateKind is added should backfill only the missing kinds -- never
    overwrite copy the owner has edited.

    Does NOT commit: the caller owns the transaction, so signup stays atomic.
    """
    existing_kinds = {
        row.kind
        for row in session.exec(
            select(EmailTemplate).where(EmailTemplate.business_id == business_id)
        ).all()
    }

    created: list[EmailTemplate] = []
    for default in DEFAULT_TEMPLATES:
        if default.kind in existing_kinds:
            continue
        template = EmailTemplate(
            business_id=business_id,
            kind=default.kind,
            name=default.name,
            subject=default.subject,
            body_html=default.body_html,
            signature=default.signature,
            footer_html=None,   # NULL -> renderer builds the standard footer from the business
            primary_color=None,  # NULL -> inherit business.brand_color
            show_logo=True,
            is_active=True,
            is_default=True,
        )
        session.add(template)
        created.append(template)

    session.flush()
    return created


# --------------------------------------------------------------------------
# Preview sample data
# --------------------------------------------------------------------------
def sample_context(business: Business) -> dict[str, Any]:
    """Realistic sample values, so the editor preview looks like a real email.

    Uses the business's own currency and contact details -- a preview showing "$" to
    a shop that trades in Ngultrum is a preview that teaches the owner nothing.
    """
    symbol = business.currency_symbol or business.currency
    today = date.today()
    due = today + timedelta(days=3)

    return {
        "customer_name": "Dorji Wangchuk",
        "customer_phone": "+975 17 12 34 56",
        "customer_email": "dorji.wangchuk@example.com",
        "amount": f"{symbol} 2,450.00",
        "grand_total": f"{symbol} 2,450.00",
        "amount_paid": f"{symbol} 1,250.00",
        "remaining": f"{symbol} 1,200.00",
        "payment_amount": f"{symbol} 1,250.00",
        "payment_date": today.strftime("%d %B %Y"),
        "payment_method": "Mobile money",
        "due_date": due.strftime("%d %B %Y"),
        "days_until_due": "3",
        "credit_number": "CR-2026-0142",
        "invoice_number": "INV-2026-0142",
        "payment_link": "https://example.com/pay/CR-2026-0142",
        "business_name": business.name,
        "business_phone": business.phone or "+975 2 33 44 55",
        "business_email": business.email or "hello@example.com",
        "business_address": business.address or "Norzin Lam, Thimphu",
        "currency": business.currency,
        "record_count": "128",
        "deletion_date": (today + timedelta(days=14)).strftime("%d %B %Y"),
        "storage_used": f"412 MB of {business.storage_quota_mb} MB",
        "download_link": "https://example.com/exports/sample.zip",
        "logo_url": None,
    }


# --------------------------------------------------------------------------
# Service
# --------------------------------------------------------------------------
class TemplateService:
    def __init__(self, session: Session) -> None:
        self.session = session

    # -- read ---------------------------------------------------------------
    def get(self, business_id: str, template_id: str) -> EmailTemplate:
        template = self.session.get(EmailTemplate, template_id)
        if template is None or template.business_id != business_id or template.is_deleted:
            raise NotFoundError("Email template not found")
        return template

    def get_by_kind(
        self, business_id: str, kind: EmailTemplateKind, *, seed_if_missing: bool = True
    ) -> EmailTemplate:
        """Fetch the template for a kind, seeding the defaults if the business
        predates this kind existing. A missing template must never be the reason a
        reminder does not go out."""
        template = self.session.exec(
            select(EmailTemplate).where(
                EmailTemplate.business_id == business_id,
                EmailTemplate.kind == kind,
                EmailTemplate.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()

        if template is None and seed_if_missing:
            seed_default_templates(self.session, business_id)
            template = self.session.exec(
                select(EmailTemplate).where(
                    EmailTemplate.business_id == business_id,
                    EmailTemplate.kind == kind,
                    EmailTemplate.deleted_at.is_(None),  # type: ignore[union-attr]
                )
            ).first()

        if template is None:
            raise NotFoundError(f"No {kind.value} email template for this business")
        return template

    def list(self, business_id: str, *, active_only: bool = False) -> list[EmailTemplate]:
        stmt = select(EmailTemplate).where(
            EmailTemplate.business_id == business_id,
            EmailTemplate.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if active_only:
            stmt = stmt.where(EmailTemplate.is_active.is_(True))  # type: ignore[union-attr]
        return list(self.session.exec(stmt.order_by(EmailTemplate.kind)).all())  # type: ignore[arg-type]

    # -- write --------------------------------------------------------------
    def update(
        self,
        business_id: str,
        template_id: str,
        *,
        name: str | None = None,
        subject: str | None = None,
        body_html: str | None = None,
        footer_html: str | None = None,
        signature: str | None = None,
        primary_color: str | None = None,
        accent_color: str | None = None,
        logo_file_id: str | None = None,
        show_logo: bool | None = None,
        is_active: bool | None = None,
    ) -> EmailTemplate:
        """Apply an owner's edit. Any edit sets ``is_default = False``.

        That flag is the whole reset story: it distinguishes "this is our copy" from
        "this is the owner's copy", so reset_to_default knows what it may overwrite.
        """
        template = self.get(business_id, template_id)

        for field, value in (
            ("name", name),
            ("subject", subject),
            ("body_html", body_html),
            ("footer_html", footer_html),
            ("signature", signature),
            ("primary_color", primary_color),
            ("accent_color", accent_color),
            ("logo_file_id", logo_file_id),
            ("show_logo", show_logo),
            ("is_active", is_active),
        ):
            if value is not None:
                setattr(template, field, value)

        template.is_default = False
        self.session.add(template)
        self.session.flush()
        return template

    def reset_to_default(self, business_id: str, template_id: str) -> EmailTemplate:
        """Restore the shipped copy, discarding the owner's edits."""
        template = self.get(business_id, template_id)
        default = _DEFAULTS_BY_KIND[EmailTemplateKind(template.kind)]

        template.name = default.name
        template.subject = default.subject
        template.body_html = default.body_html
        template.signature = default.signature
        template.footer_html = None
        template.primary_color = None   # back to inheriting the business brand colour
        template.accent_color = None
        template.logo_file_id = None
        template.show_logo = True
        template.is_active = True
        template.is_default = True

        self.session.add(template)
        self.session.flush()
        return template

    # -- preview ------------------------------------------------------------
    def preview(
        self,
        template: EmailTemplate,
        business: Business,
        context: dict[str, Any] | None = None,
    ) -> tuple[str, str, str]:
        """Render with realistic sample data -> ``(subject, html, text)``.

        The editor shows exactly what a customer would see, which is the only way an
        owner can judge their own wording.
        """
        sample = sample_context(business)
        if context:
            sample.update(context)
        return render_email(template, business, sample)
