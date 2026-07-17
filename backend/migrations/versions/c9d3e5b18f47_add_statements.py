"""add monthly statements

Stage 4 of the ledger migration. A statement is the one obligation a shop customer
actually agreed to -- "your July account, due 10 August" -- replacing four hundred
per-purchase due dates. It is a SNAPSHOT of the ledger over a window; nothing is
ever allocated to it. See app/services/statement.py.

Adds `statement` plus two cycle settings on `business`. `statements_enabled`
defaults to FALSE: an existing shop must opt in, not discover one morning that its
customers have been billed on a cycle nobody agreed to.

Nothing is dropped. Credit.due_date and Credit.status are untouched.

Revision ID: c9d3e5b18f47
Revises: b8f2d4a06e13
Create Date: 2026-07-17 14:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401

revision: str = "c9d3e5b18f47"
down_revision: str | None = "b8f2d4a06e13"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    # IDEMPOTENT, as with every migration here: init_db()'s create_all runs on boot,
    # so the table may already exist if the app started before the migration ran.
    if not inspector.has_table("statement"):
        op.create_table(
            "statement",
            sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("business_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("customer_id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
            sa.Column("number", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=False),
            sa.Column("period_start", sa.Date(), nullable=False),
            sa.Column("period_end", sa.Date(), nullable=False),
            sa.Column("opening_balance", app.models.types.MoneyType(), nullable=False),
            sa.Column("charges", app.models.types.MoneyType(), nullable=False),
            sa.Column("payments", app.models.types.MoneyType(), nullable=False),
            sa.Column("closing_balance", app.models.types.MoneyType(), nullable=False),
            sa.Column("entry_count", sa.Integer(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=False),
            sa.Column("status", sqlmodel.sql.sqltypes.AutoString(length=16), nullable=False),
            sa.Column("issued_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("settled_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_reminded_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["business_id"], ["business.id"], ondelete="CASCADE"),
            # RESTRICT: a customer who has been sent a statement has a financial
            # record. Deleting the row would orphan the document.
            sa.ForeignKeyConstraint(["customer_id"], ["customer.id"], ondelete="RESTRICT"),
            sa.PrimaryKeyConstraint("id"),
            # What makes month-end idempotent: re-running it cannot double-bill.
            sa.UniqueConstraint("customer_id", "period_start", name="uq_statement_customer_period"),
        )
        op.create_index("ix_statement_business_period", "statement", ["business_id", "period_start"])
        op.create_index(
            "ix_statement_business_status_due", "statement", ["business_id", "status", "due_date"]
        )
        for column in (
            "business_id",
            "customer_id",
            "number",
            "period_start",
            "period_end",
            "closing_balance",
            "due_date",
            "status",
            "created_at",
        ):
            op.create_index(f"ix_statement_{column}", "statement", [column])

    existing = {c["name"] for c in inspector.get_columns("business")}
    if "statements_enabled" not in existing:
        op.add_column(
            "business",
            sa.Column(
                "statements_enabled", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        )
    if "statement_due_days" not in existing:
        op.add_column(
            "business",
            sa.Column("statement_due_days", sa.Integer(), nullable=False, server_default="10"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    existing = {c["name"] for c in inspector.get_columns("business")}
    if "statement_due_days" in existing:
        op.drop_column("business", "statement_due_days")
    if "statements_enabled" in existing:
        op.drop_column("business", "statements_enabled")

    # Statements are derived from the ledger, so dropping them loses no money -- they
    # can be regenerated by re-running close_period. What IS lost is the record of
    # what each customer was actually TOLD, which is why this only belongs in a
    # downgrade.
    if inspector.has_table("statement"):
        op.drop_table("statement")
