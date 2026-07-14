"""add USER_AVATAR to the filekind enum

Revision ID: c7e91a4b2f30
Revises: be5a621e126f
Create Date: 2026-07-15

WHY THIS IS NEEDED (and why nobody noticed)
-------------------------------------------
``FileKind.USER_AVATAR`` was added to the model, but the initial migration had
already frozen the enum without it. On SQLite that is invisible: SQLite has no enum
type, it stores the value as TEXT and enforces nothing, so avatar uploads worked.

On Postgres the enum is a real type with a fixed set of labels, and inserting
'USER_AVATAR' fails with:

    invalid input value for enum filekind: "USER_AVATAR"

So every staff avatar upload would 500 in production the moment the database became
Postgres -- and the existing rows in a migrated SQLite database could not even be
copied across. This migration closes that gap.

Note that Alembic's autogenerate does NOT detect added enum VALUES (it diffs tables
and columns, not enum labels), which is precisely why this drifted silently and has
to be written by hand.
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "c7e91a4b2f30"
down_revision: str | None = "be5a621e126f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite has no enum types -- the column is TEXT and already accepts the value.
        return

    # ALTER TYPE ... ADD VALUE cannot run inside a transaction block on PostgreSQL < 12,
    # and even on 12+ the new label is not usable by other statements in the same
    # transaction. autocommit_block() steps outside Alembic's transaction for this one
    # statement, which is the supported way to do it.
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE filekind ADD VALUE IF NOT EXISTS 'USER_AVATAR'")


def downgrade() -> None:
    # PostgreSQL cannot remove a value from an enum. Undoing this means recreating the
    # type without the label and rewriting every column that uses it -- which would
    # destroy any row currently holding USER_AVATAR. Refusing is the honest answer;
    # a leftover unused label is harmless.
    pass
