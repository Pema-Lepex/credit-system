"""GraphQL input types.

Money arrives as a STRING and is parsed to Decimal at the boundary (see
``to_decimal``). GraphQL's Float is an IEEE-754 double: accepting `amount: Float`
would mean a client sending 1234567.89 hands the server 1234567.8899999999, and the
customer's balance is wrong by a cent forever. The API refuses to have that
conversation -- money is text on the wire, Decimal in the process, integer minor
units in the database.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation

import strawberry

from app.core.errors import ValidationError
from app.graphql.types import (
    CustomerStatus,
    ExportFormat,
    ItemKind,
    PaymentMethod,
    ReminderAudience,
    ReportPeriod,
    RetentionPolicy,
    RoleEnum,
)
from app.graphql.types import CreditStatus


def to_decimal(value: str | None, field: str = "amount") -> Decimal | None:
    """Parse a money string. Rejects anything that isn't a plain decimal number."""
    if value is None or value == "":
        return None
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as exc:
        raise ValidationError(f"'{value}' is not a valid amount", field=field) from exc
    if not parsed.is_finite():
        # Decimal("NaN") and Decimal("Infinity") parse happily and then poison every
        # sum they touch.
        raise ValidationError(f"'{value}' is not a valid amount", field=field)
    return parsed


def required_decimal(value: str, field: str = "amount") -> Decimal:
    parsed = to_decimal(value, field)
    if parsed is None:
        raise ValidationError(f"{field} is required", field=field)
    return parsed


# ---------------------------------------------------------------------------
# Shared
# ---------------------------------------------------------------------------
@strawberry.input
class PageInput:
    page: int = 1
    limit: int = 25


@strawberry.input
class SortInput:
    field: str = "created_at"
    desc: bool = True


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------
@strawberry.input
class LoginInput:
    email: str
    password: str


@strawberry.input
class RegisterInput:
    business_name: str
    full_name: str
    email: str
    password: str


@strawberry.input
class ResetPasswordInput:
    token: str
    new_password: str


@strawberry.input
class ChangePasswordInput:
    current_password: str
    new_password: str


# ---------------------------------------------------------------------------
# Business
# ---------------------------------------------------------------------------
@strawberry.input
class BusinessUpdateInput:
    name: str | None = None
    description: str | None = None
    logo_file_id: strawberry.ID | None = None

    email: str | None = None
    phone: str | None = None
    whatsapp_number: str | None = None
    website: str | None = None
    facebook_url: str | None = None
    instagram_url: str | None = None
    tiktok_url: str | None = None

    address: str | None = None
    city: str | None = None
    country: str | None = None
    google_maps_url: str | None = None
    latitude: float | None = None
    longitude: float | None = None

    currency: str | None = None
    currency_symbol: str | None = None
    timezone: str | None = None
    locale: str | None = None
    tax_percentage: str | None = None
    working_hours: strawberry.scalars.JSON | None = None

    reminders_enabled: bool | None = None
    reminder_days_before: list[int] | None = None
    reminder_audience: ReminderAudience | None = None  # type: ignore[valid-type]
    reminder_send_hour: int | None = None
    notify_owner_on_overdue: bool | None = None
    notify_owner_on_payment: bool | None = None

    email_from_name: str | None = None
    email_reply_to: str | None = None
    email_signature: str | None = None
    brand_color: str | None = None

    # Write-only: the key goes in, and nothing ever reads it back out (BusinessType
    # exposes only `hasW3formsAccessKey` and a masked hint).
    #
    # Three states, and the difference matters. Every other field here treats null as
    # "not supplied", which would leave no way to REMOVE a key once set -- the UI
    # cannot send the current value back, because it never had it.
    #
    #   null (omitted)  -> leave the stored key untouched
    #   ""  (empty)     -> clear the stored key, fall back to the env var
    #   "abc123..."     -> replace the stored key
    w3forms_access_key: str | None = None

    retention_policy: RetentionPolicy | None = None  # type: ignore[valid-type]
    retention_notifications_enabled: bool | None = None


# ---------------------------------------------------------------------------
# Users
# ---------------------------------------------------------------------------
@strawberry.input
class UserCreateInput:
    email: str
    full_name: str
    password: str
    role: RoleEnum = RoleEnum.STAFF  # type: ignore[valid-type,assignment]
    phone: str | None = None


@strawberry.input
class UserUpdateInput:
    full_name: str | None = None
    phone: str | None = None
    role: RoleEnum | None = None  # type: ignore[valid-type]
    is_active: bool | None = None


@strawberry.input
class ProfileUpdateInput:
    full_name: str | None = None
    phone: str | None = None
    avatar_file_id: strawberry.ID | None = None
    theme: str | None = None
    language: str | None = None


# ---------------------------------------------------------------------------
# Customers
# ---------------------------------------------------------------------------
@strawberry.input
class CustomerInput:
    name: str
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    photo_file_id: strawberry.ID | None = None
    notes: str | None = None
    status: CustomerStatus | None = None  # type: ignore[valid-type]
    credit_limit: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    emergency_contact_relation: str | None = None


