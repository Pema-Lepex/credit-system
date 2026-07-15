"""StorageService -- the only thing the rest of the app talks to about files.

Ties together: the pluggable backend, the image pipeline, content-hash dedup, and
the FileAsset reference-counting registry.

KEY LAYOUT
----------
    businesses/<business_id>/<folder>/<xx>/<checksum>.<ext>

``<folder>`` comes from FileKind (customers/, invoices/, receipts/, ...), giving
the organised tree the spec asks for. ``<xx>`` is the first two hex chars of the
checksum -- a fan-out directory. Without it, a business with 50k uploads puts 50k
entries in one directory, which most filesystems handle badly (and which makes
``ls`` in a debugging session unusable). 256 buckets keeps directories small.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.core.config import StorageBackend as BackendKind
from app.core.config import settings
from app.models.base import utcnow
from app.models.enums import FileKind
from app.models.file import FileAsset
from app.storage.base import StorageBackend, StorageError
from app.storage.images import is_image, process_upload
from app.storage.local import LocalStorage

# FileKind -> folder name, i.e. the uploads/ tree from the spec.
_FOLDERS: dict[FileKind, str] = {
    FileKind.BUSINESS_LOGO: "businesses",
    # A staff avatar is NOT a customer photo, and it must not be TEMP either --
    # clean_temp_files() hard-deletes every TEMP asset regardless of reference count,
    # which would eat people's avatars on the next nightly sweep.
    FileKind.USER_AVATAR: "avatars",
    FileKind.CUSTOMER_PHOTO: "customers",
    FileKind.PRODUCT_IMAGE: "products",
    FileKind.INVOICE: "invoices",
    FileKind.RECEIPT: "receipts",
    FileKind.CREDIT_PHOTO: "credits",
    FileKind.EXPORT: "exports",
    FileKind.TEMP: "temp",
}

# How long an unreferenced file survives before the orphan sweep removes it.
# Not zero: the UI's "replace photo" flow detaches then re-attaches, and a user may
# abandon a half-filled form. A day of slack costs a few KB and prevents data loss.
ORPHAN_GRACE = timedelta(hours=24)

_backend: StorageBackend | None = None


def get_backend() -> StorageBackend:
    """Resolve the configured driver. Cached -- clients are expensive to build.

    Imports are lazy on purpose: boto3 and the cloudinary SDK are only needed by the
    deployment that actually selected them, so a local dev install does not pay for
    either, and a missing optional dependency surfaces only if you ask for that driver.
    """
    global _backend
    if _backend is None:
        if settings.STORAGE_BACKEND is BackendKind.cloudinary:
            from app.storage.cloudinary import CloudinaryStorage

            _backend = CloudinaryStorage()
        elif settings.STORAGE_BACKEND is BackendKind.s3:
            from app.storage.s3 import S3Storage

            _backend = S3Storage()
        elif settings.STORAGE_BACKEND is BackendKind.db:
            from app.storage.database import DatabaseStorage

            _backend = DatabaseStorage()
        else:
            _backend = LocalStorage()
    return _backend


def reset_backend() -> None:
    """Test hook -- drop the cached driver."""
    global _backend
    _backend = None


class StorageService:
    def __init__(self, session: Session, backend: StorageBackend | None = None) -> None:
        self.session = session
        # LAZY on purpose. Constructing the backend can fail (e.g. STORAGE_BACKEND=
        # cloudinary with no credentials), and most StorageService uses never touch it:
        # ``url_for_id(None)`` for an avatar-less user returns None without any storage
        # call. Building the client eagerly here made every user/business response 500
        # -- signup, login, the dashboard -- the instant a production storage backend
        # was selected but not yet configured. The backend is now built on first real
        # use, so a misconfigured store only breaks operations that actually need it.
        self._backend = backend

    @property
    def backend(self) -> StorageBackend:
        if self._backend is None:
            self._backend = get_backend()
        return self._backend

    # -- upload --------------------------------------------------------------
    async def upload(
        self,
        *,
        business_id: str,
        kind: FileKind,
        filename: str,
        data: bytes,
        content_type: str,
        user_id: str | None = None,
        expires_in_hours: int | None = None,
    ) -> FileAsset:
        """Store bytes and return the FileAsset.

        Deduplicates: uploading bytes this business already has returns the existing
        asset without writing to disk a second time.
        """
        max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
        if len(data) > max_bytes:
            raise StorageError(
                f"File is {len(data) / 1_048_576:.1f} MB; the limit is {settings.MAX_UPLOAD_MB} MB"
            )
        if not data:
            raise StorageError("Refusing to store an empty file")

        processed = await process_upload(
            data, content_type, make_thumbnail=is_image(content_type)
        )

        # Checksum the STORED bytes, not the uploaded ones. Two phone photos of the
        # same receipt at different JPEG qualities are different uploads but may
        # compress to identical WebP -- and if they do, they are the same file.
        checksum = hashlib.sha256(processed.data).hexdigest()

        existing = self.session.exec(
            select(FileAsset).where(
                FileAsset.business_id == business_id,
                FileAsset.checksum == checksum,
                FileAsset.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()
        if existing is not None:
            # Same bytes already here. Resurrect it if it was drifting toward the
            # orphan sweep, and hand back the same asset.
            existing.orphaned_at = None
            if expires_in_hours is not None:
                existing.expires_at = utcnow() + timedelta(hours=expires_in_hours)
            self.session.add(existing)
            self.session.flush()
            return existing

        key = self._build_key(business_id, kind, checksum, processed.extension)
        await self.backend.write(key, processed.data, processed.content_type)

        thumb_key: str | None = None
        if processed.thumbnail:
            thumb_key = self._build_key(
                business_id, kind, checksum, processed.thumbnail_extension or "webp", thumb=True
            )
            await self.backend.write(thumb_key, processed.thumbnail, "image/webp")

        asset = FileAsset(
            business_id=business_id,
            kind=kind,
            original_filename=filename[:255],
            storage_key=key,
            thumbnail_key=thumb_key,
            content_type=processed.content_type,
            size_bytes=len(processed.data),
            original_size_bytes=processed.original_size,
            checksum=checksum,
            width=processed.width,
            height=processed.height,
            reference_count=0,
            orphaned_at=utcnow(),  # unreferenced until something attaches it
            expires_at=(
                utcnow() + timedelta(hours=expires_in_hours)
                if expires_in_hours is not None
                else None
            ),
            uploaded_by_user_id=user_id,
        )
        self.session.add(asset)
        self.session.flush()
        return asset

    def _build_key(
        self, business_id: str, kind: FileKind, checksum: str, ext: str, *, thumb: bool = False
    ) -> str:
        folder = _FOLDERS.get(kind, "temp")
        shard = checksum[:2]
        suffix = "_thumb" if thumb else ""
        return f"businesses/{business_id}/{folder}/{shard}/{checksum}{suffix}.{ext}"

    # -- reference counting --------------------------------------------------
    # Attach/detach are how a file learns whether anything still needs it. Callers
    # (CreditService, CustomerService...) MUST pair them, which is why they are here
    # rather than being ad-hoc UPDATE statements scattered across services.
    def attach(self, file_id: str | None) -> None:
        if not file_id:
            return
        asset = self.session.get(FileAsset, file_id)
        if asset is None:
            return
        asset.reference_count += 1
        asset.orphaned_at = None
        self.session.add(asset)

    def detach(self, file_id: str | None) -> None:
        if not file_id:
            return
        asset = self.session.get(FileAsset, file_id)
        if asset is None:
            return
        asset.reference_count = max(0, asset.reference_count - 1)
        if asset.reference_count == 0 and asset.orphaned_at is None:
            asset.orphaned_at = utcnow()  # starts the grace clock
        self.session.add(asset)

    def attach_many(self, file_ids: list[str] | None) -> None:
        for fid in file_ids or []:
            self.attach(fid)

    def detach_many(self, file_ids: list[str] | None) -> None:
        for fid in file_ids or []:
            self.detach(fid)

    # -- read ----------------------------------------------------------------
    async def read(self, asset: FileAsset) -> bytes:
        return await self.backend.read(asset.storage_key)

    def url_for(self, asset: FileAsset | None, *, thumb: bool = False) -> str | None:
        if asset is None:
            return None
        key = asset.thumbnail_key if (thumb and asset.thumbnail_key) else asset.storage_key
        return self.backend.url_for(key)

    def url_for_id(self, file_id: str | None, *, thumb: bool = False) -> str | None:
        if not file_id:
            return None
        return self.url_for(self.session.get(FileAsset, file_id), thumb=thumb)

    # -- deletion & hygiene --------------------------------------------------
    async def hard_delete(self, asset: FileAsset) -> int:
        """Remove the bytes and the row. Returns bytes freed."""
        freed = asset.size_bytes
        await self.backend.delete(asset.storage_key)
        if asset.thumbnail_key:
            freed += await self.backend.size(asset.thumbnail_key)
            await self.backend.delete(asset.thumbnail_key)
        self.session.delete(asset)
        return freed

    async def sweep_orphans(self, *, business_id: str | None = None, now: datetime | None = None) -> tuple[int, int]:
        """Delete assets that have been unreferenced past the grace period.

        Returns (files_deleted, bytes_freed). Called nightly by the maintenance job.
        """
        now = now or utcnow()
        cutoff = now - ORPHAN_GRACE
        stmt = select(FileAsset).where(
            FileAsset.reference_count <= 0,
            FileAsset.orphaned_at.is_not(None),  # type: ignore[union-attr]
            FileAsset.orphaned_at < cutoff,  # type: ignore[operator]
        )
        if business_id:
            stmt = stmt.where(FileAsset.business_id == business_id)

        deleted = freed = 0
        for asset in self.session.exec(stmt).all():
            freed += await self.hard_delete(asset)
            deleted += 1
        return deleted, freed

    async def sweep_expired(self, *, now: datetime | None = None) -> tuple[int, int]:
        """Delete assets past their ``expires_at`` (exports, temp files)."""
        now = now or utcnow()
        stmt = select(FileAsset).where(
            FileAsset.expires_at.is_not(None),  # type: ignore[union-attr]
            FileAsset.expires_at < now,  # type: ignore[operator]
        )
        deleted = freed = 0
        for asset in self.session.exec(stmt).all():
            freed += await self.hard_delete(asset)
            deleted += 1
        return deleted, freed

    async def clear_temp(self) -> int:
        """Empty the temp folder. Returns bytes freed."""
        if isinstance(self.backend, LocalStorage):
            return await self.backend.clear_prefix("temp")
        keys = await self.backend.list_keys("temp/")
        freed = 0
        for key in keys:
            freed += await self.backend.size(key)
            await self.backend.delete(key)
        return freed
