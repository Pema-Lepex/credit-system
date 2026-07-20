"""The template engine: a deliberately tiny, safe ``{{variable}}`` substitution.

WHY NOT JINJA (this is the important part)
------------------------------------------
Email templates are USER-AUTHORED CONTENT STORED IN THE DATABASE -- the shop owner
edits them in the admin panel. Handing a user-authored string to Jinja is a
server-side template injection hole: ``{{ ''.__class__.__mro__[1].__subclasses__() }}``
walks from a string literal to arbitrary objects, and from there to config, to the
database session, to os.environ. Sandboxing Jinja is possible and is a game you keep
having to win.

This engine cannot be made to do that, by construction:

  * The ONLY thing it can emit is a value we explicitly put in the context dict.
  * There are no filters, no expressions, no attribute access, no control flow --
    the grammar is exactly ``{{ name }}`` where name is ``[A-Za-z_][A-Za-z0-9_]*``.
  * Every substituted value is HTML-escaped on the way in, so a customer named
    ``<script>`` is text, not script.
  * An unknown variable renders as the empty string. It never leaks a raw
    ``{{foo}}`` into a customer's inbox -- a typo in a template must look like an
    omission, not like broken software.

WHY THE HTML LOOKS LIKE 2003
----------------------------
Tables, ``bgcolor`` attributes, inline CSS, 600px fixed width. Not nostalgia:
Outlook renders with Word's HTML engine (no flexbox, no grid, patchy float), and
Gmail strips ``<style>`` blocks in several contexts. Table + inline CSS is what
actually arrives looking right. Backgrounds are always set EXPLICITLY, because dark
mode in Apple Mail/Outlook inverts unspecified backgrounds and turns dark text on an
assumed-white card into dark text on a now-dark card.

``render_email`` is deliberately PURE: no session, no I/O. The logo URL is resolved
by the caller (EmailService) and passed in the context as ``logo_url``.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from app.models.enums import EmailTemplateKind

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.communication import EmailTemplate

# The whole grammar. Whitespace-tolerant: {{name}}, {{ name }}, {{  name  }}.
_VAR_PATTERN = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")

# Does this string already contain markup? Used to decide whether owner-typed plain
# text needs to be turned into paragraphs.
_TAG_PATTERN = re.compile(r"<[a-zA-Z/!]")


# --------------------------------------------------------------------------
# Variable registry
# --------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class TemplateVariable:
    """One placeholder the owner may use, as the template editor should describe it.

    ``AVAILABLE_VARIABLES`` is exposed over the API so the frontend editor can show a
    click-to-insert palette. If a variable is not in this registry, the owner has no
    way to discover it -- so the registry and the context builders must stay in step.
    """

    name: str
    description: str
    example: str

    @property
    def token(self) -> str:
        return "{{" + self.name + "}}"


def _v(name: str, description: str, example: str) -> TemplateVariable:
    return TemplateVariable(name=name, description=description, example=example)


# Every variable the engine knows about, keyed by name.
VARIABLES: dict[str, TemplateVariable] = {
    v.name: v
    for v in (
        # --- Customer -------------------------------------------------------
        _v("customer_name", "The customer's full name", "Dorji Wangchuk"),
        _v("customer_phone", "The customer's phone number", "+975 17 12 34 56"),
        _v("customer_email", "The customer's email address", "dorji@example.com"),
        # --- Money ----------------------------------------------------------
        _v("amount", "The credit's original amount", "Nu 2,450.00"),
        _v("remaining", "How much is still owed on the credit", "Nu 1,200.00"),
        _v("grand_total", "Credit total including tax and any charges", "Nu 2,450.00"),
        _v("amount_paid", "Total paid against the credit so far", "Nu 1,250.00"),
        _v("currency", "The business's currency code", "BTN"),
        # --- Credit ---------------------------------------------------------
        _v("credit_number", "Human-readable credit reference", "CR-2026-0142"),
        _v("invoice_number", "Invoice reference, when one was issued", "INV-2026-0142"),
        _v("due_date", "The date payment is due", "21 July 2026"),
        _v("days_until_due", "Days remaining until the due date (negative = overdue)", "3"),
        # Clamped to 0 or more by the caller, unlike days_until_due. An overdue
        # message reads "12 days ago", never "-12 days ago".
        _v("days_overdue", "Days since the due date passed (0 if not yet due)", "12"),
        # --- Payment --------------------------------------------------------
        _v("payment_amount", "Amount of the payment just received", "Nu 1,250.00"),
        _v("payment_date", "Date the payment was received", "14 July 2026"),
        _v("payment_method", "How the payment was made", "Mobile banking"),
        _v("payment_link", "Link the customer can use to pay or view the credit", "https://…"),
        # --- Business -------------------------------------------------------
        _v("business_name", "Your business name", "Tashi General Store"),
        _v("business_phone", "Your business phone number", "+975 2 33 44 55"),
        _v("business_email", "Your business email address", "hello@tashistore.bt"),
        _v("business_address", "Your business address", "Norzin Lam, Thimphu"),
        # --- Account / system ----------------------------------------------
        _v("record_count", "How many records are affected", "128"),
        _v("deletion_date", "The date the records will be permanently deleted", "28 July 2026"),
        _v("storage_used", "Storage currently used", "412 MB of 500 MB"),
        _v("download_link", "Link to download the export or archive", "https://…"),
        _v(
            "credit_summary",
            "Owner digest only: one plain-text line per credit due. Render it inside "
            "a <pre> block -- values are HTML-escaped, so a <br> would not survive, "
            "but newlines inside <pre> do.",
            "16 Jul  CR-2026-0012   Pema Lhamo   Nu.590.00   +975 17 44 55 66",
        ),
    )
}

# Available in every template -- the sender's own identity always makes sense.
_BUSINESS_VARS = [
    "business_name",
    "business_phone",
    "business_email",
    "business_address",
    "currency",
]
_CUSTOMER_VARS = ["customer_name", "customer_phone", "customer_email"]
_CREDIT_VARS = [
    "credit_number",
    "invoice_number",
    "amount",
    "grand_total",
    "amount_paid",
    "remaining",
    "due_date",
    "days_until_due",
    "payment_link",
]
_PAYMENT_VARS = ["payment_amount", "payment_date", "payment_method"]


def _vars(*names: str) -> list[TemplateVariable]:
    return [VARIABLES[n] for n in names]


#: What the template editor offers for each kind. Exported to the frontend.
AVAILABLE_VARIABLES: dict[EmailTemplateKind, list[TemplateVariable]] = {
    EmailTemplateKind.REMINDER: _vars(*_CUSTOMER_VARS, *_CREDIT_VARS, *_BUSINESS_VARS),
    EmailTemplateKind.OVERDUE_NOTICE: _vars(*_CUSTOMER_VARS, *_CREDIT_VARS, *_BUSINESS_VARS),
    EmailTemplateKind.RECEIPT: _vars(
        *_CUSTOMER_VARS, *_PAYMENT_VARS, *_CREDIT_VARS, "download_link", *_BUSINESS_VARS
    ),
    EmailTemplateKind.PAYMENT_CONFIRMATION: _vars(
        *_CUSTOMER_VARS, *_PAYMENT_VARS, *_CREDIT_VARS, *_BUSINESS_VARS
    ),
    EmailTemplateKind.WELCOME: _vars(*_CUSTOMER_VARS, "payment_link", *_BUSINESS_VARS),
    # The owner notification is a DIGEST (many credits, one email), so the batch
    # variables come first -- customer_name/credit_number are meaningless when the
    # mail is about forty different customers. See services/templates.py.
    EmailTemplateKind.ADMIN_NOTIFICATION: _vars(
        "record_count",
        "amount",
        "credit_summary",
        "storage_used",
        "download_link",
        *_BUSINESS_VARS,
    ),
    EmailTemplateKind.DATA_DELETION_WARNING: _vars(
        "record_count",
        "deletion_date",
        "storage_used",
        "download_link",
        *_BUSINESS_VARS,
    ),
    # WhatsApp. Same variables as their email counterparts MINUS payment_link:
    # these render to plain text in a chat, where a bare URL is both ugly and a
    # spam signal. days_overdue is offered only here -- the email overdue notice
    # does not populate it (see services/reminder.py), and offering a variable that
    # silently renders empty is worse than not offering it.
    EmailTemplateKind.WHATSAPP_REMINDER: _vars(
        *_CUSTOMER_VARS,
        "credit_number",
        "amount",
        "amount_paid",
        "remaining",
        "due_date",
        "days_until_due",
        *_BUSINESS_VARS,
    ),
    EmailTemplateKind.WHATSAPP_OVERDUE: _vars(
        *_CUSTOMER_VARS,
        "credit_number",
        "amount",
        "amount_paid",
        "remaining",
        "due_date",
        "days_overdue",
        *_BUSINESS_VARS,
    ),
}


# --------------------------------------------------------------------------
# Substitution
# --------------------------------------------------------------------------
def render(template_string: str, context: dict[str, Any], *, escape: bool = True) -> str:
    """Replace every ``{{variable}}`` with its (HTML-escaped) value from ``context``.

    Unknown or ``None`` variables become the empty string -- a customer must never
    receive a literal ``{{foo}}``.

    ``escape=False`` is for non-HTML sinks (the subject line, plain-text bodies),
    where ``&amp;`` would be a visible bug rather than a safety measure. It is never
    used for anything that lands in an HTML document.
    """
    if not template_string:
        return ""

    def _substitute(match: re.Match[str]) -> str:
        value = context.get(match.group(1))
        if value is None:
            return ""
        text = str(value)
        return html.escape(text, quote=False) if escape else text

    return _VAR_PATTERN.sub(_substitute, template_string)


def find_variables(template_string: str) -> list[str]:
    """Every variable referenced by a template, in order of first appearance.

    Lets the editor warn "you used {{amount_due}}, which does not exist" *before* the
    owner sends a reminder with a hole in it.
    """
    seen: dict[str, None] = {}
    for match in _VAR_PATTERN.finditer(template_string or ""):
        seen.setdefault(match.group(1), None)
    return list(seen)


def unknown_variables(template_string: str, kind: EmailTemplateKind) -> list[str]:
    """Referenced variables that are not offered for this template kind."""
    allowed = {v.name for v in AVAILABLE_VARIABLES.get(kind, [])}
    return [name for name in find_variables(template_string) if name not in allowed]


# --------------------------------------------------------------------------
# Plain-text derivation
# --------------------------------------------------------------------------
_BLOCK_BREAK = re.compile(
    r"</(?:p|div|tr|h[1-6]|li|table|blockquote)\s*>|<br\s*/?>", re.IGNORECASE
)
_LIST_ITEM = re.compile(r"<li[^>]*>", re.IGNORECASE)
_DROP_ELEMENTS = re.compile(r"<(script|style)[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_ANY_TAG = re.compile(r"<[^>]+>")
_EXCESS_BLANKS = re.compile(r"\n{3,}")

# Cell boundaries need their own marker. Without one, the two columns of a summary
# table collapse into "ReferenceCR-2026-0142" in the plain-text part -- and the
# plain-text part is what a screen reader and a text-only client actually read.
_CELL_END = re.compile(r"</t[dh]\s*>", re.IGNORECASE)
_CELL_MARK = "\x00"


def html_to_text(markup: str) -> str:
    """Derive a readable plain-text alternative by stripping tags.

    Not a full HTML-to-text engine (no link footnotes, no colspan) -- it only has to
    handle the markup our own layout and a shop owner's rich-text editor produce, and
    it must never be the reason a send fails.
    """
    if not markup:
        return ""
    text = _DROP_ELEMENTS.sub("", markup)
    text = _LIST_ITEM.sub("\n  - ", text)
    text = _CELL_END.sub(_CELL_MARK, text)
    text = _BLOCK_BREAK.sub("\n", text)
    text = _ANY_TAG.sub("", text)
    text = html.unescape(text)

    lines: list[str] = []
    for raw in text.splitlines():
        cells = [cell.strip() for cell in raw.split(_CELL_MARK)]
        cells = [cell for cell in cells if cell]
        if not cells:
            lines.append("")
        elif len(cells) == 2:
            # The label/value shape of our summary panels.
            lines.append(f"{cells[0]}: {cells[1]}")
        else:
            lines.append("  ".join(cells))

    return _EXCESS_BLANKS.sub("\n\n", "\n".join(lines)).strip()


def _as_html(body: str) -> str:
    """Promote owner-typed plain text to HTML paragraphs; leave real HTML alone."""
    if not body:
        return ""
    if _TAG_PATTERN.search(body):
        return body
    blocks = [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]
    return "".join(
        f'<p style="margin:0 0 16px 0;">{b.replace(chr(10), "<br />")}</p>' for b in blocks
    )


# --------------------------------------------------------------------------
# The email layout
# --------------------------------------------------------------------------
# Explicit, never-inherited colours. Dark mode in Apple Mail/Outlook inverts
# *unspecified* backgrounds; anything we state survives.
_PAGE_BG = "#f1f3f6"
_CARD_BG = "#ffffff"
_TEXT = "#1f2937"
_MUTED = "#6b7280"
_BORDER = "#e5e7eb"
_FALLBACK_BRAND = "#4F46E5"

_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")


def _safe_color(value: str | None, fallback: str = _FALLBACK_BRAND) -> str:
    """Colours are interpolated straight into a ``style=""`` attribute, so they are
    validated as hex rather than escaped -- ``#fff;" onload="`` must not be a thing."""
    if value and _HEX_RE.match(value.strip()):
        return value.strip()
    return fallback


