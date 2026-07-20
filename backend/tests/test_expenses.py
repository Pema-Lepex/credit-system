"""Expenses: CRUD, validation, tenancy, the Trash, and the accounting reports.

The load-bearing assertions here are the ones that protect the spec's two hard
rules -- an expense must never move a customer balance, and it must never leak
across a tenant boundary.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission, Role, has_permission, hash_password
from app.models.base import utcnow
from app.models.business import Business
from app.models.credit import Payment
from app.models.enums import ApprovalStatus, AuditAction, PaymentMethod, ReportPeriod
from app.models.expense import Expense
from app.models.ledger import LedgerEntry
from app.models.retention import AuditLog
from app.models.user import User
from app.services.accounting import AccountingService
from app.services.base import ServiceContext
from app.services.expense import ExpenseCategoryService, ExpenseFilter, ExpenseService


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------
def test_distinct_categories_can_be_added_but_duplicates_are_refused(
    ctx: ServiceContext,
) -> None:
    svc = ExpenseCategoryService(ctx)
    for name in ("Rent", "Utilities", "Fuel"):
        svc.create(name=name, color="#059669")

    with pytest.raises(ConflictError):
        svc.create(name="Rent")

    assert {c.name for c in svc.list().items} == {"Rent", "Utilities", "Fuel"}


def test_categories_sort_by_sort_order_then_name(ctx: ServiceContext) -> None:
    svc = ExpenseCategoryService(ctx)
    svc.create(name="Zebra", sort_order=0)
    svc.create(name="Apple", sort_order=5)
    svc.create(name="Mango", sort_order=0)

    # sort_order first, name breaking the tie -- so an owner can pin a bucket to the
    # top without renaming it.
    assert [c.name for c in svc.list().items] == ["Mango", "Zebra", "Apple"]


def test_deleting_a_category_uncategorises_its_expenses_rather_than_deleting_them(
    ctx: ServiceContext,
) -> None:
    categories = ExpenseCategoryService(ctx)
    expenses = ExpenseService(ctx)
    category = categories.create(name="Fuel")
    expense = expenses.create(amount=Decimal("500"), category_id=category.id)

    categories.soft_delete(category.id)

    survivor = expenses.get(expense.id)
    assert survivor.category_id is None
    assert survivor.amount == Decimal("500.00")


# ---------------------------------------------------------------------------
# Expense CRUD & validation
# ---------------------------------------------------------------------------
def test_create_stores_money_exactly_and_defaults_the_date(ctx: ServiceContext) -> None:
    expense = ExpenseService(ctx).create(
        amount="1234.56", vendor_name="Druk Fuel", payment_method=PaymentMethod.CASH
    )
    assert expense.amount == Decimal("1234.56")
    assert expense.vendor_name == "Druk Fuel"
    # No date given -> today in the BUSINESS's timezone, not UTC.
    assert expense.expense_date is not None


@pytest.mark.parametrize("amount", ["0", "-1", "-0.01"])
def test_amount_must_be_greater_than_zero(ctx: ServiceContext, amount: str) -> None:
    with pytest.raises(ValidationError):
        ExpenseService(ctx).create(amount=amount)


def test_amount_must_be_a_number(ctx: ServiceContext) -> None:
    with pytest.raises(ValidationError):
        ExpenseService(ctx).create(amount="not-money")


def test_a_future_dated_expense_is_refused(ctx: ServiceContext) -> None:
    with pytest.raises(ValidationError):
        ExpenseService(ctx).create(
            amount="100", expense_date=date.today() + timedelta(days=2)
        )


def test_an_unknown_category_is_refused(ctx: ServiceContext) -> None:
    with pytest.raises(NotFoundError):
        ExpenseService(ctx).create(amount="100", category_id="does-not-exist")


def test_update_changes_fields_and_records_the_diff(ctx: ServiceContext) -> None:
    svc = ExpenseService(ctx)
    expense = svc.create(amount="100", vendor_name="Old vendor")

    updated = svc.update(expense.id, amount="250.50", vendor_name="New vendor")

    assert updated.amount == Decimal("250.50")
    assert updated.vendor_name == "New vendor"

    log = ctx.session.exec(
        select(AuditLog).where(
            AuditLog.entity_type == "expense", AuditLog.action == AuditAction.UPDATE
        )
    ).first()
    assert log is not None
    assert "amount" in log.changes


def test_every_write_leaves_an_audit_log(ctx: ServiceContext) -> None:
    svc = ExpenseService(ctx)
    expense = svc.create(amount="100")
    svc.update(expense.id, notes="corrected")
    svc.soft_delete(expense.id)

    actions = {
        log.action
        for log in ctx.session.exec(
            select(AuditLog).where(AuditLog.entity_type == "expense")
        ).all()
    }
    assert actions == {AuditAction.CREATE, AuditAction.UPDATE, AuditAction.DELETE}


# ---------------------------------------------------------------------------
# The rule the whole feature hangs on
# ---------------------------------------------------------------------------
def test_recording_an_expense_never_touches_the_customer_ledger(
    ctx: ServiceContext, customer: object
) -> None:
    """The spec's hard rule: expenses are business-only. No ledger entry, ever."""
    ExpenseService(ctx).create(amount="5000", vendor_name="Landlord")

    assert ctx.session.exec(select(LedgerEntry)).all() == []


