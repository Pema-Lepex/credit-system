"""The write half of the schema.

TRANSACTIONS -- WHY EVERY MUTATION COMMITS, AND WHY THAT IS A DECORATOR
-----------------------------------------------------------------------
The services are inconsistent about this on purpose (see services/base.py):
``AuthService.login`` MUST commit before it raises, or the failed-attempt counter
rolls back and account lockout quietly stops working. ``CreditService.create`` only
flushes, because a credit and the customer aggregates it moves must land together.

The request is therefore the transaction boundary, and something has to close it.
Doing that with ``session.commit()`` copy-pasted into forty resolvers means the
fortieth one forgets, and a payment is recorded, acknowledged to the shopkeeper,
and then silently discarded when the session closes. ``@commits`` makes it
structural: the commit happens after the resolver returns, and only if it returned.
An exception propagates with no commit, and the session is discarded unflushed.

Committing a session a service already committed is a no-op, so the decorator is
safe to apply uniformly -- which is the point: uniform is auditable.

NO ``from __future__ import annotations`` -- see the note in queries.py.
"""

import functools
import inspect
import logging
from collections.abc import Awaitable, Callable
from datetime import date, datetime
from typing import Any

import strawberry

from app.core.errors import ValidationError
from app.core.security import Permission
from app.email.service import EmailService
from app.graphql import mappers as m
from app.graphql.context import GraphQLContext
from app.graphql.inputs import (
    BusinessUpdateInput,
    CategoryInput,
    ChangePasswordInput,
    CreditCreateInput,
    CreditItemInput,
    CreditUpdateInput,
    CustomerInput,
    EmailTemplateInput,
    ExportInput,
    LoginInput,
    PaymentInput,
    ProductInput,
    ProfileUpdateInput,
    RegisterInput,
    ResetPasswordInput,
    ServiceInput,
    UserCreateInput,
    UserUpdateInput,
    required_decimal,
    to_decimal,
)
from app.graphql.types import (
    ArchiveBatchType,
    AuthPayload,
    BusinessType,
    CategoryType,
    CreditType,
    CustomerType,
    EmailTemplateType,
    EmailTemplateKind,
    ExportJobType,
    MaintenanceResult,
    MessagePayload,
    NotificationType,
    PaymentType,
    ProductType,
    ScheduledReminderType,
    ServiceType,
    UserType,
)
from app.models.business import Business
from app.models.enums import ExportFormat, ItemKind, PaymentMethod
from app.services.auth import AuthService
from app.services.base import BaseService, ServiceContext
from app.services.business import BusinessService
from app.services.catalog import CategoryService, ProductService, ServiceItemService
from app.services.credit import CreditItemInput as ServiceCreditItem
from app.services.credit import CreditService
from app.services.customer import CustomerService
from app.services.export import ExportService
from app.services.notification import NotificationService
from app.services.payment import PaymentService
from app.services.reminder import ReminderService
from app.services.retention import RetentionService
from app.services.storage_stats import StorageStatsService
from app.services.templates import TemplateService
from app.services.user import UserService
from app.utils.dates import start_of_day, today_in

log = logging.getLogger(__name__)

# The SAME sentence whether or not the address is registered. Branching here would
# rebuild the account-enumeration oracle that AuthService.request_password_reset
# deliberately closed by returning None instead of raising.
_RESET_SENT = (
    "If an account exists for that address, we have sent a link to reset the password."
)


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------
def _ctx(info: strawberry.Info) -> ServiceContext:
    context: GraphQLContext = info.context
    return context.service_ctx()


def _graphql_context(args: tuple[Any, ...], kwargs: dict[str, Any]) -> GraphQLContext:
    """Find the Info in whatever way Strawberry chose to pass it."""
    info = kwargs.get("info")
    if info is None:
        info = next((a for a in args if hasattr(a, "context")), None)
    if info is None:  # pragma: no cover - would mean a resolver with no `info` param
        raise RuntimeError("@commits requires the resolver to take `info`")
    return info.context  # type: ignore[no-any-return]


