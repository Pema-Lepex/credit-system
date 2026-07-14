"""FileAsset -- the registry behind every upload.

ARCHITECTURE NOTE — content-addressed deduplication
---------------------------------------------------
The spec demands "never store duplicate files" and "prevent duplicate uploads".
We get both from one idea: a file's identity is the SHA-256 of its *bytes*.

  * ``checksum`` is unique per business. Re-uploading the same receipt returns the
    existing FileAsset instead of writing a second copy to disk.
  * ``storage_key`` is derived from the checksum, so the same bytes always land on
    the same path -- no orphaned near-duplicates.
  * ``reference_count`` tracks how many domain rows point at this asset. Detaching
    a file decrements it; the nightly orphan sweep deletes assets that have sat at
    zero long enough. Without this, deleting one of two credits that share a photo
    would delete the photo out from under the other.

The dedup scope is deliberately per-business, not global: cross-tenant dedup would
let business A's storage bill be affected by business B, and would let a file
survive after its only owner "deleted" it -- a privacy problem, not a saving.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Index, UniqueConstraint
from sqlmodel import Field

from app.models.base import TZDateTime, TenantEntity
from app.models.enums import FileKind


class FileAsset(TenantEntity, table=True):
    __tablename__ = "file_asset"
    __table_args__ = (
        UniqueConstraint("business_id", "checksum", name="uq_file_business_checksum"),
        Index("ix_file_kind_refcount", "kind", "reference_count"),
    )

    kind: FileKind = Field(default=FileKind.TEMP, max_length=24, index=True)

    original_filename: str = Field(max_length=255)
    # Path within the storage backend, e.g.
    #   businesses/<bid>/customers/9f/9f3a...c1.webp
    # Backend-agnostic on purpose: the same key works as an S3 object key.
    storage_key: str = Field(unique=True, index=True, max_length=512)
    thumbnail_key: str | None = Field(default=None, max_length=512)

    content_type: str = Field(max_length=120)
    size_bytes: int = Field(default=0, index=True)
    original_size_bytes: int = Field(default=0)   # before compression -- powers "you saved X MB"
    checksum: str = Field(index=True, max_length=64)  # sha256 hex of the stored bytes

    width: int | None = Field(default=None)
    height: int | None = Field(default=None)

    reference_count: int = Field(default=0, index=True)
    # Set when reference_count first hits 0. The orphan sweep only deletes assets
    # that have been unreferenced for a grace period, so a two-step "detach then
    # re-attach" edit in the UI never loses the file.
    orphaned_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]

    # Exports and other throwaway artefacts self-destruct. NULL = keep forever.
    expires_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]

    uploaded_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )

    @property
    def bytes_saved(self) -> int:
        return max(0, self.original_size_bytes - self.size_bytes)
