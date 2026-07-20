"""Phase 2: vendors, cash accounts and recurring expenses.

The load-bearing tests here are the IDEMPOTENCY ones. The scheduler's contract is
that every job can run twice with no ill effect; for a generator that is the
difference between "the rent was recorded" and "the rent was recorded four times".
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission, Role, has_permission
from app.models.base import utcnow
from app.models.credit import Payment
from app.models.enums import ExpenseFrequency, PaymentMethod
from app.services.base import ServiceContext
from app.services.cash_account import CashAccountService
from app.services.expense import ExpenseFilter, ExpenseService
from app.services.recurring import RecurringExpenseService, advance
from app.services.vendor import VendorService


# ===========================================================================
# Vendors
# ===========================================================================
def test_vendor_crud_and_duplicate_names(ctx: ServiceContext) -> None:
    svc = VendorService(ctx)
    vendor = svc.create("Druk Fuel", phone="+975 17 11 22 33", email="sales@druk.bt")
    assert vendor.name == "Druk Fuel"

    with pytest.raises(ConflictError):
        svc.create("Druk Fuel")

    updated = svc.update(vendor.id, phone="+975 17 99 88 77")
    assert updated.phone == "+975 17 99 88 77"

    assert svc.list().total == 1


def test_vendor_email_is_sanity_checked(ctx: ServiceContext) -> None:
    with pytest.raises(ValidationError):
        VendorService(ctx).create("Bad Email Co", email="not-an-email")


def test_vendor_search_matches_name_phone_and_email(ctx: ServiceContext) -> None:
    svc = VendorService(ctx)
    svc.create("Druk Fuel", phone="+975 17 11 22 33", email="sales@druk.bt")
    svc.create("Thimphu Wholesale")

    assert svc.search("druk").total == 1
    assert svc.search("17 11").total == 1
    assert svc.search("sales@").total == 1


def test_picking_a_vendor_snapshots_its_name_onto_the_expense(
    ctx: ServiceContext,
) -> None:
    vendor = VendorService(ctx).create("Druk Fuel")
    expense = ExpenseService(ctx).create(amount="500", vendor_id=vendor.id)

    assert expense.vendor_id == vendor.id
    assert expense.vendor_name == "Druk Fuel"  # snapshotted, not just linked


def test_deleting_a_vendor_leaves_the_name_on_past_expenses(
    ctx: ServiceContext,
) -> None:
    """The whole point of the snapshot: history must not go blank."""
    vendors = VendorService(ctx)
    expenses = ExpenseService(ctx)
    vendor = vendors.create("Druk Fuel")
    expense = expenses.create(amount="500", vendor_id=vendor.id)

    vendors.soft_delete(vendor.id)

    survivor = expenses.get(expense.id)
    assert survivor.vendor_id is None       # link detached
    assert survivor.vendor_name == "Druk Fuel"  # record still readable
    assert survivor.amount == Decimal("500.00")


def test_renaming_a_vendor_does_not_rewrite_past_expenses(ctx: ServiceContext) -> None:
    vendors = VendorService(ctx)
    expenses = ExpenseService(ctx)
    vendor = vendors.create("Druk Fuel")
    expense = expenses.create(amount="500", vendor_id=vendor.id)

    vendors.update(vendor.id, name="Druk Petroleum")

    # The expense records who was paid AT THE TIME.
    assert expenses.get(expense.id).vendor_name == "Druk Fuel"


def test_expenses_can_be_filtered_by_vendor(ctx: ServiceContext) -> None:
    vendors = VendorService(ctx)
    expenses = ExpenseService(ctx)
    fuel = vendors.create("Druk Fuel")
    vendors.create("Thimphu Wholesale")

    expenses.create(amount="500", vendor_id=fuel.id)
    expenses.create(amount="900")

    assert expenses.list(ExpenseFilter(vendor_id=fuel.id)).total == 1


def test_an_unknown_vendor_is_refused(ctx: ServiceContext) -> None:
    with pytest.raises(NotFoundError):
        ExpenseService(ctx).create(amount="100", vendor_id="nope")


# ===========================================================================
# Cash accounts
# ===========================================================================
def test_balance_is_opening_plus_payments_minus_expenses(
    ctx: ServiceContext, session: Session, customer: object
) -> None:
    accounts = CashAccountService(ctx)
    till = accounts.create("Cash in the till", opening_balance="1000")

    session.add(
        Payment(
            business_id=ctx.business_id,
            number="PAY-CA-0001",
            credit_id=None,
            customer_id=customer.id,  # type: ignore[attr-defined]
            amount=Decimal("2500"),
            method=PaymentMethod.CASH,
            paid_at=utcnow(),
            cash_account_id=till.id,
        )
    )
    session.commit()

    ExpenseService(ctx).create(amount="400", cash_account_id=till.id)

    balance = accounts.balance_of(till.id)
    assert balance.money_in == Decimal("2500.00")
    assert balance.money_out == Decimal("400.00")
    assert balance.balance == Decimal("3100.00")  # 1000 + 2500 - 400


def test_a_voided_payment_does_not_count_toward_the_balance(
    ctx: ServiceContext, session: Session, customer: object
) -> None:
    """Money that never arrived must not show up in the till."""
    accounts = CashAccountService(ctx)
    till = accounts.create("Cash in the till")

    session.add(
        Payment(
            business_id=ctx.business_id,
            number="PAY-CA-0002",
            credit_id=None,
            customer_id=customer.id,  # type: ignore[attr-defined]
            amount=Decimal("999"),
            method=PaymentMethod.CASH,
            paid_at=utcnow(),
            cash_account_id=till.id,
            voided_at=utcnow(),
        )
    )
    session.commit()

    assert accounts.balance_of(till.id).balance == Decimal("0.00")


def test_a_trashed_expense_does_not_count_toward_the_balance(
    ctx: ServiceContext,
) -> None:
    accounts = CashAccountService(ctx)
    expenses = ExpenseService(ctx)
    till = accounts.create("Cash in the till", opening_balance="500")

    expense = expenses.create(amount="200", cash_account_id=till.id)
    assert accounts.balance_of(till.id).balance == Decimal("300.00")

    expenses.soft_delete(expense.id)
    assert accounts.balance_of(till.id).balance == Decimal("500.00")


def test_opening_balance_may_be_negative(ctx: ServiceContext) -> None:
    """An overdrawn bank account is a real thing a shop can have."""
    account = CashAccountService(ctx).create("Bank", opening_balance="-1500")
    assert account.opening_balance == Decimal("-1500.00")
    assert CashAccountService(ctx).balance_of(account.id).balance == Decimal("-1500.00")


def test_an_account_with_no_movement_reports_its_opening_balance(
    ctx: ServiceContext,
) -> None:
    account = CashAccountService(ctx).create("Wallet", opening_balance="250")
    assert CashAccountService(ctx).balance_of(account.id).balance == Decimal("250.00")


def test_list_with_balances_covers_every_account(ctx: ServiceContext) -> None:
    accounts = CashAccountService(ctx)
    accounts.create("Till", opening_balance="100", sort_order=0)
    accounts.create("Bank", opening_balance="200", sort_order=1)

    balances = accounts.list_with_balances()
    assert [b.account.name for b in balances] == ["Till", "Bank"]
    assert [b.balance for b in balances] == [Decimal("100.00"), Decimal("200.00")]


def test_deleting_an_account_unassigns_its_records_without_destroying_them(
    ctx: ServiceContext,
) -> None:
    accounts = CashAccountService(ctx)
    expenses = ExpenseService(ctx)
    till = accounts.create("Till")
    expense = expenses.create(amount="300", cash_account_id=till.id)

    accounts.soft_delete(till.id)

    survivor = expenses.get(expense.id)
    assert survivor.cash_account_id is None
    assert survivor.amount == Decimal("300.00")


def test_duplicate_account_names_are_refused(ctx: ServiceContext) -> None:
    accounts = CashAccountService(ctx)
    accounts.create("Till")
    with pytest.raises(ConflictError):
        accounts.create("Till")


def test_an_unknown_cash_account_is_refused_on_an_expense(ctx: ServiceContext) -> None:
    with pytest.raises(NotFoundError):
        ExpenseService(ctx).create(amount="100", cash_account_id="nope")


# ===========================================================================
# Recurring expenses
# ===========================================================================
def test_advance_walks_each_frequency() -> None:
    start = date(2026, 7, 20)
    assert advance(start, ExpenseFrequency.DAILY) == date(2026, 7, 21)
    assert advance(start, ExpenseFrequency.WEEKLY) == date(2026, 7, 27)
    assert advance(start, ExpenseFrequency.MONTHLY) == date(2026, 8, 20)
    assert advance(start, ExpenseFrequency.YEARLY) == date(2027, 7, 20)


def test_a_month_end_template_does_not_drift(ctx: ServiceContext) -> None:
    """31 Jan -> 28 Feb -> 31 Mar. WITHOUT the anchor the third would be 28 Mar and
    the rent would be three days early forever after one short month."""
    day = date(2026, 1, 31)
    anchor = 31
    seen = []
    for _ in range(5):
        day = advance(day, ExpenseFrequency.MONTHLY, anchor)
        seen.append(day)

    assert seen == [
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
        date(2026, 5, 31),
        date(2026, 6, 30),
    ]


def test_running_the_generator_creates_the_expense(ctx: ServiceContext) -> None:
    today = date.today()
    svc = RecurringExpenseService(ctx)
    svc.create("Shop rent", amount="10000", frequency=ExpenseFrequency.MONTHLY, next_run=today)

    result = svc.run_due(today=today)

    assert result.created == 1
    expenses = ExpenseService(ctx).list().items
    assert len(expenses) == 1
    assert expenses[0].amount == Decimal("10000.00")
    assert expenses[0].recurring_template_id is not None


def test_running_the_generator_twice_does_not_double_charge(
    ctx: ServiceContext,
) -> None:
    """THE test. The scheduler may fire twice -- a restart, an overlapping deploy,
    a 'Run now' click in the same minute. The shop must be charged rent once."""
    today = date.today()
    svc = RecurringExpenseService(ctx)
    svc.create("Shop rent", amount="10000", frequency=ExpenseFrequency.MONTHLY, next_run=today)

    first = svc.run_due(today=today)
    second = svc.run_due(today=today)
    third = svc.run_due(today=today)

    assert first.created == 1
    # The second and third runs find nothing due (next_run has moved on), so they
    # create nothing. Either way, exactly one expense exists.
    assert second.created == 0
    assert third.created == 0
    assert ExpenseService(ctx).list().total == 1


def test_the_unique_index_refuses_a_duplicate_even_if_next_run_is_rewound(
    ctx: ServiceContext,
) -> None:
    """Belt AND braces: even with next_run forced backwards -- which is what a
    partially-applied run or a hand-edited row looks like -- the database refuses
    the second expense for that date."""
    today = date.today()
    svc = RecurringExpenseService(ctx)
    template = svc.create(
        "Shop rent", amount="10000", frequency=ExpenseFrequency.MONTHLY, next_run=today
    )

    assert svc.run_due(today=today).created == 1

    template.next_run = today  # rewind, simulating a crash between insert and commit
    ctx.session.add(template)
    ctx.session.commit()

    result = svc.run_due(today=today)

    assert result.created == 0
    assert result.skipped == 1  # the index did its job
    assert ExpenseService(ctx).list().total == 1


def test_a_missed_run_is_caught_up_not_skipped(ctx: ServiceContext) -> None:
    """The host was asleep for three days. All three days are still recorded."""
    today = date.today()
    svc = RecurringExpenseService(ctx)
    svc.create(
        "Daily float",
        amount="100",
        frequency=ExpenseFrequency.DAILY,
        next_run=today - timedelta(days=3),
    )

    result = svc.run_due(today=today)

    assert result.created == 4  # T-3, T-2, T-1, T
    assert ExpenseService(ctx).list().total == 4


def test_catch_up_is_capped_and_resumes_next_run(ctx: ServiceContext) -> None:
    """A template dormant for years must not dump a thousand rows in one tick."""
    today = date.today()
    svc = RecurringExpenseService(ctx)
    template = svc.create(
        "Daily float",
        amount="100",
        frequency=ExpenseFrequency.DAILY,
        next_run=today - timedelta(days=400),
    )

    result = svc.run_due(today=today)

    assert result.created == 60          # the cap
    assert template.id in result.capped
    # next_run advanced to where it stopped, so the backlog CONTINUES rather than
    # being silently skipped.
    assert ctx.session.get(type(template), template.id).next_run < today


def test_an_inactive_template_generates_nothing(ctx: ServiceContext) -> None:
    today = date.today()
    svc = RecurringExpenseService(ctx)
    template = svc.create("Shop rent", amount="10000", next_run=today)
    svc.set_active(template.id, is_active=False)

    assert svc.run_due(today=today).created == 0
    assert ExpenseService(ctx).list().total == 0


def test_a_template_stops_at_its_end_date(ctx: ServiceContext) -> None:
    today = date.today()
    svc = RecurringExpenseService(ctx)
    template = svc.create(
        "Short lease",
        amount="500",
        frequency=ExpenseFrequency.DAILY,
        next_run=today - timedelta(days=5),
        end_date=today - timedelta(days=3),
    )

    result = svc.run_due(today=today)

    assert result.created == 3  # T-5, T-4, T-3 then stop
    assert ctx.session.get(type(template), template.id).is_active is False


def test_an_end_date_before_the_start_is_refused(ctx: ServiceContext) -> None:
    today = date.today()
    with pytest.raises(ValidationError):
        RecurringExpenseService(ctx).create(
            "Backwards", amount="100", next_run=today, end_date=today - timedelta(days=1)
        )


@pytest.mark.parametrize("amount", ["0", "-5"])
def test_a_template_amount_must_be_positive(ctx: ServiceContext, amount: str) -> None:
    with pytest.raises(ValidationError):
        RecurringExpenseService(ctx).create("Bad", amount=amount)


def test_a_generated_expense_cannot_be_edited(ctx: ServiceContext) -> None:
    """Spec: never edit generated expenses. Correct the template instead."""
    today = date.today()
    recurring = RecurringExpenseService(ctx)
    recurring.create("Shop rent", amount="10000", next_run=today)
    recurring.run_due(today=today)

    generated = ExpenseService(ctx).list().items[0]
    with pytest.raises(ConflictError):
        ExpenseService(ctx).update(generated.id, amount="1")


def test_a_generated_expense_can_still_be_deleted(ctx: ServiceContext) -> None:
    """Refusing edits must not trap a wrong row -- deleting it stays available."""
    today = date.today()
    recurring = RecurringExpenseService(ctx)
    recurring.create("Shop rent", amount="10000", next_run=today)
    recurring.run_due(today=today)

    generated = ExpenseService(ctx).list().items[0]
    ExpenseService(ctx).soft_delete(generated.id)

    assert ExpenseService(ctx).list().total == 0


def test_deleting_a_template_keeps_the_expenses_it_generated(
    ctx: ServiceContext,
) -> None:
    """Cancelling a standing order does not un-pay last month's rent."""
    today = date.today()
    recurring = RecurringExpenseService(ctx)
    template = recurring.create("Shop rent", amount="10000", next_run=today)
    recurring.run_due(today=today)

    recurring.soft_delete(template.id)

    assert ExpenseService(ctx).list().total == 1


