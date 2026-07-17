"""add customer account ledger (Stage 1: alongside, not instead of)

Adds ``ledger_entry`` plus two cached columns on ``customer``. Nothing reads them
yet -- this stage exists so the ledger can be backfilled from the existing
Credit/Payment rows and RECONCILED against customer.outstanding_balance before any
write path moves over. See app/services/ledger.py.

Why a new table rather than reshaping ``credit``: a purchase and a debt are
different things. ``credit`` keeps its history untouched; ``ledger_entry`` becomes
the thing that counts money. Nothing is dropped by this migration.

Revision ID: a7e1c3f95d24
Revises: f5b2c8d09a31
Create Date: 2026-07-17 12:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401  (registers MoneyType)

revision: str = "a7e1c3f95d24"
down_revision: str | None = "f5b2c8d09a31"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # IDEMPOTENT, for the same reason as f5b2c8d09a31: init_db()'s create_all runs on
    # every boot, so on a server that started the new code first, the table already
    # exists before `alembic upgrade head` runs.
    if not inspector.has_table("ledger_entry"):
        op.create_table(
            "ledger_entry",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("customer_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("seq", sa.Integer(), nullable=False),
            sa.Column("entry_type", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
            # MoneyType -> BigInteger cents. SIGNED: + increases debt, - reduces it.
            sa.Column("amount", app.models.types.MoneyType(), nullable=False),
            sa.Column("balance_after", app.models.types.MoneyType(), nullable=False),
            sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("credit_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("payment_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("reverses_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("memo", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
            sa.Column(
                "created_by_user_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True
            ),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "archive_batch_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            # RESTRICT: a customer with ledger history is a customer with a financial
            # record. Deleting the row out from under it would orphan the money.
            sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="RESTRICT"),
            sa.ForeignKeyConstraint(["credit_id"], ["credit.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["payment_id"], ["payment.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["reverses_id"], ["ledger_entry.id"]),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            # THE CONCURRENCY GUARD. Turns a lost update into a failed insert.
            sa.UniqueConstraint("customer_id", "seq", name="uq_ledger_customer_seq"),
        )
        op.create_index(
            "ix_ledger_business_customer_seq",
            "ledger_entry",
            ["business_id", "customer_id", "seq"],
        )
        op.create_index(
            "ix_ledger_business_occurred", "ledger_entry", ["business_id", "occurred_at"]
        )
        for column in (
            "business_id",
            "customer_id",
            "seq",
            "entry_type",
            "occurred_at",
            "credit_id",
            "payment_id",
            "reverses_id",
            "archived_at",
            "archive_batch_id",
            "created_at",
        ):
            op.create_index(f"ix_ledger_entry_{column}", "ledger_entry", [column])

    existing = {c["name"] for c in inspector.get_columns("customer")}
    if "ledger_balance" not in existing:
        # server_default so the column is populated on existing rows; the real values
        # arrive when LedgerService.backfill_business runs.
        op.add_column(
            "customer",
            sa.Column(
                "ledger_balance", app.models.types.MoneyType(), nullable=False, server_default="0"
            ),
        )
        op.create_index("ix_customer_ledger_balance", "customer", ["ledger_balance"])
    if "ledger_seq" not in existing:
        op.add_column(
            "customer", sa.Column("ledger_seq", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing = {c["name"] for c in inspector.get_columns("customer")}
    if "ledger_seq" in existing:
        op.drop_column("customer", "ledger_seq")
    if "ledger_balance" in existing:
        op.drop_index("ix_customer_ledger_balance", table_name="customer")
        op.drop_column("customer", "ledger_balance")

    if inspector.has_table("ledger_entry"):
        op.drop_table("ledger_entry")
