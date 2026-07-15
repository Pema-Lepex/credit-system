"""A file's bytes, stored in the SQL database itself.

This is the storage row behind ``STORAGE_BACKEND=db`` (app/storage/database.py). It
exists so that a deployment with a PERSISTENT database but an EPHEMERAL filesystem
(the classic Render/Fly/Vercel setup: Supabase Postgres + a container disk that is
wiped on every redeploy) can keep its uploaded files without paying for a separate
object store. The bytes live next to the metadata, so if the database survives, the
file survives.

This is deliberately NOT a ``BaseEntity``: there is no soft-delete, no UUID id, and
no business_id. The storage KEY is the primary key — an opaque, content-addressed
string the storage layer already guarantees is unique — and the row is pure bytes +
just enough to serve them (content type) and to sweep them (size, created_at). All
tenancy and lifecycle logic stays in the FileAsset that POINTS at this key; this
table is a dumb byte bucket.
"""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from sqlmodel import Field, SQLModel

from app.models.base import TZDateTime, utcnow


class StoredBlob(SQLModel, table=True):
    __tablename__ = "stored_blob"

    # The storage key IS the identity. It is the same opaque key every other backend
    # uses (e.g. "businesses/<bid>/exports/ab/abcd1234.zip"), so nothing upstream has
    # to know files now live in a table.
    key: str = Field(primary_key=True, max_length=512)

    # The raw bytes. LargeBinary maps to BYTEA on Postgres and BLOB on SQLite, so the
    # same model works in dev and in production. Exports and logos are small; this is
    # not meant for multi-megabyte media libraries (use cloudinary/s3 for those).
    data: bytes = Field(sa_column=sa.Column(sa.LargeBinary, nullable=False))

    content_type: str = Field(default="application/octet-stream", max_length=255)

    # Denormalised so the Storage Dashboard can SUM sizes without loading every blob.
    size_bytes: int = Field(default=0, index=True)

    created_at: datetime = Field(
        default_factory=utcnow,
        sa_type=TZDateTime,  # type: ignore[call-overload]
        nullable=False,
    )