def test_a_template_carries_its_category_vendor_and_account_onto_the_expense(
    ctx: ServiceContext,
) -> None:
    from app.services.expense import ExpenseCategoryService

    today = date.today()
    category = ExpenseCategoryService(ctx).create(name="Rent")
    vendor = VendorService(ctx).create("Landlord")
    account = CashAccountService(ctx).create("Bank")

    recurring = RecurringExpenseService(ctx)
    recurring.create(
        "Shop rent",
        amount="10000",
        next_run=today,
        category_id=category.id,
        vendor_id=vendor.id,
        cash_account_id=account.id,
    )
    recurring.run_due(today=today)

    expense = ExpenseService(ctx).list().items[0]
    assert expense.category_id == category.id
    assert expense.vendor_id == vendor.id
    assert expense.vendor_name == "Landlord"
    assert expense.cash_account_id == account.id


# ===========================================================================
# Tenancy & permissions
# ===========================================================================
def test_phase2_records_are_tenant_scoped(
    ctx: ServiceContext, session: Session, other_ctx: ServiceContext
) -> None:
    vendor = VendorService(ctx).create("Druk Fuel")
    account = CashAccountService(ctx).create("Till")
    template = RecurringExpenseService(ctx).create("Rent", amount="100")

    assert VendorService(other_ctx).list().total == 0
    assert CashAccountService(other_ctx).list().total == 0
    assert RecurringExpenseService(other_ctx).list().total == 0

    for service, entity_id in (
        (VendorService(other_ctx), vendor.id),
        (CashAccountService(other_ctx), account.id),
        (RecurringExpenseService(other_ctx), template.id),
    ):
        with pytest.raises(NotFoundError):
            service.get(entity_id)


