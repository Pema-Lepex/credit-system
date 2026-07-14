"""Outbound email: providers, the safe template renderer, and the audited service.

    from app.email import EmailService
    from app.models.enums import EmailTemplateKind

    result = await EmailService(session).send_templated(
        session, business, EmailTemplateKind.REMINDER, customer.email, customer.name, ctx,
        credit_id=credit.id, customer_id=customer.id,
    )

PROVIDER CAPABILITY -- read app/email/base.py before wiring customer mail. W3Forms
(the free option) is a relay: it reaches the owner's registered inbox and NOTHING
ELSE. It declares ``can_send_to_arbitrary_recipients = False``, and EmailService
refuses -- loudly, with an EmailLog row -- to pretend it delivered a customer
reminder. ``EMAIL_PROVIDER=smtp`` is the drop-in that makes customer mail work.
"""

from __future__ import annotations

from app.email.base import EmailMessage, EmailProvider, EmailResult
from app.email.renderer import (
    AVAILABLE_VARIABLES,
    VARIABLES,
    TemplateVariable,
    find_variables,
    html_to_text,
    render,
    render_email,
    render_raw,
    unknown_variables,
)
from app.email.service import EmailService, get_provider, reset_provider

__all__ = [
    # contract
    "EmailMessage",
    "EmailProvider",
    "EmailResult",
    # renderer
    "AVAILABLE_VARIABLES",
    "VARIABLES",
    "TemplateVariable",
    "find_variables",
    "html_to_text",
    "render",
    "render_email",
    "render_raw",
    "unknown_variables",
    # service
    "EmailService",
    "get_provider",
    "reset_provider",
]
