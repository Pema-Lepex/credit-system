"""Lightweight accounting reports: Profit & Loss and the Expense breakdown.

WHY A SEPARATE MODULE FROM reports.py
--------------------------------------
``reports.py`` is already ~1550 lines and owns two unrelated jobs (period reports
and printable A4 documents). These two reports share its money helpers and its
timezone discipline but none of its rendering, so they live here and import what
they need. Nothing in ``reports.py`` changes.

WHAT "CASH BASIS" MEANS HERE, AND WHAT IT DOES NOT
---------------------------------------------------
This is NOT an accounting statement and must never be presented as one -- the spec
is explicit. Two approximations are baked in, deliberately, and both are visible to
the reader as the label "Cash basis":

1. REVENUE is money actually COLLECTED in the period (payments received), not
   credit issued. That is the number a shop owner means by "what did we take this
   month", and it is the one that reconciles with the till.

2. COGS is the cost of goods ISSUED in the period, valued at the product's CURRENT
   ``cost_price``. Two known consequences: it is matched against collections that
   may relate to a different period, and re-pricing a product retroactively
   changes past COGS. Fixing either means snapshotting cost onto every credit line
   and running accrual matching -- i.e. the double-entry system the spec rules out.
   ``Product.cost_price`` is what the spec says to use, so that is what is used.

Services and custom line items have no cost price and contribute zero COGS, which
is correct: their cost is labour, and that lands in Operating Expenses instead.

MONEY: every sum below goes through app.services.analytics.money_sum / to_money.
Do not hand-roll a SUM over a MoneyType column -- see that module for why.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import BigInteger, and_, func, type_coerce
from sqlmodel import col, select

from app.core.errors import ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.catalog import Product
from app.models.credit import Credit, CreditItem, Payment
from app.models.customer import Customer
from app.models.enums import CreditStatus, PaymentMethod, ReportPeriod
from app.models.expense import Expense, ExpenseCategory
from app.models.types import quantize_money
from app.services.analytics import count_if, money_sum, money_sum_if, to_money
from app.services.base import BaseService
from app.utils.dates import get_tz, period_bounds, start_of_day, today_in

ZERO = Decimal("0")

#: Label used for expenses with no category / no vendor. One constant so the report,
#: the export and the UI cannot drift into "Uncategorised" vs "Uncategorized".
UNCATEGORISED = "Uncategorised"
NO_VENDOR = "No vendor"


#: Cash-flow bucket sizes. "week" is why this is not reports.Granularity, which has
#: only day/month -- the spec asks for a weekly cash-flow view.
CashGranularity = Literal["day", "week", "month"]

#: A CUSTOM range longer than this renders as weeks, and longer than the second
#: threshold as months. Same reasoning as reports._DAILY_ROW_LIMIT: 400 daily rows
#: is unreadable and makes the XLSX pointlessly large.
_DAILY_LIMIT = 62
_WEEKLY_LIMIT = 400


@dataclass(frozen=True, slots=True)
class ExpenseGroupRow:
    """One line of a grouped expense breakdown."""

    key: str
    label: str
    total: Decimal
    count: int
    #: Hex colour from the category, when the grouping is by category. Lets the UI
    #: colour the pie chart from the owner's own choices rather than a palette.
    color: str | None = None

    def share_of(self, total: Decimal) -> Decimal:
        """This row as a percentage of ``total``. Zero total -> zero, not a crash."""
        if total == ZERO:
            return ZERO
        return quantize_money(self.total / total * Decimal("100"))


@dataclass(frozen=True, slots=True)
class ExpenseReportData:
    business_name: str
    currency: str
    currency_symbol: str
    timezone: str

    period: ReportPeriod
    start: date              # inclusive, business-local
    end: date                # inclusive, business-local
    generated_at: datetime   # UTC

    total: Decimal
    count: int
    by_category: list[ExpenseGroupRow] = field(default_factory=list)
    by_vendor: list[ExpenseGroupRow] = field(default_factory=list)
    by_method: list[ExpenseGroupRow] = field(default_factory=list)

    @property
    def title(self) -> str:
        return f"Expenses - {self.start:%d %b %Y} to {self.end:%d %b %Y}"


@dataclass(frozen=True, slots=True)
class ProfitLossData:
    business_name: str
    currency: str
    currency_symbol: str
    timezone: str

    period: ReportPeriod
    start: date
    end: date
    generated_at: datetime

    #: Money COLLECTED in the period -- see the module docstring.
    revenue: Decimal
    cost_of_goods_sold: Decimal
    operating_expenses: Decimal
    expenses_by_category: list[ExpenseGroupRow] = field(default_factory=list)

    @property
    def gross_profit(self) -> Decimal:
        return quantize_money(self.revenue - self.cost_of_goods_sold)

    @property
    def net_profit(self) -> Decimal:
        return quantize_money(self.gross_profit - self.operating_expenses)

    @property
    def net_margin_pct(self) -> Decimal:
        """Net profit as a percentage of revenue. Zero revenue -> zero."""
        if self.revenue == ZERO:
            return ZERO
        return quantize_money(self.net_profit / self.revenue * Decimal("100"))

    @property
    def title(self) -> str:
        return f"Profit & Loss (cash basis) - {self.start:%d %b %Y} to {self.end:%d %b %Y}"


@dataclass(frozen=True, slots=True)
class CashFlowRow:
    bucket: date
    label: str
    money_in: Decimal
    money_out: Decimal

    @property
    def net(self) -> Decimal:
        return quantize_money(self.money_in - self.money_out)


@dataclass(frozen=True, slots=True)
class CashFlowData:
    business_name: str
    currency: str
    currency_symbol: str
    timezone: str

    period: ReportPeriod
    start: date
    end: date
    granularity: CashGranularity
    generated_at: datetime

    total_in: Decimal
    total_out: Decimal
    rows: list[CashFlowRow] = field(default_factory=list)

    @property
    def net_flow(self) -> Decimal:
        return quantize_money(self.total_in - self.total_out)

    @property
    def title(self) -> str:
        return f"Cash flow - {self.start:%d %b %Y} to {self.end:%d %b %Y}"


#: The aging ladder. Ordered, and the ORDER IS THE REPORT -- rendering it any other
#: way makes "how bad is it" unreadable. ``upper`` is inclusive; None means "and older".
AGING_BUCKETS: tuple[tuple[str, str, int | None, int | None], ...] = (
    ("CURRENT", "Not due yet", None, 0),
    ("D1_30", "1-30 days", 1, 30),
    ("D31_60", "31-60 days", 31, 60),
    ("D61_90", "61-90 days", 61, 90),
    ("D90_PLUS", "90+ days", 91, None),
)


@dataclass(frozen=True, slots=True)
class AgingBucketTotal:
    key: str
    label: str
    total: Decimal
    count: int

    def share_of(self, total: Decimal) -> Decimal:
        if total == ZERO:
            return ZERO
        return quantize_money(self.total / total * Decimal("100"))


@dataclass(frozen=True, slots=True)
class AgingCustomerRow:
    customer_id: str
    name: str
    phone: str | None
    #: Keyed by AGING_BUCKETS[i][0].
    buckets: dict[str, Decimal]
    total: Decimal
    #: Days past due of the OLDEST unpaid credit -- the number that decides who to
    #: chase first. Zero when nothing is overdue.
    oldest_days: int


@dataclass(frozen=True, slots=True)
class AgingData:
    business_name: str
    currency: str
    currency_symbol: str
    timezone: str

    as_at: date
    generated_at: datetime

    total_outstanding: Decimal
    buckets: list[AgingBucketTotal] = field(default_factory=list)
    customers: list[AgingCustomerRow] = field(default_factory=list)

    @property
    def title(self) -> str:
        return f"Money customers owe - as at {self.as_at:%d %b %Y}"


@dataclass(frozen=True, slots=True)
class TaxRateRow:
    """One tax rate, and what was charged at it."""

    rate: Decimal
    taxable_base: Decimal
    tax_amount: Decimal
    line_count: int


@dataclass(frozen=True, slots=True)
class TaxSummaryData:
    business_name: str
    currency: str
    currency_symbol: str
    timezone: str

    period: ReportPeriod
    start: date
    end: date
    generated_at: datetime

    total_taxable: Decimal
    total_tax: Decimal
    #: From Credit.tax_amount -- the authoritative figure the customer was billed.
    #: Compared against the per-rate sum below to surface any drift; see tax_summary.
    total_tax_on_credits: Decimal
    rows: list[TaxRateRow] = field(default_factory=list)

    @property
    def reconciles(self) -> bool:
        """Whether the per-rate breakdown adds up to what was actually billed.

        False means some tax was charged at the CREDIT level rather than on a line
        (Credit.tax_percentage), so the breakdown is incomplete. The UI says so
        rather than quietly showing a total that disagrees with the invoices.
        """
        return self.total_tax == self.total_tax_on_credits

    @property
    def title(self) -> str:
        return f"Tax summary - {self.start:%d %b %Y} to {self.end:%d %b %Y}"


class AccountingService(BaseService):
    """Read-only. Every report here is gated on REPORT_READ, like the rest."""

    # ------------------------------------------------------------------ shared
    def _bounds(
        self, period: ReportPeriod, start: date | None, end: date | None
    ) -> tuple[date, date, datetime, datetime]:
        """Resolve a period to (local_start, local_end, utc_lower, utc_upper).

        Identical derivation to ReportService.generate -- expenses are keyed on a
        local DATE and payments on a UTC INSTANT, so both are needed.
        """
        tz = self.get_business().timezone

        if period is ReportPeriod.CUSTOM and (start is None or end is None):
            raise ValidationError(
                "A custom report needs both a start and an end date", field="period"
            )
        if start and end and end < start:
            raise ValidationError("The end date is before the start date", field="end")

        lower, upper = period_bounds(period, tz, start=start, end=end)
        local_start = lower.astimezone(get_tz(tz)).date()
        # upper is exclusive local midnight, so the last INCLUDED local day is upper-1.
        local_end = (upper.astimezone(get_tz(tz)) - timedelta(microseconds=1)).date()
        return local_start, local_end, lower, upper

    def _expense_scope(self, local_start: date, local_end: date) -> tuple[Any, ...]:
        """The WHERE clause every expense figure in this module shares."""
        return (
            Expense.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Expense.deleted_at).is_(None),
            col(Expense.expense_date) >= local_start,
            col(Expense.expense_date) <= local_end,
        )

    # ---------------------------------------------------------- expense report
    def expense_report(
        self,
        period: ReportPeriod = ReportPeriod.MONTHLY,
        start: date | None = None,
        end: date | None = None,
        *,
        category_id: str | None = None,
        vendor_name: str | None = None,
        payment_method: list[PaymentMethod] | None = None,
        created_by_user_id: str | None = None,
    ) -> ExpenseReportData:
        """Total spending for a period, grouped three ways."""
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        local_start, local_end, _lower, _upper = self._bounds(period, start, end)

        scope = list(self._expense_scope(local_start, local_end))
        if category_id:
            scope.append(Expense.category_id == category_id)
        if vendor_name:
            scope.append(col(Expense.vendor_name).ilike(f"%{vendor_name.strip()}%"))
        if payment_method:
            # A LIST, matching ExpenseFilter: "cash and card" is a normal question,
            # and taking only the first method would silently drop the rest.
            scope.append(
                col(Expense.payment_method).in_([PaymentMethod(m) for m in payment_method])
            )
        if created_by_user_id:
            scope.append(Expense.created_by_user_id == created_by_user_id)

        total_row = self.session.execute(
            select(
                money_sum(Expense.amount).label("total"),
                func.count().label("count"),
            ).where(*scope)
        ).one()

        return ExpenseReportData(
            business_name=business.name,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            timezone=business.timezone,
            period=period,
            start=local_start,
            end=local_end,
            generated_at=utcnow(),
            total=to_money(total_row.total),
            count=int(total_row.count or 0),
            by_category=self._by_category(scope),
            by_vendor=self._by_vendor(scope),
            by_method=self._by_method(scope),
        )

    def _by_category(self, scope: list[Any]) -> list[ExpenseGroupRow]:
        """LEFT JOIN so uncategorised spending still shows up -- an owner who never
        picks a category would otherwise see an empty breakdown over a real total."""
        stmt = (
            select(
                Expense.category_id,
                ExpenseCategory.name,
                ExpenseCategory.color,
                money_sum(Expense.amount).label("total"),
                func.count().label("count"),
            )
            .join(ExpenseCategory, Expense.category_id == ExpenseCategory.id, isouter=True)
            .where(*scope)
            .group_by(Expense.category_id, ExpenseCategory.name, ExpenseCategory.color)
        )
        rows = [
            ExpenseGroupRow(
                key=r.category_id or "",
                label=r.name or UNCATEGORISED,
                total=to_money(r.total),
                count=int(r.count or 0),
                color=r.color,
            )
            for r in self.session.execute(stmt).all()
        ]
        return sorted(rows, key=lambda r: r.total, reverse=True)

    def _by_vendor(self, scope: list[Any]) -> list[ExpenseGroupRow]:
        stmt = (
            select(
                Expense.vendor_name,
                money_sum(Expense.amount).label("total"),
                func.count().label("count"),
            )
            .where(*scope)
            .group_by(Expense.vendor_name)
        )
        rows = [
            ExpenseGroupRow(
                key=r.vendor_name or "",
                label=r.vendor_name or NO_VENDOR,
                total=to_money(r.total),
                count=int(r.count or 0),
            )
            for r in self.session.execute(stmt).all()
        ]
        return sorted(rows, key=lambda r: r.total, reverse=True)

    def _by_method(self, scope: list[Any]) -> list[ExpenseGroupRow]:
        stmt = (
            select(
                Expense.payment_method,
                money_sum(Expense.amount).label("total"),
                func.count().label("count"),
            )
            .where(*scope)
            .group_by(Expense.payment_method)
        )
        rows = [
            ExpenseGroupRow(
                key=str(getattr(r.payment_method, "value", r.payment_method)),
                label=str(getattr(r.payment_method, "value", r.payment_method))
                .replace("_", " ")
                .title(),
                total=to_money(r.total),
                count=int(r.count or 0),
            )
            for r in self.session.execute(stmt).all()
        ]
        return sorted(rows, key=lambda r: r.total, reverse=True)

    # ------------------------------------------------------------ profit & loss
    def profit_loss(
        self,
        period: ReportPeriod = ReportPeriod.MONTHLY,
        start: date | None = None,
        end: date | None = None,
    ) -> ProfitLossData:
        """Revenue - COGS - operating expenses. Cash basis; see the module docstring."""
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        local_start, local_end, lower, upper = self._bounds(period, start, end)

        # Revenue: collections, keyed on the payment INSTANT -> UTC bounds.
        revenue_row = self.session.execute(
            select(money_sum(Payment.amount).label("collected")).where(
                Payment.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Payment.deleted_at).is_(None),
                col(Payment.voided_at).is_(None),
                col(Payment.paid_at) >= lower,
                col(Payment.paid_at) < upper,
            )
        ).one()

        scope = list(self._expense_scope(local_start, local_end))
        expenses_row = self.session.execute(
            select(money_sum(Expense.amount).label("total")).where(*scope)
        ).one()

        return ProfitLossData(
            business_name=business.name,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            timezone=business.timezone,
            period=period,
            start=local_start,
            end=local_end,
            generated_at=utcnow(),
            revenue=to_money(revenue_row.collected),
            cost_of_goods_sold=self._cogs(local_start, local_end),
            operating_expenses=to_money(expenses_row.total),
            expenses_by_category=self._by_category(scope),
        )

    def _cogs(self, local_start: date, local_end: date) -> Decimal:
        """Cost of goods issued in the period, at the product's current cost price.

        ``type_coerce(..., BigInteger)`` strips MoneyType's result processor for the
        same reason ``money_sum`` does -- the product with ``quantity`` would
        otherwise come back a factor of 100 out with no error raised. The result is
        fractional minor units (quantity has 3 decimal places), so it is rounded to
        whole cents exactly once, here.

        Lines with no ``product_id`` -- services and free-text items -- are excluded
        by the INNER join, and lines whose product has no ``cost_price`` contribute
        zero. Both are intended; see the module docstring.
        """
        stmt = (
            select(
                func.coalesce(
                    func.sum(
                        type_coerce(Product.cost_price, BigInteger) * CreditItem.quantity
                    ),
                    0,
                ).label("cogs")
            )
            .select_from(CreditItem)
            .join(Credit, CreditItem.credit_id == Credit.id)
            .join(Product, CreditItem.product_id == Product.id)
            .where(
                Credit.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Credit.deleted_at).is_(None),
                col(Credit.status) != CreditStatus.CANCELLED,
                col(Credit.issued_date) >= local_start,
                col(Credit.issued_date) <= local_end,
                col(CreditItem.deleted_at).is_(None),
            )
        )
        raw = self.session.execute(stmt).scalar_one_or_none() or 0
        return to_money(int(Decimal(str(raw)).to_integral_value()))


    # ------------------------------------------------------------- cash flow
    def cash_flow(
        self,
        period: ReportPeriod = ReportPeriod.MONTHLY,
        start: date | None = None,
        end: date | None = None,
    ) -> CashFlowData:
        """Money in (collections) vs money out (expenses), bucketed over time.

        The two sides are keyed DIFFERENTLY and that is not an inconsistency:
        ``Payment.paid_at`` is an instant, so its bucket edges are local midnights
        expressed in UTC; ``Expense.expense_date`` is already a local calendar date
        and is compared as one. Getting this backwards puts a shop's evening takings
        on tomorrow's row. Same rule as reports.py.
        """
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        tz = business.timezone
        local_start, local_end, _lower, _upper = self._bounds(period, start, end)

        buckets, granularity = self._cash_buckets(local_start, local_end, period)
        rows = self._cash_rows(buckets, granularity, tz)

        return CashFlowData(
            business_name=business.name,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            timezone=tz,
            period=period,
            start=local_start,
            end=local_end,
            granularity=granularity,
            generated_at=utcnow(),
            total_in=quantize_money(sum((r.money_in for r in rows), ZERO)),
            total_out=quantize_money(sum((r.money_out for r in rows), ZERO)),
            rows=rows,
        )

    @staticmethod
    def _cash_buckets(
        start: date, end: date, period: ReportPeriod
    ) -> tuple[list[date], CashGranularity]:
        """Every bucket in range, INCLUDING empty ones.

        Omitting a quiet week would misrepresent a downturn as a flat line -- the
        same reasoning as month_range in utils/dates.
        """
        span = (end - start).days + 1

        if period is ReportPeriod.YEARLY or span > _WEEKLY_LIMIT:
            out: list[date] = []
            cursor = start.replace(day=1)
            while cursor <= end:
                out.append(cursor)
                cursor = (
                    cursor.replace(year=cursor.year + 1, month=1)
                    if cursor.month == 12
                    else cursor.replace(month=cursor.month + 1)
                )
            return out, "month"

        if span > _DAILY_LIMIT:
            # Align to Monday so weeks are calendar weeks, not offsets from the
            # arbitrary day the range happens to begin on.
            cursor = start - timedelta(days=start.weekday())
            weeks: list[date] = []
            while cursor <= end:
                weeks.append(cursor)
                cursor += timedelta(days=7)
            return weeks, "week"

        return [start + timedelta(days=i) for i in range(span)], "day"

    def _cash_rows(
        self, buckets: list[date], granularity: CashGranularity, tz: str
    ) -> list[CashFlowRow]:
        """One SUM(CASE) column per bucket per side -- two queries total, not 2*N."""
        if not buckets:
            return []

        edges = [(b, _bucket_end(b, granularity)) for b in buckets]

        in_cols: list[Any] = [
            money_sum_if(
                Payment.amount,
                and_(
                    col(Payment.paid_at) >= start_of_day(lo, tz),
                    col(Payment.paid_at) < start_of_day(hi, tz),
                ),
            )
            for lo, hi in edges
        ]
        in_row = self.session.execute(
            select(*in_cols).where(
                Payment.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Payment.deleted_at).is_(None),
                col(Payment.voided_at).is_(None),
            )
        ).one()

        out_cols: list[Any] = [
            money_sum_if(
                Expense.amount,
                and_(col(Expense.expense_date) >= lo, col(Expense.expense_date) < hi),
            )
            for lo, hi in edges
        ]
        out_row = self.session.execute(
            select(*out_cols).where(
                Expense.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Expense.deleted_at).is_(None),
            )
        ).one()

        return [
            CashFlowRow(
                bucket=bucket,
                label=_bucket_label(bucket, granularity),
                money_in=to_money(in_row[i]),
                money_out=to_money(out_row[i]),
            )
            for i, bucket in enumerate(buckets)
        ]

    # -------------------------------------------------------- aging receivable
    def aging_receivable(self, as_at: date | None = None) -> AgingData:
        """Who owes what, and for how long. Built entirely from existing Credits.

        A POINT-IN-TIME report, not a period one: "who owes me today" has no start
        date. ``as_at`` defaults to today in the shop's timezone and exists so the
        figure can be reproduced later.

        Only OPEN credits with something still outstanding are counted -- a fully
        paid credit owes nothing regardless of how late it was.
        """
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        as_at = as_at or today_in(business.timezone)

        scope = (
            Credit.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Credit.deleted_at).is_(None),
            col(Credit.status).in_(list(CreditStatus.open_statuses())),
            col(Credit.remaining_amount) > 0,
        )

        # One grouped query for the whole report: a SUM(CASE) column per bucket,
        # grouped by customer. Bucket totals are then folded up in Python from the
        # per-customer rows, so the two can never disagree.
        bucket_cols: list[Any] = []
        for _key, _label, lo, hi in AGING_BUCKETS:
            bucket_cols.append(money_sum_if(Credit.remaining_amount, _overdue_window(as_at, lo, hi)))
            bucket_cols.append(count_if(_overdue_window(as_at, lo, hi)))

        stmt = (
            select(
                Credit.customer_id,
                Customer.name,
                Customer.phone,
                money_sum(Credit.remaining_amount).label("total"),
                func.min(col(Credit.due_date)).label("oldest_due"),
                *bucket_cols,
            )
            .join(Customer, col(Credit.customer_id) == col(Customer.id))
            .where(*scope)
            .group_by(Credit.customer_id, Customer.name, Customer.phone)
        )

        customers: list[AgingCustomerRow] = []
        bucket_totals = {key: ZERO for key, *_ in AGING_BUCKETS}
        bucket_counts = {key: 0 for key, *_ in AGING_BUCKETS}

        for row in self.session.execute(stmt).all():
            buckets: dict[str, Decimal] = {}
            for i, (key, _label, _lo, _hi) in enumerate(AGING_BUCKETS):
                amount = to_money(row[5 + i * 2])
                buckets[key] = amount
                bucket_totals[key] = quantize_money(bucket_totals[key] + amount)
                bucket_counts[key] += int(row[6 + i * 2] or 0)

            oldest_due = row.oldest_due
            if isinstance(oldest_due, datetime):  # SQLite may hand back a datetime
                oldest_due = oldest_due.date()

            customers.append(
                AgingCustomerRow(
                    customer_id=row.customer_id,
                    name=row.name,
                    phone=row.phone,
                    buckets=buckets,
                    total=to_money(row.total),
                    oldest_days=max((as_at - oldest_due).days, 0) if oldest_due else 0,
                )
            )

        # Worst debt first: that is the order the owner works down the list in.
        customers.sort(key=lambda c: (c.oldest_days, c.total), reverse=True)

        return AgingData(
            business_name=business.name,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            timezone=business.timezone,
            as_at=as_at,
            generated_at=utcnow(),
            total_outstanding=quantize_money(sum((c.total for c in customers), ZERO)),
            buckets=[
                AgingBucketTotal(
                    key=key, label=label, total=bucket_totals[key], count=bucket_counts[key]
                )
                for key, label, _lo, _hi in AGING_BUCKETS
            ],
            customers=customers,
        )

    # -------------------------------------------------------------- dashboard
    def dashboard(self, months: int = 12) -> DashboardAccounting:
        """Today's figures, this month's figures, and a 12-month series."""
        self.require(Permission.REPORT_READ)
        return _dashboard_impl(self, months)

    # ------------------------------------------------------------ tax summary
    def tax_summary(
        self,
        period: ReportPeriod = ReportPeriod.MONTHLY,
        start: date | None = None,
        end: date | None = None,
    ) -> TaxSummaryData:
        """Tax charged, grouped by rate.

        Aggregated from CREDIT LINES, not credit headers: ``CreditItem.tax_percentage``
        is the rate snapshotted from the product at the time of sale, which is the
        only place the per-rate split actually exists. ``Credit.tax_amount`` is then
        summed independently as a cross-check -- if a shop charged tax at the credit
        level instead of per line, the two disagree and ``reconciles`` says so rather
        than the report quietly under-reporting.

        No TaxCode model, per the spec.
        """
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        local_start, local_end, _lower, _upper = self._bounds(period, start, end)

        credit_scope = (
            Credit.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Credit.deleted_at).is_(None),
            col(Credit.status) != CreditStatus.CANCELLED,
            col(Credit.issued_date) >= local_start,
            col(Credit.issued_date) <= local_end,
        )

        rate_stmt = (
            select(
                CreditItem.tax_percentage,
                money_sum(CreditItem.line_subtotal).label("base"),
                money_sum(CreditItem.tax_amount).label("tax"),
                func.count().label("lines"),
            )
            .select_from(CreditItem)
            .join(Credit, col(CreditItem.credit_id) == col(Credit.id))
            .where(*credit_scope, col(CreditItem.deleted_at).is_(None))
            .group_by(CreditItem.tax_percentage)
        )

        rows = [
            TaxRateRow(
                rate=Decimal(str(r.tax_percentage or 0)),
                taxable_base=to_money(r.base),
                tax_amount=to_money(r.tax),
                line_count=int(r.lines or 0),
            )
            for r in self.session.execute(rate_stmt).all()
        ]
        # Highest rate first -- the standard-rate band is what an owner looks for.
        rows.sort(key=lambda r: r.rate, reverse=True)

        billed = self.session.execute(
            select(money_sum(Credit.tax_amount).label("tax")).where(*credit_scope)
        ).one()

        return TaxSummaryData(
            business_name=business.name,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            timezone=business.timezone,
            period=period,
            start=local_start,
            end=local_end,
            generated_at=utcnow(),
            total_taxable=quantize_money(sum((r.taxable_base for r in rows), ZERO)),
            total_tax=quantize_money(sum((r.tax_amount for r in rows), ZERO)),
            total_tax_on_credits=to_money(billed.tax),
            rows=rows,
        )


@dataclass(frozen=True, slots=True)
class DashboardAccounting:
    """The money-out half of the dashboard.

    Kept as its OWN block rather than merged into AnalyticsService's
    DashboardSummary: that type is already wide, is consumed by the existing
    dashboard UI, and knows nothing about expenses. A separate block is additive --
    the current dashboard query keeps working untouched.
    """

    today_sales: Decimal
    today_collections: Decimal
    today_expenses: Decimal
    outstanding_credit: Decimal

    month_revenue: Decimal
    month_expenses: Decimal
    month_cogs: Decimal
    previous_month_expenses: Decimal

    #: 12 months of in/out, oldest first. Feeds Revenue-vs-Expenses AND the cash
    #: flow trend -- one series, two charts, so they can never disagree.
    monthly: list[CashFlowRow] = field(default_factory=list)
    top_expense_categories: list[ExpenseGroupRow] = field(default_factory=list)

    @property
    def net_cash_flow(self) -> Decimal:
        """This month: what came in, less what went out."""
        return quantize_money(self.month_revenue - self.month_expenses)

    @property
    def net_profit(self) -> Decimal:
        """Same definition as the P&L report -- revenue less COGS less expenses.
        Two different numbers under one name would be worse than no number."""
        return quantize_money(self.month_revenue - self.month_cogs - self.month_expenses)

    @property
    def expense_delta_pct(self) -> Decimal | None:
        """Change against last month. None -- not zero -- when there is no baseline;
        going from nothing to something is "new", not "an infinite increase"."""
        if self.previous_month_expenses == ZERO:
            return None
        return quantize_money(
            (self.month_expenses - self.previous_month_expenses)
            / self.previous_month_expenses
            * Decimal("100")
        )


def _dashboard_impl(svc: "AccountingService", months: int) -> DashboardAccounting:
    """Body of AccountingService.dashboard, kept out of the class for readability.

    SEVEN queries for the whole block, regardless of how many months are charted:
    the monthly series is one SUM(CASE) column set per side, exactly like
    ``_cash_rows``. Loading rows and totalling them in Python would be correct at
    100 records and a timeout at a million -- see analytics.py.
    """
    business = svc.get_business()
    tz = business.timezone
    today = today_in(tz)
    month_start = _month_start(today)
    prev_start = _month_start(today, 1)

    # --- today ---------------------------------------------------------------
    # Credit issued today is a CALENDAR-date column; collections are an INSTANT.
    sales = svc.session.execute(
        select(money_sum_if(Credit.grand_total, col(Credit.issued_date) == today)).where(
            Credit.business_id == svc.scope_id,  # TENANCY BOUNDARY
            col(Credit.deleted_at).is_(None),
            col(Credit.status) != CreditStatus.CANCELLED,
        )
    ).scalar_one()

    collections = svc.session.execute(
        select(
            money_sum_if(
                Payment.amount,
                and_(
                    col(Payment.paid_at) >= start_of_day(today, tz),
                    col(Payment.paid_at) < start_of_day(today + timedelta(days=1), tz),
                ),
            ).label("today"),
            money_sum_if(
                Payment.amount, col(Payment.paid_at) >= start_of_day(month_start, tz)
            ).label("month"),
        ).where(
            Payment.business_id == svc.scope_id,  # TENANCY BOUNDARY
            col(Payment.deleted_at).is_(None),
            col(Payment.voided_at).is_(None),
        )
    ).one()

    expenses = svc.session.execute(
        select(
            money_sum_if(Expense.amount, col(Expense.expense_date) == today).label("today"),
            money_sum_if(Expense.amount, col(Expense.expense_date) >= month_start).label("month"),
            money_sum_if(
                Expense.amount,
                and_(
                    col(Expense.expense_date) >= prev_start,
                    col(Expense.expense_date) < month_start,
                ),
            ).label("previous"),
        ).where(
            Expense.business_id == svc.scope_id,  # TENANCY BOUNDARY
            col(Expense.deleted_at).is_(None),
        )
    ).one()

    outstanding = svc.session.execute(
        select(money_sum(Credit.remaining_amount)).where(
            Credit.business_id == svc.scope_id,  # TENANCY BOUNDARY
            col(Credit.deleted_at).is_(None),
            col(Credit.status).in_(list(CreditStatus.open_statuses())),
        )
    ).scalar_one()

    # --- the charted series --------------------------------------------------
    # Every month in range, INCLUDING empty ones: a chart that drops a quiet month
    # misrepresents a downturn as a flat line.
    buckets = [_month_start(today, months - 1 - i) for i in range(months)]
    monthly = svc._cash_rows(buckets, "month", tz)

    # --- this month's breakdown ----------------------------------------------
    month_scope = list(svc._expense_scope(month_start, today))

    return DashboardAccounting(
        today_sales=to_money(sales),
        today_collections=to_money(collections.today),
        today_expenses=to_money(expenses.today),
        outstanding_credit=to_money(outstanding),
        month_revenue=to_money(collections.month),
        month_expenses=to_money(expenses.month),
        month_cogs=svc._cogs(month_start, today),
        previous_month_expenses=to_money(expenses.previous),
        monthly=monthly,
        top_expense_categories=svc._by_category(month_scope)[:5],
    )


def _month_start(day: date, back: int = 0) -> date:
    """First of the month, optionally ``back`` months earlier."""
    total = day.month - 1 - back
    year = day.year + total // 12
    return date(year, total % 12 + 1, 1)


def _bucket_end(bucket: date, granularity: CashGranularity) -> date:
    """EXCLUSIVE upper edge of a bucket. Half-open ranges cannot drop a record that
    lands on the boundary."""
    if granularity == "day":
        return bucket + timedelta(days=1)
    if granularity == "week":
        return bucket + timedelta(days=7)
    if bucket.month == 12:
        return bucket.replace(year=bucket.year + 1, month=1, day=1)
    return bucket.replace(month=bucket.month + 1, day=1)


def _bucket_label(bucket: date, granularity: CashGranularity) -> str:
    if granularity == "month":
        return bucket.strftime("%Y-%m")
    if granularity == "week":
        return f"w/c {bucket.strftime('%Y-%m-%d')}"
    return bucket.strftime("%Y-%m-%d")


def _overdue_window(as_at: date, lower: int | None, upper: int | None) -> Any:
    """SQL predicate for "this credit is N days past due", by DUE DATE.

    Expressed as date comparisons rather than arithmetic on a date column, because
    SQLite and Postgres disagree about what subtracting two dates yields. Comparing
    ``due_date`` against precomputed Python dates is portable and index-friendly.

      lower=None  -> not due yet (due_date is in the future, or today)
      upper=None  -> and older, no floor
    """
    if lower is None:
        # "Current": nothing is late yet.
        return col(Credit.due_date) >= as_at

    # `lower` days late means due_date <= as_at - lower.
    newest = as_at - timedelta(days=lower)
    if upper is None:
        return col(Credit.due_date) <= newest
    oldest = as_at - timedelta(days=upper)
    return and_(col(Credit.due_date) <= newest, col(Credit.due_date) >= oldest)


__all__ = [
    "AGING_BUCKETS",
    "AccountingService",
    "AgingBucketTotal",
    "AgingCustomerRow",
    "AgingData",
    "CashFlowData",
    "CashFlowRow",
    "DashboardAccounting",
    "TaxRateRow",
    "TaxSummaryData",
    "ExpenseGroupRow",
    "ExpenseReportData",
    "ProfitLossData",
    "NO_VENDOR",
    "UNCATEGORISED",
]
