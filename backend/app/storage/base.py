"""The storage contract.

ARCHITECTURE NOTE (spec: "never tightly couple storage to business logic")
--------------------------------------------------------------------------
Business logic depends on this Protocol, never on a filesystem path or an S3
client. A "storage key" is an opaque, backend-agnostic string
(``businesses/<bid>/customers/ab/abcd1234.webp``) that happens to work equally
well as a POSIX path and as an S3 object key.

Consequences that matter:
  * ``CreditService`` never imports ``pathlib``. It asks StorageService for a key.
  * Moving to Cloudflare R2 means setting STORAGE_BACKEND=s3 and filling in four
    env vars. No service, resolver, or model changes.
  * ``url_for()`` is the backend's business, so local dev serves through a signed
    FastAPI route while production hands back a CDN URL -- transparently.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(frozen=True, slots=True)
class StoredObject:
    key: str
    size_bytes: int
    content_type: str


@runtime_checkable
class StorageBackend(Protocol):
    """Every driver (local disk, S3, R2, Supabase) implements exactly this."""

    async def write(self, key: str, data: bytes, content_type: str) -> StoredObject:
        """Write bytes at ``key``, overwriting if present."""
        ...

    async def read(self, key: str) -> bytes:
        """Return the bytes at ``key``. Raises FileNotFoundError if absent."""
        ...

    async def delete(self, key: str) -> bool:
        """Remove ``key``. Returns False if it did not exist (never raises)."""
        ...

    async def exists(self, key: str) -> bool: ...

    async def size(self, key: str) -> int:
        """Size in bytes, or 0 if the object is missing."""
        ...

    def url_for(self, key: str) -> str:
        """A URL the browser can fetch this object from."""
        ...

    async def total_size(self, prefix: str = "") -> int:
        """Sum of all object sizes under ``prefix``. Powers the Storage Dashboard."""
        ...

    async def list_keys(self, prefix: str = "") -> list[str]:
        """All keys under ``prefix``. Used by the orphan-file sweep."""
        ...


class StorageError(Exception):
    """Raised when a storage operation fails for a reason the caller can act on."""
