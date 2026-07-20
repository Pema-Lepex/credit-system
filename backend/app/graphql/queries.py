"""The read half of the schema.

NO ``from __future__ import annotations`` IN THIS MODULE -- ON PURPOSE.
----------------------------------------------------------------------
Strawberry resolves a resolver's return annotation at schema-build time. With PEP
563 in force every annotation is a string, and Strawberry then has to re-evaluate
it against a namespace it reconstructs from the module -- which silently fails for
anything imported under ``if TYPE_CHECKING`` and turns a real type into an
``UnresolvedFieldTypeError`` (or, worse, a ``String``). The models hit exactly this
bug. Annotations here are live objects; leave them that way.

TENANCY
-------
Every resolver that touches tenant data goes through ``info.context.service_ctx()``
and lets the service decide what the caller may see (BaseService.scope_id is the
boundary). No resolver takes a ``business_id`` from the client, and no resolver
writes a WHERE clause that a service could have written instead -- with two
deliberate exceptions (``search`` and ``auditLogs``), which have no service and are
therefore scoped explicitly through ``BaseService.scope_id`` and gated on the same
permissions everything else uses.
"""

import logging
from datetime import UTC, date, datetime
from typing import Any

import strawberry
from sqlalchemy import func
from sqlmodel import col, select

from app.core.security import Permission, has_permission
from app.email.renderer import AVAILABLE_VARIABLES
from app.graphql import mappers as m
from app.graphql.context import GraphQLContext
from app.graphql.inputs import (
    CreditFilterInput,
    CustomerFilterInput,
    ExpenseFilterInput,
    PageInput,
    PaymentFilterInput,
    ProductFilterInput,
    ReportInput,
    ServiceFilterInput,
    SortInput,
    to_decimal,
)
from app.graphql.types import (
    LedgerPage,
    LedgerEntryRow,
    StatementPage,
    StatementType,
    ActivityItem,
    AdminBusinessPage,
    AdminBusinessType,
    AdminStats,
    ApprovalStatus,
    PlatformSettingsType,
    ArchiveBatchPage,
    AuditAction,
    AuditLogPage,
    BusinessPage,
    BusinessType,
    CategoryType,
    CreditPage,
    CreditType,
    CustomerPage,
    CustomerScore,
    CustomerType,
    Dashboard,
    DashboardSummary,
    EmailTemplateType,
    ExpenseCategoryType,
    ExpenseGroupRow,
    ExpensePage,
    ExpenseReportType,
    ExpenseType,
    AgingBucketType,
    AgingCustomerType,
    AgingReportType,
    CashAccountType,
    CashFlowRowType,
    CashFlowType,
    DashboardAccountingType,
    ProfitLossType,
    TaxRateRowType,
    TaxSummaryType,
    RecurringExpensePage,
    RecurringExpenseType,
    VendorPage,
    VendorType,
    ExportJobPage,
    ExportJobType,
    MethodBreakdown,
    MonthlyPoint,
    NotificationPage,
    PaymentPage,
    PaymentType,
    ProductPage,
    ProductType,
    ReminderPage,
    ReportRow,
    ReportSummary,
    RetentionPreview,
    SearchHit,
    SearchResults,
    ServicePage,
    ServiceType,
    StorageBreakdown,
    StorageUsage,
    TemplateVariableType,
    TopCustomer,
    UserPage,
    UserType,
    money,
    page_info,
)
from app.models.catalog import Product
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import (
    CreditStatus,
    EmailTemplateKind,
    NotificationState,
    ReminderStatus,
    ReportPeriod,
    RetentionPolicy,
)
from app.models.file import FileAsset
from app.models.retention import AuditLog
from app.models.enums import PaymentMethod
from app.services.accounting import AccountingService
from app.services.analytics import AnalyticsService
from app.services.cash_account import CashAccountService
from app.services.recurring import RecurringExpenseService
from app.services.vendor import VendorService
from app.services.base import BaseService, ServiceContext
from app.services.business import BusinessService
from app.services.catalog import CategoryService, ProductService, ServiceItemService
from app.services.credit import CreditFilter, CreditService
from app.services.customer import CustomerService
from app.services.expense import ExpenseCategoryService, ExpenseFilter, ExpenseService
from app.services.export import ExportService
from app.services.ledger import LedgerService
from app.services.notification import NotificationService
from app.services.statement import StatementService
from app.services.payment import PaymentFilter, PaymentService
from app.services.platform import PlatformService, resolve_registration_notice_key
from app.services.reminder import ReminderService
from app.services.reports import ReportService
from app.services.retention import RetentionService
from app.services.storage_stats import StorageStatsService
from app.services.templates import TemplateService
from app.services.user import UserService
from app.utils.dates import end_of_day, start_of_day, today_in
from app.utils.pagination import PageInput as ServicePage_

log = logging.getLogger(__name__)

# The ⌘K palette shows a handful of hits per entity type, not a page of them.
_SEARCH_PER_KIND = 5


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------
def _ctx(info: strawberry.Info) -> ServiceContext:
    """The ONE way a resolver obtains a service context. Never takes a business_id
    from the client -- BaseService.scope_id pins a non-superadmin to their own."""
    context: GraphQLContext = info.context
    return context.service_ctx()


def _page(page: PageInput | None) -> ServicePage_:
    return ServicePage_(page=page.page, limit=page.limit) if page else ServicePage_()


def _sort(sort: SortInput | None, default: str) -> tuple[str, bool]:
    return (sort.field, sort.desc) if sort else (default, True)


def _today(svc: BaseService) -> date:
    """Today in the BUSINESS's timezone -- the only 'today' a due date may be compared to."""
    return today_in(svc.get_business().timezone)


