"""Local-disk storage driver. The free default.

VERCEL / SERVERLESS WARNING
---------------------------
This driver writes to the container filesystem. On Vercel, AWS Lambda, Cloud Run
and every other serverless host, that filesystem is EPHEMERAL: it is wiped between
deploys and is not shared between concurrent instances. An upload written by one
request may be missing from the next.

That is fine -- and free -- for local development and for a single always-on VPS
(Fly.io, Railway, a Raspberry Pi in the shop). It is NOT safe for a serverless
backend. Set ``STORAGE_BACKEND=s3`` before deploying the backend to a serverless
platform. Nothing else in the codebase has to change; see docs/DEPLOYMENT.md.

The frontend on Vercel is unaffected -- it never touches storage, it only renders
URLs handed to it by the API.
"""

from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

import aiofiles

from app.core.config import settings
from app.storage.base import StorageError, StoredObject


class LocalStorage:
    """Filesystem implementation of the StorageBackend protocol."""

    def __init__(self, root: Path | None = None, public_base_url: str | None = None) -> None:
        self.root = (root or settings.UPLOAD_DIR).resolve()
        self.public_base_url = (public_base_url or settings.PUBLIC_FILES_URL).rstrip("/")
        self.root.mkdir(parents=True, exist_ok=True)

    # -- path safety ---------------------------------------------------------
    def _resolve(self, key: str) -> Path:
        """Map a storage key to an absolute path, refusing to escape the root.

        SECURITY: without this check, a key of ``../../etc/passwd`` (or a crafted
        filename that survives into a key) would let a caller read or clobber files
        anywhere the process can reach. We resolve the candidate and assert it is
        still inside the upload root.
        """
        candidate = (self.root / key).resolve()
        if not candidate.is_relative_to(self.root):
            raise StorageError(f"Storage key escapes the upload root: {key!r}")
        return candidate

    # -- protocol ------------------------------------------------------------
    async def write(self, key: str, data: bytes, content_type: str) -> StoredObject:
        path = self._resolve(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Write to a temp file then rename: an interrupted write can never leave a
        # truncated file at the real key (rename is atomic on POSIX).
        tmp = path.with_suffix(path.suffix + ".part")
        async with aiofiles.open(tmp, "wb") as fh:
            await fh.write(data)
        await asyncio.to_thread(tmp.replace, path)
        return StoredObject(key=key, size_bytes=len(data), content_type=content_type)

    async def read(self, key: str) -> bytes:
        path = self._resolve(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        async with aiofiles.open(path, "rb") as fh:
            return await fh.read()

    async def delete(self, key: str) -> bool:
        path = self._resolve(key)
        if not path.is_file():
            return False
        await asyncio.to_thread(path.unlink)
        await asyncio.to_thread(self._prune_empty_dirs, path.parent)
        return True

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._resolve(key).is_file)

    async def size(self, key: str) -> int:
        path = self._resolve(key)
        if not path.is_file():
            return 0
        return (await asyncio.to_thread(path.stat)).st_size

    def url_for(self, key: str) -> str:
        return f"{self.public_base_url}/{key}"

    async def total_size(self, prefix: str = "") -> int:
        return await asyncio.to_thread(self._total_size_sync, prefix)

    async def list_keys(self, prefix: str = "") -> list[str]:
        return await asyncio.to_thread(self._list_keys_sync, prefix)

    # -- local extras (used by the Storage Dashboard & maintenance jobs) ------
    async def clear_prefix(self, prefix: str) -> int:
        """Delete everything under ``prefix``. Returns bytes freed."""
        return await asyncio.to_thread(self._clear_prefix_sync, prefix)

    # -- sync helpers (run in a thread; os.walk has no async equivalent) ------
    def _total_size_sync(self, prefix: str) -> int:
        base = self._resolve(prefix) if prefix else self.root
        if not base.exists():
            return 0
        if base.is_file():
            return base.stat().st_size
        return sum(p.stat().st_size for p in base.rglob("*") if p.is_file())

    def _list_keys_sync(self, prefix: str) -> list[str]:
        base = self._resolve(prefix) if prefix else self.root
        if not base.exists():
            return []
        return [
            str(p.relative_to(self.root))
            for p in base.rglob("*")
            if p.is_file() and not p.name.endswith(".part")
        ]

    def _clear_prefix_sync(self, prefix: str) -> int:
        base = self._resolve(prefix)
        if not base.exists():
            return 0
        freed = self._total_size_sync(prefix)
        if base.is_dir():
            shutil.rmtree(base, ignore_errors=True)
            base.mkdir(parents=True, exist_ok=True)
        else:
            base.unlink(missing_ok=True)
        return freed

    def _prune_empty_dirs(self, directory: Path) -> None:
        """Walk up removing empty dirs so deleting a business's last file doesn't
        leave a skeleton of empty folders behind."""
        current = directory
        while current != self.root and current.is_relative_to(self.root):
            try:
                next(current.iterdir())
                return  # not empty
            except StopIteration:
                current.rmdir()
                current = current.parent
            except OSError:
                return
