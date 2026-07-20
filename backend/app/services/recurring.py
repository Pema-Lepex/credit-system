"""RecurringExpenseService -- standing instructions, and the job that fires them.

READ app/models/recurring.py FIRST. The idempotency guarantee lives in a unique
index on ``(expense.recurring_template_id, expense.expense_date)``, not in this
file. Everything here is written on the assumption that the database is the thing
stopping a double-charge, and that this code may be run twice, concurrently, or
half-way and then again.

CATCH-UP, AND WHY IT IS BOUNDED
--------------------------------
A template whose ``next_run`` is in the past has missed runs -- the host was asleep,
the shop was offline, the template was reactivated after a pause. The generator
walks forward from ``next_run`` to today, emitting one expense per due date, so
nothing is silently skipped.

That walk is CAPPED (``_MAX_CATCH_UP``). A daily template left dormant for three
years would otherwise produce a thousand expenses in one tick and hand the owner a
mess they have to delete one at a time. Past the cap the generator stops, logs, and
leaves ``next_run`` where it got to -- so the next tick continues rather than
skipping, and the owner sees the backlog arriving in batches instead of a flood.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import col, select

from app.core.errors import ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.cash_account import CashAccount
from app.models.enums import AuditAction, ExpenseFrequency, PaymentMethod
from app.models.expense import Expense, ExpenseCategory
from app.models.recurring import RecurringExpenseTemplate
from app.models.types import quantize_money
from app.models.vendor import Vendor
from app.services.base import BaseService, diff_fields
from app.utils.dates import today_in
from app.utils.pagination import Page, PageInput, paginate

log = logging.getLogger("app.services.recurring")

ZERO = Decimal("0")

#: Most expenses one template may generate in a single run. See the module docstring.
_MAX_CATCH_UP = 60

TEMPLATE_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "category_id",
        "vendor_id",
        "vendor_name",
        "cash_account_id",
        "amount",
        "payment_method",
        "frequency",
        "next_run",
        "anchor_day",
        "end_date",
        "is_active",
        "notes",
    }
)


def advance(day: date, frequency: ExpenseFrequency, anchor_day: int | None = None) -> date:
    """The next due date after ``day``.

    MONTHLY and YEARLY clamp to the end of a short month rather than overflowing:
    a template due on the 31st lands on the 30th in June and the 28th in February.
    Rolling into the next month instead would drift a "rent on the 31st" template
    into the following month and eventually skip one entirely.

    ``anchor_day`` is the day the owner originally chose, and it is what stops the
    clamp becoming permanent. Advancing 31 Jan gives 28 Feb; advancing THAT with an
    anchor of 31 gives 31 Mar, not 28 Mar. Without the anchor a single short month
    would move the rent three days earlier for good. See models/recurring.py.
    """
    if frequency is ExpenseFrequency.DAILY:
        return day + timedelta(days=1)
    if frequency is ExpenseFrequency.WEEKLY:
        return day + timedelta(days=7)
    if frequency is ExpenseFrequency.MONTHLY:
        return _add_months(day, 1, anchor_day)
    return _add_months(day, 12, anchor_day)


def _add_months(day: date, months: int, anchor_day: int | None = None) -> date:
    total = day.month - 1 + months
    year = day.year + total // 12
    month = total % 12 + 1
    wanted = anchor_day or day.day
    return day.replace(year=year, month=month, day=min(wanted, _days_in(year, month)))


def _days_in(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - timedelta(days=1)).day


@dataclass(slots=True)
class GenerationResult:
    """What one run of the generator did, for the scheduler's log and the UI."""

    created: int = 0
    skipped: int = 0  # already existed -- the unique index did its job
    capped: list[str] = field(default_factory=list)  # template ids that hit the cap

    def __bool__(self) -> bool:
        return bool(self.created or self.skipped)


