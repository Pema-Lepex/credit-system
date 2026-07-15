"""add platform_setting table

Holds the super-admin's own configuration (currently: the W3Forms access key for
new-registration notices). One row, no tenant.

Note: init_db()'s create_all also creates this table on first boot, but the migration
is the source of truth so `alembic upgrade head` against Postgres/Supabase is complete.

Revision ID: e3c9a1d75b40
Revises: d1a4f7c9e820
Create Date: 2026-07-15 13:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401

revision: str = "e3c9a1d75b40"
down_revision: str | None = "d1a4f7c9e820"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IDEMPOTENT ON PURPOSE. init_db()'s create_all runs on every app boot and creates
    # this (new) table, so on a server that has already started the new code, the table
    # is present before `alembic upgrade head` runs. Guarding on existence lets the
    # migration run cleanly whether the app booted first or the migration did.
    bind = op.get_bind()
    if inspect(bind).has_table("platform_setting"):
        return

    op.create_table(
        "platform_setting",
        sa.Column("id", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column(
            "w3forms_access_key",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_platform_setting_created_at"), "platform_setting", ["created_at"], unique=False
    )
    op.create_index(
        op.f("ix_platform_setting_deleted_at"), "platform_setting", ["deleted_at"], unique=False
    )
    op.create_index(
        op.f("ix_platform_setting_key"), "platform_setting", ["key"], unique=True
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("platform_setting"):
        return
    op.drop_index(op.f("ix_platform_setting_key"), table_name="platform_setting")
    op.drop_index(op.f("ix_platform_setting_deleted_at"), table_name="platform_setting")
    op.drop_index(op.f("ix_platform_setting_created_at"), table_name="platform_setting")
    op.drop_table("platform_setting")
