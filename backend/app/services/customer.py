"""CustomerService -- the people who owe the shop money.

The two module-level functions at the bottom (``recompute_aggregates`` and
``recompute_credit_score``) are the reason this file is shaped the way it is.
CreditService and PaymentService must call them on every write, and they must be
callable with nothing but a ``Session`` -- a payment recorded by the scheduler has
no ``ServiceContext`` and no permissions to check. So they are plain functions;
the class merely wraps them for the authenticated path.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from sqlmodel import Session, col, select

from app.core.errors import ConflictError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import AuditAction, CreditStatus, CustomerStatus
from app.models.types import quantize_money
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.dates import ensure_utc
from app.utils.numbering import next_customer_code
from app.utils.pagination import Page, PageInput, paginate

EDITABLE_FIELDS: frozenset[str] = frozenset(
    {
        "name",
        "phone",
        "email",
        "address",
        "city",
        "latitude",
        "longitude",
        "photo_file_id",
        "notes",
        "status",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relation",
        "credit_limit",
        "date_of_birth",
    }
)

# Sort keys the UI offers. An allow-list, not getattr(Customer, sort_by): the latter
# would let a caller sort by any column, including ones we index nothing on.
SORT_FIELDS: dict[str, Any] = {
    "name": Customer.name,
    "created_at": Customer.created_at,
    "outstanding_balance": Customer.outstanding_balance,
    "credit_score": Customer.credit_score,
    "code": Customer.code,
}


class CustomerService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self.storage = StorageService(self.session)

    # -- read ----------------------------------------------------------------
    def get(self, customer_id: str) -> Customer:
        self.require(Permission.CUSTOMER_READ)
        return self.get_scoped(Customer, customer_id, label="Customer")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        status: CustomerStatus | str | list[CustomerStatus | str] | None = None,
        min_outstanding: Decimal | None = None,
        max_outstanding: Decimal | None = None,
        has_overdue: bool | None = None,
        sort_by: str = "created_at",
        sort_desc: bool = True,
    ) -> Page[Customer]:
        self.require(Permission.CUSTOMER_READ)

        stmt = select(Customer).where(
            Customer.business_id == self.scope_id,
            Customer.deleted_at.is_(None),  # type: ignore[union-attr]
        )

        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                col(Customer.name).ilike(like)
                | col(Customer.phone).ilike(like)
                | col(Customer.email).ilike(like)
                | col(Customer.code).ilike(like)
            )
        if status is not None:
            # A single status stays a single status; the UI's multi-select filter sends
            # a list ("show me BLOCKED and DEFAULTED"), which becomes an IN.
            wanted = status if isinstance(status, list) else [status]
            stmt = stmt.where(col(Customer.status).in_([_coerce_status(s) for s in wanted]))
        if has_overdue is not None:
            # overdue_count is a maintained aggregate on Customer (see recompute_aggregates),
            # so this is an indexed column read, not a correlated subquery over Credit.
            stmt = stmt.where(
                col(Customer.overdue_count) > 0
                if has_overdue
                else col(Customer.overdue_count) == 0
            )
        if min_outstanding is not None:
            stmt = stmt.where(col(Customer.outstanding_balance) >= quantize_money(min_outstanding))
        if max_outstanding is not None:
            stmt = stmt.where(col(Customer.outstanding_balance) <= quantize_money(max_outstanding))

        column = SORT_FIELDS.get(sort_by)
        if column is None:
            raise ValidationError(
                f"Cannot sort by '{sort_by}'. Allowed: {', '.join(sorted(SORT_FIELDS))}",
                field="sort_by",
            )
        stmt = stmt.order_by(col(column).desc() if sort_desc else col(column).asc())
        return paginate(self.session, stmt, page or PageInput())

    # -- write ---------------------------------------------------------------
    def create(self, name: str, **fields: Any) -> Customer:
        self.require(Permission.CUSTOMER_WRITE)
        business_id = self.scope_id

        name = (name or "").strip()
        if not name:
            raise ValidationError("Customer name is required", field="name")

        payload = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS and k != "name"}
        _validate(payload)

        customer = Customer(
            business_id=business_id,
            code=next_customer_code(self.session, business_id),
            name=name,
            **payload,
        )
        self.session.add(customer)
        self.session.flush()

        if customer.photo_file_id:
            self.storage.attach(customer.photo_file_id)

        self.audit(
            AuditAction.CREATE,
            "customer",
            customer.id,
            f"Customer {customer.code} ({customer.name}) created",
        )
        self.session.commit()
        self.session.refresh(customer)
        return customer

    def update(self, customer_id: str, **fields: Any) -> Customer:
        self.require(Permission.CUSTOMER_WRITE)
        customer = self.get_scoped(Customer, customer_id, label="Customer")

        payload = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
        if not payload:
            return customer
        _validate(payload)

        if "name" in payload:
            name = str(payload["name"]).strip()
            if not name:
                raise ValidationError("Customer name is required", field="name")
            payload["name"] = name

        before = {k: getattr(customer, k) for k in payload}

        if "photo_file_id" in payload and payload["photo_file_id"] != customer.photo_file_id:
            self.storage.detach(customer.photo_file_id)
            self.storage.attach(payload["photo_file_id"])

        for key, value in payload.items():
            setattr(customer, key, value)
        self.session.add(customer)

        self.audit(
            AuditAction.UPDATE,
            "customer",
            customer.id,
            f"Customer {customer.code} updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(customer)
        return customer

    def soft_delete(self, customer_id: str) -> Customer:
        """Refuses while the customer still owes money.

        You cannot delete someone who owes you money: the debt is the record. Close
        or cancel the open credits first -- that is a decision, and it should be
        made explicitly rather than as a side effect of tidying a list.
        """
        self.require(Permission.CUSTOMER_DELETE)
        customer = self.get_scoped(Customer, customer_id, label="Customer")

        open_credits = self.session.exec(
            select(Credit).where(
                Credit.business_id == customer.business_id,
                Credit.customer_id == customer.id,
                col(Credit.status).in_(CreditStatus.open_statuses()),
                Credit.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
        if open_credits:
            total = quantize_money(sum((c.remaining_amount for c in open_credits), Decimal("0")))
            raise ConflictError(
                f"{customer.name} still has {len(open_credits)} open credit(s) totalling {total}. "
                "Settle or cancel them before deleting the customer."
            )

        customer.deleted_at = utcnow()
        self.session.add(customer)
        self.storage.detach(customer.photo_file_id)

        self.audit(
            AuditAction.DELETE,
            "customer",
            customer.id,
            f"Customer {customer.code} ({customer.name}) deleted",
        )
        self.session.commit()
        self.session.refresh(customer)
        return customer

    def restore(self, customer_id: str) -> Customer:
        self.require(Permission.CUSTOMER_DELETE)
        # Deliberately not get_scoped: that filters out soft-deleted rows, which is
        # exactly what we are looking for here.
        customer = self.session.get(Customer, customer_id)
        if customer is None or customer.business_id != self.scope_id:
            raise ConflictError("Customer not found")
        if customer.deleted_at is None:
            return customer

        customer.deleted_at = None
        self.session.add(customer)
        self.storage.attach(customer.photo_file_id)

        recompute_aggregates(self.session, customer.id)
        self.audit(
            AuditAction.RESTORE,
            "customer",
            customer.id,
            f"Customer {customer.code} ({customer.name}) restored",
        )
        self.session.commit()
        self.session.refresh(customer)
        return customer

    # -- derived numbers -----------------------------------------------------
    def recompute(self, customer_id: str) -> Customer:
        """Force a recalculation (admin "recalculate" button, nightly integrity job)."""
        self.require(Permission.CUSTOMER_WRITE)
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        recompute_aggregates(self.session, customer.id)
        self.session.commit()
        self.session.refresh(customer)
        return customer

    def score_breakdown(self, customer_id: str) -> tuple[int, list[str]]:
        """(score, human-readable reasons) -- what the UI shows behind the number."""
        self.require(Permission.CUSTOMER_READ)
        customer = self.get_scoped(Customer, customer_id, label="Customer")
        return score_breakdown(self.session, customer.id)


# ---------------------------------------------------------------------------
# Module-level: callable from CreditService / PaymentService / the scheduler,
# none of which have a ServiceContext or anything to authorise.
# ---------------------------------------------------------------------------
def _live_credits(session: Session, customer: Customer) -> list[Credit]:
    """Credits that count. Excludes soft-deleted, archived, and cancelled records.

    CANCELLED is excluded because a cancelled credit is a credit that never really
    happened -- counting it would inflate ``total_credit`` for a sale that was
    voided. ARCHIVED is excluded because those rows are on their way out of the
    system and are already reflected in the balances that survive them.
    """
    return list(
        session.exec(
            select(Credit).where(
                Credit.business_id == customer.business_id,
                Credit.customer_id == customer.id,
                Credit.deleted_at.is_(None),  # type: ignore[union-attr]
                Credit.archived_at.is_(None),  # type: ignore[union-attr]
                Credit.status != CreditStatus.CANCELLED,
            )
        ).all()
    )


def _live_payments(session: Session, customer: Customer) -> list[Payment]:
    """Payments that count. Excludes soft-deleted, archived, and voided entries."""
    return list(
        session.exec(
            select(Payment).where(
                Payment.business_id == customer.business_id,
                Payment.customer_id == customer.id,
                Payment.deleted_at.is_(None),  # type: ignore[union-attr]
                Payment.archived_at.is_(None),  # type: ignore[union-attr]
                Payment.voided_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
    )


def recompute_aggregates(session: Session, customer_id: str) -> Customer | None:
    """Rebuild the cached totals on a Customer from the Credit/Payment ledgers.

    The Customer row caches numbers it does not own (see models/customer.py). This
    is the single writer of those columns; CreditService and PaymentService call it
    after every mutation, and the nightly integrity job calls it to catch drift.

    Does not commit -- the caller owns the transaction, so a credit and the
    aggregates it moves land together or not at all.
    """
    customer = session.get(Customer, customer_id)
    if customer is None:
        return None

    credits = _live_credits(session, customer)
    payments = _live_payments(session, customer)

    total_credit = quantize_money(sum((c.grand_total for c in credits), Decimal("0")))
    total_paid = quantize_money(sum((p.amount for p in payments), Decimal("0")))

    customer.total_credit = total_credit
    customer.total_paid = total_paid
    # Clamped at zero: an overpayment is credit in the customer's favour, not a
    # negative debt, and a negative outstanding_balance would break every "who owes
    # us money" sort and total on the dashboard.
    customer.outstanding_balance = quantize_money(max(Decimal("0"), total_credit - total_paid))
    customer.credit_count = len(credits)
    customer.overdue_count = sum(
        1 for c in credits if CreditStatus(c.status) is CreditStatus.OVERDUE
    )

    customer.last_credit_at = (
        max(ensure_utc(c.created_at) for c in credits) if credits else None
    )
    customer.last_payment_at = (
        max(ensure_utc(p.paid_at) for p in payments) if payments else None
    )

    # The score is a function of the same ledger, so it is recomputed here rather
    # than left to a caller who might forget -- "recomputed on every payment" is a
    # promise the model docstring already makes.
    customer.credit_score = _score(credits, customer)[0]

    session.add(customer)
    session.flush()
    return customer


def recompute_credit_score(session: Session, customer_id: str) -> int:
    """0-100 internal creditworthiness heuristic. See ``score_breakdown`` for the rules.

    NOT a bureau score. It is this shop's own opinion of this customer, computed
    only from this shop's history with them.
    """
    return score_breakdown(session, customer_id)[0]


def score_breakdown(session: Session, customer_id: str) -> tuple[int, list[str]]:
    """The score AND the reasons for it, in plain language.

    A shopkeeper looking at "34" must be able to see why. The rules, all of them:

        Everyone starts at              50   (no history = neutral, not risky)

        + up to +25   on-time payment ratio: 25 x (credits paid on or before the
                      due date / credits fully paid). Only counts once at least
                      one credit has been fully paid.
        + up to +10   repayment track record: +2 per fully-paid credit, capped.
                      Rewards a long, boring history of settling up.

        - up to -30   currently overdue credits: -10 each.
        - up to -20   average days late across late credits: -1 per day.
        - up to -20   debt load against their credit limit (only when a limit is
                      set):  over the limit -20, 80-100% -12, 50-80% -5.

        Clamped to 0-100.
    """
    customer = session.get(Customer, customer_id)
    if customer is None:
        return 50, ["No history yet."]
    return _score(_live_credits(session, customer), customer)


def _score(credits: list[Credit], customer: Customer) -> tuple[int, list[str]]:
    reasons: list[str] = []
    score = 50
    today = datetime.now(UTC).date()

    if not credits:
        return score, ["No credit history yet - starting at the neutral score of 50."]

    paid = [c for c in credits if CreditStatus(c.status) is CreditStatus.PAID]
    overdue = [c for c in credits if CreditStatus(c.status) is CreditStatus.OVERDUE]

    # --- reward: paid on time ------------------------------------------------
    if paid:
        on_time = [c for c in paid if _settled_on_time(c)]
        ratio = len(on_time) / len(paid)
        bonus = round(25 * ratio)
        score += bonus
        reasons.append(
            f"Paid {len(on_time)} of {len(paid)} settled credits on time "
            f"({ratio * 100:.0f}%): +{bonus}"
        )

        track = min(10, 2 * len(paid))
        score += track
        reasons.append(f"{len(paid)} credit(s) fully repaid: +{track}")
    else:
        reasons.append("No credit has been fully repaid yet: no bonus")

    # --- penalty: currently overdue -----------------------------------------
    if overdue:
        penalty = min(30, 10 * len(overdue))
        score -= penalty
        reasons.append(f"{len(overdue)} credit(s) currently overdue: -{penalty}")

    # --- penalty: how late, on average ---------------------------------------
    late_days = [d for d in (_days_late(c, today) for c in credits) if d > 0]
    if late_days:
        avg_late = sum(late_days) / len(late_days)
        penalty = min(20, round(avg_late))
        score -= penalty
        reasons.append(f"Late by {avg_late:.0f} days on average: -{penalty}")

    # --- penalty: debt load --------------------------------------------------
    limit = customer.credit_limit
    if limit and limit > 0:
        used = customer.outstanding_balance / limit
        if used > 1:
            score -= 20
            reasons.append(f"Owes more than their credit limit ({used * 100:.0f}% of it): -20")
        elif used >= Decimal("0.8"):
            score -= 12
            reasons.append(f"Using {used * 100:.0f}% of their credit limit: -12")
        elif used >= Decimal("0.5"):
            score -= 5
            reasons.append(f"Using {used * 100:.0f}% of their credit limit: -5")

    final = max(0, min(100, score))
    reasons.append(f"Final score: {final} out of 100.")
    return final, reasons


def _settled_on_time(credit: Credit) -> bool:
    if credit.paid_at is None:
        return False
    return ensure_utc(credit.paid_at).date() <= credit.due_date


def _days_late(credit: Credit, today: date) -> int:
    """How many days late this credit was paid -- or is, right now, if still open."""
    status = CreditStatus(credit.status)
    if status is CreditStatus.PAID and credit.paid_at is not None:
        return (ensure_utc(credit.paid_at).date() - credit.due_date).days
    if status is CreditStatus.OVERDUE:
        return (today - credit.due_date).days
    return 0


# ---------------------------------------------------------------------------
def _coerce_status(status: CustomerStatus | str) -> CustomerStatus:
    try:
        return CustomerStatus(status)
    except ValueError as exc:
        raise ValidationError(f"Unknown customer status '{status}'", field="status") from exc


def _validate(fields: dict[str, Any]) -> None:
    if "status" in fields and fields["status"] is not None:
        fields["status"] = _coerce_status(fields["status"])

    if "credit_limit" in fields and fields["credit_limit"] is not None:
        limit = quantize_money(fields["credit_limit"])
        if limit < 0:
            raise ValidationError("Credit limit cannot be negative", field="credit_limit")
        fields["credit_limit"] = limit

    if "email" in fields and fields["email"]:
        addr = str(fields["email"]).strip().lower()
        if "@" not in addr:
            raise ValidationError("Enter a valid email address", field="email")
        fields["email"] = addr
