"""Record WHICH bank or wallet a payment/expense went through.

Three nullable text columns, no constraints, no FKs -- so a plain ADD COLUMN on
every backend and no Alembic batch rebuild. Every existing row is valid the moment
this lands; nothing needs backfilling, because "we did not record which bank" is
exactly what NULL means here.

Free text rather than an enum on purpose -- see app/models/credit.py.

Revision ID: f7a2d5c81b64
Revises: e6b3c9d15a72
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

revision: str = "f7a2d5c81b64"
down_revision: str | None = "e6b3c9d15a72"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: (table, needs_index) -- the template is only ever read one row at a time, so it
#: gains no index; payments and expenses are filtered and grouped by provider.
_TARGETS: tuple[tuple[str, bool], ...] = (
    ("payment", True),
    ("expense", True),
    ("recurring_expense_template", False),
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    for table, indexed in _TARGETS:
        if not inspector.has_table(table):
            continue
        existing = {c["name"] for c in inspector.get_columns(table)}
        if "provider" in existing:
            continue

        op.add_column(
            table,
            sa.Column("provider", sqlmodel.sql.sqltypes.AutoString(length=120), nullable=True),
        )
        if indexed:
            op.create_index(f"ix_{table}_provider", table, ["provider"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)

    for table, indexed in _TARGETS:
        if not inspector.has_table(table):
            continue
        if "provider" not in {c["name"] for c in inspector.get_columns(table)}:
            continue
        if indexed:
            op.drop_index(f"ix_{table}_provider", table_name=table)
        op.drop_column(table, "provider")