def commits(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Commit the request's transaction once the resolver has succeeded.

    Applied to every mutation. See the module docstring for why this is structural
    rather than a line at the bottom of each resolver.
    """
    if inspect.iscoroutinefunction(fn):

        @functools.wraps(fn)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            result: Awaitable[Any] = fn(*args, **kwargs)
            value = await result
            _graphql_context(args, kwargs).session.commit()
            return value

        return async_wrapper

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        value = fn(*args, **kwargs)
        _graphql_context(args, kwargs).session.commit()
        return value

    return wrapper


def _business_today(svc: BaseService) -> date:
    """Today in the business's timezone -- the reference for days_until_due/is_overdue."""
    return today_in(svc.get_business().timezone)


def _set(**fields: Any) -> dict[str, Any]:
    """Drop the keys the client did not send.

    GraphQL cannot distinguish "absent" from "explicit null" without UNSET, and the
    inputs default every optional field to None. So None means "leave it alone" --
    a partial update never blanks a column the client simply did not mention.
    """
    return {k: v for k, v in fields.items() if v is not None}


def _auth_payload(ctx: ServiceContext, user: Any, access: str, refresh: str) -> AuthPayload:
    return AuthPayload(
        access_token=access,
        refresh_token=refresh,
        user=m.to_user(ctx.session, user),
    )


def _to_service_items(items: list[CreditItemInput]) -> list[ServiceCreditItem]:
    return [
        ServiceCreditItem(
            name=i.name,
            quantity=required_decimal(i.quantity, "quantity"),
            unit_price=required_decimal(i.unit_price, "unit_price"),
            kind=ItemKind(i.kind),
            product_id=str(i.product_id) if i.product_id else None,
            service_id=str(i.service_id) if i.service_id else None,
            description=i.description,
            unit=i.unit,
            discount_amount=required_decimal(i.discount_amount, "discount_amount"),
            tax_percentage=required_decimal(i.tax_percentage, "tax_percentage"),
        )
        for i in items
    ]


# Maintenance operations a client may name. A whitelist, not getattr(service, op):
# these are the most destructive buttons in the product, and "run any method on the
# service whose name you send me" is not an API, it is a vulnerability.
_MAINTENANCE_OPS: dict[str, str] = {
    "clean_temp_files": "clean_temp_files",
    "delete_expired_exports": "delete_expired_exports",
    "sweep_orphan_files": "sweep_orphan_files",
    "vacuum_database": "vacuum_database",
    "analyze_database": "analyze_database",
    "optimize_database": "optimize_database",
    "check_integrity": "check_integrity",
    "clean_old_logs": "clean_old_logs",
}


@strawberry.type
class Mutation:
    # =====================================================================
    # Auth
    # =====================================================================
    @strawberry.mutation
    @commits
    def login(self, info: strawberry.Info, input: LoginInput) -> AuthPayload:
        ctx = _ctx(info)
        user, access, refresh = AuthService(ctx).login(
            email=input.email,
            password=input.password,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
        )
        return _auth_payload(ctx, user, access, refresh)

    @strawberry.mutation(description="Create a business and its first ADMIN, and sign them in.")
    @commits
    def register(self, info: strawberry.Info, input: RegisterInput) -> AuthPayload:
        ctx = _ctx(info)
        auth = AuthService(ctx)
        auth.register_business(
            business_name=input.business_name,
            full_name=input.full_name,
            email=input.email,
            password=input.password,
        )
        # Sign them straight in. register_business does not mint tokens (the scheduler
        # and tests create tenants too, and neither wants a session); issuing them here
        # means the client is not forced into an immediate second round trip.
        user, access, refresh = auth.login(
            email=input.email,
            password=input.password,
            ip_address=ctx.ip_address,
            user_agent=ctx.user_agent,
        )
        return _auth_payload(ctx, user, access, refresh)

    @strawberry.mutation(description="Rotate a refresh token. The presented token is revoked.")
    @commits
    def refresh_token(self, info: strawberry.Info, refresh_token: str) -> AuthPayload:
        ctx = _ctx(info)
        user, access, refresh = AuthService(ctx).refresh(refresh_token)
        return _auth_payload(ctx, user, access, refresh)

    @strawberry.mutation
    @commits
    def logout(self, info: strawberry.Info, refresh_token: str) -> MessagePayload:
        AuthService(_ctx(info)).logout(refresh_token)
        return MessagePayload(success=True, message="Signed out.")

    @strawberry.mutation(
        description="Always reports the same thing, registered address or not -- otherwise this "
        "endpoint is a free account-enumeration oracle."
    )
    @commits
    async def request_password_reset(self, info: strawberry.Info, email: str) -> MessagePayload:
        ctx = _ctx(info)
        result = AuthService(ctx).request_password_reset(email)

        if result is not None:
            user, raw_token = result
            business = ctx.session.get(Business, user.business_id) if user.business_id else None
            if business is not None:
                try:
                    # EmailService requires the session. Omitting it raised a TypeError
                    # that the except-block below swallowed, so password-reset mail was
                    # never sent -- and never looked broken, because the response is
                    # identical either way.
                    await EmailService(ctx.session).send_raw(
                        ctx.session,
                        business,
                        to_address=user.email,
                        to_name=user.full_name,
                        subject="Reset your password",
                        body_html=(
                            f"<p>Hello {user.full_name},</p>"
                            "<p>Use the code below to set a new password. It expires shortly, "
                            "and it can only be used once.</p>"
                            f"<p><code>{raw_token}</code></p>"
                            "<p>If you did not ask for this, you can ignore this email — "
                            "your password has not changed.</p>"
                        ),
                    )
                except Exception:  # noqa: BLE001
                    # A mail failure must NOT change the response: a different answer for
                    # "we could not email you" than for "no such account" is the same
                    # oracle by another route. Log it and say the same sentence.
                    log.exception("Password-reset email failed for user %s", user.id)

        return MessagePayload(success=True, message=_RESET_SENT)

    @strawberry.mutation
    @commits
    def reset_password(self, info: strawberry.Info, input: ResetPasswordInput) -> MessagePayload:
        AuthService(_ctx(info)).reset_password(input.token, input.new_password)
        return MessagePayload(
            success=True,
            message="Your password has been changed and every other session has been signed out.",
        )

    @strawberry.mutation
    @commits
    def change_password(self, info: strawberry.Info, input: ChangePasswordInput) -> UserType:
        ctx = _ctx(info)
        user = AuthService(ctx).change_password(input.current_password, input.new_password)
        return m.to_user(ctx.session, user)

    @strawberry.mutation(description="Self-service. Cannot touch role or is_active.")
    @commits
    def update_profile(self, info: strawberry.Info, input: ProfileUpdateInput) -> UserType:
        ctx = _ctx(info)
        user = UserService(ctx).update_profile(
            **_set(
                full_name=input.full_name,
                phone=input.phone,
                avatar_file_id=str(input.avatar_file_id) if input.avatar_file_id else None,
                theme=input.theme,
                language=input.language,
            )
        )
        return m.to_user(ctx.session, user)

    # =====================================================================
    # Business
    # =====================================================================
    @strawberry.mutation
    @commits
    def update_business(self, info: strawberry.Info, input: BusinessUpdateInput) -> BusinessType:
        ctx = _ctx(info)
        # No business_id argument, deliberately: BusinessService.update defaults to the
        # caller's own tenant, and there is no way to name someone else's from here.
        business = BusinessService(ctx).update(
            **_set(
                name=input.name,
                description=input.description,
                logo_file_id=str(input.logo_file_id) if input.logo_file_id else None,
                email=input.email,
                phone=input.phone,
                whatsapp_number=input.whatsapp_number,
                website=input.website,
                facebook_url=input.facebook_url,
                instagram_url=input.instagram_url,
                tiktok_url=input.tiktok_url,
                address=input.address,
                city=input.city,
                country=input.country,
                google_maps_url=input.google_maps_url,
                latitude=input.latitude,
                longitude=input.longitude,
                currency=input.currency,
                currency_symbol=input.currency_symbol,
                timezone=input.timezone,
                locale=input.locale,
                tax_percentage=input.tax_percentage,
                working_hours=input.working_hours,
                reminders_enabled=input.reminders_enabled,
                reminder_days_before=input.reminder_days_before,
                reminder_audience=input.reminder_audience,
                reminder_send_hour=input.reminder_send_hour,
                notify_owner_on_overdue=input.notify_owner_on_overdue,
                notify_owner_on_payment=input.notify_owner_on_payment,
                email_from_name=input.email_from_name,
                email_reply_to=input.email_reply_to,
                email_signature=input.email_signature,
                brand_color=input.brand_color,
                # _set() drops None but KEEPS "" -- which is exactly the three states
                # this field needs: omitted => unchanged, "" => clear, value => replace.
                w3forms_access_key=input.w3forms_access_key,
                retention_policy=input.retention_policy,
                retention_notifications_enabled=input.retention_notifications_enabled,
            )
        )
        return m.to_business(ctx.session, business)

    # =====================================================================
    # Users
    # =====================================================================
    @strawberry.mutation
    @commits
    def create_user(self, info: strawberry.Info, input: UserCreateInput) -> UserType:
        ctx = _ctx(info)
        user = UserService(ctx).create(
            email=input.email,
            full_name=input.full_name,
            password=input.password,
            role=input.role,
            phone=input.phone,
        )
        return m.to_user(ctx.session, user)

    @strawberry.mutation
    @commits
    def update_user(
        self, info: strawberry.Info, id: strawberry.ID, input: UserUpdateInput
    ) -> UserType:
        ctx = _ctx(info)
        user = UserService(ctx).update(
            str(id),
            **_set(
                full_name=input.full_name,
                phone=input.phone,
                role=input.role,
                is_active=input.is_active,
            ),
        )
        return m.to_user(ctx.session, user)

    @strawberry.mutation
    @commits
    def deactivate_user(self, info: strawberry.Info, id: strawberry.ID) -> UserType:
        ctx = _ctx(info)
        return m.to_user(ctx.session, UserService(ctx).deactivate(str(id)))

    @strawberry.mutation
    @commits
    def delete_user(self, info: strawberry.Info, id: strawberry.ID) -> UserType:
        ctx = _ctx(info)
        return m.to_user(ctx.session, UserService(ctx).soft_delete(str(id)))

    # =====================================================================
    # Customers
    # =====================================================================
    @strawberry.mutation
    @commits
    def create_customer(self, info: strawberry.Info, input: CustomerInput) -> CustomerType:
        ctx = _ctx(info)
        customer = CustomerService(ctx).create(
            input.name,
            **_set(
                phone=input.phone,
                email=input.email,
                address=input.address,
                city=input.city,
                latitude=input.latitude,
                longitude=input.longitude,
                photo_file_id=str(input.photo_file_id) if input.photo_file_id else None,
                notes=input.notes,
                status=input.status,
                credit_limit=to_decimal(input.credit_limit, "credit_limit"),
                emergency_contact_name=input.emergency_contact_name,
                emergency_contact_phone=input.emergency_contact_phone,
                emergency_contact_relation=input.emergency_contact_relation,
            ),
        )
        return m.to_customer(ctx.session, customer)

    @strawberry.mutation
    @commits
    def update_customer(
        self, info: strawberry.Info, id: strawberry.ID, input: CustomerInput
    ) -> CustomerType:
        ctx = _ctx(info)
        customer = CustomerService(ctx).update(
            str(id),
            **_set(
                name=input.name,
                phone=input.phone,
                email=input.email,
                address=input.address,
                city=input.city,
                latitude=input.latitude,
                longitude=input.longitude,
                photo_file_id=str(input.photo_file_id) if input.photo_file_id else None,
                notes=input.notes,
                status=input.status,
                credit_limit=to_decimal(input.credit_limit, "credit_limit"),
                emergency_contact_name=input.emergency_contact_name,
                emergency_contact_phone=input.emergency_contact_phone,
                emergency_contact_relation=input.emergency_contact_relation,
            ),
        )
        return m.to_customer(ctx.session, customer)

    @strawberry.mutation(description="Refused while the customer still owes money.")
    @commits
    def delete_customer(self, info: strawberry.Info, id: strawberry.ID) -> CustomerType:
        ctx = _ctx(info)
        return m.to_customer(ctx.session, CustomerService(ctx).soft_delete(str(id)))

    @strawberry.mutation
    @commits
    def restore_customer(self, info: strawberry.Info, id: strawberry.ID) -> CustomerType:
        ctx = _ctx(info)
        return m.to_customer(ctx.session, CustomerService(ctx).restore(str(id)))

    # =====================================================================
    # Catalog
    # =====================================================================
    @strawberry.mutation
    @commits
    def create_category(self, info: strawberry.Info, input: CategoryInput) -> CategoryType:
        ctx = _ctx(info)
        category = CategoryService(ctx).create(
            input.name, **_set(description=input.description, color=input.color)
        )
        return m.to_category(category)

    @strawberry.mutation
    @commits
    def update_category(
        self, info: strawberry.Info, id: strawberry.ID, input: CategoryInput
    ) -> CategoryType:
        ctx = _ctx(info)
        category = CategoryService(ctx).update(
            str(id),
            **_set(name=input.name, description=input.description, color=input.color),
        )
        return m.to_category(category)

    @strawberry.mutation(description="Members of the category are uncategorised, not deleted.")
    @commits
    def delete_category(self, info: strawberry.Info, id: strawberry.ID) -> CategoryType:
        return m.to_category(CategoryService(_ctx(info)).soft_delete(str(id)))

    @strawberry.mutation
    @commits
    def create_product(self, info: strawberry.Info, input: ProductInput) -> ProductType:
        ctx = _ctx(info)
        product = ProductService(ctx).create(
            input.name,
            **_set(
                sku=input.sku,
                barcode=input.barcode,
                description=input.description,
                category_id=str(input.category_id) if input.category_id else None,
                price=required_decimal(input.price, "price"),
                cost_price=to_decimal(input.cost_price, "cost_price"),
                tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
                stock_quantity=required_decimal(input.stock_quantity, "stock_quantity"),
                low_stock_threshold=to_decimal(
                    input.low_stock_threshold, "low_stock_threshold"
                ),
                unit=input.unit,
                image_file_ids=[str(i) for i in (input.image_file_ids or [])],
                is_active=input.is_active,
            ),
        )
        return m.to_product(ctx.session, product)

    @strawberry.mutation
    @commits
    def update_product(
        self, info: strawberry.Info, id: strawberry.ID, input: ProductInput
    ) -> ProductType:
        ctx = _ctx(info)
        product = ProductService(ctx).update(
            str(id),
            **_set(
                name=input.name,
                sku=input.sku,
                barcode=input.barcode,
                description=input.description,
                category_id=str(input.category_id) if input.category_id else None,
                price=to_decimal(input.price, "price"),
                cost_price=to_decimal(input.cost_price, "cost_price"),
                tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
                stock_quantity=to_decimal(input.stock_quantity, "stock_quantity"),
                low_stock_threshold=to_decimal(
                    input.low_stock_threshold, "low_stock_threshold"
                ),
                unit=input.unit,
                image_file_ids=(
                    [str(i) for i in input.image_file_ids]
                    if input.image_file_ids is not None
                    else None
                ),
                is_active=input.is_active,
            ),
        )
        return m.to_product(ctx.session, product)

    @strawberry.mutation
    @commits
    def delete_product(self, info: strawberry.Info, id: strawberry.ID) -> ProductType:
        ctx = _ctx(info)
        return m.to_product(ctx.session, ProductService(ctx).soft_delete(str(id)))

    @strawberry.mutation(
        description="Add to (or subtract from) stock. Stock may go negative on purpose: a stale "
        "count must never block a sale -- see models/catalog.py."
    )
    @commits
    def adjust_stock(
        self,
        info: strawberry.Info,
        id: strawberry.ID,
        delta: str,
        reason: str | None = None,
    ) -> ProductType:
        ctx = _ctx(info)
        # A quantity, not money -- but it arrives as a string for the same reason money
        # does: 0.1 + 0.2 is not 0.3 in a JSON Number.
        amount = required_decimal(delta, "delta")
        product = ProductService(ctx).adjust_stock(str(id), amount, reason=reason)
        return m.to_product(ctx.session, product)

    @strawberry.mutation
    @commits
    def create_service(self, info: strawberry.Info, input: ServiceInput) -> ServiceType:
        ctx = _ctx(info)
        service = ServiceItemService(ctx).create(
            input.name,
            **_set(
                code=input.code,
                description=input.description,
                category_id=str(input.category_id) if input.category_id else None,
                price=required_decimal(input.price, "price"),
                tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
                duration_minutes=input.duration_minutes,
                is_active=input.is_active,
            ),
        )
        return m.to_service(ctx.session, service)

    @strawberry.mutation
    @commits
    def update_service(
        self, info: strawberry.Info, id: strawberry.ID, input: ServiceInput
    ) -> ServiceType:
        ctx = _ctx(info)
        service = ServiceItemService(ctx).update(
            str(id),
            **_set(
                name=input.name,
                code=input.code,
                description=input.description,
                category_id=str(input.category_id) if input.category_id else None,
                price=to_decimal(input.price, "price"),
                tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
                duration_minutes=input.duration_minutes,
                is_active=input.is_active,
            ),
        )
        return m.to_service(ctx.session, service)

    @strawberry.mutation
    @commits
    def delete_service(self, info: strawberry.Info, id: strawberry.ID) -> ServiceType:
        ctx = _ctx(info)
        return m.to_service(ctx.session, ServiceItemService(ctx).soft_delete(str(id)))

    # =====================================================================
    # Credits
    # =====================================================================
    @strawberry.mutation
    @commits
    def create_credit(self, info: strawberry.Info, input: CreditCreateInput) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        credit = svc.create(
            ctx,
            customer_id=str(input.customer_id),
            items=_to_service_items(input.items),
            issued_date=input.issued_date,
            due_date=input.due_date,
            reminder_date=input.reminder_date,
            discount_percentage=to_decimal(input.discount_percentage, "discount_percentage"),
            tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
            notes=input.notes,
            photo_file_ids=[str(i) for i in (input.photo_file_ids or [])],
            invoice_file_id=str(input.invoice_file_id) if input.invoice_file_id else None,
            initial_payment=to_decimal(input.initial_payment, "initial_payment"),
        )
        return m.to_credit(ctx.session, credit, today=_business_today(svc))

    @strawberry.mutation
    @commits
    def update_credit(
        self, info: strawberry.Info, id: strawberry.ID, input: CreditUpdateInput
    ) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        credit = svc.update(
            ctx,
            str(id),
            # None means "leave alone" to CreditService too, so these pass straight
            # through -- including `items=None`, which must NOT clear the line set.
            items=_to_service_items(input.items) if input.items is not None else None,
            due_date=input.due_date,
            reminder_date=input.reminder_date,
            discount_percentage=to_decimal(input.discount_percentage, "discount_percentage"),
            tax_percentage=to_decimal(input.tax_percentage, "tax_percentage"),
            notes=input.notes,
            photo_file_ids=(
                [str(i) for i in input.photo_file_ids]
                if input.photo_file_ids is not None
                else None
            ),
            invoice_file_id=str(input.invoice_file_id) if input.invoice_file_id else None,
        )
        return m.to_credit(ctx.session, credit, today=_business_today(svc))

    @strawberry.mutation(description="Refused once money has changed hands -- void the payments first.")
    @commits
    def cancel_credit(
        self, info: strawberry.Info, id: strawberry.ID, reason: str | None = None
    ) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        credit = svc.cancel(ctx, str(id), reason)
        return m.to_credit(ctx.session, credit, today=_business_today(svc))

    @strawberry.mutation(description="Refused if payments exist -- cancel it instead, so the ledger survives.")
    @commits
    def delete_credit(self, info: strawberry.Info, id: strawberry.ID) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        credit = svc.soft_delete(ctx, str(id))
        return m.to_credit(ctx.session, credit, today=_business_today(svc))

    @strawberry.mutation(description="Restore a credit from the Trash. Admin only.")
    @commits
    def restore_credit(self, info: strawberry.Info, id: strawberry.ID) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        credit = svc.restore(str(id), today=_business_today(svc))
        return m.to_credit(ctx.session, credit, today=_business_today(svc))

    @strawberry.mutation(
        description="Permanently delete a credit that is already in the Trash. Cannot be undone. Admin only."
    )
    @commits
    def permanently_delete_credit(
        self, info: strawberry.Info, id: strawberry.ID
    ) -> MessagePayload:
        ctx = _ctx(info)
        number = CreditService(ctx).permanent_delete(str(id))
        return MessagePayload(success=True, message=f"Credit {number} permanently deleted.")

    # =====================================================================
    # Payments
    # =====================================================================
    @strawberry.mutation(description="Overpayment is refused here, at the counter.")
    @commits
    def record_payment(self, info: strawberry.Info, input: PaymentInput) -> PaymentType:
        ctx = _ctx(info)
        svc = PaymentService(ctx)

        # `paid_at` arrives as a calendar DATE (a shopkeeper backdating yesterday's
        # cash). Payment.paid_at is an INSTANT, so the date is anchored at local
        # midnight in the business's timezone -- anchoring it in UTC would file a
        # payment into the wrong day for half the world.
        paid_at: datetime | None = None
        if input.paid_at is not None:
            paid_at = start_of_day(input.paid_at, svc.get_business().timezone)

        payment = svc.record(
            ctx,
            credit_id=str(input.credit_id),
            amount=required_decimal(input.amount, "amount"),
            method=PaymentMethod(input.method),
            paid_at=paid_at,
            reference=input.reference,
            notes=input.notes,
            receipt_file_id=str(input.receipt_file_id) if input.receipt_file_id else None,
        )
        return m.to_payment(ctx.session, payment)

    @strawberry.mutation(
        description="Reverse a payment WITHOUT erasing it. The reason becomes part of the "
        "permanent record."
    )
    @commits
    def void_payment(
        self, info: strawberry.Info, id: strawberry.ID, reason: str
    ) -> PaymentType:
        ctx = _ctx(info)
        return m.to_payment(ctx.session, PaymentService(ctx).void(ctx, str(id), reason))

    @strawberry.mutation(
        description="Send a payment to the Trash. Its amount returns to the credit's balance. Admin only."
    )
    @commits
    def delete_payment(self, info: strawberry.Info, id: strawberry.ID) -> PaymentType:
        ctx = _ctx(info)
        return m.to_payment(ctx.session, PaymentService(ctx).soft_delete(ctx, str(id)))

    @strawberry.mutation(description="Restore a payment from the Trash. Admin only.")
    @commits
    def restore_payment(self, info: strawberry.Info, id: strawberry.ID) -> PaymentType:
        ctx = _ctx(info)
        return m.to_payment(ctx.session, PaymentService(ctx).restore(ctx, str(id)))

    @strawberry.mutation(
        description="Permanently delete a payment already in the Trash. Cannot be undone. Admin only."
    )
    @commits
    def permanently_delete_payment(
        self, info: strawberry.Info, id: strawberry.ID
    ) -> MessagePayload:
        ctx = _ctx(info)
        number = PaymentService(ctx).permanent_delete(str(id))
        return MessagePayload(success=True, message=f"Payment {number} permanently deleted.")

    # =====================================================================
    # Reminders
    # =====================================================================
    @strawberry.mutation(description="Queue an immediate reminder. The sweep delivers it.")
    @commits
    def send_reminder(
        self, info: strawberry.Info, credit_id: strawberry.ID
    ) -> ScheduledReminderType:
        ctx = _ctx(info)
        return m.to_reminder(ReminderService(ctx).send_now(ctx, str(credit_id)))

    @strawberry.mutation
    @commits
    def cancel_reminder(self, info: strawberry.Info, id: strawberry.ID) -> ScheduledReminderType:
        ctx = _ctx(info)
        return m.to_reminder(ReminderService(ctx).cancel(ctx, str(id)))

    # =====================================================================
    # Email templates
    # =====================================================================
    @strawberry.mutation
    @commits
    def update_email_template(
        self,
        info: strawberry.Info,
        kind: EmailTemplateKind,  # type: ignore[valid-type]
        input: EmailTemplateInput,
    ) -> EmailTemplateType:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        svc.require(Permission.TEMPLATE_WRITE)

        templates = TemplateService(ctx.session)
        template = templates.get_by_kind(svc.scope_id, kind)
        updated = templates.update(
            svc.scope_id,
            template.id,
            subject=input.subject,
            body_html=input.body_html,
            footer_html=input.footer_html,
            signature=input.signature,
            primary_color=input.primary_color,
            accent_color=input.accent_color,
            show_logo=input.show_logo,
            is_active=input.is_active,
        )
        return m.to_email_template(updated)

    @strawberry.mutation(description="Restore the shipped copy, discarding the owner's edits.")
    @commits
    def reset_email_template(
        self,
        info: strawberry.Info,
        kind: EmailTemplateKind,  # type: ignore[valid-type]
    ) -> EmailTemplateType:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        svc.require(Permission.TEMPLATE_WRITE)

        templates = TemplateService(ctx.session)
        template = templates.get_by_kind(svc.scope_id, kind)
        return m.to_email_template(templates.reset_to_default(svc.scope_id, template.id))

    @strawberry.mutation(description="Render the template with realistic sample data. Returns HTML.")
    def preview_email_template(
        self,
        info: strawberry.Info,
        kind: EmailTemplateKind,  # type: ignore[valid-type]
    ) -> str:
        # Read-only: no @commits. Rendering a preview must not write anything.
        ctx = _ctx(info)
        svc = BaseService(ctx)
        svc.require(Permission.SETTINGS_READ)

        templates = TemplateService(ctx.session)
        template = templates.get_by_kind(svc.scope_id, kind)
        _subject, html, _text = templates.preview(template, svc.get_business())
        return html

    # =====================================================================
    # Notifications
    # =====================================================================
    @strawberry.mutation
    @commits
    def mark_notification_read(
        self, info: strawberry.Info, id: strawberry.ID
    ) -> NotificationType:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        notification = NotificationService(ctx.session).mark_read(
            svc.scope_id, str(id), user_id=svc.user.id
        )
        return m.to_notification(notification)

    @strawberry.mutation(description="Returns how many were marked read.")
    @commits
    def mark_all_notifications_read(self, info: strawberry.Info) -> int:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        return NotificationService(ctx.session).mark_all_read(
            svc.scope_id, user_id=svc.user.id
        )

    @strawberry.mutation
    @commits
    def archive_notification(self, info: strawberry.Info, id: strawberry.ID) -> NotificationType:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        notification = NotificationService(ctx.session).archive(
            svc.scope_id, str(id), user_id=svc.user.id
        )
        return m.to_notification(notification)

    @strawberry.mutation
    @commits
    def delete_notification(self, info: strawberry.Info, id: strawberry.ID) -> MessagePayload:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        NotificationService(ctx.session).delete(svc.scope_id, str(id), user_id=svc.user.id)
        return MessagePayload(success=True, message="Notification deleted.")

    # =====================================================================
    # Exports
    # =====================================================================
    @strawberry.mutation(description="Runs the export and returns the READY (or FAILED) job.")
    @commits
    async def create_export(self, info: strawberry.Info, input: ExportInput) -> ExportJobType:
        ctx = _ctx(info)
        filters: dict[str, Any] = {}
        if input.date_from:
            filters["start"] = input.date_from
        if input.date_to:
            filters["end"] = input.date_to

        job = await ExportService(ctx).create_export(
            ctx,
            format=ExportFormat(input.format),
            datasets=list(input.datasets),
            filters=filters,
        )
        return m.to_export_job(ctx.session, job)

    # =====================================================================
    # Retention
    # =====================================================================
    @strawberry.mutation(description="Push a scheduled deletion back. The owner's veto.")
    @commits
    def postpone_deletion(
        self, info: strawberry.Info, batch_id: strawberry.ID, days: int = 30
    ) -> ArchiveBatchType:
        ctx = _ctx(info)
        return m.to_archive_batch(RetentionService(ctx).postpone(ctx, str(batch_id), days))

    @strawberry.mutation(description="Bring an archived batch back into the active lists.")
    @commits
    def restore_archive(
        self, info: strawberry.Info, batch_id: strawberry.ID
    ) -> ArchiveBatchType:
        ctx = _ctx(info)
        return m.to_archive_batch(RetentionService(ctx).restore(ctx, str(batch_id)))

    # =====================================================================
    # Storage maintenance
    # =====================================================================
    @strawberry.mutation(
        description="Run one maintenance operation. Allowed: clean_temp_files, "
        "delete_expired_exports, sweep_orphan_files, vacuum_database, analyze_database, "
        "optimize_database, check_integrity, clean_old_logs."
    )
    @commits
    async def run_maintenance(self, info: strawberry.Info, operation: str) -> MaintenanceResult:
        ctx = _ctx(info)
        name = _MAINTENANCE_OPS.get(operation.strip().lower())
        if name is None:
            raise ValidationError(
                f"Unknown maintenance operation '{operation}'. "
                f"Choose from: {', '.join(sorted(_MAINTENANCE_OPS))}",
                field="operation",
            )

        # The service does its own require(STORAGE_MAINTAIN) -- this is not a
        # substitute for it, it is a fail-fast so an unauthorised caller never gets as
        # far as opening a connection for VACUUM.
        svc = StorageStatsService(ctx)
        if name != "check_integrity":  # read-only; needs STORAGE_READ, not MAINTAIN
            svc.require(Permission.STORAGE_MAINTAIN)

        result = getattr(svc, name)()
        if inspect.isawaitable(result):
            result = await result

        # Reported honestly, including a failed integrity check: this is the one place
        # in the product where a comforting lie would be dangerous.
        return MaintenanceResult(
            operation=result.operation,
            success=result.ok,
            message=result.detail,
            bytes_freed=result.bytes_freed,
            rows_affected=result.rows_affected,
        )


__all__ = ["Mutation", "commits"]
