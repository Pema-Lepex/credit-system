"""add stored_blob table

Backs STORAGE_BACKEND=db: file bytes (CSV/XLSX/PDF exports, logos, receipts) stored
as rows so a deployment with a persistent database but an ephemeral filesystem keeps
its files across redeploys without an external object store.

Note: init_db()'s create_all also creates this table on first boot, but the migration
is the source of truth so `alembic upgrade head` against Postgres/Supabase is complete.

Revision ID: f5b2c8d09a31
Revises: e3c9a1d75b40
Create Date: 2026-07-15 15:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy import inspect

import app.models.types  # noqa: F401

revision: str = "f5b2c8d09a31"
down_revision: str | None = "e3c9a1d75b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # IDEMPOTENT ON PURPOSE. init_db()'s create_all runs on every app boot and creates
    # this (new) table, so on a server that has already started the new code the table
    # is present before `alembic upgrade head` runs. Guarding on existence lets the
    # migration run cleanly whether the app booted first or the migration did.
    bind = op.get_bind()
    if inspect(bind).has_table("stored_blob"):
        return

    op.create_table(
        "stored_blob",
        sa.Column("key", sqlmodel.sql.sqltypes.AutoString(length=512), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column(
            "content_type",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_index(
        op.f("ix_stored_blob_size_bytes"), "stored_blob", ["size_bytes"], unique=False
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("stored_blob"):
        return
    op.drop_index(op.f("ix_stored_blob_size_bytes"), table_name="stored_blob")
    op.drop_table("stored_blob")