@strawberry.input
class CustomerFilterInput:
    search: str | None = None
    status: list[CustomerStatus] | None = None  # type: ignore[valid-type]
    min_outstanding: str | None = None
    max_outstanding: str | None = None
    has_overdue: bool | None = None


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------
@strawberry.input
class CategoryInput:
    name: str
    description: str | None = None
    color: str | None = None


@strawberry.input
class ProductInput:
    name: str
    sku: str | None = None
    barcode: str | None = None
    description: str | None = None
    category_id: strawberry.ID | None = None
    price: str = "0"
    cost_price: str | None = None
    tax_percentage: str | None = None
    stock_quantity: str = "0"
    low_stock_threshold: str | None = None
    unit: str = "pcs"
    image_file_ids: list[strawberry.ID] | None = None
    is_active: bool = True


@strawberry.input
class ProductFilterInput:
    search: str | None = None
    category_id: strawberry.ID | None = None
    is_active: bool | None = None
    low_stock_only: bool = False


@strawberry.input
class ServiceInput:
    name: str
    code: str | None = None
    description: str | None = None
    category_id: strawberry.ID | None = None
    price: str = "0"
    tax_percentage: str | None = None
    duration_minutes: int | None = None
    is_active: bool = True


@strawberry.input
class ServiceFilterInput:
    search: str | None = None
    category_id: strawberry.ID | None = None
    is_active: bool | None = None


# ---------------------------------------------------------------------------
# Credits
# ---------------------------------------------------------------------------
@strawberry.input
class CreditItemInput:
    name: str
    quantity: str = "1"
    unit_price: str = "0"
    kind: ItemKind = ItemKind.PRODUCT  # type: ignore[valid-type,assignment]
    product_id: strawberry.ID | None = None
    service_id: strawberry.ID | None = None
    description: str | None = None
    unit: str = "pcs"
    discount_amount: str = "0"
    tax_percentage: str = "0"


@strawberry.input
class CreditCreateInput:
    customer_id: strawberry.ID
    items: list[CreditItemInput]
    due_date: date
    issued_date: date | None = None
    reminder_date: date | None = None
    discount_percentage: str | None = None
    tax_percentage: str | None = None
    notes: str | None = None
    photo_file_ids: list[strawberry.ID] | None = None
    invoice_file_id: strawberry.ID | None = None
    # Convenience: the customer pays something up front at the counter. Recording it
    # here means one round trip instead of create-then-pay.
    initial_payment: str | None = None


@strawberry.input
class CreditUpdateInput:
    items: list[CreditItemInput] | None = None
    due_date: date | None = None
    reminder_date: date | None = None
    discount_percentage: str | None = None
    tax_percentage: str | None = None
    notes: str | None = None
    photo_file_ids: list[strawberry.ID] | None = None
    invoice_file_id: strawberry.ID | None = None


@strawberry.input
class CreditFilterInput:
    search: str | None = None
    status: list[CreditStatus] | None = None  # type: ignore[valid-type]
    customer_id: strawberry.ID | None = None
    due_from: date | None = None
    due_to: date | None = None
    issued_from: date | None = None
    issued_to: date | None = None
    min_amount: str | None = None
    max_amount: str | None = None
    overdue_only: bool = False


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------
@strawberry.input
class PaymentInput:
    credit_id: strawberry.ID
    amount: str
    method: PaymentMethod = PaymentMethod.CASH  # type: ignore[valid-type,assignment]
    paid_at: date | None = None
    reference: str | None = None
    notes: str | None = None
    receipt_file_id: strawberry.ID | None = None


@strawberry.input
class PaymentFilterInput:
    search: str | None = None
    credit_id: strawberry.ID | None = None
    customer_id: strawberry.ID | None = None
    method: list[PaymentMethod] | None = None  # type: ignore[valid-type]
    date_from: date | None = None
    date_to: date | None = None
    min_amount: str | None = None
    max_amount: str | None = None
    include_voided: bool = False


# ---------------------------------------------------------------------------
# Templates / notifications / exports / reports
# ---------------------------------------------------------------------------
@strawberry.input
class EmailTemplateInput:
    subject: str | None = None
    body_html: str | None = None
    footer_html: str | None = None
    signature: str | None = None
    primary_color: str | None = None
    accent_color: str | None = None
    show_logo: bool | None = None
    is_active: bool | None = None


@strawberry.input
class ExportInput:
    format: ExportFormat  # type: ignore[valid-type]
    datasets: list[str]
    date_from: date | None = None
    date_to: date | None = None


@strawberry.input
class ReportInput:
    period: ReportPeriod = ReportPeriod.MONTHLY  # type: ignore[valid-type,assignment]
    start_date: date | None = None
    end_date: date | None = None


__all__ = [name for name in dir() if name.endswith("Input") or name in ("to_decimal", "required_decimal")]
