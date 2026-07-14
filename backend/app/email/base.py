"""The outbound-email provider contract.

ARCHITECTURE NOTE — one interface, two capability classes
----------------------------------------------------------
Every provider implements the same ``send(msg) -> EmailResult`` coroutine, so the
rest of the application never branches on which one is configured. But providers
are NOT interchangeable in one respect, and pretending otherwise would silently
lose customer mail:

    W3Forms is a form-to-email RELAY. It delivers a submission to the single inbox
    registered against the access key. It has no concept of a "To:" address, and
    therefore CANNOT email an arbitrary customer. That is what the free tier is;
    it is not a bug to work around.

So the interface carries a capability flag, ``can_send_to_arbitrary_recipients``:

    w3forms  -> False   (owner notifications only)
    smtp     -> True    (customer reminders work)
    console  -> True    (dev/tests; delivers to the log)

``EmailService`` checks the flag BEFORE sending and, when a message targets a
recipient the provider cannot reach, fails loudly: an ``EmailLog`` row with
``success=False`` and an error that names the fix (configure SMTP). The one thing
we never do is return success for a message that was never delivered.

Adding SMS/WhatsApp later is a new class implementing this same Protocol -- see
``ReminderChannel`` in models/enums.py.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass(slots=True)
class EmailMessage:
    """A fully rendered message, ready for a provider.

    Rendering (templates, branding, HTML layout) has already happened by the time
    a provider sees this: providers are dumb transports and know nothing about
    templates, businesses, or the database.
    """

    to_address: str
    subject: str
    html_body: str
    text_body: str = ""
    to_name: str | None = None
    from_name: str | None = None
    from_address: str | None = None
    reply_to: str | None = None
    # Free-form routing/audit hints (template kind, credit id, ...). Providers may
    # forward these (W3Forms shows them in the relayed email) or ignore them.
    tags: dict[str, Any] = field(default_factory=dict)

    @property
    def to_display(self) -> str:
        """RFC-5322 display form: ``Jane Doe <jane@example.com>``."""
        return f"{self.to_name} <{self.to_address}>" if self.to_name else self.to_address


@dataclass(slots=True)
class EmailResult:
    """Outcome of exactly one send attempt. Always produced -- never an exception
    for a delivery failure, because every attempt has to be recorded in EmailLog."""

    success: bool
    provider: str
    message_id: str | None = None
    error: str | None = None

    @classmethod
    def ok(cls, provider: str, message_id: str | None = None) -> EmailResult:
        return cls(success=True, provider=provider, message_id=message_id)

    @classmethod
    def failed(cls, provider: str, error: str) -> EmailResult:
        # Truncated to fit EmailLog.error (max_length=1000) without a DB error on
        # top of the delivery error we are already trying to report.
        return cls(success=False, provider=provider, error=error[:1000])


@runtime_checkable
class EmailProvider(Protocol):
    """The transport contract. Implementations live in app/email/providers/."""

    #: Stable identifier, written to ``EmailLog.provider``.
    name: str

    #: False => this provider can only reach its own fixed inbox (see module docs).
    can_send_to_arbitrary_recipients: bool

    async def send(self, msg: EmailMessage) -> EmailResult:
        """Attempt delivery. Must not raise for a delivery failure -- return
        ``EmailResult.failed(...)`` so the caller can log it."""
        ...
