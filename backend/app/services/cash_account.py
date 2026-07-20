"""CashAccountService -- what is in the till, the bank, and the wallet.

The balance is DERIVED, never stored. See app/models/cash_account.py for the full
argument; the short version is that a stored counter would need updating from
eleven different write paths and is silently wrong forever the first time one is
missed.

MONEY: every sum goes through analytics.money_sum / to_money. Never hand-roll a
SUM over a MoneyType column.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlmodel import col, select

from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.cash_account import CashAccount
from app.models.credit import Payment
from app.models.enums import AuditAction
from app.models.expense import Expense
from app.models.recurring import RecurringExpenseTemplate
from app.models.types import quantize_money
from app.services.analytics import money_sum, to_money
from app.services.base import BaseService, diff_fields
from app.utils.pagination import Page, PageInput, paginate

ZERO = Decimal("0")

CASH_ACCOUNT_FIELDS: frozenset[str] = frozenset(
    {"name", "description", "opening_balance", "is_active", "sort_order"}
)


@dataclass(frozen=True, slots=True)
class CashAccountBalance:
    """An account plus the three numbers that make up its current balance."""

    account: CashAccount
    money_in: Decimal
    money_out: Decimal

    @property
    def balance(self) -> Decimal:
        return quantize_money(self.account.opening_balance + self.money_in - self.money_out)


class CashAccountService(BaseService):
    def get(self, account_id: str) -> CashAccount:
        self.require(Permission.CASH_ACCOUNT_READ)
        return self.get_scoped(CashAccount, account_id, label="Cash account")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        is_active: bool | None = None,
    ) -> Page[CashAccount]:
        self.require(Permission.CASH_ACCOUNT_READ)
        stmt = select(CashAccount).where(
            CashAccount.business_id == self.scope_id,  # TENANCY BOUNDARY
            col(CashAccount.deleted_at).is_(None),
        )
        if search:
            stmt = stmt.where(col(CashAccount.name).ilike(f"%{search.strip()}%"))
        if is_active is not None:
            stmt = stmt.where(CashAccount.is_active == is_active)
        stmt = stmt.order_by(
            col(CashAccount.sort_order).asc(), col(CashAccount.name).asc()
        )
        return paginate(self.session, stmt, page or PageInput())

    # -------------------------------------------------------------- balances
    def balance_of(self, account_id: str) -> CashAccountBalance:
        """Current balance for one account, computed from its movements."""
        account = self.get(account_id)
        return self._balances_for([account])[0]

    def list_with_balances(
        self, *, is_active: bool | None = None
    ) -> list[CashAccountBalance]:
        """Every account with its balance -- what the Cash accounts screen shows.

        Two grouped queries total, not two per account: the money-in and money-out
        sums are each a single GROUP BY over an indexed, business-scoped table.
        """
        self.require(Permission.CASH_ACCOUNT_READ)
        accounts = list(self.list(PageInput(page=1, limit=200), is_active=is_active).items)
        return self._balances_for(accounts)

    def _balances_for(self, accounts: list[CashAccount]) -> list[CashAccountBalance]:
        if not accounts:
            return []

        # Money IN: payments received into the account. A voided or trashed payment
        # is money that never arrived, so both are excluded -- the same predicate
        # PaymentService.list and the reports use.
        in_rows = self.session.execute(
            select(
                Payment.cash_account_id,
                money_sum(Payment.amount).label("total"),
            )
            .where(
                Payment.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Payment.deleted_at).is_(None),
                col(Payment.voided_at).is_(None),
                col(Payment.cash_account_id).is_not(None),
            )
            .group_by(Payment.cash_account_id)
        ).all()
        money_in = {row.cash_account_id: to_money(row.total) for row in in_rows}

        # Money OUT: expenses paid from the account. Trashed expenses excluded, to
        # match the expense reports.
        out_rows = self.session.execute(
            select(
                Expense.cash_account_id,
                money_sum(Expense.amount).label("total"),
            )
            .where(
                Expense.business_id == self.scope_id,  # TENANCY BOUNDARY
                col(Expense.deleted_at).is_(None),
                col(Expense.cash_account_id).is_not(None),
            )
            .group_by(Expense.cash_account_id)
        ).all()
        money_out = {row.cash_account_id: to_money(row.total) for row in out_rows}

        return [
            CashAccountBalance(
                account=account,
                money_in=money_in.get(account.id, ZERO),
                money_out=money_out.get(account.id, ZERO),
            )
            for account in accounts
        ]

    # ---------------------------------------------------------------- writes
    def create(self, name: str, **fields: Any) -> CashAccount:
        self.require(Permission.CASH_ACCOUNT_MANAGE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Account name is required", field="name")
        self._assert_name_free(business_id, name)

        payload = {
            k: v for k, v in fields.items() if k in CASH_ACCOUNT_FIELDS and k != "name"
        }
        self._validate(payload)

        account = CashAccount(business_id=business_id, name=name, **payload)
        self.session.add(account)
        self.session.flush()

        self.audit(
            AuditAction.CREATE, "cash_account", account.id, f"Cash account '{name}' created"
        )
        self.session.commit()
        self.session.refresh(account)
        return account

    def update(self, account_id: str, **fields: Any) -> CashAccount:
        self.require(Permission.CASH_ACCOUNT_MANAGE)
        account = self.get_scoped(CashAccount, account_id, label="Cash account")

        payload = {k: v for k, v in fields.items() if k in CASH_ACCOUNT_FIELDS}
        if not payload:
            return account
        self._validate(payload)

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Account name is required", field="name")
            if name != account.name:
                self._assert_name_free(account.business_id, name)
            payload["name"] = name

        before = {k: getattr(account, k) for k in payload}
        for key, value in payload.items():
            setattr(account, key, value)
        self.session.add(account)

        self.audit(
            AuditAction.UPDATE,
            "cash_account",
            account.id,
            f"Cash account '{account.name}' updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(account)
        return account

    def set_active(self, account_id: str, *, is_active: bool) -> CashAccount:
        return self.update(account_id, is_active=is_active)

    def soft_delete(self, account_id: str) -> CashAccount:
        self.require(Permission.CASH_ACCOUNT_MANAGE)
        account = self.get_scoped(CashAccount, account_id, label="Cash account")

        # Detach by hand -- the columns carry no DB-level FK, and ON DELETE SET NULL
        # never fires for a soft delete anyway. Payments and expenses survive intact;
        # they simply stop being attributed to a pot that no longer exists.
        detached = 0
        for model in (Payment, Expense, RecurringExpenseTemplate):
            rows = self.session.exec(
                select(model).where(
                    model.business_id == account.business_id,
                    model.cash_account_id == account.id,
                    col(model.deleted_at).is_(None),
                )
            ).all()
            for row in rows:
                row.cash_account_id = None
                self.session.add(row)
                detached += 1

        account.deleted_at = utcnow()
        account.is_active = False
        self.session.add(account)

        self.audit(
            AuditAction.DELETE,
            "cash_account",
            account.id,
            f"Cash account '{account.name}' deleted; {detached} record(s) unassigned",
        )
        self.session.commit()
        self.session.refresh(account)
        return account

    def restore(self, account_id: str) -> CashAccount:
        self.require(Permission.CASH_ACCOUNT_MANAGE)
        account = self.session.get(CashAccount, account_id)
        if account is None or account.deleted_at is None:
            raise NotFoundError("Deleted cash account not found")
        self.assert_in_scope(account.business_id)

        account.deleted_at = None
        account.is_active = True
        self.session.add(account)
        self.audit(
            AuditAction.RESTORE, "cash_account", account.id, f"Cash account '{account.name}' restored"
        )
        self.session.commit()
        self.session.refresh(account)
        return account

    # -- helpers -------------------------------------------------------------
    def _validate(self, fields: dict[str, Any]) -> None:
        if "opening_balance" in fields and fields["opening_balance"] is not None:
            try:
                # NOT clamped to >= 0: an overdrawn bank account is a real thing.
                fields["opening_balance"] = quantize_money(fields["opening_balance"])
            except (ArithmeticError, TypeError, ValueError) as exc:
                raise ValidationError(
                    "Opening balance must be a number", field="opening_balance"
                ) from exc
        if "sort_order" in fields and fields["sort_order"] is not None:
            value = fields["sort_order"]
            if isinstance(value, bool) or not isinstance(value, int):
                raise ValidationError("Sort order must be a whole number", field="sort_order")
        if "description" in fields and fields["description"] is not None:
            text = str(fields["description"]).strip()
            fields["description"] = text or None

    def _assert_name_free(self, business_id: str, name: str) -> None:
        existing = self.session.exec(
            select(CashAccount).where(
                CashAccount.business_id == business_id,
                CashAccount.name == name,
                col(CashAccount.deleted_at).is_(None),
            )
        ).first()
        if existing is not None:
            raise ConflictError(f"An account called '{name}' already exists", field="name")
