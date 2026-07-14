"""AnalyticsService -- everything the dashboard draws.

TWO RULES THIS MODULE EXISTS TO ENFORCE
---------------------------------------
1. **Aggregate in the database, never in Python.** Every figure below is a
   ``SUM``/``COUNT`` executed by the engine over an indexed, business-scoped
   query. Loading rows and adding them up in a loop is correct at 100 records and
   a timeout at 1,000,000. There is no ``for credit in credits: total += ...``
   anywhere in this file, and there must never be.

2. **Bucket dates in the BUSINESS's timezone.** "Collections today" means today in
   Thimphu, not today in UTC. Instants (``paid_at``) are stored UTC and compared
   against UTC bounds derived from local calendar days via ``app.utils.dates``.
   Calendar dates (``issued_date``, ``due_date``) are already local by definition
   and are compared as dates.

MONEY (read app/models/types.py first)
--------------------------------------
``MoneyType`` stores an INTEGER number of minor units (cents). The helpers
``money_sum``/``to_money`` below are the only sanctioned way to total one, and
they do the cents -> Decimal conversion exactly once, explicitly. Getting this
wrong reports revenue 100x out, which is worse than reporting nothing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal

from sqlalchemy import BigInteger, ColumnElement, and_, case, func, select, type_coerce
from sqlmodel import col

from app.core.security import Permission
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import CreditStatus, CustomerStatus, PaymentMethod, ReportPeriod
from app.models.types import quantize_money
from app.services.base import BaseService
from app.utils.dates import ensure_utc, month_range, period_bounds, start_of_day, today_in

ZERO = Decimal("0")
_MINOR_UNITS = Decimal("100")


# ---------------------------------------------------------------------------
# Aggregate-SQL money helpers. Shared with reports.py and export.py.
# ---------------------------------------------------------------------------
def money_sum(column: Any) -> ColumnElement[int]:
    """``SUM(column)`` over a MoneyType column, returned as raw integer minor units.

    ``type_coerce(column, BigInteger)`` deliberately strips MoneyType's result
    processor from the expression. We could instead let SQLAlchemy propagate
    MoneyType through SUM (it does, today, for a bare ``func.sum``) -- but that
    inference silently stops holding once the column is wrapped in a CASE, a
    COALESCE with a literal, or a window function, and the failure mode is a total
    that is exactly 100x wrong with no exception raised. So: the database always
    hands us cents, and ``to_money`` is the single place cents become a Decimal.
    """
    return func.coalesce(func.sum(type_coerce(column, BigInteger)), 0)


def money_sum_if(column: Any, condition: Any) -> ColumnElement[int]:
    """Conditional SUM in minor units -- lets one query answer many questions.

    A dashboard needs ~15 totals over the same three tables. Fifteen queries is
    fifteen index scans; ``SUM(CASE WHEN ... )`` columns in one query is one.
    """
    return func.coalesce(
        func.sum(case((condition, type_coerce(column, BigInteger)), else_=0)), 0
    )


def count_if(condition: Any) -> ColumnElement[int]:
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def to_money(minor_units: int | None) -> Decimal:
    """Integer minor units (as stored) -> Decimal with 2dp. The one conversion point."""
    return quantize_money(Decimal(int(minor_units or 0)) / _MINOR_UNITS)


def pct_delta(current: Decimal, previous: Decimal) -> Decimal | None:
    """Percentage change, or None when there is no baseline to compare against.

    None -- not 0, not +100% -- when ``previous`` is zero: going from nothing to
    something is not "an infinite increase", it is "new". The UI renders that as a
    dash rather than a misleading green arrow.
    """
    if previous == ZERO:
        return None
    return quantize_money((current - previous) / previous * Decimal("100"))


# ---------------------------------------------------------------------------
# Return types
# ---------------------------------------------------------------------------
@dataclass(frozen=True, slots=True)
class DashboardCard:
    """One dashboard tile: a value, its previous-period value, and the trend arrow."""

    key: str
    value: Decimal
    previous: Decimal
    delta_pct: Decimal | None
    is_money: bool = False

    @property
    def count(self) -> int:
        """The value as an int -- for the cards that are counts, not money."""
        return int(self.value)

    @property
    def direction(self) -> Literal["up", "down", "flat"]:
        if self.delta_pct is None or self.delta_pct == ZERO:
            return "flat"
        return "up" if self.delta_pct > ZERO else "down"


@dataclass(frozen=True, slots=True)
class DashboardSummary:
    as_of: date
    currency: str
    currency_symbol: str

    total_customers: DashboardCard
    active_customers: DashboardCard
    total_credits: DashboardCard
    total_credit_value: DashboardCard
    overdue_count: DashboardCard
    overdue_amount: DashboardCard
    due_today_count: DashboardCard
    due_today_amount: DashboardCard
    total_revenue: DashboardCard
    pending_revenue: DashboardCard
    collections_this_month: DashboardCard
    collections_last_month: DashboardCard

    @property
    def cards(self) -> tuple[DashboardCard, ...]:
        return (
            self.total_customers,
            self.active_customers,
            self.total_credits,
            self.total_credit_value,
            self.overdue_count,
            self.overdue_amount,
            self.due_today_count,
            self.due_today_amount,
            self.total_revenue,
            self.pending_revenue,
            self.collections_this_month,
            self.collections_last_month,
        )


@dataclass(frozen=True, slots=True)
class MonthlyPoint:
    month: date            # first day of the month, in business-local time
    label: str             # "2026-07"
    credit_issued: Decimal
    collected: Decimal
    overdue_amount: Decimal


@dataclass(frozen=True, slots=True)
class OverduePoint:
    month: date
    label: str
    count: int
    amount: Decimal


@dataclass(frozen=True, slots=True)
class TopCustomer:
    customer_id: str
    code: str
    name: str
    outstanding: Decimal
    total_credit: Decimal
    total_paid: Decimal
    credit_count: int
    overdue_count: int


@dataclass(frozen=True, slots=True)
class FeedEntry:
    """One row of the unified "latest activity" feed."""

    kind: Literal["credit", "payment"]
    id: str
    label: str             # the human number: CR-2026-0042 / PAY-2026-0117
    amount: Decimal
    at: datetime           # UTC; the UI localises
    customer_name: str


@dataclass(frozen=True, slots=True)
class UpcomingDue:
    credit_id: str
    number: str
    customer_id: str
    customer_name: str
    due_date: date
    days_until_due: int
    remaining_amount: Decimal
    status: CreditStatus


@dataclass(frozen=True, slots=True)
class MethodSlice:
    method: PaymentMethod
    total: Decimal
    count: int
    share_pct: Decimal     # of all collections, for the donut's labels


class AnalyticsService(BaseService):
    """Read-only. Every query is scoped to ``self.scope_id`` and aggregated in SQL."""

    # ---------------------------------------------------------------- summary
    def dashboard_summary(self) -> DashboardSummary:
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        tz = business.timezone
        today = today_in(tz)

        month_start = today.replace(day=1)
        prev_month_start = (month_start - timedelta(days=1)).replace(day=1)
        yesterday = today - timedelta(days=1)

        # The "previous period" for every cumulative card is "as it stood at the
        # start of this month" -- i.e. the month-to-date change is what the arrow
        # reports. That is the only baseline we can reconstruct honestly from stored
        # data without a separate metrics-history table.
        cutoff = start_of_day(month_start, tz)

        this_start, this_end = period_bounds(ReportPeriod.MONTHLY, tz, reference=today)
        last_start, last_end = period_bounds(
            ReportPeriod.MONTHLY, tz, reference=prev_month_start
        )

        cus = self._customer_totals(cutoff)
        cre = self._credit_totals(today, yesterday, month_start, cutoff)
        pay = self._payment_totals(cutoff, this_start, this_end, last_start, last_end)

        # Outstanding as it stood at the cutoff: everything billed on live credits
        # before then, minus everything collected before then. Clamped at zero --
        # see CreditService I3 for why a negative receivable must never propagate.
        prev_pending = max(
            ZERO, to_money(cre["billed_before_cutoff"]) - to_money(pay["before_cutoff"])
        )

        def card(key: str, value: Decimal, previous: Decimal, *, money: bool = False) -> DashboardCard:
            return DashboardCard(
                key=key,
                value=value,
                previous=previous,
                delta_pct=pct_delta(value, previous),
                is_money=money,
            )

        return DashboardSummary(
            as_of=today,
            currency=business.currency,
            currency_symbol=business.currency_symbol,
            total_customers=card(
                "total_customers", Decimal(cus["total"]), Decimal(cus["before_cutoff"])
            ),
            active_customers=card(
                "active_customers",
                Decimal(cus["active"]),
                Decimal(cus["active_before_cutoff"]),
            ),
            total_credits=card(
                "total_credits", Decimal(cre["count"]), Decimal(cre["count_before_cutoff"])
            ),
            total_credit_value=card(
                "total_credit_value",
                to_money(cre["value"]),
                to_money(cre["value_before_cutoff"]),
                money=True,
            ),
            overdue_count=card(
                "overdue_count",
                Decimal(cre["overdue_count"]),
                Decimal(cre["overdue_count_prev"]),
            ),
            overdue_amount=card(
                "overdue_amount",
                to_money(cre["overdue_amount"]),
                to_money(cre["overdue_amount_prev"]),
                money=True,
            ),
            # "Today" compares against yesterday, not against last month -- a
            # day-scoped card with a month-scoped baseline would be nonsense.
            due_today_count=card(
                "due_today_count",
                Decimal(cre["due_today_count"]),
                Decimal(cre["due_yesterday_count"]),
            ),
            due_today_amount=card(
                "due_today_amount",
                to_money(cre["due_today_amount"]),
                to_money(cre["due_yesterday_amount"]),
                money=True,
            ),
            total_revenue=card(
                "total_revenue",
                to_money(pay["total"]),
                to_money(pay["before_cutoff"]),
                money=True,
            ),
            pending_revenue=card(
                "pending_revenue", to_money(cre["pending"]), prev_pending, money=True
            ),
            collections_this_month=card(
                "collections_this_month",
                to_money(pay["this_month"]),
                to_money(pay["last_month"]),
                money=True,
            ),
            collections_last_month=card(
                "collections_last_month",
                to_money(pay["last_month"]),
                to_money(pay["month_before_last"]),
                money=True,
            ),
        )

    def _customer_totals(self, cutoff: datetime) -> dict[str, int]:
        active = col(Customer.status) == CustomerStatus.ACTIVE
        before = col(Customer.created_at) < cutoff

        stmt = select(
            func.count().label("total"),
            count_if(active).label("active"),
            count_if(before).label("before_cutoff"),
            count_if(and_(active, before)).label("active_before_cutoff"),
        ).where(
            Customer.business_id == self.scope_id,  # tenancy boundary
            col(Customer.deleted_at).is_(None),
        )
        return self._row(stmt)

    def _credit_totals(
        self, today: date, yesterday: date, month_start: date, cutoff: datetime
    ) -> dict[str, int]:
        """Every credit-side dashboard figure, in one indexed pass.

        Archived credits are INCLUDED in the historical totals: they are still real
        data until they are purged, and "total credits ever" must not silently drop
        the day the retention sweep runs. They cannot pollute the open-credit
        figures because only PAID/CANCELLED records are ever archived.
        """
        open_ = and_(
            col(Credit.status).in_(list(CreditStatus.open_statuses())),
            Credit.remaining_amount > 0,
        )
        # Overdue is derived here rather than read off status == OVERDUE so that the
        # same expression can be evaluated at ANY reference date -- which is what
        # makes the previous-period baseline reconstructible. At reference == today
        # it agrees with the stored status the nightly promoter maintains.
        overdue_now = and_(open_, col(Credit.due_date) < today)
        overdue_at_month_start = and_(open_, col(Credit.due_date) < month_start)

        due_today = and_(open_, col(Credit.due_date) == today)
        due_yesterday = and_(open_, col(Credit.due_date) == yesterday)

        billed = col(Credit.status) != CreditStatus.CANCELLED
        before = col(Credit.created_at) < cutoff

        stmt = select(
            func.count().label("count"),
            money_sum(Credit.grand_total).label("value"),
            count_if(before).label("count_before_cutoff"),
            money_sum_if(Credit.grand_total, before).label("value_before_cutoff"),
            money_sum_if(Credit.grand_total, and_(billed, before)).label(
                "billed_before_cutoff"
            ),
            count_if(overdue_now).label("overdue_count"),
            money_sum_if(Credit.remaining_amount, overdue_now).label("overdue_amount"),
            count_if(overdue_at_month_start).label("overdue_count_prev"),
            money_sum_if(Credit.remaining_amount, overdue_at_month_start).label(
                "overdue_amount_prev"
            ),
            count_if(due_today).label("due_today_count"),
            money_sum_if(Credit.remaining_amount, due_today).label("due_today_amount"),
            count_if(due_yesterday).label("due_yesterday_count"),
            money_sum_if(Credit.remaining_amount, due_yesterday).label(
                "due_yesterday_amount"
            ),
            money_sum_if(Credit.remaining_amount, open_).label("pending"),
        ).where(
            Credit.business_id == self.scope_id,  # tenancy boundary
            col(Credit.deleted_at).is_(None),
        )
        return self._row(stmt)

    def _payment_totals(
        self,
        cutoff: datetime,
        this_start: datetime,
        this_end: datetime,
        last_start: datetime,
        last_end: datetime,
    ) -> dict[str, int]:
        # The month before last, so collections_last_month gets a trend arrow too.
        before_last_start, before_last_end = period_bounds(
            ReportPeriod.MONTHLY,
            self.get_business().timezone,
            reference=(last_start.date() - timedelta(days=1)),
        )

        in_this = and_(col(Payment.paid_at) >= this_start, col(Payment.paid_at) < this_end)
        in_last = and_(col(Payment.paid_at) >= last_start, col(Payment.paid_at) < last_end)
        in_before_last = and_(
            col(Payment.paid_at) >= before_last_start, col(Payment.paid_at) < before_last_end
        )

        stmt = select(
            money_sum(Payment.amount).label("total"),
            money_sum_if(Payment.amount, col(Payment.paid_at) < cutoff).label("before_cutoff"),
            money_sum_if(Payment.amount, in_this).label("this_month"),
            money_sum_if(Payment.amount, in_last).label("last_month"),
            money_sum_if(Payment.amount, in_before_last).label("month_before_last"),
        ).where(
            Payment.business_id == self.scope_id,  # tenancy boundary
            col(Payment.deleted_at).is_(None),
            col(Payment.voided_at).is_(None),  # a voided payment is not revenue
        )
        return self._row(stmt)

    # ----------------------------------------------------------------- series
    def monthly_series(self, months: int = 12) -> list[MonthlyPoint]:
        """Credit issued / collected / overdue for each of the last N months.

        ``month_range`` supplies EVERY month, so a month with no activity is a zero
        and not a gap. A line chart that skips empty months turns a collapse in
        takings into a flat line -- it lies.
        """
        self.require(Permission.REPORT_READ)
        tz = self.get_business().timezone
        today = today_in(tz)
        buckets = month_range(months, tz, reference=today)

        issued = self._issued_by_month(buckets)
        collected = self._collected_by_month(buckets, tz)
        overdue = self._overdue_by_month(buckets, tz, today)

        return [
            MonthlyPoint(
                month=first,
                label=first.strftime("%Y-%m"),
                credit_issued=to_money(issued[i]),
                collected=to_money(collected[i]),
                overdue_amount=to_money(overdue[i][1]),
            )
            for i, first in enumerate(buckets)
        ]

    def overdue_trend(self, months: int = 6) -> list[OverduePoint]:
        self.require(Permission.REPORT_READ)
        tz = self.get_business().timezone
        today = today_in(tz)
        buckets = month_range(months, tz, reference=today)
        overdue = self._overdue_by_month(buckets, tz, today)

        return [
            OverduePoint(
                month=first,
                label=first.strftime("%Y-%m"),
                count=int(overdue[i][0]),
                amount=to_money(overdue[i][1]),
            )
            for i, first in enumerate(buckets)
        ]

    def _issued_by_month(self, buckets: list[date]) -> list[int]:
        """One query, one SUM(CASE) column per month.

        Bucketing with SUM(CASE) instead of GROUP BY strftime/date_trunc keeps this
        dialect-agnostic (SQLite and Postgres spell month-truncation differently)
        AND timezone-correct, because the bucket edges are computed in Python from
        the business's calendar rather than from the database's idea of a month.
        """
        # issued_date is a DATE: already the business's local calendar day, so no
        # UTC conversion is involved (converting it would introduce an off-by-one).
        columns = [
            money_sum_if(
                Credit.grand_total,
                and_(
                    col(Credit.issued_date) >= first,
                    col(Credit.issued_date) < _next_month(first),
                ),
            )
            for first in buckets
        ]
        stmt = select(*columns).where(
            Credit.business_id == self.scope_id,  # tenancy boundary
            col(Credit.deleted_at).is_(None),
            col(Credit.status) != CreditStatus.CANCELLED,
        )
        return self._tuple(stmt, len(buckets))

    def _collected_by_month(self, buckets: list[date], tz: str) -> list[int]:
        # paid_at is an INSTANT: bucket edges must be local midnight expressed in UTC.
        columns = []
        for first in buckets:
            lower = start_of_day(first, tz)
            upper = start_of_day(_next_month(first), tz)
            columns.append(
                money_sum_if(
                    Payment.amount,
                    and_(col(Payment.paid_at) >= lower, col(Payment.paid_at) < upper),
                )
            )
        stmt = select(*columns).where(
            Payment.business_id == self.scope_id,  # tenancy boundary
            col(Payment.deleted_at).is_(None),
            col(Payment.voided_at).is_(None),
        )
        return self._tuple(stmt, len(buckets))

    def _overdue_by_month(
        self, buckets: list[date], tz: str, today: date
    ) -> list[tuple[int, int]]:
        """Credits that fell due in month M and are STILL unpaid past their due date.

        Returns (count, minor_units) per bucket. A credit due later this month is not
        overdue yet, hence the ``due_date < today`` clause.
        """
        open_and_late = and_(
            col(Credit.status).in_(list(CreditStatus.open_statuses())),
            Credit.remaining_amount > 0,
            col(Credit.due_date) < today,
        )
        columns: list[Any] = []
        for first in buckets:
            in_month = and_(
                open_and_late,
                col(Credit.due_date) >= first,
                col(Credit.due_date) < _next_month(first),
            )
            columns.append(count_if(in_month))
            columns.append(money_sum_if(Credit.remaining_amount, in_month))

        stmt = select(*columns).where(
            Credit.business_id == self.scope_id,  # tenancy boundary
            col(Credit.deleted_at).is_(None),
        )
        flat = self._tuple(stmt, len(buckets) * 2)
        return [(flat[i * 2], flat[i * 2 + 1]) for i in range(len(buckets))]

    # ------------------------------------------------------------------- tops
    def top_customers(
        self, limit: int = 5, by: Literal["outstanding", "volume"] = "outstanding"
    ) -> list[TopCustomer]:
        """Biggest debtors ("outstanding") or biggest spenders ("volume").

        Sorts on Customer's cached aggregate columns rather than joining and summing
        the credit table. That is exactly what those columns exist for (see
        models/customer.py): they are indexed, CustomerService keeps them true, and
        a nightly job re-verifies them. A correlated SUM here would be a table scan
        per dashboard load.
        """
        self.require(Permission.REPORT_READ)
        sort_col = (
            col(Customer.outstanding_balance)
            if by == "outstanding"
            else col(Customer.total_credit)
        )
        stmt = (
            select(Customer)
            .where(
                Customer.business_id == self.scope_id,  # tenancy boundary
                col(Customer.deleted_at).is_(None),
                sort_col > 0,  # a table of zeroes is not a "top 5"
            )
            .order_by(sort_col.desc())
            .limit(max(1, limit))
        )
        return [
            TopCustomer(
                customer_id=c.id,
                code=c.code,
                name=c.name,
                outstanding=quantize_money(c.outstanding_balance),
                total_credit=quantize_money(c.total_credit),
                total_paid=quantize_money(c.total_paid),
                credit_count=c.credit_count,
                overdue_count=c.overdue_count,
            )
            for c in self.session.execute(stmt).scalars().all()
        ]

    # ------------------------------------------------------------------- feed
    def latest_transactions(self, limit: int = 10) -> list[FeedEntry]:
        """A single time-ordered feed of recent credits AND payments.

        Two indexed LIMIT-N queries merged in Python, rather than a SQL UNION: the
        two tables have different shapes, a UNION would force a lowest-common-
        denominator column list and defeat both tables' indexes on the sort key.
        The Python merge touches at most 2N rows, which is bounded and tiny.
        """
        self.require(Permission.REPORT_READ)
        n = max(1, limit)

        credit_stmt = (
            select(Credit, Customer.name)
            .join(Customer, col(Credit.customer_id) == col(Customer.id))
            .where(
                Credit.business_id == self.scope_id,  # tenancy boundary
                col(Credit.deleted_at).is_(None),
            )
            .order_by(col(Credit.created_at).desc())
            .limit(n)
        )
        payment_stmt = (
            select(Payment, Customer.name)
            .join(Customer, col(Payment.customer_id) == col(Customer.id))
            .where(
                Payment.business_id == self.scope_id,  # tenancy boundary
                col(Payment.deleted_at).is_(None),
                col(Payment.voided_at).is_(None),
            )
            .order_by(col(Payment.paid_at).desc())
            .limit(n)
        )

        entries: list[FeedEntry] = [
            FeedEntry(
                kind="credit",
                id=c.id,
                label=c.number,
                amount=quantize_money(c.grand_total),
                at=ensure_utc(c.created_at),
                customer_name=name,
            )
            for c, name in self.session.execute(credit_stmt).all()
        ]
        entries += [
            FeedEntry(
                kind="payment",
                id=p.id,
                label=p.number,
                amount=quantize_money(p.amount),
                at=ensure_utc(p.paid_at),
                customer_name=name,
            )
            for p, name in self.session.execute(payment_stmt).all()
        ]

        entries.sort(key=lambda e: e.at, reverse=True)
        return entries[:n]

    def upcoming_due(self, days: int = 7, limit: int = 10) -> list[UpcomingDue]:
        self.require(Permission.REPORT_READ)
        tz = self.get_business().timezone
        today = today_in(tz)
        horizon = today + timedelta(days=max(0, days))

        stmt = (
            select(Credit, Customer.name)
            .join(Customer, col(Credit.customer_id) == col(Customer.id))
            .where(
                Credit.business_id == self.scope_id,  # tenancy boundary
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                col(Credit.status).in_(list(CreditStatus.open_statuses())),
                Credit.remaining_amount > 0,
                col(Credit.due_date) >= today,
                col(Credit.due_date) <= horizon,
            )
            .order_by(col(Credit.due_date).asc())
            .limit(max(1, limit))
        )
        return [
            UpcomingDue(
                credit_id=c.id,
                number=c.number,
                customer_id=c.customer_id,
                customer_name=name,
                due_date=c.due_date,
                days_until_due=(c.due_date - today).days,
                remaining_amount=quantize_money(c.remaining_amount),
                status=CreditStatus(c.status),
            )
            for c, name in self.session.execute(stmt).all()
        ]

    # ---------------------------------------------------------------- methods
    def collections_by_method(self) -> list[MethodSlice]:
        """Payment totals per method, for the donut chart. GROUP BY, not a Python loop."""
        self.require(Permission.REPORT_READ)
        stmt = (
            select(
                col(Payment.method),
                money_sum(Payment.amount).label("total"),
                func.count().label("count"),
            )
            .where(
                Payment.business_id == self.scope_id,  # tenancy boundary
                col(Payment.deleted_at).is_(None),
                col(Payment.voided_at).is_(None),
            )
            .group_by(col(Payment.method))
        )
        rows = self.session.execute(stmt).all()
        grand_total = sum((int(r[1]) for r in rows), 0)

        slices = [
            MethodSlice(
                method=PaymentMethod(method),
                total=to_money(total),
                count=int(count),
                share_pct=(
                    quantize_money(Decimal(int(total)) / Decimal(grand_total) * 100)
                    if grand_total
                    else ZERO
                ),
            )
            for method, total, count in rows
        ]
        slices.sort(key=lambda s: s.total, reverse=True)
        return slices

    # ---------------------------------------------------------------- helpers
    def _row(self, stmt: Any) -> dict[str, int]:
        """Run a one-row aggregate query and return {label: int}."""
        row = self.session.execute(stmt).one()
        return {key: int(value or 0) for key, value in row._mapping.items()}

    def _tuple(self, stmt: Any, width: int) -> list[int]:
        row = self.session.execute(stmt).one()
        return [int(row[i] or 0) for i in range(width)]


def _next_month(first: date) -> date:
    """First day of the month after ``first`` -- the exclusive upper bucket edge."""
    return (
        first.replace(year=first.year + 1, month=1)
        if first.month == 12
        else first.replace(month=first.month + 1)
    )


__all__ = [
    "AnalyticsService",
    "DashboardCard",
    "DashboardSummary",
    "FeedEntry",
    "MethodSlice",
    "MonthlyPoint",
    "OverduePoint",
    "TopCustomer",
    "UpcomingDue",
    "count_if",
    "money_sum",
    "money_sum_if",
    "pct_delta",
    "to_money",
]
