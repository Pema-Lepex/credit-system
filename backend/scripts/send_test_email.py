"""Send one email through the configured provider and report exactly what happened.

    cd backend && .venv/bin/python scripts/send_test_email.py you@example.com

Why this exists: an email that does not arrive gives you nothing to debug -- the app
records the failure in EmailLog and moves on, because a failed reminder must never
take down the request that triggered it. This script does the same send with the
same provider and the same settings, but prints the provider's verdict straight to
your terminal, so a bad password or an unverified sender says so in one line.

It sends to an ARBITRARY address on purpose: that is precisely what W3Forms cannot
do and SMTP can, so a success here proves customer reminders will work.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# Python puts THIS file's directory (scripts/) on sys.path, not the backend root,
# so `app` is not importable without this. Keeps the script runnable from anywhere.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import EmailProvider, settings  # noqa: E402
from app.email.base import EmailMessage  # noqa: E402
from app.email.service import get_provider  # noqa: E402


def _preflight() -> None:
    """Catch the two misconfigurations that account for most 'no email' reports."""
    if settings.EMAIL_PROVIDER is EmailProvider.console:
        sys.exit(
            "EMAIL_PROVIDER=console -- this only LOGS email, it never sends.\n"
            "That is the default when backend/.env is missing. Set EMAIL_PROVIDER=smtp."
        )

    if settings.EMAIL_PROVIDER is EmailProvider.smtp and not settings.SMTP_HOST:
        sys.exit("EMAIL_PROVIDER=smtp but SMTP_HOST is empty. Fill in backend/.env.")

    if settings.EMAIL_PROVIDER is EmailProvider.smtp and not settings.SMTP_PASSWORD:
        sys.exit(
            "EMAIL_PROVIDER=smtp but SMTP_PASSWORD is empty. Fill in backend/.env.\n"
            "Brevo: the SMTP key, not your account password. Gmail: an App Password."
        )


async def main() -> int:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <recipient-email>")

    recipient = sys.argv[1]
    _preflight()

    provider = get_provider()
    print(f"provider   : {provider.name}")
    print(f"can reach arbitrary recipients: {provider.can_send_to_arbitrary_recipients}")
    print(f"sending to : {recipient}\n")

    if not provider.can_send_to_arbitrary_recipients:
        print(
            f"WARNING: {provider.name} can only deliver to its own registered inbox.\n"
            f"Whatever address you passed, the mail lands there -- and the app will\n"
            f"BLOCK this send when the recipient is a customer.\n"
        )

    result = await provider.send(
        EmailMessage(
            to_address=recipient,
            to_name="Test Recipient",
            subject="Credit Management System — test email",
            html_body=(
                "<p>This is a test from your Credit Management System.</p>"
                "<p>If you are reading this, outbound email works: due-date reminders, "
                "receipts and overdue notices will reach your customers.</p>"
                "<p>Amounts will appear like <strong>Nu.&nbsp;1,234.50</strong>.</p>"
            ),
            text_body=(
                "This is a test from your Credit Management System.\n"
                "If you are reading this, outbound email works."
            ),
        )
    )

    if result.success:
        print(f"SENT — provider accepted it (message id: {result.message_id})")
        print("If it is not in the inbox in a minute, check the spam folder, and")
        print("confirm EMAIL_FROM_ADDRESS is a sender you verified with your provider.")
        return 0

    print(f"FAILED — {result.error}")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
