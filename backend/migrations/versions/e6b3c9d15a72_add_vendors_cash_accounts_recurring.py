"""Phase 2: vendors, cash accounts and recurring expense templates.

Additive throughout. Three new tables, four new NULLABLE columns on two existing
tables, and one unique index.

WHY NO BATCH MODE, AND WHY THE NEW COLUMNS CARRY NO FOREIGN KEY: SQLite cannot
ALTER a constraint in, so a real FK on an added column means Alembic batch mode --
a copy-and-move rebuild of `expense` AND of `payment`. Rebuilding the payments
table on a live database is a far bigger risk than the constraint is worth, and the
constraint buys almost nothing: ON DELETE SET NULL only fires on a hard delete,
while every parent here is soft-deleted. The services hand-detach instead, exactly
as CategoryService already does. See app/models/expense.py.

Every statement below is therefore a plain CREATE or ADD COLUMN, which SQLite
supports natively -- and the schema is identical whether it was reached by
migration or created fresh by init_db.

Every added column is nullable with no server default, so existing rows are valid
the instant the migration lands and no backfill is required.

Revision ID: e6b3c9d15a72
Revises: d4f7a1c62b98
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401  -- registers MoneyType for the column defs below

revision: str = "e6b3c9d15a72"
down_revision: str | None = "d4f7a1c62b98"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(inspector: sa.Inspector, table: str) -> set[str]:
    return {i["name"] for i in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # ---------------------------------------------------------------- vendor
    if not inspector.has_table("vendor"):
        op.create_table(
            "vendor",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
            sa.Column("phone", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=True),
            sa.Column("email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=True),
            sa.Column("address", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
            sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("business_id", "name", name="uq_vendor_business_name"),
        )
        for column in ("business_id", "name", "phone", "email", "is_active", "created_at", "deleted_at"):
            op.create_index(f"ix_vendor_{column}", "vendor", [column])

    # ---------------------------------------------------------- cash_account
    if not inspector.has_table("cash_account"):
        op.create_table(
            "cash_account",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=False),
            sa.Column("description", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
            sa.Column("opening_balance", app.models.types.MoneyType(), nullable=False),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("business_id", "name", name="uq_cash_account_business_name"),
        )
        for column in ("business_id", "name", "is_active", "sort_order", "created_at", "deleted_at"):
            op.create_index(f"ix_cash_account_{column}", "cash_account", [column])

    # ------------------------------------------ recurring_expense_template
    if not inspector.has_table("recurring_expense_template"):
        op.create_table(
            "recurring_expense_template",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=False),
            sa.Column("category_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("vendor_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("vendor_name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True),
            sa.Column("cash_account_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True),
            sa.Column("amount", app.models.types.MoneyType(), nullable=False),
            sa.Column("payment_method", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False),
            sa.Column("frequency", sqlmodel.sql.sqltypes.AutoString(length=12), nullable=False),
            sa.Column("next_run", sa.Date(), nullable=False),
            sa.Column("anchor_day", sa.Integer(), nullable=True),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
            sa.Column("last_run_at", sa.Date(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["category_id"], ["expense_category.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["vendor_id"], ["vendor.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["cash_account_id"], ["cash_account.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_recurring_business_next_run",
            "recurring_expense_template",
            ["business_id", "next_run"],
        )
        for column in (
            "business_id",
            "name",
            "category_id",
            "vendor_id",
            "cash_account_id",
            "frequency",
            "next_run",
            "is_active",
            "created_at",
            "deleted_at",
        ):
            op.create_index(
                f"ix_recurring_expense_template_{column}",
                "recurring_expense_template",
                [column],
            )

    # ------------------------------------------------- expense: new columns
    existing = _columns(inspector, "expense")

    if "vendor_id" not in existing:
        op.add_column(
            "expense",
            sa.Column(
                "vendor_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
        )
        op.create_index("ix_expense_vendor_id", "expense", ["vendor_id"])

    if "cash_account_id" not in existing:
        op.add_column(
            "expense",
            sa.Column(
                "cash_account_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
        )
        op.create_index("ix_expense_cash_account_id", "expense", ["cash_account_id"])

    if "recurring_template_id" not in existing:
        op.add_column(
            "expense",
            sa.Column(
                "recurring_template_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
        )
        op.create_index(
            "ix_expense_recurring_template_id", "expense", ["recurring_template_id"]
        )

    # THE idempotency guarantee -- see the module docstring and models/recurring.py.
    if "uq_expense_template_run" not in _indexes(inspect(bind), "expense"):
        op.create_index(
            "uq_expense_template_run",
            "expense",
            ["recurring_template_id", "expense_date"],
            unique=True,
        )

    # ------------------------------------------------- payment: new column
    if "cash_account_id" not in _columns(inspector, "payment"):
        op.add_column(
            "payment",
            sa.Column(
                "cash_account_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
        )
        op.create_index("ix_payment_cash_account_id", "payment", ["cash_account_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if "cash_account_id" in _columns(inspector, "payment"):
        op.drop_index("ix_payment_cash_account_id", table_name="payment")
        op.drop_column("payment", "cash_account_id")

    if "uq_expense_template_run" in _indexes(inspector, "expense"):
        op.drop_index("uq_expense_template_run", table_name="expense")

    for column, index in (
        ("recurring_template_id", "ix_expense_recurring_template_id"),
        ("cash_account_id", "ix_expense_cash_account_id"),
        ("vendor_id", "ix_expense_vendor_id"),
    ):
        if column in _columns(inspector, "expense"):
            op.drop_index(index, table_name="expense")
            op.drop_column("expense", column)

    # Templates first -- they hold FKs into vendor and cash_account.
    for table in ("recurring_expense_template", "cash_account", "vendor"):
        if inspector.has_table(table):
            op.drop_table(table)