@strawberry.type
class Query:
    # =====================================================================
    # Identity
    # =====================================================================
    @strawberry.field(description="The signed-in user, with the permissions their role grants.")
    def me(self, info: strawberry.Info) -> UserType:
        from app.services.auth import AuthService

        ctx = _ctx(info)
        return m.to_user(ctx.session, AuthService(ctx).me())

    @strawberry.field(description="The caller's own business.")
    def business(self, info: strawberry.Info) -> BusinessType:
        ctx = _ctx(info)
        return m.to_business(ctx.session, BusinessService(ctx).get())

    @strawberry.field(description="Every business on the platform. SUPER_ADMIN only.")
    def businesses(
        self,
        info: strawberry.Info,
        page: PageInput | None = None,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> BusinessPage:
        ctx = _ctx(info)
        result = BusinessService(ctx).list_businesses(
            _page(page), search=search, is_active=is_active
        )
        return BusinessPage(
            items=[m.to_business(ctx.session, b) for b in result.items],
            page_info=page_info(result),
        )

    @strawberry.field(description="Staff accounts in the caller's business.")
    def users(
        self,
        info: strawberry.Info,
        page: PageInput | None = None,
        search: str | None = None,
        role: str | None = None,
        is_active: bool | None = None,
    ) -> UserPage:
        ctx = _ctx(info)
        result = UserService(ctx).list(
            _page(page), search=search, role=role, is_active=is_active
        )
        return UserPage(
            items=[m.to_user(ctx.session, u) for u in result.items],
            page_info=page_info(result),
        )

    # =====================================================================
    # Super Admin panel (store-owner approvals). SUPER_ADMIN only -- the service
    # guards every call with BUSINESS_CREATE + an explicit is_super_admin check.
    # =====================================================================
    @strawberry.field(description="Store-owner counts by approval state. SUPER_ADMIN only.")
    def admin_stats(self, info: strawberry.Info) -> AdminStats:
        ctx = _ctx(info)
        s = BusinessService(ctx).admin_stats()
        return AdminStats(
            total_store_owners=s["total"],
            pending=s["pending"],
            approved=s["approved"],
            rejected=s["rejected"],
            suspended=s["suspended"],
        )

    @strawberry.field(description="Every store owner, optionally filtered by status. SUPER_ADMIN only.")
    def admin_businesses(
        self,
        info: strawberry.Info,
        page: PageInput | None = None,
        status: ApprovalStatus | None = None,  # type: ignore[valid-type]
        search: str | None = None,
    ) -> AdminBusinessPage:
        ctx = _ctx(info)
        svc = BusinessService(ctx)
        result = svc.list_for_admin(_page(page), status=status, search=search)
        # Batch the owners so a page of 25 businesses is two queries, not twenty-six.
        owners = svc.owners_for([b.id for b in result.items])
        return AdminBusinessPage(
            items=[
                m.to_admin_business(ctx.session, b, owner=owners.get(b.id))
                for b in result.items
            ],
            page_info=page_info(result),
        )

    @strawberry.field(description="One store owner, with its owner and counts. SUPER_ADMIN only.")
    def admin_business(self, info: strawberry.Info, id: strawberry.ID) -> AdminBusinessType:
        ctx = _ctx(info)
        svc = BusinessService(ctx)
        business = svc.get_for_admin(str(id))
        owner = svc.owners_for([business.id]).get(business.id)
        counts = svc.counts_for(business.id)
        return m.to_admin_business(ctx.session, business, owner=owner, counts=counts)

    @strawberry.field(description="Platform settings (e.g. the W3Forms key). SUPER_ADMIN only.")
    def platform_settings(self, info: strawberry.Info) -> PlatformSettingsType:
        ctx = _ctx(info)
        return m.to_platform_settings(PlatformService(ctx).get())

    @strawberry.field(
        description=(
            "The W3Forms access key used to email the super-admin when a new store "
            "owner signs up. Returned in the clear and WITHOUT authentication ON "
            "PURPOSE: a W3Forms access key is a client-side credential -- its only "
            "power is to POST a notice to the operator's own inbox, it reads nothing "
            "-- and W3Forms' free tier accepts submissions from a browser but rejects "
            "them from a server (HTTP 403, 'Pro plan required'). So the register page "
            "reads this key and sends the notice itself, client-side. Null when no key "
            "is configured (dashboard first, then env)."
        )
    )
    def registration_notice_key(self, info: strawberry.Info) -> str | None:
        return resolve_registration_notice_key(_ctx(info).session)

    # =====================================================================
    # Customers
    # =====================================================================
    @strawberry.field
    def customer(self, info: strawberry.Info, id: strawberry.ID) -> CustomerType:
        ctx = _ctx(info)
        return m.to_customer(ctx.session, CustomerService(ctx).get(str(id)))

    @strawberry.field
    def customers(
        self,
        info: strawberry.Info,
        filter: CustomerFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> CustomerPage:
        ctx = _ctx(info)
        f = filter or CustomerFilterInput()
        sort_by, sort_desc = _sort(sort, "created_at")

        result = CustomerService(ctx).list(
            _page(page),
            search=f.search,
            status=list(f.status) if f.status else None,
            min_outstanding=to_decimal(f.min_outstanding, "min_outstanding"),
            max_outstanding=to_decimal(f.max_outstanding, "max_outstanding"),
            has_overdue=f.has_overdue,
            sort_by=sort_by,
            sort_desc=sort_desc,
        )
        return CustomerPage(
            items=m.to_customer_rows(ctx.session, result.items),
            page_info=page_info(result),
        )

    @strawberry.field(description="The 0-100 credit score and the plain-language reasons for it.")
    def customer_score(self, info: strawberry.Info, id: strawberry.ID) -> CustomerScore:
        ctx = _ctx(info)
        score, reasons = CustomerService(ctx).score_breakdown(str(id))
        return CustomerScore(customer_id=id, score=score, reasons=reasons)

    # =====================================================================
    # Catalog
    # =====================================================================
    @strawberry.field
    def categories(
        self, info: strawberry.Info, search: str | None = None
    ) -> list[CategoryType]:
        # Categories are a short, flat list (they populate a <select>), so they are
        # not paginated. MAX_PAGE_SIZE still caps the fetch.
        ctx = _ctx(info)
        result = CategoryService(ctx).list(ServicePage_(page=1, limit=100), search=search)
        return [m.to_category(c) for c in result.items]

    @strawberry.field
    def product(self, info: strawberry.Info, id: strawberry.ID) -> ProductType:
        ctx = _ctx(info)
        return m.to_product(ctx.session, ProductService(ctx).get(str(id)))

    @strawberry.field
    def products(
        self,
        info: strawberry.Info,
        filter: ProductFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> ProductPage:
        ctx = _ctx(info)
        f = filter or ProductFilterInput()
        sort_by, sort_desc = _sort(sort, "name")

        result = ProductService(ctx).list(
            _page(page),
            search=f.search,
            category_id=str(f.category_id) if f.category_id else None,
            is_active=f.is_active,
            low_stock=f.low_stock_only,
            sort_by=sort_by,
            sort_desc=sort_desc if sort else False,
        )
        return ProductPage(
            items=[m.to_product(ctx.session, p) for p in result.items],
            page_info=page_info(result),
        )

    @strawberry.field
    def service(self, info: strawberry.Info, id: strawberry.ID) -> ServiceType:
        ctx = _ctx(info)
        return m.to_service(ctx.session, ServiceItemService(ctx).get(str(id)))

    @strawberry.field
    def services(
        self,
        info: strawberry.Info,
        filter: ServiceFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> ServicePage:
        ctx = _ctx(info)
        f = filter or ServiceFilterInput()
        sort_by, sort_desc = _sort(sort, "name")

        result = ServiceItemService(ctx).list(
            _page(page),
            search=f.search,
            category_id=str(f.category_id) if f.category_id else None,
            is_active=f.is_active,
            sort_by=sort_by,
            sort_desc=sort_desc if sort else False,
        )
        return ServicePage(
            items=[m.to_service(ctx.session, s) for s in result.items],
            page_info=page_info(result),
        )

    # =====================================================================
    # Credits
    # =====================================================================
    @strawberry.field
    def credit(self, info: strawberry.Info, id: strawberry.ID) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        return m.to_credit(ctx.session, svc.get(str(id)), today=_today(svc))

    @strawberry.field(description="Look a credit up by its human reference, e.g. CR-2026-0042.")
    def credit_by_number(self, info: strawberry.Info, number: str) -> CreditType:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        return m.to_credit(ctx.session, svc.get_by_number(number), today=_today(svc))

    @strawberry.field
    def credits(
        self,
        info: strawberry.Info,
        filter: CreditFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> CreditPage:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        sort_by, sort_desc = _sort(sort, "created_at")

        result = svc.list(_to_credit_filter(filter), _page(page), sort_by=sort_by, sort_desc=sort_desc)
        today = _today(svc)
        return CreditPage(
            items=m.to_credit_rows(ctx.session, result.items, today=today),
            page_info=page_info(result),
        )

    # =====================================================================
    # Payments
    # =====================================================================
    @strawberry.field
    def payment(self, info: strawberry.Info, id: strawberry.ID) -> PaymentType:
        ctx = _ctx(info)
        return m.to_payment(ctx.session, PaymentService(ctx).get(str(id)))

    @strawberry.field
    def payments(
        self,
        info: strawberry.Info,
        filter: PaymentFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> PaymentPage:
        ctx = _ctx(info)
        sort_by, sort_desc = _sort(sort, "paid_at")

        result = PaymentService(ctx).list(
            _to_payment_filter(filter), _page(page), sort_by=sort_by, sort_desc=sort_desc
        )
        return PaymentPage(
            items=m.to_payment_rows(ctx.session, result.items),
            page_info=page_info(result),
        )

    # =====================================================================
    # Expenses (money out)
    # =====================================================================
    @strawberry.field
    def expense(self, info: strawberry.Info, id: strawberry.ID) -> ExpenseType:
        ctx = _ctx(info)
        return m.to_expense(ctx.session, ExpenseService(ctx).get(str(id)))

    @strawberry.field
    def expenses(
        self,
        info: strawberry.Info,
        filter: ExpenseFilterInput | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> ExpensePage:
        ctx = _ctx(info)
        sort_by, sort_desc = _sort(sort, "expense_date")

        result = ExpenseService(ctx).list(
            _to_expense_filter(filter), _page(page), sort_by=sort_by, sort_desc=sort_desc
        )
        return ExpensePage(
            items=[m.to_expense(ctx.session, e) for e in result.items],
            page_info=page_info(result),
        )

    @strawberry.field(description="Trashed expenses, newest first.")
    def deleted_expenses(
        self, info: strawberry.Info, page: PageInput | None = None
    ) -> ExpensePage:
        ctx = _ctx(info)
        result = ExpenseService(ctx).list_deleted(_page(page))
        return ExpensePage(
            items=[m.to_expense(ctx.session, e) for e in result.items],
            page_info=page_info(result),
        )

    @strawberry.field
    def expense_categories(
        self,
        info: strawberry.Info,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> list[ExpenseCategoryType]:
        ctx = _ctx(info)
        result = ExpenseCategoryService(ctx).list(
            ServicePage_(page=1, limit=100), search=search, is_active=is_active
        )
        return [m.to_expense_category(c) for c in result.items]

    # =====================================================================
    # Vendors, cash accounts, recurring expenses (Phase 2)
    # =====================================================================
    @strawberry.field
    def vendor(self, info: strawberry.Info, id: strawberry.ID) -> VendorType:
        return m.to_vendor(VendorService(_ctx(info)).get(str(id)))

    @strawberry.field
    def vendors(
        self,
        info: strawberry.Info,
        search: str | None = None,
        is_active: bool | None = None,
        page: PageInput | None = None,
        sort: SortInput | None = None,
    ) -> VendorPage:
        ctx = _ctx(info)
        sort_by, sort_desc = _sort(sort, "name")
        result = VendorService(ctx).list(
            _page(page),
            search=search,
            is_active=is_active,
            sort_by=sort_by,
            sort_desc=sort_desc if sort else False,
        )
        return VendorPage(
            items=[m.to_vendor(v) for v in result.items], page_info=page_info(result)
        )

    @strawberry.field(
        description="Cash accounts with their derived balances, cheapest ordering first."
    )
    def cash_accounts(
        self, info: strawberry.Info, is_active: bool | None = None
    ) -> list[CashAccountType]:
        ctx = _ctx(info)
        return [
            m.to_cash_account(b)
            for b in CashAccountService(ctx).list_with_balances(is_active=is_active)
        ]

    @strawberry.field
    def cash_account(self, info: strawberry.Info, id: strawberry.ID) -> CashAccountType:
        ctx = _ctx(info)
        return m.to_cash_account(CashAccountService(ctx).balance_of(str(id)))

    @strawberry.field
    def recurring_expense(
        self, info: strawberry.Info, id: strawberry.ID
    ) -> RecurringExpenseType:
        ctx = _ctx(info)
        return m.to_recurring_expense(
            ctx.session, RecurringExpenseService(ctx).get(str(id))
        )

    @strawberry.field
    def recurring_expenses(
        self,
        info: strawberry.Info,
        search: str | None = None,
        is_active: bool | None = None,
        page: PageInput | None = None,
    ) -> RecurringExpensePage:
        ctx = _ctx(info)
        result = RecurringExpenseService(ctx).list(
            _page(page), search=search, is_active=is_active
        )
        return RecurringExpensePage(
            items=[m.to_recurring_expense(ctx.session, t) for t in result.items],
            page_info=page_info(result),
        )

    # =====================================================================
    # The customer account ledger
    # =====================================================================
    @strawberry.field(
        description=(
            "A customer's passbook: every charge, payment and correction against "
            "their account, newest first, each with the running balance at that "
            "point. Append-only -- a reversal appears alongside the entry it "
            "cancels rather than replacing it."
        )
    )
    def customer_ledger(
        self,
        info: strawberry.Info,
        customer_id: strawberry.ID,
        page: PageInput | None = None,
    ) -> LedgerPage:
        ctx = _ctx(info)
        result = LedgerService(ctx).list_entries(str(customer_id), _page(page))
        return LedgerPage(
            items=[m.to_ledger_entry(e) for e in result.items],
            page_info=page_info(result),
        )

    @strawberry.field(
        description=(
            "Monthly statements, newest first. ONE per customer per month -- the "
            "document that carries the due date, replacing four hundred per-purchase "
            "ones."
        )
    )
    def statements(
        self,
        info: strawberry.Info,
        customer_id: strawberry.ID | None = None,
        page: PageInput | None = None,
    ) -> StatementPage:
        ctx = _ctx(info)
        result = StatementService(ctx).list(
            customer_id=str(customer_id) if customer_id else None, page=_page(page)
        )
        return StatementPage(
            items=[m.to_statement(ctx.session, s) for s in result.items],
            page_info=page_info(result),
        )

    @strawberry.field(description="One statement.")
    def statement(self, info: strawberry.Info, id: strawberry.ID) -> StatementType:
        ctx = _ctx(info)
        return m.to_statement(ctx.session, StatementService(ctx).get(str(id)))

    @strawberry.field(
        description="The ledger lines a statement covers -- the detail behind its total."
    )
    def statement_entries(
        self, info: strawberry.Info, id: strawberry.ID
    ) -> list[LedgerEntryRow]:
        ctx = _ctx(info)
        return [m.to_ledger_entry(e) for e in StatementService(ctx).entries_for(str(id))]

    # =====================================================================
    # Trash (deleted credits + payments). Admin-only -- the services require
    # CREDIT_DELETE / PAYMENT_DELETE, which staff do not hold.
    # =====================================================================
    @strawberry.field(description="Credits in the Trash: soft-deleted, recoverable.")
    def deleted_credits(
        self, info: strawberry.Info, page: PageInput | None = None
    ) -> CreditPage:
        ctx = _ctx(info)
        svc = CreditService(ctx)
        result = svc.list_deleted(_page(page))
        today = _today(svc)
        return CreditPage(
            items=m.to_credit_rows(ctx.session, result.items, today=today),
            page_info=page_info(result),
        )

    @strawberry.field(description="Payments in the Trash: soft-deleted, recoverable.")
    def deleted_payments(
        self, info: strawberry.Info, page: PageInput | None = None
    ) -> PaymentPage:
        ctx = _ctx(info)
        result = PaymentService(ctx).list_deleted(_page(page))
        return PaymentPage(
            items=m.to_payment_rows(ctx.session, result.items),
            page_info=page_info(result),
        )

    @strawberry.field(
        description="Every payment on a credit, VOIDED ONES INCLUDED -- the ledger is append-only "
        "and the UI strikes voids through rather than hiding them."
    )
    def payment_history(self, info: strawberry.Info, credit_id: strawberry.ID) -> list[PaymentType]:
        ctx = _ctx(info)
        rows = PaymentService(ctx).history_for_credit(str(credit_id))
        return [m.to_payment(ctx.session, p) for p in rows]

    # =====================================================================
    # Dashboard
    # =====================================================================
    @strawberry.field(description="Everything the dashboard draws, in one round trip.")
    def dashboard(self, info: strawberry.Info) -> Dashboard:
        ctx = _ctx(info)
        analytics = AnalyticsService(ctx)
        credits = CreditService(ctx)
        session = ctx.session

        summary = analytics.dashboard_summary()
        today = today_in(analytics.get_business().timezone)

        # TopCustomer carries a credit_score, which the analytics dataclass does not.
        # Five primary-key gets against the identity map, not a join.
        def top(customer_id: str, name: str, outstanding: Any, total: Any, count: int) -> TopCustomer:
            row = session.get(Customer, customer_id)
            return TopCustomer(
                customer_id=strawberry.ID(customer_id),
                name=name,
                outstanding=money(outstanding),
                total_credit=money(total),
                credit_count=count,
                credit_score=row.credit_score if row else 0,
            )

        return Dashboard(
            summary=DashboardSummary(
                total_customers=summary.total_customers.count,
                active_customers=summary.active_customers.count,
                total_credits=summary.total_credits.count,
                total_credit_value=money(summary.total_credit_value.value),
                overdue_count=summary.overdue_count.count,
                overdue_amount=money(summary.overdue_amount.value),
                due_today_count=summary.due_today_count.count,
                due_today_amount=money(summary.due_today_amount.value),
                total_revenue=money(summary.total_revenue.value),
                pending_revenue=money(summary.pending_revenue.value),
                collections_this_month=money(summary.collections_this_month.value),
                collections_last_month=money(summary.collections_last_month.value),
                collections_delta_percent=_pct(summary.collections_this_month.delta_pct),
                currency=summary.currency,
                currency_symbol=summary.currency_symbol,
            ),
            monthly=[
                MonthlyPoint(
                    month=p.label,                    # "2026-07"
                    label=p.month.strftime("%b"),     # "Jul"
                    credit_issued=money(p.credit_issued),
                    collected=money(p.collected),
                    overdue_amount=money(p.overdue_amount),
                )
                for p in analytics.monthly_series(12)
            ],
            overdue_trend=[
                MonthlyPoint(
                    month=p.label,
                    label=p.month.strftime("%b"),
                    # OverduePoint measures one thing. Issued/collected are not part of
                    # that series and are reported as zero rather than invented.
                    credit_issued=money(0),
                    collected=money(0),
                    overdue_amount=money(p.amount),
                )
                for p in analytics.overdue_trend(6)
            ],
            top_customers=[
                top(c.customer_id, c.name, c.outstanding, c.total_credit, c.credit_count)
                for c in analytics.top_customers(limit=5, by="outstanding")
            ],
            latest_activity=[
                ActivityItem(
                    kind=e.kind,
                    id=strawberry.ID(e.id),
                    label=e.label,
                    amount=money(e.amount),
                    customer_name=e.customer_name,
                    at=e.at,
                )
                for e in analytics.latest_transactions(10)
            ],
            # CreditService, not AnalyticsService: the type is a full CreditType, and
            # analytics' UpcomingDue is a projection with only five of its fields.
            upcoming_due=[
                m.to_credit(session, c, today=today)
                for c in credits.upcoming_due(days=7, limit=10)
            ],
            collections_by_method=[
                MethodBreakdown(method=s.method, total=money(s.total), count=s.count)
                for s in analytics.collections_by_method()
            ],
            accounting=_dashboard_accounting(ctx),
            recent_expenses=[
                m.to_expense(session, e)
                for e in ExpenseService(ctx).list(page=ServicePage_(page=1, limit=5)).items
            ],
            # The aging report's own rows, so "overdue" means the same thing here as
            # it does on the receivables page. Top five worst.
            overdue_customers=_overdue_customers(ctx, limit=5),
        )

    # =====================================================================
    # Global search (the ⌘K palette)
    # =====================================================================
    @strawberry.field(
        description="Global search across customers (name/phone/code), credits (number), "
        "payments (reference/number) and products (name/SKU)."
    )
    def search(self, info: strawberry.Info, query: str, limit: int = 20) -> SearchResults:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        user = svc.user                 # 401 for an anonymous caller
        business_id = svc.scope_id      # TENANCY BOUNDARY -- never from the client
        session = ctx.session

        term = query.strip()
        if not term:
            return SearchResults(hits=[], total=0)
        like = f"%{term}%"
        cap = max(1, min(limit, 50))
        hits: list[SearchHit] = []

        # Each block is gated on the same permission the corresponding list query
        # needs: search must not be a back door to a table you cannot read.
        if has_permission(user.role, Permission.CUSTOMER_READ):
            rows = session.exec(
                select(Customer)
                .where(
                    Customer.business_id == business_id,
                    col(Customer.deleted_at).is_(None),
                    col(Customer.name).ilike(like)
                    | col(Customer.phone).ilike(like)
                    | col(Customer.code).ilike(like)
                    | col(Customer.email).ilike(like),
                )
                .order_by(col(Customer.name).asc())
                .limit(_SEARCH_PER_KIND)
            ).all()
            hits += [
                SearchHit(
                    kind="customer",
                    id=strawberry.ID(c.id),
                    title=c.name,
                    subtitle=" · ".join(p for p in (c.code, c.phone) if p),
                    amount=money(c.outstanding_balance),
                    status=c.status.value,
                )
                for c in rows
            ]

        if has_permission(user.role, Permission.CREDIT_READ):
            rows = session.exec(
                select(Credit)
                .where(
                    Credit.business_id == business_id,
                    col(Credit.deleted_at).is_(None),
                    col(Credit.number).ilike(like),
                )
                .order_by(col(Credit.created_at).desc())
                .limit(_SEARCH_PER_KIND)
            ).all()
            hits += [
                SearchHit(
                    kind="credit",
                    id=strawberry.ID(c.id),
                    title=c.number,
                    subtitle=f"Due {c.due_date.isoformat()}",
                    amount=money(c.remaining_amount),
                    status=CreditStatus(c.status).value,
                )
                for c in rows
            ]

        if has_permission(user.role, Permission.PAYMENT_READ):
            rows = session.exec(
                select(Payment)
                .where(
                    Payment.business_id == business_id,
                    col(Payment.deleted_at).is_(None),
                    col(Payment.reference).ilike(like) | col(Payment.number).ilike(like),
                )
                .order_by(col(Payment.paid_at).desc())
                .limit(_SEARCH_PER_KIND)
            ).all()
            hits += [
                SearchHit(
                    kind="payment",
                    id=strawberry.ID(p.id),
                    title=p.number,
                    subtitle=p.reference or p.method.value,
                    amount=money(p.amount),
                    status="VOID" if p.voided_at else "OK",
                )
                for p in rows
            ]

        if has_permission(user.role, Permission.CATALOG_READ):
            rows = session.exec(
                select(Product)
                .where(
                    Product.business_id == business_id,
                    col(Product.deleted_at).is_(None),
                    col(Product.name).ilike(like)
                    | col(Product.sku).ilike(like)
                    | col(Product.barcode).ilike(like),
                )
                .order_by(col(Product.name).asc())
                .limit(_SEARCH_PER_KIND)
            ).all()
            hits += [
                SearchHit(
                    kind="product",
                    id=strawberry.ID(p.id),
                    title=p.name,
                    subtitle=p.sku or "",
                    amount=money(p.price),
                    status="ACTIVE" if p.is_active else "INACTIVE",
                )
                for p in rows
            ]

        return SearchResults(hits=hits[:cap], total=len(hits))

    # =====================================================================
    # Notifications
    # =====================================================================
    @strawberry.field
    def notifications(
        self,
        info: strawberry.Info,
        state: NotificationState | None = None,
        page: PageInput | None = None,
    ) -> NotificationPage:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        user = svc.user
        business_id = svc.scope_id

        notifications = NotificationService(ctx.session)
        result = notifications.list(
            business_id, user_id=user.id, state=state, page=_page(page)
        )
        return NotificationPage(
            items=[m.to_notification(n) for n in result.items],
            page_info=page_info(result),
            unread_count=notifications.unread_count(business_id, user_id=user.id),
        )

    @strawberry.field(description="Badge count. A COUNT(*), not a fetch.")
    def unread_notification_count(self, info: strawberry.Info) -> int:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        return NotificationService(ctx.session).unread_count(
            svc.scope_id, user_id=svc.user.id
        )

    # =====================================================================
    # Email templates
    # =====================================================================
    @strawberry.field
    def email_templates(self, info: strawberry.Info) -> list[EmailTemplateType]:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        svc.require(Permission.SETTINGS_READ)
        rows = TemplateService(ctx.session).list(svc.scope_id)
        return [m.to_email_template(t) for t in rows]

    @strawberry.field
    def email_template(
        self,
        info: strawberry.Info,
        kind: EmailTemplateKind,  # type: ignore[valid-type]
    ) -> EmailTemplateType:
        ctx = _ctx(info)
        svc = BaseService(ctx)
        svc.require(Permission.SETTINGS_READ)
        return m.to_email_template(
            TemplateService(ctx.session).get_by_kind(svc.scope_id, kind)
        )

    @strawberry.field(description="The {{variables}} this template kind may use.")
    def template_variables(
        self,
        info: strawberry.Info,
        kind: EmailTemplateKind,  # type: ignore[valid-type]
    ) -> list[TemplateVariableType]:
        BaseService(_ctx(info)).require(Permission.SETTINGS_READ)
        return [m.to_template_variable(v) for v in AVAILABLE_VARIABLES.get(kind, [])]

    # =====================================================================
    # Reminders
    # =====================================================================
    @strawberry.field
    def reminders(
        self,
        info: strawberry.Info,
        status: list[ReminderStatus] | None = None,  # type: ignore[valid-type]
        credit_id: strawberry.ID | None = None,
        page: PageInput | None = None,
    ) -> ReminderPage:
        ctx = _ctx(info)
        result = ReminderService(ctx).list(
            _page(page),
            status=[ReminderStatus(s) for s in status] if status else None,
            credit_id=str(credit_id) if credit_id else None,
        )
        return ReminderPage(
            items=[m.to_reminder(r) for r in result.items],
            page_info=page_info(result),
        )

    # =====================================================================
    # Reports
    # =====================================================================
    @strawberry.field
    def report(self, info: strawberry.Info, input: ReportInput | None = None) -> ReportSummary:
        ctx = _ctx(info)
        session = ctx.session
        spec = input or ReportInput()

        data = ReportService(ctx).generate(
            ReportPeriod(spec.period), start=spec.start_date, end=spec.end_date
        )
        s = data.summary
        return ReportSummary(
            period=data.period,
            start_date=data.start,
            end_date=data.end,
            total_issued=money(s.credits_issued),
            total_issued_count=s.credit_count,
            total_collected=money(s.collected),
            total_collected_count=s.payment_count,
            outstanding=money(s.outstanding_at_end),
            overdue_amount=money(s.overdue_amount),
            overdue_count=s.overdue_count,
            rows=[
                ReportRow(
                    label=r.label,
                    credits_issued=money(r.credits_issued),
                    credits_count=r.credit_count,
                    collected=money(r.collected),
                    payments_count=r.payment_count,
                )
                for r in data.rows
            ],
            top_customers=[
                TopCustomer(
                    customer_id=strawberry.ID(c.customer_id),
                    name=c.name,
                    outstanding=money(c.outstanding),
                    # In a PERIOD report, "total credit" is what they were billed in the
                    # period -- not their lifetime total. See ReportService._top_customers.
                    total_credit=money(c.credits_issued),
                    credit_count=c.credit_count,
                    credit_score=_score_of(session, c.customer_id),
                )
                for c in data.top_customers
            ],
            by_method=[
                MethodBreakdown(method=b.method, total=money(b.total), count=b.count)
                for b in data.by_method
            ],
        )

    @strawberry.field(
        description="Total spending for a period, grouped by category, vendor and method."
    )
    def expense_report(
        self,
        info: strawberry.Info,
        input: ReportInput | None = None,
        filter: ExpenseFilterInput | None = None,
    ) -> ExpenseReportType:
        ctx = _ctx(info)
        spec = input or ReportInput()
        f = filter or ExpenseFilterInput()

        data = AccountingService(ctx).expense_report(
            ReportPeriod(spec.period),
            start=spec.start_date,
            end=spec.end_date,
            category_id=str(f.category_id) if f.category_id else None,
            vendor_name=f.vendor_name,
            payment_method=(
                [PaymentMethod(m) for m in f.payment_method] if f.payment_method else None
            ),
            created_by_user_id=str(f.created_by_user_id) if f.created_by_user_id else None,
        )
        return ExpenseReportType(
            period=data.period,
            start_date=data.start,
            end_date=data.end,
            total=money(data.total),
            count=data.count,
            by_category=_group_rows(data.by_category, data.total),
            by_vendor=_group_rows(data.by_vendor, data.total),
            by_method=_group_rows(data.by_method, data.total),
        )

    @strawberry.field(
        description=(
            "Cash-basis profit and loss. A management figure, not an accounting "
            "statement -- see app/services/accounting.py."
        )
    )
    def profit_loss(
        self, info: strawberry.Info, input: ReportInput | None = None
    ) -> ProfitLossType:
        ctx = _ctx(info)
        spec = input or ReportInput()

        data = AccountingService(ctx).profit_loss(
            ReportPeriod(spec.period), start=spec.start_date, end=spec.end_date
        )
        return ProfitLossType(
            period=data.period,
            start_date=data.start,
            end_date=data.end,
            revenue=money(data.revenue),
            cost_of_goods_sold=money(data.cost_of_goods_sold),
            gross_profit=money(data.gross_profit),
            operating_expenses=money(data.operating_expenses),
            net_profit=money(data.net_profit),
            net_margin_pct=money(data.net_margin_pct),
            expenses_by_category=_group_rows(
                data.expenses_by_category, data.operating_expenses
            ),
            basis="Cash basis",
        )

    @strawberry.field(description="Money in against money out, bucketed over time.")
    def cash_flow(
        self, info: strawberry.Info, input: ReportInput | None = None
    ) -> CashFlowType:
        ctx = _ctx(info)
        spec = input or ReportInput()

        data = AccountingService(ctx).cash_flow(
            ReportPeriod(spec.period), start=spec.start_date, end=spec.end_date
        )
        return CashFlowType(
            period=data.period,
            start_date=data.start,
            end_date=data.end,
            granularity=data.granularity,
            total_in=money(data.total_in),
            total_out=money(data.total_out),
            net_flow=money(data.net_flow),
            rows=[
                CashFlowRowType(
                    bucket=r.bucket,
                    label=r.label,
                    money_in=money(r.money_in),
                    money_out=money(r.money_out),
                    net=money(r.net),
                )
                for r in data.rows
            ],
        )

    @strawberry.field(
        description="Money customers owe, by how late it is. Defaults to today."
    )
    def aging_receivable(
        self, info: strawberry.Info, as_at: date | None = None
    ) -> AgingReportType:
        ctx = _ctx(info)
        data = AccountingService(ctx).aging_receivable(as_at=as_at)

        return AgingReportType(
            as_at=data.as_at,
            total_outstanding=money(data.total_outstanding),
            buckets=[
                AgingBucketType(
                    key=b.key,
                    label=b.label,
                    total=money(b.total),
                    count=b.count,
                    share_pct=money(b.share_of(data.total_outstanding)),
                )
                for b in data.buckets
            ],
            customers=[
                AgingCustomerType(
                    customer_id=strawberry.ID(c.customer_id),
                    name=c.name,
                    phone=c.phone,
                    current=money(c.buckets.get("CURRENT")),
                    days_1_to_30=money(c.buckets.get("D1_30")),
                    days_31_to_60=money(c.buckets.get("D31_60")),
                    days_61_to_90=money(c.buckets.get("D61_90")),
                    days_90_plus=money(c.buckets.get("D90_PLUS")),
                    total=money(c.total),
                    oldest_days=c.oldest_days,
                )
                for c in data.customers
            ],
        )

    @strawberry.field(description="Tax charged, grouped by rate.")
    def tax_summary(
        self, info: strawberry.Info, input: ReportInput | None = None
    ) -> TaxSummaryType:
        ctx = _ctx(info)
        spec = input or ReportInput()

        data = AccountingService(ctx).tax_summary(
            ReportPeriod(spec.period), start=spec.start_date, end=spec.end_date
        )
        return TaxSummaryType(
            period=data.period,
            start_date=data.start,
            end_date=data.end,
            total_taxable=money(data.total_taxable),
            total_tax=money(data.total_tax),
            total_tax_on_credits=money(data.total_tax_on_credits),
            reconciles=data.reconciles,
            rows=[
                TaxRateRowType(
                    # A RATE, not money -- _plain keeps "5" from becoming "5.00".
                    rate=str(r.rate),
                    taxable_base=money(r.taxable_base),
                    tax_amount=money(r.tax_amount),
                    line_count=r.line_count,
                )
                for r in data.rows
            ],
        )

    # =====================================================================
    # Storage & retention
    # =====================================================================
    @strawberry.field
    def storage_usage(self, info: strawberry.Info) -> StorageUsage:
        ctx = _ctx(info)
        svc = StorageStatsService(ctx)
        usage = svc.usage()

        # StorageUsage.by_kind has bytes but no counts, and StorageBreakdown wants both.
        # One extra GROUP BY rather than a fabricated zero.
        rows = ctx.session.execute(
            select(
                col(FileAsset.kind),
                func.count().label("count"),
                func.coalesce(func.sum(col(FileAsset.size_bytes)), 0).label("bytes"),
            )
            .where(
                FileAsset.business_id == svc.scope_id,  # TENANCY BOUNDARY
                col(FileAsset.deleted_at).is_(None),
            )
            .group_by(col(FileAsset.kind))
        ).all()

        return StorageUsage(
            database_bytes=usage.database_bytes,
            uploads_bytes=usage.uploads_bytes,
            total_bytes=usage.total_bytes,
            quota_bytes=usage.quota_mb * 1024 * 1024,
            percent_used=usage.percent_used,
            over_quota=usage.over_quota,
            bytes_saved_by_compression=usage.bytes_saved_by_compression,
            breakdown=sorted(
                (
                    StorageBreakdown(
                        label=str(getattr(kind, "value", kind)),
                        bytes=int(size or 0),
                        count=int(count or 0),
                    )
                    for kind, count, size in rows
                ),
                key=lambda b: b.bytes,
                reverse=True,
            ),
            customer_count=usage.customers,
            credit_count=usage.credits,
            payment_count=usage.payments,
            product_count=usage.products,
            service_count=usage.services,
            image_count=usage.images,
            export_count=usage.exports,
        )

    @strawberry.field
    def archive_batches(
        self, info: strawberry.Info, page: PageInput | None = None
    ) -> ArchiveBatchPage:
        ctx = _ctx(info)
        result = RetentionService(ctx).list_batches(_page(page))
        now = datetime.now(UTC)
        return ArchiveBatchPage(
            items=[m.to_archive_batch(b, now=now) for b in result.items],
            page_info=page_info(result),
        )

    @strawberry.field(description="What the NEXT retention sweep would archive. Nothing is moved.")
    def retention_preview(self, info: strawberry.Info) -> RetentionPreview:
        ctx = _ctx(info)
        svc = RetentionService(ctx)
        counts = svc.preview()
        return RetentionPreview(
            credits=counts["credits"],
            payments=counts["payments"],
            records=counts["records"],
            policy=RetentionPolicy(svc.get_business().retention_policy),
        )

    # =====================================================================
    # Exports
    # =====================================================================
    @strawberry.field
    def exports(self, info: strawberry.Info, page: PageInput | None = None) -> ExportJobPage:
        ctx = _ctx(info)
        result = ExportService(ctx).list_exports(_page(page))
        return ExportJobPage(
            items=[m.to_export_job(ctx.session, j) for j in result.items],
            page_info=page_info(result),
        )

    @strawberry.field
    def export(self, info: strawberry.Info, id: strawberry.ID) -> ExportJobType:
        ctx = _ctx(info)
        return m.to_export_job(ctx.session, ExportService(ctx).get_export(str(id)))

    # =====================================================================
    # Audit
    # =====================================================================
    @strawberry.field(description="The audit trail. ADMIN and above.")
    def audit_logs(
        self,
        info: strawberry.Info,
        page: PageInput | None = None,
        entity_type: str | None = None,
        entity_id: strawberry.ID | None = None,
        action: AuditAction | None = None,  # type: ignore[valid-type]
        search: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
    ) -> AuditLogPage:
        from app.utils.pagination import paginate

        ctx = _ctx(info)
        # No AuditLogService exists; the boundary is still enforced the same way --
        # an explicit permission check and BaseService.scope_id, never a client id.
        svc = BaseService(ctx)
        svc.require(Permission.AUDIT_READ)

        stmt = select(AuditLog).where(AuditLog.business_id == svc.scope_id)  # TENANCY BOUNDARY
        # created_at is an INSTANT, so a bare date comparison would silently drop
        # everything after midnight on the end date. Widened to the business's own
        # local day bounds, expressed in UTC -- the same rule the reports use.
        tz = svc.get_business().timezone
        if date_from:
            stmt = stmt.where(col(AuditLog.created_at) >= start_of_day(date_from, tz))
        if date_to:
            stmt = stmt.where(col(AuditLog.created_at) < end_of_day(date_to, tz))
        if entity_type:
            stmt = stmt.where(AuditLog.entity_type == entity_type)
        if entity_id:
            stmt = stmt.where(AuditLog.entity_id == str(entity_id))
        if action is not None:
            stmt = stmt.where(AuditLog.action == action)
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(col(AuditLog.summary).ilike(like))
        stmt = stmt.order_by(col(AuditLog.created_at).desc())

        result = paginate(ctx.session, stmt, _page(page))
        return AuditLogPage(
            items=[m.to_audit_log(row) for row in result.items],
            page_info=page_info(result),
        )


# ---------------------------------------------------------------------------
# Input -> service-filter translation
# ---------------------------------------------------------------------------
def _to_credit_filter(f: CreditFilterInput | None) -> CreditFilter:
    if f is None:
        return CreditFilter()
    return CreditFilter(
        search=f.search,
        status=[CreditStatus(s) for s in f.status] if f.status else None,
        customer_id=str(f.customer_id) if f.customer_id else None,
        due_from=f.due_from,
        due_to=f.due_to,
        issued_from=f.issued_from,
        issued_to=f.issued_to,
        min_amount=to_decimal(f.min_amount, "min_amount"),
        max_amount=to_decimal(f.max_amount, "max_amount"),
        overdue_only=f.overdue_only,
    )


def _to_payment_filter(f: PaymentFilterInput | None) -> PaymentFilter:
    if f is None:
        return PaymentFilter()
    return PaymentFilter(
        search=f.search,
        credit_id=str(f.credit_id) if f.credit_id else None,
        customer_id=str(f.customer_id) if f.customer_id else None,
        method=list(f.method) if f.method else None,
        date_from=f.date_from,
        date_to=f.date_to,
        min_amount=to_decimal(f.min_amount, "min_amount"),
        max_amount=to_decimal(f.max_amount, "max_amount"),
        include_voided=f.include_voided,
    )


def _dashboard_accounting(ctx: ServiceContext) -> DashboardAccountingType:
    data = AccountingService(ctx).dashboard()
    return DashboardAccountingType(
        today_sales=money(data.today_sales),
        today_collections=money(data.today_collections),
        today_expenses=money(data.today_expenses),
        outstanding_credit=money(data.outstanding_credit),
        month_revenue=money(data.month_revenue),
        month_expenses=money(data.month_expenses),
        month_cogs=money(data.month_cogs),
        net_cash_flow=money(data.net_cash_flow),
        net_profit=money(data.net_profit),
        expense_delta_percent=_pct(data.expense_delta_pct),
        monthly=[
            CashFlowRowType(
                bucket=r.bucket,
                label=r.label,
                money_in=money(r.money_in),
                money_out=money(r.money_out),
                net=money(r.net),
            )
            for r in data.monthly
        ],
        top_expense_categories=_group_rows(
            data.top_expense_categories, data.month_expenses
        ),
    )


def _overdue_customers(ctx: ServiceContext, *, limit: int) -> list[AgingCustomerType]:
    """The worst debts, from the aging report. Only customers who are ACTUALLY late:
    a customer whose only credit is not due yet does not belong on this list."""
    data = AccountingService(ctx).aging_receivable()
    late = [c for c in data.customers if c.oldest_days > 0][:limit]
    return [
        AgingCustomerType(
            customer_id=strawberry.ID(c.customer_id),
            name=c.name,
            phone=c.phone,
            current=money(c.buckets.get("CURRENT")),
            days_1_to_30=money(c.buckets.get("D1_30")),
            days_31_to_60=money(c.buckets.get("D31_60")),
            days_61_to_90=money(c.buckets.get("D61_90")),
            days_90_plus=money(c.buckets.get("D90_PLUS")),
            total=money(c.total),
            oldest_days=c.oldest_days,
        )
        for c in late
    ]


def _group_rows(rows: list[Any], total: Any) -> list[ExpenseGroupRow]:
    """Map accounting group rows onto the GraphQL type, computing each row's share
    server-side so the client never parses a money string back into a number."""
    return [
        ExpenseGroupRow(
            key=r.key,
            label=r.label,
            total=money(r.total),
            count=r.count,
            share_pct=money(r.share_of(total)),
            color=r.color,
        )
        for r in rows
    ]


def _to_expense_filter(f: ExpenseFilterInput | None) -> ExpenseFilter:
    if f is None:
        return ExpenseFilter()
    return ExpenseFilter(
        search=f.search,
        category_id=str(f.category_id) if f.category_id else None,
        vendor_id=str(f.vendor_id) if f.vendor_id else None,
        cash_account_id=str(f.cash_account_id) if f.cash_account_id else None,
        vendor_name=f.vendor_name,
        payment_method=list(f.payment_method) if f.payment_method else None,
        date_from=f.date_from,
        date_to=f.date_to,
        min_amount=to_decimal(f.min_amount, "min_amount"),
        max_amount=to_decimal(f.max_amount, "max_amount"),
        created_by_user_id=str(f.created_by_user_id) if f.created_by_user_id else None,
    )


def _pct(value: Any) -> float | None:
    """Decimal percentage -> float, keeping None as None.

    None means "no baseline to compare against" (see analytics.pct_delta) and the UI
    renders a dash. Coercing it to 0.0 would draw a flat trend arrow, which is a lie.
    """
    return None if value is None else float(value)


def _score_of(session: Any, customer_id: str) -> int:
    row = session.get(Customer, customer_id)
    return row.credit_score if row else 0


__all__ = ["Query"]
