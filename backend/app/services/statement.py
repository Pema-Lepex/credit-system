"""StatementService -- close a month, and bill it once.

Stage 4 of the ledger migration. The ledger made the balance cheap; this makes the
OBLIGATION singular. One statement per customer per month, carrying the due date
that four hundred purchases used to carry between them.

WHAT CLOSING A PERIOD MEANS
---------------------------
Read the ledger over a window and write down what it says:

    opening + charges - payments = closing

Nothing is moved, allocated or settled. The statement is a photograph of the
account, and the account keeps running underneath it. A customer who pays after the
period closes does not "pay the statement" -- they pay their balance, and the
statement notices.

THE THREE RULES
---------------
R1  IDEMPOTENT. UNIQUE(customer_id, period_start) plus a pre-check means running
    month-end twice cannot double-bill anyone. It must be safe to re-run by hand
    after a failed job, at 2am, without thinking.

R2  CLOSED STATEMENTS ARE IMMUTABLE. Once issued, the numbers are what the customer
    was told. A back-dated correction to a closed period does NOT rewrite it -- it
    lands in the next statement, exactly as a credit card does. Recomputing history
    would mean the document you sent and the document you can see disagree, which
    is the one thing a statement exists to prevent.

R3  SETTLEMENT IS DERIVED FROM THE BALANCE, never from allocation. A statement is
    SETTLED when the account balance has fallen to (or below) what it asked for.
    There is no payment_id on a statement and there never will be.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func
from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.business import Business
from app.models.customer import Customer
from app.models.enums import AuditAction, LedgerEntryType, StatementStatus
from app.models.ledger import LedgerEntry
from app.models.statement import Statement
from app.models.types import quantize_money
from app.services.base import BaseService
from app.utils.dates import today_in
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")


@dataclass(slots=True)
class CloseResult:
    period_start: date
    period_end: date
    created: int = 0
    skipped: int = 0          # already had a statement for this period (R1)
    nothing_to_bill: int = 0  # no activity and no balance -- not worth a document
    total_billed: Decimal = ZERO
    statements: list[Statement] = field(default_factory=list)


def month_bounds(on: date) -> tuple[date, date]:
    """The calendar month containing ``on``, inclusive both ends."""
    start = on.replace(day=1)
    end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
    return start, end


def previous_month(on: date) -> tuple[date, date]:
    """The month BEFORE the one containing ``on``.

    What month-end actually closes: on 1 August you bill July. Closing the current
    month would bill a period that is still running.
    """
    first_of_this = on.replace(day=1)
    return month_bounds(first_of_this - timedelta(days=1))


class StatementService(BaseService):
    # ================================================================== close
    def close_period(
        self,
        *,
        period_start: date | None = None,
        period_end: date | None = None,
        customer_id: str | None = None,
    ) -> CloseResult:
        """Generate statements for a closed period. Idempotent (R1).

        Defaults to the previous calendar month, which is what the month-end job
        wants. ``customer_id`` narrows it to one account (a shopkeeper asking for
        one customer's statement early).

        Does not commit -- the caller owns the transaction.
        """
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        today = today_in(business.timezone)

        if period_start is None or period_end is None:
            period_start, period_end = previous_month(today)
        if period_end < period_start:
            raise ValidationError(
                "The period ends before it starts.", field="period_end"
            )
        if period_end >= today:
            # Billing a period that is still running produces a statement that is
            # wrong the moment the customer buys something else today.
            raise ValidationError(
                f"That period has not finished yet (it ends {period_end}, and today is "
                f"{today}). A statement can only be issued for a period that is closed.",
                field="period_end",
            )

        result = CloseResult(period_start=period_start, period_end=period_end)
        due = period_end + timedelta(days=max(0, business.statement_due_days))

        for customer in self._customers(customer_id):
            existing = self.session.exec(
                select(Statement).where(
                    Statement.customer_id == customer.id,
                    Statement.period_start == period_start,
                )
            ).first()
            if existing is not None:
                result.skipped += 1  # R1
                continue

            opening = self._balance_before(customer.id, period_start)
            charges, payments, entries = self._activity(customer.id, period_start, period_end)
            closing = quantize_money(opening + charges - payments)

            # No activity AND nothing owed => no document. A shop with 300 customers
            # should not generate 300 statements saying "you owe nothing" every month.
            if entries == 0 and closing <= ZERO:
                result.nothing_to_bill += 1
                continue

            statement = Statement(
                business_id=self.scope_id,  # TENANCY BOUNDARY
                customer_id=customer.id,
                number=self._next_number(period_start),
                period_start=period_start,
                period_end=period_end,
                opening_balance=opening,
                charges=charges,
                payments=payments,
                closing_balance=closing,
                entry_count=entries,
                due_date=due,
                # Issued at generation: the act of closing the month IS the bill.
                status=StatementStatus.ISSUED if closing > ZERO else StatementStatus.SETTLED,
                issued_at=utcnow(),
                settled_at=utcnow() if closing <= ZERO else None,
            )
            self.session.add(statement)
            self.session.flush()

            result.created += 1
            result.total_billed = quantize_money(result.total_billed + max(ZERO, closing))
            result.statements.append(statement)

        if result.created:
            self.audit(
                AuditAction.CREATE,
                "statement",
                None,
                f"Issued {result.created} statement(s) for "
                f"{period_start:%b %Y} totalling {result.total_billed}",
            )
        return result

    def refresh_statuses(self, *, today: date | None = None) -> int:
        """Re-derive ISSUED/SETTLED/OVERDUE from the account balance (R3).

        Called by the nightly job. This is the ONLY way a statement is settled:
        nothing is ever allocated to it. A statement asking for 9,880 is settled the
        moment the account balance drops to 9,880-or-less, whether that took one
        payment or five.

        Returns how many changed.
        """
        self.require(Permission.REPORT_READ)
        business = self.get_business()
        reference = today or today_in(business.timezone)

        stmt = select(Statement).where(
            Statement.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Statement.status).in_([StatementStatus.ISSUED, StatementStatus.OVERDUE]),
        )
        changed = 0
        for statement in self.session.exec(stmt).all():
            customer = self.session.get(Customer, statement.customer_id)
            if customer is None:
                continue

            # THE SETTLEMENT RULE. The statement asked for `closing_balance`. If the
            # account has since fallen to or below that, everything it billed for has
            # been paid -- later purchases may have pushed the balance up again, but
            # those belong to the NEXT statement, not this one.
            settled = customer.ledger_balance <= ZERO or self._covered(statement, customer)
            if settled:
                new_status = StatementStatus.SETTLED
            elif statement.due_date < reference:
                new_status = StatementStatus.OVERDUE
            else:
                new_status = StatementStatus.ISSUED

            if new_status is not StatementStatus(statement.status):
                statement.status = new_status
                statement.settled_at = utcnow() if new_status is StatementStatus.SETTLED else None
                self.session.add(statement)
                changed += 1
        return changed

    def _covered(self, statement: Statement, customer: Customer) -> bool:
        """Has everything this statement billed for been paid?

        Payments SINCE the statement closed, measured against what it asked for. A
        customer who owed 9,880 and has since paid 9,880 has settled it, even if they
        have bought another 2,000 worth in the meantime and their balance is 2,000.
        """
        paid_since = self.session.exec(
            select(func.coalesce(func.sum(col(LedgerEntry.amount)), 0)).where(
                LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                LedgerEntry.customer_id == customer.id,
                LedgerEntry.entry_type == LedgerEntryType.PAYMENT,
                col(LedgerEntry.occurred_at) > _end_of_day(statement.period_end),
            )
        ).one()
        # Payments are negative; flip the sign to compare with what was billed.
        return quantize_money(-Decimal(paid_since or 0)) >= statement.closing_balance

    # =================================================================== read
    def get(self, statement_id: str) -> Statement:
        self.require(Permission.REPORT_READ)
        statement = self.session.get(Statement, statement_id)
        if statement is None:
            raise NotFoundError("Statement not found")
        self.assert_in_scope(statement.business_id)
        return statement

    def list(
        self, *, customer_id: str | None = None, page: PageInput | None = None
    ) -> Page[Statement]:
        self.require(Permission.REPORT_READ)
        stmt = select(Statement).where(
            Statement.business_id == self.scope_id  # TENANCY BOUNDARY
        )
        if customer_id:
            stmt = stmt.where(Statement.customer_id == customer_id)
        stmt = stmt.order_by(col(Statement.period_start).desc())
        return paginate(self.session, stmt, page or PageInput())

    def entries_for(self, statement_id: str) -> list[LedgerEntry]:
        """The ledger lines this statement covers -- the detail behind the total."""
        statement = self.get(statement_id)
        return list(
            self.session.exec(
                select(LedgerEntry)
                .where(
                    LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                    LedgerEntry.customer_id == statement.customer_id,
                    col(LedgerEntry.occurred_at) >= _start_of_day(statement.period_start),
                    col(LedgerEntry.occurred_at) <= _end_of_day(statement.period_end),
                )
                .order_by(col(LedgerEntry.seq).asc())
            ).all()
        )

    # ================================================================ helpers
    def _customers(self, customer_id: str | None) -> list[Customer]:
        stmt = select(Customer).where(
            Customer.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(Customer.deleted_at).is_(None),
        )
        if customer_id:
            stmt = stmt.where(Customer.id == customer_id)
        found = list(self.session.exec(stmt).all())
        if customer_id and not found:
            raise NotFoundError("Customer not found")
        return found

    def _balance_before(self, customer_id: str, period_start: date) -> Decimal:
        """The balance carried in: everything that happened before this period.

        By occurred_at, not seq: a charge back-dated INTO an earlier period belongs
        to that period's opening balance, because that is when it happened.
        """
        total = self.session.exec(
            select(func.coalesce(func.sum(col(LedgerEntry.amount)), 0)).where(
                LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                LedgerEntry.customer_id == customer_id,
                col(LedgerEntry.occurred_at) < _start_of_day(period_start),
            )
        ).one()
        return quantize_money(Decimal(total or 0))

    def _activity(
        self, customer_id: str, period_start: date, period_end: date
    ) -> tuple[Decimal, Decimal, int]:
        """(charges, payments-as-positive, entry_count) within the window."""
        rows = self.session.exec(
            select(LedgerEntry.amount).where(
                LedgerEntry.business_id == self.scope_id,  # TENANCY BOUNDARY
                LedgerEntry.customer_id == customer_id,
                col(LedgerEntry.occurred_at) >= _start_of_day(period_start),
                col(LedgerEntry.occurred_at) <= _end_of_day(period_end),
            )
        ).all()

        charges = quantize_money(sum((a for a in rows if a > ZERO), ZERO))
        # Flipped to positive: a statement reads "you paid 5,710", never "-5,710".
        payments = quantize_money(-sum((a for a in rows if a < ZERO), ZERO))
        return charges, payments, len(rows)

    def _next_number(self, period_start: date) -> str:
        """ST-2026-07-0042. Per business, per period -- the sequence restarts each
        month, which is what makes it readable down a phone."""
        prefix = f"ST-{period_start:%Y-%m}-"
        rows = self.session.exec(
            select(Statement.number).where(
                Statement.business_id == self.scope_id,
                col(Statement.number).like(f"{prefix}%"),
            )
        ).all()
        highest = 0
        for value in rows:
            tail = str(value).rsplit("-", 1)[-1]
            if tail.isdigit():
                highest = max(highest, int(tail))
        return f"{prefix}{highest + 1:04d}"


def _start_of_day(day: date):
    from datetime import datetime, time

    from app.utils.dates import ensure_utc

    return ensure_utc(datetime.combine(day, time.min))


def _end_of_day(day: date):
    from datetime import datetime, time

    from app.utils.dates import ensure_utc

    return ensure_utc(datetime.combine(day, time.max))


__all__ = ["CloseResult", "StatementService", "month_bounds", "previous_month"]