def test_the_generator_never_crosses_a_tenant_boundary(
    ctx: ServiceContext, other_ctx: ServiceContext
) -> None:
    today = date.today()
    RecurringExpenseService(ctx).create("Rent", amount="10000", next_run=today)

    # The other business runs its own generator: it must produce nothing.
    assert RecurringExpenseService(other_ctx).run_due(today=today).created == 0
    assert ExpenseService(other_ctx).list().total == 0
    assert ExpenseService(ctx).list().total == 0  # ours has not run yet either


def test_staff_may_add_vendors_but_not_configure_accounts_or_schedules() -> None:
    assert has_permission(Role.STAFF, Permission.VENDOR_READ)
    assert has_permission(Role.STAFF, Permission.VENDOR_WRITE)
    assert not has_permission(Role.STAFF, Permission.VENDOR_DELETE)

    assert has_permission(Role.STAFF, Permission.CASH_ACCOUNT_READ)
    assert not has_permission(Role.STAFF, Permission.CASH_ACCOUNT_MANAGE)

    assert has_permission(Role.STAFF, Permission.RECURRING_EXPENSE_READ)
    assert not has_permission(Role.STAFF, Permission.RECURRING_EXPENSE_MANAGE)


def test_admin_holds_every_phase2_permission() -> None:
    for permission in (
        Permission.VENDOR_READ,
        Permission.VENDOR_WRITE,
        Permission.VENDOR_DELETE,
        Permission.CASH_ACCOUNT_READ,
        Permission.CASH_ACCOUNT_MANAGE,
        Permission.RECURRING_EXPENSE_READ,
        Permission.RECURRING_EXPENSE_MANAGE,
    ):
        assert has_permission(Role.ADMIN, permission)


def test_models_are_registered_for_alembic() -> None:
    """A model missing from app/models/__init__.py silently does not exist -- no
    table from create_all, and nothing for autogenerate to see."""
    import app.models as models

    for name in ("CashAccount", "RecurringExpenseTemplate", "Vendor", "ExpenseFrequency"):
        assert hasattr(models, name), f"{name} is not exported from app.models"
        assert name in models.__all__, f"{name} is missing from app.models.__all__"