# ---------------------------------------------------------------------------
# Filtering & search
# ---------------------------------------------------------------------------
def test_list_filters_by_category_method_and_date_range(ctx: ServiceContext) -> None:
    categories = ExpenseCategoryService(ctx)
    svc = ExpenseService(ctx)
    rent = categories.create(name="Rent")
    fuel = categories.create(name="Fuel")

    today = date.today()
    svc.create(amount="10000", category_id=rent.id, expense_date=today)
    svc.create(
        amount="500",
        category_id=fuel.id,
        payment_method=PaymentMethod.CARD,
        expense_date=today - timedelta(days=10),
    )

    by_category = svc.list(ExpenseFilter(category_id=rent.id))
    assert [e.amount for e in by_category.items] == [Decimal("10000.00")]

    by_method = svc.list(ExpenseFilter(payment_method=[PaymentMethod.CARD]))
    assert [e.amount for e in by_method.items] == [Decimal("500.00")]

    by_date = svc.list(ExpenseFilter(date_from=today))
    assert [e.amount for e in by_date.items] == [Decimal("10000.00")]


def test_search_matches_vendor_notes_and_category_name(ctx: ServiceContext) -> None:
    categories = ExpenseCategoryService(ctx)
    svc = ExpenseService(ctx)
    category = categories.create(name="Transportation")
    svc.create(amount="100", vendor_name="Druk Fuel")
    svc.create(amount="200", notes="taxi to the wholesaler")
    svc.create(amount="300", category_id=category.id)

    assert svc.search("druk").total == 1
    assert svc.search("taxi").total == 1
    assert svc.search("transport").total == 1


# ---------------------------------------------------------------------------
# Trash
# ---------------------------------------------------------------------------
def test_soft_delete_hides_the_expense_and_restore_brings_it_back(
    ctx: ServiceContext,
) -> None:
    svc = ExpenseService(ctx)
    expense = svc.create(amount="750")

    svc.soft_delete(expense.id)
    assert svc.list().total == 0
    assert svc.list_deleted().total == 1

    svc.restore(expense.id)
    assert svc.list().total == 1
    assert svc.list_deleted().total == 0


def test_permanent_delete_destroys_the_row(ctx: ServiceContext) -> None:
    svc = ExpenseService(ctx)
    expense = svc.create(amount="750")
    svc.soft_delete(expense.id)

    svc.permanent_delete(expense.id)

    assert ctx.session.get(Expense, expense.id) is None


def test_a_live_expense_cannot_be_permanently_deleted(ctx: ServiceContext) -> None:
    svc = ExpenseService(ctx)
    expense = svc.create(amount="750")
    with pytest.raises(NotFoundError):
        svc.permanent_delete(expense.id)


# ---------------------------------------------------------------------------
# Tenancy
# ---------------------------------------------------------------------------
def test_one_business_cannot_see_or_touch_another_businesses_expenses(
    ctx: ServiceContext, session: Session
) -> None:
    mine = ExpenseService(ctx).create(amount="999", vendor_name="Mine")

    other_business = Business(
        name="Other Shop",
        slug="other-shop",
        email="other@example.com",
        currency="BTN",
        currency_symbol="Nu.",
        timezone="Asia/Thimphu",
        tax_percentage=0,
        approval_status=ApprovalStatus.APPROVED,
    )
    session.add(other_business)
    session.commit()
    session.refresh(other_business)

    intruder = User(
        email="other@example.com",
        hashed_password=hash_password("Password123"),
        full_name="Other Owner",
        role=Role.ADMIN,
        business_id=other_business.id,
    )
    session.add(intruder)
    session.commit()

    other_ctx = ServiceContext(
        session=session, user=intruder, business_id=other_business.id
    )
    other_svc = ExpenseService(other_ctx)

    assert other_svc.list().total == 0
    with pytest.raises(NotFoundError):
        other_svc.get(mine.id)
    with pytest.raises(NotFoundError):
        other_svc.update(mine.id, amount="1")


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------
def test_staff_may_record_expenses_but_not_delete_them() -> None:
    assert has_permission(Role.STAFF, Permission.EXPENSE_READ)
    assert has_permission(Role.STAFF, Permission.EXPENSE_WRITE)
    assert not has_permission(Role.STAFF, Permission.EXPENSE_DELETE)
    # Managing the buckets themselves is an owner decision.
    assert has_permission(Role.STAFF, Permission.EXPENSE_CATEGORY_READ)
    assert not has_permission(Role.STAFF, Permission.EXPENSE_CATEGORY_MANAGE)


