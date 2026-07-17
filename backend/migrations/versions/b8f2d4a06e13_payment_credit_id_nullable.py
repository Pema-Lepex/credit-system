"""make payment.credit_id nullable -- allow payments against the ACCOUNT

Stage 2 of the ledger migration. This is the single line that forced every problem:
a required credit_id makes the schema assert "every payment settles one credit",
when a shop customer buys 6-15 times a day and pays once a month against their
BALANCE. See app/models/credit.py and app/services/ledger.py.

NULL == an account payment. Existing rows keep their credit_id and keep working;
nothing is dropped, and no data changes.

SQLite cannot ALTER a column's nullability in place, so batch_alter_table is used:
Alembic recreates the table with the new definition, copies the rows, and swaps it.
That is a real table rewrite -- it holds a write lock for the duration and should be
run during a quiet moment on a large database. Postgres does this as a cheap
catalogue change (DROP NOT NULL) and does not rewrite anything.

Revision ID: b8f2d4a06e13
Revises: a7e1c3f95d24
Create Date: 2026-07-17 13:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401

revision: str = "b8f2d4a06e13"
down_revision: str | None = "a7e1c3f95d24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _is_nullable(bind, table: str, column: str) -> bool:
    for col in inspect(bind).get_columns(table):
        if col["name"] == column:
            return bool(col["nullable"])
    raise RuntimeError(f"{table}.{column} not found")


def upgrade() -> None:
    bind = op.get_bind()

    # IDEMPOTENT, like the migrations before it: init_db()'s create_all may already
    # have created the table with the new (nullable) definition on a server that
    # booted the new code before the migration ran.
    if _is_nullable(bind, "payment", "credit_id"):
        return

    # naming_convention: SQLite stores no names for the FK constraints SQLModel
    # created, and batch mode has to be able to reproduce them when it rebuilds the
    # table. Without this, the rebuild silently drops the foreign keys.
    with op.batch_alter_table(
        "payment",
        naming_convention={"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"},
    ) as batch:
        batch.alter_column(
            "credit_id",
            existing_type=sqlmodel.sql.sqltypes.AutoString(length=32),
            nullable=True,
        )


def downgrade() -> None:
    """Refuses if any account payment exists -- they cannot be expressed without it.

    A destructive downgrade that silently deleted a customer's payments would be a
    far worse outcome than a failed migration, so this stops and says what to do.
    """
    bind = op.get_bind()
    if _is_nullable(bind, "payment", "credit_id"):
        orphans = bind.exec_driver_sql(
            "SELECT count(*) FROM payment WHERE credit_id IS NULL"
        ).scalar()
        if orphans:
            raise RuntimeError(
                f"{orphans} account payment(s) have no credit_id and would be lost by "
                f"this downgrade. Re-attach or void them before downgrading."
            )
        with op.batch_alter_table(
            "payment",
            naming_convention={
                "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"
            },
        ) as batch:
            batch.alter_column(
                "credit_id",
                existing_type=sqlmodel.sql.sqltypes.AutoString(length=32),
                nullable=False,
            )
