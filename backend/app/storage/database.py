"""Database storage driver — file bytes live in the SQL database.

WHY THIS EXISTS
---------------
The free/ephemeral deployment (Render + Supabase Postgres) has a PERSISTENT database
but a DISPOSABLE filesystem. ``STORAGE_BACKEND=local`` loses every uploaded file on
redeploy; ``cloudinary``/``s3`` fix that but add another account to sign up for and
configure. This driver takes the pragmatic middle path: put the bytes in the database
you already pay nothing for and already trust to persist. No new service, no new
credentials — if the DB survives, the files survive.

It implements exactly the StorageBackend protocol (app/storage/base.py), so switching
to it is a one-line env change and nothing else in the app knows the difference.

CONCURRENCY: SQLModel/psycopg calls are synchronous, so every protocol method hands
its blocking DB work to ``asyncio.to_thread`` — the same discipline the Cloudinary
driver uses — so a large read/write never stalls the event loop. Each call opens its
own short-lived Session against the shared engine.

SCOPE: intended for small artefacts — CSV/XLSX/PDF exports, logos, receipts. A big
image gallery is better on cloudinary/s3 to keep the database lean and backups fast.
"""

from __future__ import annotations

import asyncio

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlmodel import Session, col

from app.core.config import settings
from app.db.session import engine
from app.models.stored_blob import StoredBlob
from app.storage.base import StoredObject


class DatabaseStorage:
    """Stores objects as rows in the ``stored_blob`` table."""

    def __init__(self) -> None:
        # Files are served through the same FastAPI route the local backend uses
        # (/api/files/<key>), which reads via this backend. See app/api/files.py.
        self.public_base_url = settings.PUBLIC_FILES_URL.rstrip("/")

    # -- protocol ------------------------------------------------------------
    async def write(self, key: str, data: bytes, content_type: str) -> StoredObject:
        return await asyncio.to_thread(self._write_sync, key, data, content_type)

    def _write_sync(self, key: str, data: bytes, content_type: str) -> StoredObject:
        with Session(engine) as session:
            row = session.get(StoredBlob, key)
            if row is None:
                row = StoredBlob(key=key)
            row.data = data
            row.content_type = content_type
            row.size_bytes = len(data)
            session.add(row)
            session.commit()
        return StoredObject(key=key, size_bytes=len(data), content_type=content_type)

    async def read(self, key: str) -> bytes:
        return await asyncio.to_thread(self._read_sync, key)

    def _read_sync(self, key: str) -> bytes:
        with Session(engine) as session:
            row = session.get(StoredBlob, key)
            if row is None:
                raise FileNotFoundError(key)
            return bytes(row.data)

    async def delete(self, key: str) -> bool:
        return await asyncio.to_thread(self._delete_sync, key)

    def _delete_sync(self, key: str) -> bool:
        with Session(engine) as session:
            row = session.get(StoredBlob, key)
            if row is None:
                return False
            session.delete(row)
            session.commit()
            return True

    async def exists(self, key: str) -> bool:
        return await asyncio.to_thread(self._exists_sync, key)

    def _exists_sync(self, key: str) -> bool:
        with Session(engine) as session:
            return session.get(StoredBlob, key) is not None

    async def size(self, key: str) -> int:
        return await asyncio.to_thread(self._size_sync, key)

    def _size_sync(self, key: str) -> int:
        with Session(engine) as session:
            row = session.get(StoredBlob, key)
            return row.size_bytes if row is not None else 0

    def url_for(self, key: str) -> str:
        return f"{self.public_base_url}/{key}"

    async def total_size(self, prefix: str = "") -> int:
        return await asyncio.to_thread(self._total_size_sync, prefix)

    def _total_size_sync(self, prefix: str) -> int:
        with Session(engine) as session:
            stmt = select(func.coalesce(func.sum(col(StoredBlob.size_bytes)), 0))
            if prefix:
                stmt = stmt.where(col(StoredBlob.key).like(f"{prefix}%"))
            return int(session.execute(stmt).scalar_one())

    async def list_keys(self, prefix: str = "") -> list[str]:
        return await asyncio.to_thread(self._list_keys_sync, prefix)

    def _list_keys_sync(self, prefix: str) -> list[str]:
        with Session(engine) as session:
            stmt = select(col(StoredBlob.key))
            if prefix:
                stmt = stmt.where(col(StoredBlob.key).like(f"{prefix}%"))
            return list(session.execute(stmt).scalars().all())

    # -- maintenance-job parity with the local backend -----------------------
    async def clear_prefix(self, prefix: str) -> int:
        """Delete everything under ``prefix``. Returns bytes freed. Mirrors
        LocalStorage.clear_prefix so the Storage Dashboard's cleanup works here too."""
        return await asyncio.to_thread(self._clear_prefix_sync, prefix)

    def _clear_prefix_sync(self, prefix: str) -> int:
        with Session(engine) as session:
            freed = int(
                session.execute(
                    select(func.coalesce(func.sum(col(StoredBlob.size_bytes)), 0)).where(
                        col(StoredBlob.key).like(f"{prefix}%")
                    )
                ).scalar_one()
            )
            session.execute(sa_delete(StoredBlob).where(col(StoredBlob.key).like(f"{prefix}%")))
            session.commit()
            return freed