def test_admin_holds_every_expense_permission() -> None:
    for permission in (
        Permission.EXPENSE_READ,
        Permission.EXPENSE_WRITE,
        Permission.EXPENSE_DELETE,
        Permission.EXPENSE_CATEGORY_READ,
        Permission.EXPENSE_CATEGORY_MANAGE,
    ):
        assert has_permission(Role.ADMIN, permission)


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------
def test_expense_report_totals_and_groups(ctx: ServiceContext) -> None:
    categories = ExpenseCategoryService(ctx)
    svc = ExpenseService(ctx)
    rent = categories.create(name="Rent", color="#ff0000")
    fuel = categories.create(name="Fuel")

    svc.create(amount="10000", category_id=rent.id, vendor_name="Landlord")
    svc.create(amount="1500", category_id=fuel.id, vendor_name="Druk Fuel")
    svc.create(amount="500", category_id=fuel.id, vendor_name="Druk Fuel")

    report = AccountingService(ctx).expense_report(ReportPeriod.MONTHLY)

    assert report.total == Decimal("12000.00")
    assert report.count == 3

    # Largest bucket first.
    assert [(r.label, r.total, r.count) for r in report.by_category] == [
        ("Rent", Decimal("10000.00"), 1),
        ("Fuel", Decimal("2000.00"), 2),
    ]
    assert report.by_category[0].color == "#ff0000"
    assert [(r.label, r.total) for r in report.by_vendor] == [
        ("Landlord", Decimal("10000.00")),
        ("Druk Fuel", Decimal("2000.00")),
    ]
    # Shares are percentages of the report total.
    assert report.by_category[0].share_of(report.total) == Decimal("83.33")


def test_expense_report_filters_by_several_payment_methods_at_once(
    ctx: ServiceContext,
) -> None:
    """"Cash and card" is one question, not two -- every listed method must count."""
    svc = ExpenseService(ctx)
    svc.create(amount="100", payment_method=PaymentMethod.CASH)
    svc.create(amount="200", payment_method=PaymentMethod.CARD)
    svc.create(amount="400", payment_method=PaymentMethod.CHEQUE)

    report = AccountingService(ctx).expense_report(
        ReportPeriod.MONTHLY,
        payment_method=[PaymentMethod.CASH, PaymentMethod.CARD],
    )

    assert report.total == Decimal("300.00")
    assert report.count == 2


def test_uncategorised_expenses_still_appear_in_the_breakdown(
    ctx: ServiceContext,
) -> None:
    """An owner who never picks a category must not see an empty breakdown over a
    real total -- that reads as missing money."""
    ExpenseService(ctx).create(amount="800")

    report = AccountingService(ctx).expense_report(ReportPeriod.MONTHLY)

    assert report.total == Decimal("800.00")
    assert [r.label for r in report.by_category] == ["Uncategorised"]
    assert [r.label for r in report.by_vendor] == ["No vendor"]


def test_expense_report_excludes_deleted_expenses(ctx: ServiceContext) -> None:
    svc = ExpenseService(ctx)
    kept = svc.create(amount="100")
    binned = svc.create(amount="900")
    svc.soft_delete(binned.id)

    report = AccountingService(ctx).expense_report(ReportPeriod.MONTHLY)

    assert report.total == Decimal("100.00")
    assert kept.id is not None


def test_profit_loss_subtracts_expenses_from_collections(
    ctx: ServiceContext, session: Session, customer: object
) -> None:
    """Revenue is money COLLECTED; expenses come straight off it. With no products
    sold there is no COGS, so gross profit == revenue."""
    session.add(
        Payment(
            business_id=ctx.business_id,
            number="PAY-TEST-0001",
            credit_id=None,
            customer_id=customer.id,  # type: ignore[attr-defined]
            amount=Decimal("5000"),
            method=PaymentMethod.CASH,
            paid_at=utcnow(),
        )
    )
    session.commit()

    ExpenseService(ctx).create(amount="2000", vendor_name="Landlord")

    pl = AccountingService(ctx).profit_loss(ReportPeriod.MONTHLY)

    assert pl.revenue == Decimal("5000.00")
    assert pl.cost_of_goods_sold == Decimal("0.00")
    assert pl.gross_profit == Decimal("5000.00")
    assert pl.operating_expenses == Decimal("2000.00")
    assert pl.net_profit == Decimal("3000.00")
    assert pl.net_margin_pct == Decimal("60.00")


def test_profit_loss_with_no_activity_is_all_zero_not_a_crash(
    ctx: ServiceContext,
) -> None:
    pl = AccountingService(ctx).profit_loss(ReportPeriod.MONTHLY)

    assert pl.revenue == Decimal("0.00")
    assert pl.net_profit == Decimal("0.00")
    # Zero revenue must not divide by zero.
    assert pl.net_margin_pct == Decimal("0.00")


def test_a_custom_period_needs_both_dates(ctx: ServiceContext) -> None:
    with pytest.raises(ValidationError):
        AccountingService(ctx).profit_loss(ReportPeriod.CUSTOM, start=date.today())


def test_an_end_date_before_the_start_is_refused(ctx: ServiceContext) -> None:
    today = date.today()
    with pytest.raises(ValidationError):
        AccountingService(ctx).profit_loss(
            ReportPeriod.CUSTOM, start=today, end=today - timedelta(days=5)
        )
