"""Cash flow, aging receivable and tax summary.

The bucket BOUNDARIES are what these tests exist for. An off-by-one in the aging
ladder puts a customer in the wrong column, and the whole point of the report is
deciding who to chase first.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.models.base import utcnow
from app.models.credit import Credit, CreditItem, Payment
from app.models.customer import Customer
from app.models.enums import CreditStatus, PaymentMethod, ReportPeriod
from app.services.accounting import AGING_BUCKETS, AccountingService
from app.services.base import ServiceContext
from app.services.expense import ExpenseService

TODAY = date.today()


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------
def make_credit(
    session: Session,
    ctx: ServiceContext,
    customer: Customer,
    *,
    number: str,
    remaining: str,
    due: date,
    issued: date | None = None,
    status: CreditStatus = CreditStatus.PENDING,
    tax_amount: str = "0",
) -> Credit:
    credit = Credit(
        business_id=ctx.business_id,
        number=number,
        customer_id=customer.id,
        subtotal=Decimal(remaining),
        grand_total=Decimal(remaining),
        remaining_amount=Decimal(remaining),
        tax_amount=Decimal(tax_amount),
        issued_date=issued or due,
        due_date=due,
        status=status,
    )
    session.add(credit)
    session.commit()
    session.refresh(credit)
    return credit


def make_payment(
    session: Session, ctx: ServiceContext, customer: Customer, *, number: str, amount: str
) -> None:
    session.add(
        Payment(
            business_id=ctx.business_id,
            number=number,
            credit_id=None,
            customer_id=customer.id,
            amount=Decimal(amount),
            method=PaymentMethod.CASH,
            paid_at=utcnow(),
        )
    )
    session.commit()


# ===========================================================================
# Cash flow
# ===========================================================================
def test_cash_flow_nets_collections_against_expenses(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    make_payment(session, ctx, customer, number="PAY-CF-1", amount="5000")
    ExpenseService(ctx).create(amount="1800", expense_date=TODAY)

    report = AccountingService(ctx).cash_flow(ReportPeriod.MONTHLY)

    assert report.total_in == Decimal("5000.00")
    assert report.total_out == Decimal("1800.00")
    assert report.net_flow == Decimal("3200.00")


def test_cash_flow_net_can_be_negative(ctx: ServiceContext) -> None:
    """A month where the shop spent more than it took must say so, not clamp."""
    ExpenseService(ctx).create(amount="900", expense_date=TODAY)

    report = AccountingService(ctx).cash_flow(ReportPeriod.MONTHLY)

    assert report.total_in == Decimal("0.00")
    assert report.net_flow == Decimal("-900.00")


def test_cash_flow_includes_empty_buckets(ctx: ServiceContext) -> None:
    """A quiet day still gets a row -- omitting it would draw a downturn as a
    flat line."""
    report = AccountingService(ctx).cash_flow(ReportPeriod.MONTHLY)

    assert len(report.rows) >= 28
    assert all(r.money_in == Decimal("0.00") for r in report.rows)
    # Rows are contiguous and ordered.
    assert report.rows == sorted(report.rows, key=lambda r: r.bucket)


def test_cash_flow_rows_sum_to_the_totals(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """The chart and the headline figure must never disagree."""
    make_payment(session, ctx, customer, number="PAY-CF-2", amount="1200")
    ExpenseService(ctx).create(amount="300", expense_date=TODAY)

    report = AccountingService(ctx).cash_flow(ReportPeriod.MONTHLY)

    assert sum((r.money_in for r in report.rows), Decimal("0")) == report.total_in
    assert sum((r.money_out for r in report.rows), Decimal("0")) == report.total_out


@pytest.mark.parametrize(
    ("span_days", "expected"),
    [(10, "day"), (120, "week"), (500, "month")],
)
def test_cash_flow_granularity_scales_with_the_range(
    ctx: ServiceContext, span_days: int, expected: str
) -> None:
    """400 daily rows is unreadable; the bucket size grows with the window."""
    report = AccountingService(ctx).cash_flow(
        ReportPeriod.CUSTOM, start=TODAY - timedelta(days=span_days), end=TODAY
    )
    assert report.granularity == expected


def test_cash_flow_excludes_voided_payments_and_trashed_expenses(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    session.add(
        Payment(
            business_id=ctx.business_id,
            number="PAY-CF-VOID",
            credit_id=None,
            customer_id=customer.id,
            amount=Decimal("777"),
            method=PaymentMethod.CASH,
            paid_at=utcnow(),
            voided_at=utcnow(),
        )
    )
    session.commit()

    expenses = ExpenseService(ctx)
    binned = expenses.create(amount="555", expense_date=TODAY)
    expenses.soft_delete(binned.id)

    report = AccountingService(ctx).cash_flow(ReportPeriod.MONTHLY)

    assert report.total_in == Decimal("0.00")
    assert report.total_out == Decimal("0.00")


# ===========================================================================
# Aging receivable
# ===========================================================================
@pytest.mark.parametrize(
    ("days_overdue", "expected_bucket"),
    [
        (-5, "CURRENT"),    # due in five days
        (0, "CURRENT"),     # due today -- not late yet
        (1, "D1_30"),
        (30, "D1_30"),
        (31, "D31_60"),
        (60, "D31_60"),
        (61, "D61_90"),
        (90, "D61_90"),
        (91, "D90_PLUS"),
        (365, "D90_PLUS"),
    ],
)
def test_every_aging_boundary_lands_in_the_right_bucket(
    ctx: ServiceContext,
    session: Session,
    customer: Customer,
    days_overdue: int,
    expected_bucket: str,
) -> None:
    """THE test for this report. Each edge is checked on both sides."""
    make_credit(
        session,
        ctx,
        customer,
        number=f"CR-AGE-{days_overdue}",
        remaining="100",
        due=TODAY - timedelta(days=days_overdue),
    )

    report = AccountingService(ctx).aging_receivable(as_at=TODAY)

    populated = {b.key for b in report.buckets if b.total > Decimal("0")}
    assert populated == {expected_bucket}
    assert report.total_outstanding == Decimal("100.00")


def test_aging_buckets_sum_to_the_total(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    for i, days in enumerate((-3, 10, 45, 75, 200)):
        make_credit(
            session,
            ctx,
            customer,
            number=f"CR-SUM-{i}",
            remaining="100",
            due=TODAY - timedelta(days=days),
        )

    report = AccountingService(ctx).aging_receivable(as_at=TODAY)

    assert report.total_outstanding == Decimal("500.00")
    assert sum((b.total for b in report.buckets), Decimal("0")) == report.total_outstanding
    # One credit landed in each of the five buckets.
    assert all(b.total == Decimal("100.00") for b in report.buckets)


def test_aging_ignores_paid_and_cancelled_credits(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """A settled credit owes nothing, however late it once was."""
    make_credit(
        session, ctx, customer, number="CR-PAID", remaining="0",
        due=TODAY - timedelta(days=200), status=CreditStatus.PAID,
    )
    make_credit(
        session, ctx, customer, number="CR-CANCELLED", remaining="500",
        due=TODAY - timedelta(days=200), status=CreditStatus.CANCELLED,
    )

    report = AccountingService(ctx).aging_receivable(as_at=TODAY)

    assert report.total_outstanding == Decimal("0.00")
    assert report.customers == []


def test_aging_lists_the_worst_debt_first(
    ctx: ServiceContext, session: Session, business: object
) -> None:
    """The order IS the report -- it is the order the owner works down the list."""
    recent = Customer(business_id=ctx.business_id, code="C-1", name="Recent Debtor")
    ancient = Customer(business_id=ctx.business_id, code="C-2", name="Ancient Debtor")
    session.add_all([recent, ancient])
    session.commit()

    make_credit(session, ctx, recent, number="CR-R", remaining="9000",
                due=TODAY - timedelta(days=5))
    make_credit(session, ctx, ancient, number="CR-A", remaining="100",
                due=TODAY - timedelta(days=300))

    report = AccountingService(ctx).aging_receivable(as_at=TODAY)

    # Oldest first, even though they owe far less.
    assert [c.name for c in report.customers] == ["Ancient Debtor", "Recent Debtor"]
    assert report.customers[0].oldest_days == 300


def test_aging_reports_zero_days_when_nothing_is_late(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    make_credit(session, ctx, customer, number="CR-FUTURE", remaining="400",
                due=TODAY + timedelta(days=14))

    report = AccountingService(ctx).aging_receivable(as_at=TODAY)

    assert report.customers[0].oldest_days == 0
    assert report.customers[0].buckets["CURRENT"] == Decimal("400.00")


def test_aging_as_at_is_reproducible(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """Running last month's report today must give last month's answer."""
    make_credit(session, ctx, customer, number="CR-ASAT", remaining="100",
                due=TODAY - timedelta(days=40))

    now = AccountingService(ctx).aging_receivable(as_at=TODAY)
    back_then = AccountingService(ctx).aging_receivable(as_at=TODAY - timedelta(days=30))

    assert {b.key for b in now.buckets if b.total > 0} == {"D31_60"}
    assert {b.key for b in back_then.buckets if b.total > 0} == {"D1_30"}


def test_aging_is_tenant_scoped(ctx: ServiceContext, other_ctx: ServiceContext,
                                session: Session, customer: Customer) -> None:
    make_credit(session, ctx, customer, number="CR-MINE", remaining="5000",
                due=TODAY - timedelta(days=10))

    assert AccountingService(other_ctx).aging_receivable().total_outstanding == Decimal("0.00")


def test_the_bucket_ladder_is_exhaustive_and_ordered() -> None:
    """Every day from 0 to 400 must fall in exactly one bucket, in order."""
    assert [b[0] for b in AGING_BUCKETS] == [
        "CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS",
    ]


# ===========================================================================
# Tax summary
# ===========================================================================
def _add_item(
    session: Session, ctx: ServiceContext, credit: Credit, *, base: str, rate: str, tax: str
) -> None:
    session.add(
        CreditItem(
            business_id=ctx.business_id,
            credit_id=credit.id,
            name="Line",
            quantity=Decimal("1"),
            unit_price=Decimal(base),
            line_subtotal=Decimal(base),
            line_total=Decimal(base) + Decimal(tax),
            tax_percentage=Decimal(rate),
            tax_amount=Decimal(tax),
        )
    )
    session.commit()


def test_tax_summary_groups_by_rate(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    credit = make_credit(session, ctx, customer, number="CR-TAX-1", remaining="0",
                         due=TODAY, tax_amount="70")
    _add_item(session, ctx, credit, base="1000", rate="5", tax="50")
    _add_item(session, ctx, credit, base="200", rate="10", tax="20")

    report = AccountingService(ctx).tax_summary(ReportPeriod.MONTHLY)

    # Highest rate first.
    assert [(r.rate, r.tax_amount) for r in report.rows] == [
        (Decimal("10"), Decimal("20.00")),
        (Decimal("5"), Decimal("50.00")),
    ]
    assert report.total_taxable == Decimal("1200.00")
    assert report.total_tax == Decimal("70.00")


def test_tax_summary_reconciles_against_what_was_billed(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    credit = make_credit(session, ctx, customer, number="CR-TAX-2", remaining="0",
                         due=TODAY, tax_amount="50")
    _add_item(session, ctx, credit, base="1000", rate="5", tax="50")

    report = AccountingService(ctx).tax_summary(ReportPeriod.MONTHLY)

    assert report.total_tax_on_credits == Decimal("50.00")
    assert report.reconciles is True


def test_tax_charged_at_the_credit_level_is_flagged_not_hidden(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """If a shop charged tax on the credit rather than per line, the per-rate
    breakdown is incomplete. The report must SAY so, not quietly under-report."""
    make_credit(session, ctx, customer, number="CR-TAX-3", remaining="0",
                due=TODAY, tax_amount="80")  # no line items at all

    report = AccountingService(ctx).tax_summary(ReportPeriod.MONTHLY)

    assert report.total_tax == Decimal("0.00")
    assert report.total_tax_on_credits == Decimal("80.00")
    assert report.reconciles is False


def test_tax_summary_excludes_cancelled_credits(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    credit = make_credit(session, ctx, customer, number="CR-TAX-4", remaining="0",
                         due=TODAY, tax_amount="50", status=CreditStatus.CANCELLED)
    _add_item(session, ctx, credit, base="1000", rate="5", tax="50")

    report = AccountingService(ctx).tax_summary(ReportPeriod.MONTHLY)

    assert report.total_tax == Decimal("0.00")
    assert report.rows == []


def test_zero_rated_lines_still_appear(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """Zero-rated sales are a real category and belong in a tax report."""
    credit = make_credit(session, ctx, customer, number="CR-TAX-5", remaining="0", due=TODAY)
    _add_item(session, ctx, credit, base="400", rate="0", tax="0")

    report = AccountingService(ctx).tax_summary(ReportPeriod.MONTHLY)

    assert [(r.rate, r.taxable_base) for r in report.rows] == [
        (Decimal("0"), Decimal("400.00"))
    ]


# ===========================================================================
# Dashboard block
# ===========================================================================
def test_dashboard_reports_todays_figures(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    make_credit(session, ctx, customer, number="CR-DASH-1", remaining="4000",
                due=TODAY, issued=TODAY)
    make_payment(session, ctx, customer, number="PAY-DASH-1", amount="1500")
    ExpenseService(ctx).create(amount="600", expense_date=TODAY)

    data = AccountingService(ctx).dashboard()

    assert data.today_sales == Decimal("4000.00")
    assert data.today_collections == Decimal("1500.00")
    assert data.today_expenses == Decimal("600.00")
    assert data.outstanding_credit == Decimal("4000.00")


def test_dashboard_net_cash_flow_and_profit(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    make_payment(session, ctx, customer, number="PAY-DASH-2", amount="5000")
    ExpenseService(ctx).create(amount="2000", expense_date=TODAY)

    data = AccountingService(ctx).dashboard()

    assert data.month_revenue == Decimal("5000.00")
    assert data.month_expenses == Decimal("2000.00")
    assert data.net_cash_flow == Decimal("3000.00")
    # No products sold, so no COGS -- net profit equals net cash flow here.
    assert data.month_cogs == Decimal("0.00")
    assert data.net_profit == Decimal("3000.00")


def test_dashboard_net_profit_matches_the_profit_loss_report(
    ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    """Two different numbers under one name would be worse than no number."""
    make_payment(session, ctx, customer, number="PAY-DASH-3", amount="8000")
    ExpenseService(ctx).create(amount="1250", expense_date=TODAY)

    accounting = AccountingService(ctx)
    dashboard = accounting.dashboard()
    report = accounting.profit_loss(ReportPeriod.MONTHLY)

    assert dashboard.net_profit == report.net_profit


def test_dashboard_expense_delta_has_no_baseline_when_last_month_was_empty(
    ctx: ServiceContext,
) -> None:
    """None, not 0 and not +100% -- going from nothing to something is 'new'."""
    ExpenseService(ctx).create(amount="500", expense_date=TODAY)

    assert AccountingService(ctx).dashboard().expense_delta_pct is None


def test_dashboard_series_covers_every_month_including_empty_ones(
    ctx: ServiceContext,
) -> None:
    data = AccountingService(ctx).dashboard(months=12)

    assert len(data.monthly) == 12
    assert data.monthly == sorted(data.monthly, key=lambda r: r.bucket)
    # The last bucket is the current month.
    assert data.monthly[-1].bucket.month == TODAY.month


def test_dashboard_top_expense_categories_is_capped_and_ordered(
    ctx: ServiceContext,
) -> None:
    from app.services.expense import ExpenseCategoryService

    categories = ExpenseCategoryService(ctx)
    expenses = ExpenseService(ctx)
    for i, amount in enumerate(("100", "700", "300", "500", "200", "900")):
        category = categories.create(name=f"Cat {i}")
        expenses.create(amount=amount, category_id=category.id, expense_date=TODAY)

    data = AccountingService(ctx).dashboard()

    assert len(data.top_expense_categories) == 5  # capped
    totals = [r.total for r in data.top_expense_categories]
    assert totals == sorted(totals, reverse=True)
    assert totals[0] == Decimal("900.00")


def test_dashboard_is_tenant_scoped(
    ctx: ServiceContext, other_ctx: ServiceContext, session: Session, customer: Customer
) -> None:
    make_payment(session, ctx, customer, number="PAY-DASH-4", amount="9999")
    ExpenseService(ctx).create(amount="777", expense_date=TODAY)

    other = AccountingService(other_ctx).dashboard()

    assert other.month_revenue == Decimal("0.00")
    assert other.month_expenses == Decimal("0.00")
    assert other.outstanding_credit == Decimal("0.00")


def test_an_empty_period_is_all_zero_not_a_crash(ctx: ServiceContext) -> None:
    accounting = AccountingService(ctx)

    assert accounting.tax_summary(ReportPeriod.MONTHLY).total_tax == Decimal("0.00")
    assert accounting.cash_flow(ReportPeriod.MONTHLY).net_flow == Decimal("0.00")
    assert accounting.aging_receivable().total_outstanding == Decimal("0.00")
