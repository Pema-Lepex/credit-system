"""WhatsApp click-to-chat links.

The tests that matter most here are the ones about the PHONE NUMBER. Everything
else is cosmetic; getting the number wrong sends a customer's outstanding balance
to a stranger who happens to own that number in another country.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from urllib.parse import parse_qs, unquote, urlparse

import pytest

from app.core.errors import ValidationError
from app.models.customer import Customer
from app.models.enums import CreditStatus, EmailTemplateKind
from app.services.credit import CreditItemInput, CreditService
from app.services.whatsapp import MAX_MESSAGE_CHARS, WhatsAppService, normalize_phone


def _credit(ctx, customer, *, days_until_due: int = 5, amount: str = "450"):
    kwargs = {}
    if days_until_due < 0:
        # A due date in the past needs an issue date further back, or CreditService
        # rejects it outright.
        kwargs["issued_date"] = date.today() + timedelta(days=days_until_due - 30)
    return CreditService(ctx).create(
        ctx,
        customer_id=customer.id,
        items=[CreditItemInput(name="Rice 5kg", quantity=Decimal("2"), unit_price=Decimal(amount))],
        due_date=date.today() + timedelta(days=days_until_due),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Phone normalisation -- the safety-critical part
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+97517723391", "97517723391"),          # already E.164
        ("+975 17 72 33 91", "97517723391"),      # human formatting
        ("+975-17-72-33-91", "97517723391"),
        ("0097517723391", "97517723391"),         # the other international prefix
        ("  +97517723391  ", "97517723391"),
    ],
)
def test_international_numbers_are_accepted(raw: str, expected: str) -> None:
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "17111111",     # local -- no country code
        "017111111",    # local with a trunk prefix
        "",
        "   ",
        "abc",
        "+",
        "+975",         # a dial code with no subscriber number
        "+12345",       # too short to be a real number
        "+1234567890123456",  # longer than E.164 permits
    ],
)
def test_numbers_without_a_country_code_are_refused(raw: str) -> None:
    """NEVER guess. A wrong guess messages a stranger about someone's debt."""
    assert normalize_phone(raw) is None


# ---------------------------------------------------------------------------
# Link building
# ---------------------------------------------------------------------------
def test_builds_a_wa_me_link_for_an_upcoming_credit(ctx, session, business, customer) -> None:
    credit = _credit(ctx, customer)
    session.commit()

    link = WhatsAppService(ctx).reminder_link(credit.id)

    assert link.to_phone == "97517123456"  # the fixture's "+975 17 12 34 56"
    assert link.url.startswith("https://wa.me/97517123456?text=")
    assert link.customer_name == customer.name

    # The message survives URL-encoding intact -- an '&' in a shop name must not
    # truncate it.
    query = parse_qs(urlparse(link.url).query)
    assert unquote(query["text"][0]) == link.text

    assert customer.name in link.text
    assert credit.number in link.text
    assert business.name in link.text
    assert "900.00" in link.text  # 2 x 450


def test_an_upcoming_credit_uses_the_reminder_template(ctx, session, customer) -> None:
    credit = _credit(ctx, customer, days_until_due=5)
    session.commit()

    text = WhatsAppService(ctx).reminder_link(credit.id).text

    assert "friendly reminder" in text.lower()
    assert "5 days from now" in text


def test_an_overdue_credit_uses_the_overdue_template(ctx, session, customer) -> None:
    """The tone has to change on its own -- nobody picks a template per send."""
    credit = _credit(ctx, customer, days_until_due=-12)
    credit.status = CreditStatus.OVERDUE
    session.add(credit)
    session.commit()

    text = WhatsAppService(ctx).reminder_link(credit.id).text

    assert "12 days ago" in text
    assert "friendly reminder" not in text.lower()


def test_the_message_is_plain_text_with_no_markup(ctx, session, customer) -> None:
    """It lands in a chat window, where a stray <p> is just garbage on screen."""
    credit = _credit(ctx, customer)
    session.commit()

    text = WhatsAppService(ctx).reminder_link(credit.id).text

    assert "<" not in text and ">" not in text
    assert "&amp;" not in text and "&nbsp;" not in text
    assert "{{" not in text  # every variable was substituted


def test_an_ampersand_in_the_shop_name_survives(ctx, session, business, customer) -> None:
    """escape=False is deliberate: the customer must see "Tashi & Sons", not
    "Tashi &amp; Sons"."""
    business.name = "Tashi & Sons"
    session.add(business)
    session.commit()

    credit = _credit(ctx, customer)
    session.commit()

    link = WhatsAppService(ctx).reminder_link(credit.id)
    assert "Tashi & Sons" in link.text
    assert "&amp;" not in link.text
    # ...and it must not break the URL's query string.
    assert unquote(parse_qs(urlparse(link.url).query)["text"][0]) == link.text