class RecurringExpenseService(BaseService):
    # ------------------------------------------------------------------ reads
    def get(self, template_id: str) -> RecurringExpenseTemplate:
        self.require(Permission.RECURRING_EXPENSE_READ)
        return self.get_scoped(RecurringExpenseTemplate, template_id, label="Recurring expense")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> Page[RecurringExpenseTemplate]:
        self.require(Permission.RECURRING_EXPENSE_READ)
        stmt = select(RecurringExpenseTemplate).where(
            RecurringExpenseTemplate.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(RecurringExpenseTemplate.deleted_at).is_(None),
        )
        if search:
            stmt = stmt.where(col(RecurringExpenseTemplate.name).ilike(f"%{search.strip()}%"))
        if is_active is not None:
            stmt = stmt.where(RecurringExpenseTemplate.is_active == is_active)
        stmt = stmt.order_by(
            col(RecurringExpenseTemplate.is_active).desc(),
            col(RecurringExpenseTemplate.next_run).asc(),
        )
        return paginate(self.session, stmt, page or PageInput())

    # ----------------------------------------------------------------- writes
    def create(self, name: str, **fields: Any) -> RecurringExpenseTemplate:
        self.require(Permission.RECURRING_EXPENSE_MANAGE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Give this a name, e.g. 'Shop rent'", field="name")

        payload = {k: v for k, v in fields.items() if k in TEMPLATE_FIELDS and k != "name"}
        self._validate(payload)

        if payload.get("amount") is None:
            raise ValidationError("An amount is required", field="amount")
        if not payload.get("next_run"):
            # No start date given: the owner means "from today".
            payload["next_run"] = today_in(self.get_business().timezone)

        # The day they picked is the anchor for every future month -- see advance().
        payload["anchor_day"] = payload["next_run"].day

        template = RecurringExpenseTemplate(business_id=business_id, name=name, **payload)
        self.session.add(template)
        self.session.flush()

        self.audit(
            AuditAction.CREATE,
            "recurring_expense",
            template.id,
            f"Recurring expense '{name}' created "
            f"({ExpenseFrequency(template.frequency).value.lower()}, "
            f"next {template.next_run})",
        )
        self.session.commit()
        self.session.refresh(template)
        return template

    def update(self, template_id: str, **fields: Any) -> RecurringExpenseTemplate:
        self.require(Permission.RECURRING_EXPENSE_MANAGE)
        template = self.get_scoped(
            RecurringExpenseTemplate, template_id, label="Recurring expense"
        )

        payload = {k: v for k, v in fields.items() if k in TEMPLATE_FIELDS}
        if not payload:
            return template
        self._validate(payload)

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Give this a name, e.g. 'Shop rent'", field="name")
            payload["name"] = name

        # Re-scheduling re-anchors: moving the rent to the 5th means the 5th from
        # now on, not the 5th once and then whatever February leaves behind.
        if payload.get("next_run"):
            payload["anchor_day"] = payload["next_run"].day

        before = {k: getattr(template, k) for k in payload}
        for key, value in payload.items():
            setattr(template, key, value)
        self.session.add(template)

        # Editing a template changes the FUTURE only. Expenses it has already
        # generated are historical records and are never rewritten.
        self.audit(
            AuditAction.UPDATE,
            "recurring_expense",
            template.id,
            f"Recurring expense '{template.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(template)
        return template

    def set_active(self, template_id: str, *, is_active: bool) -> RecurringExpenseTemplate:
        """Pause or resume. Pausing does not move ``next_run``, so resuming will
        catch up on anything missed -- which is usually what a shop wants after
        pausing over a closure."""
        return self.update(template_id, is_active=is_active)

    def soft_delete(self, template_id: str) -> RecurringExpenseTemplate:
        self.require(Permission.RECURRING_EXPENSE_MANAGE)
        template = self.get_scoped(
            RecurringExpenseTemplate, template_id, label="Recurring expense"
        )

        # Expenses it already generated are NOT touched. Deleting a standing order
        # at a bank does not un-pay last month's rent. They keep their
        # recurring_template_id, which is what stops them being edited.
        template.deleted_at = utcnow()
        template.is_active = False
        self.session.add(template)

        self.audit(
            AuditAction.DELETE,
            "recurring_expense",
            template.id,
            f"Recurring expense '{template.name}' deleted; generated expenses kept",
        )
        self.session.commit()
        self.session.refresh(template)
        return template

    # ------------------------------------------------------------- generation
    def run_due(self, *, today: date | None = None) -> GenerationResult:
        """Turn every due template into expenses. Safe to run repeatedly.

        Called by the daily scheduler job and by the "Run now" button. Both may fire
        in the same minute; the unique index makes that a no-op rather than a
        double-charge.
        """
        if not self.ctx.is_system:
            self.require(Permission.RECURRING_EXPENSE_MANAGE)

        business = self.get_business()
        today = today or today_in(business.timezone)
        result = GenerationResult()

        templates = self.session.exec(
            select(RecurringExpenseTemplate).where(
                RecurringExpenseTemplate.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(RecurringExpenseTemplate.deleted_at).is_(None),
                RecurringExpenseTemplate.is_active == True,  # noqa: E712 (SQL, not truthiness)
                col(RecurringExpenseTemplate.next_run) <= today,
            )
        ).all()

        for template in templates:
            self._run_one(template, today, result)

        self.session.commit()
        return result

    def _run_one(
        self, template: RecurringExpenseTemplate, today: date, result: GenerationResult
    ) -> None:
        due = template.next_run
        emitted = 0

        while due <= today:
            if template.end_date and due > template.end_date:
                # Past its end date: stop for good rather than leaving it to fire
                # again tomorrow.
                template.is_active = False
                self.session.add(template)
                break

            if emitted >= _MAX_CATCH_UP:
                # Leave next_run HERE so the next tick continues from this point.
                result.capped.append(template.id)
                log.warning(
                    "Recurring expense %s hit the catch-up cap at %s; "
                    "%d generated, resuming next run",
                    template.id,
                    due,
                    emitted,
                )
                break

            if self._emit(template, due):
                result.created += 1
            else:
                result.skipped += 1

            emitted += 1
            due = advance(due, ExpenseFrequency(template.frequency), template.anchor_day)

        template.next_run = due
        if emitted:
            template.last_run_at = today
        self.session.add(template)

    def _emit(self, template: RecurringExpenseTemplate, due: date) -> bool:
        """Create one expense. Returns False if it already existed.

        The SAVEPOINT is what makes "already existed" survivable: without it, the
        IntegrityError would poison the whole session and take every other
        template's work down with it.
        """
        try:
            with self.session.begin_nested():
                expense = Expense(
                    business_id=template.business_id,
                    category_id=template.category_id,
                    amount=template.amount,
                    vendor_id=template.vendor_id,
                    vendor_name=template.vendor_name,
                    cash_account_id=template.cash_account_id,
                    payment_method=template.payment_method,
                    expense_date=due,
                    notes=template.notes or f"Automatic: {template.name}",
                    recurring_template_id=template.id,
                    created_by_user_id=None,  # the system created it, not a person
                )
                self.session.add(expense)
                self.session.flush()
        except IntegrityError:
            # The unique index refused a duplicate -- exactly what it is for.
            return False

        self.audit(
            AuditAction.CREATE,
            "expense",
            expense.id,
            f"Automatic expense from '{template.name}' for {due}",
            business_id=template.business_id,
        )
        return True

    # ---------------------------------------------------------------- helpers
    def _validate(self, fields: dict[str, Any]) -> None:
        if "amount" in fields and fields["amount"] is not None:
            try:
                amount = quantize_money(fields["amount"])
            except (ArithmeticError, TypeError, ValueError) as exc:
                raise ValidationError("Amount must be a number", field="amount") from exc
            if amount <= ZERO:
                raise ValidationError("The amount must be greater than zero", field="amount")
            fields["amount"] = amount

        if "frequency" in fields and fields["frequency"] is not None:
            try:
                fields["frequency"] = ExpenseFrequency(fields["frequency"])
            except ValueError as exc:
                raise ValidationError("Unknown frequency", field="frequency") from exc

        if "payment_method" in fields and fields["payment_method"] is not None:
            try:
                fields["payment_method"] = PaymentMethod(fields["payment_method"])
            except ValueError as exc:
                raise ValidationError("Unknown payment method", field="payment_method") from exc

        for key in ("next_run", "end_date"):
            if key in fields and fields[key] is not None and not isinstance(fields[key], date):
                raise ValidationError("That date is invalid", field=key)

        if fields.get("end_date") and fields.get("next_run"):
            if fields["end_date"] < fields["next_run"]:
                raise ValidationError(
                    "The end date is before the first run", field="end_date"
                )

        # Scope checks. get_scoped is the tenancy boundary AND the existence check.
        if fields.get("category_id"):
            self.get_scoped(ExpenseCategory, fields["category_id"], label="Expense category")
        if fields.get("cash_account_id"):
            self.get_scoped(CashAccount, fields["cash_account_id"], label="Cash account")
        if fields.get("vendor_id"):
            vendor = self.get_scoped(Vendor, fields["vendor_id"], label="Vendor")
            # Snapshot the name, so a deleted vendor still leaves a readable record.
            fields["vendor_name"] = vendor.name

        for key in ("vendor_name", "notes"):
            if key in fields and fields[key] is not None:
                text = str(fields[key]).strip()
                fields[key] = text or None


__all__ = [
    "GenerationResult",
    "RecurringExpenseService",
    "advance",
]
