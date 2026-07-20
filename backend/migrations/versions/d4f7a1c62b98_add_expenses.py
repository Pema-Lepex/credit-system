"""Add expense and expense_category tables.

Purely additive: two new tables, no ALTER on anything that already exists. The
``inspector.has_table`` guards follow the convention in this directory -- init_db()
runs ``create_all`` at boot, so a fresh database may already have these tables by
the time Alembic gets here, and the migration has to be a no-op rather than a crash.

Revision ID: d4f7a1c62b98
Revises: c9d3e5b18f47
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401  -- registers MoneyType for the column defs below

revision: str = "d4f7a1c62b98"
down_revision: str | None = "c9d3e5b18f47"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    if not inspector.has_table("expense_category"):
        op.create_table(
            "expense_category",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column(
                "business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False
            ),
            sa.Column("name", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=False),
            sa.Column(
                "description", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True
            ),
            sa.Column("color", sqlmodel.sql.sqltypes.AutoString(length=9), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "business_id", "name", name="uq_expense_category_business_name"
            ),
        )
        for column in ("business_id", "name", "is_active", "sort_order", "created_at", "deleted_at"):
            op.create_index(
                f"ix_expense_category_{column}", "expense_category", [column]
            )

    if not inspector.has_table("expense"):
        op.create_table(
            "expense",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column(
                "business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False
            ),
            sa.Column(
                "category_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True
            ),
            sa.Column("amount", app.models.types.MoneyType(), nullable=False),
            sa.Column(
                "vendor_name", sqlmodel.sql.sqltypes.AutoString(length=200), nullable=True
            ),
            sa.Column(
                "payment_method", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False
            ),
            sa.Column("expense_date", sa.Date(), nullable=False),
            sa.Column(
                "reference", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=True
            ),
            sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=1000), nullable=True),
            sa.Column(
                "receipt_file_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=True
            ),
            sa.Column(
                "created_by_user_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
            sa.Column(
                "updated_by_user_id",
                sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=True,
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(
                ["category_id"], ["expense_category.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(
                ["receipt_file_id"], ["file_asset.id"], ondelete="SET NULL"
            ),
            sa.ForeignKeyConstraint(["created_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["user.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_expense_business_date", "expense", ["business_id", "expense_date"]
        )
        for column in (
            "business_id",
            "category_id",
            "vendor_name",
            "payment_method",
            "expense_date",
            "reference",
            "created_at",
            "deleted_at",
        ):
            op.create_index(f"ix_expense_{column}", "expense", [column])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # expense first -- it holds the FK into expense_category.
    if inspector.has_table("expense"):
        op.drop_table("expense")
    if inspector.has_table("expense_category"):
        op.drop_table("expense_category")