def test_a_very_long_template_is_truncated(ctx, session, customer) -> None:
    """A wa.me URL travels through the address bar; some handlers truncate long ones."""
    from app.services.templates import TemplateService

    template = TemplateService(session).get_by_kind(
        customer.business_id, EmailTemplateKind.WHATSAPP_REMINDER
    )
    template.body_html = "<p>" + ("x" * 5000) + "</p>"
    session.add(template)
    session.commit()

    credit = _credit(ctx, customer)
    session.commit()

    text = WhatsAppService(ctx).reminder_link(credit.id).text
    assert len(text) <= MAX_MESSAGE_CHARS
    assert text.endswith("…")


# ---------------------------------------------------------------------------
# Refusals
# ---------------------------------------------------------------------------
def test_a_local_number_is_refused_by_name(ctx, session, business) -> None:
    """The error has to name the customer AND the fix -- the owner is holding a
    phone, not a debugger."""
    local = Customer(business_id=business.id, code="CUST-0009", name="Old Record", phone="17111111")
    session.add(local)
    session.commit()
    session.refresh(local)

    credit = _credit(ctx, local)
    session.commit()

    with pytest.raises(ValidationError) as exc:
        WhatsAppService(ctx).reminder_link(credit.id)

    message = str(exc.value)
    assert "Old Record" in message
    assert "17111111" in message
    assert "+975" in message  # shows the shape they should type


def test_a_customer_with_no_phone_is_refused(ctx, session, business) -> None:
    silent = Customer(business_id=business.id, code="CUST-0010", name="No Phone")
    session.add(silent)
    session.commit()
    session.refresh(silent)

    credit = _credit(ctx, silent)
    session.commit()

    with pytest.raises(ValidationError, match="No Phone has no phone number"):
        WhatsAppService(ctx).reminder_link(credit.id)


def test_another_tenants_credit_is_not_reachable(ctx, session) -> None:
    """The tenancy boundary, on a route that hands back a customer's phone number."""
    from app.models.business import Business
    from app.models.credit import Credit

    other = Business(name="Rival Shop", slug="rival-shop", email="rival@x.bt")
    session.add(other)
    session.commit()
    their_customer = Customer(
        business_id=other.id, code="CUST-0001", name="Their Customer", phone="+97517000000"
    )
    session.add(their_customer)
    session.commit()
    their_credit = Credit(
        business_id=other.id,
        number="CR-2026-9999",
        customer_id=their_customer.id,
        issued_date=date.today(),
        due_date=date.today() + timedelta(days=5),
    )
    session.add(their_credit)
    session.commit()

    from app.core.errors import NotFoundError

    with pytest.raises(NotFoundError):
        WhatsAppService(ctx).reminder_link(their_credit.id)


def test_composing_is_audited(ctx, session, customer) -> None:
    """'Did I chase Sonam?' is a question the owner will ask later."""
    from app.models.retention import AuditLog
    from sqlmodel import select

    credit = _credit(ctx, customer)
    session.commit()

    WhatsAppService(ctx).reminder_link(credit.id)
    session.commit()

    entries = [
        row
        for row in session.exec(select(AuditLog)).all()
        if "WhatsApp" in row.summary
    ]
    assert len(entries) == 1
    assert customer.name in entries[0].summary


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------
def test_the_whatsapp_templates_are_owner_editable(ctx, session, customer) -> None:
    """The whole reason they live in the template system: the shop's own words."""
    from app.services.templates import TemplateService

    service = TemplateService(session)
    template = service.get_by_kind(customer.business_id, EmailTemplateKind.WHATSAPP_REMINDER)
    template.body_html = "<p>Kuzuzangpo {{customer_name}} — Nu {{remaining}} pending.</p>"
    session.add(template)
    session.commit()

    credit = _credit(ctx, customer)
    session.commit()

    text = WhatsAppService(ctx).reminder_link(credit.id).text
    assert text.startswith("Kuzuzangpo Dorji Wangchuk")
    assert "pending" in text


def test_a_business_predating_the_feature_gets_the_templates_seeded(ctx, session, customer) -> None:
    """Existing shops have no WHATSAPP_* rows. A missing template must never be the
    reason a reminder cannot be sent."""
    from sqlmodel import select

    from app.models.communication import EmailTemplate

    for row in session.exec(
        select(EmailTemplate).where(EmailTemplate.business_id == customer.business_id)
    ).all():
        session.delete(row)
    session.commit()

    credit = _credit(ctx, customer)
    session.commit()

    link = WhatsAppService(ctx).reminder_link(credit.id)  # must not raise
    assert customer.name in link.text