def _on_brand_text(brand: str) -> str:
    """Black or white header text, whichever the brand colour can actually carry.

    A shop with a pale yellow brand colour would otherwise get white-on-yellow.
    Relative luminance (sRGB, WCAG), not the naive average.
    """
    hex_digits = brand.lstrip("#")[:6]
    if len(hex_digits) == 3:
        hex_digits = "".join(c * 2 for c in hex_digits)
    try:
        r, g, b = (int(hex_digits[i : i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError:
        return "#ffffff"

    def _lin(c: float) -> float:
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    luminance = 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)
    return "#111827" if luminance > 0.55 else "#ffffff"


def _layout(
    *,
    title: str,
    body_html: str,
    brand: str,
    logo_url: str | None,
    show_logo: bool,
    business_name: str,
    signature_html: str,
    footer_html: str,
) -> str:
    """The responsive, table-based shell. 600px wide, fluid below that."""
    on_brand = _on_brand_text(brand)
    safe_business = html.escape(business_name, quote=True)

    if show_logo and logo_url:
        header_content = (
            f'<img src="{html.escape(logo_url, quote=True)}" alt="{safe_business}" '
            f'width="128" style="display:block;border:0;outline:none;text-decoration:none;'
            f'max-width:160px;height:auto;margin:0 auto;" />'
        )
    else:
        header_content = (
            f'<span style="font-family:Helvetica,Arial,sans-serif;font-size:20px;'
            f'font-weight:700;letter-spacing:0.2px;color:{on_brand};">{safe_business}</span>'
        )

    signature_block = (
        f'<tr><td style="padding:0 32px 8px 32px;font-family:Helvetica,Arial,sans-serif;'
        f'font-size:15px;line-height:24px;color:{_TEXT};">{signature_html}</td></tr>'
        if signature_html
        else ""
    )
    footer_block = (
        f'<tr><td align="center" style="padding:20px 32px 0 32px;'
        f'font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:19px;'
        f'color:{_MUTED};">{footer_html}</td></tr>'
        if footer_html
        else ""
    )

    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" \
"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>{html.escape(title, quote=True)}</title>
<style type="text/css">
  /* Progressive enhancement only -- Gmail strips this in some contexts, so the
     layout must already be correct from the inline styles alone. */
  body {{ margin:0 !important; padding:0 !important; width:100% !important; }}
  img {{ -ms-interpolation-mode:bicubic; }}
  a {{ text-decoration:none; }}
  @media only screen and (max-width:620px) {{
    .wrap {{ width:100% !important; }}
    .pad {{ padding-left:20px !important; padding-right:20px !important; }}
    .btn {{ display:block !important; width:auto !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:{_PAGE_BG};color:{_TEXT};">
<div style="display:none;font-size:1px;color:{_PAGE_BG};line-height:1px;max-height:0;\
max-width:0;opacity:0;overflow:hidden;">{html.escape(title, quote=False)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       bgcolor="{_PAGE_BG}" style="background-color:{_PAGE_BG};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0"
             border="0" style="width:600px;max-width:600px;">

        <!-- Brand bar -->
        <tr>
          <td align="center" bgcolor="{brand}"
              style="background-color:{brand};padding:28px 32px;border-radius:12px 12px 0 0;">
            {header_content}
          </td>
        </tr>

        <!-- Card -->
        <tr>
          <td bgcolor="{_CARD_BG}"
              style="background-color:{_CARD_BG};border-radius:0 0 12px 12px;
                     border:1px solid {_BORDER};border-top:0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td class="pad" style="padding:32px 32px 8px 32px;
                    font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:24px;
                    color:{_TEXT};">
                  {body_html}
                </td>
              </tr>
              {signature_block}
              <tr><td style="padding:16px 32px 24px 32px;">
                <div style="height:1px;line-height:1px;font-size:0;
                     background-color:{_BORDER};">&nbsp;</div>
              </td></tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        {footer_block}
      </table>
    </td>
  </tr>
</table>
</body>
</html>"""


def button(label: str, url: str, brand: str = _FALLBACK_BRAND) -> str:
    """A bulletproof CTA button (a table, not a styled <a> -- Outlook ignores
    padding on inline elements). Exposed so seed templates can use it."""
    brand = _safe_color(brand)
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'style="margin:8px 0 20px 0;"><tr>'
        f'<td bgcolor="{brand}" style="background-color:{brand};border-radius:8px;">'
        f'<a class="btn" href="{html.escape(url, quote=True)}" '
        f'style="display:inline-block;padding:12px 26px;'
        f'font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;'
        f'color:{_on_brand_text(brand)};text-decoration:none;border-radius:8px;">'
        f"{html.escape(label, quote=False)}</a></td></tr></table>"
    )


def _default_footer(business: Business) -> str:
    """Sender identity + a reason-for-receipt line. Both are what keeps mail out of
    the spam folder and on the right side of anti-spam law."""
    bits: list[str] = [f"<strong>{html.escape(business.name)}</strong>"]
    contact = " &nbsp;·&nbsp; ".join(
        html.escape(x) for x in (business.phone, business.email, business.address) if x
    )
    if contact:
        bits.append(contact)
    bits.append("You are receiving this because you have an account with this business.")
    return "<br />".join(bits)


def render_email(
    template: EmailTemplate,
    business: Business,
    context: dict[str, Any],
) -> tuple[str, str, str]:
    """Render a template into ``(subject, html_body, text_body)``.

    Branding cascades: template override -> business default -> platform default. The
    template's own colour/logo wins so a shop can style, say, the overdue notice more
    firmly than the welcome mail.

    PURE: no session, no network. ``context["logo_url"]`` is resolved by the caller.
    """
    brand = _safe_color(template.primary_color or business.brand_color)

    # escape=False for the subject: it is not HTML, and "Tom &amp; Jerry's" in a
    # subject line is a visible bug. Newlines are stripped -- a newline in a header
    # is header injection.
    subject = render(template.subject, context, escape=False)
    subject = " ".join(subject.split())[:300] or f"Message from {business.name}"

    body = _as_html(render(template.body_html, context))
    signature = _as_html(
        render(template.signature or business.email_signature or "", context)
    )
    footer = _as_html(render(template.footer_html or "", context)) or _default_footer(business)

    html_body = _layout(
        title=subject,
        body_html=body,
        brand=brand,
        logo_url=context.get("logo_url"),
        show_logo=template.show_logo,
        business_name=business.name,
        signature_html=signature,
        footer_html=footer,
    )

    # The text alternative is derived from the SAME rendered content, so it can never
    # drift from the HTML the way a hand-maintained second template would.
    text_parts = [html_to_text(body)]
    if signature:
        text_parts.append(html_to_text(signature))
    text_parts.append(html_to_text(footer))
    text_body = "\n\n".join(p for p in text_parts if p)

    return subject, html_body, text_body


def render_raw(
    *,
    subject: str,
    body_html: str,
    business: Business | None = None,
    brand_color: str | None = None,
    business_name: str | None = None,
    logo_url: str | None = None,
    footer_html: str | None = None,
) -> tuple[str, str, str]:
    """Wrap already-final HTML in the same shell, for system mail that has no
    EmailTemplate row (password reset, provider self-test)."""
    brand = _safe_color(brand_color or (business.brand_color if business else None))
    name = business_name or (business.name if business else "Credit Management System")
    footer = footer_html or (_default_footer(business) if business else "")
    body = _as_html(body_html)

    html_body = _layout(
        title=subject,
        body_html=body,
        brand=brand,
        logo_url=logo_url,
        show_logo=bool(logo_url),
        business_name=name,
        signature_html="",
        footer_html=footer,
    )
    text_body = "\n\n".join(p for p in (html_to_text(body), html_to_text(footer)) if p)
    return subject, html_body, text_body
