"""S3-compatible storage driver (AWS S3, Cloudflare R2, Supabase Storage, MinIO).

This is the migration target. It is written against the same protocol as
LocalStorage, so switching is a config change:

    STORAGE_BACKEND=s3
    S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com   # omit for AWS
    S3_BUCKET=credit-system
    S3_ACCESS_KEY_ID=...
    S3_SECRET_ACCESS_KEY=...
    S3_PUBLIC_BASE_URL=https://cdn.example.com                    # optional

``boto3`` is an OPTIONAL dependency, imported lazily inside __init__ rather than at
module scope. A free-tier user running on SQLite + local disk should not have to
install (or pay the cold-start cost of) an AWS SDK they never call. Install it only
when you flip the switch:

    pip install boto3
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.config import settings
from app.storage.base import StorageError, StoredObject


class S3Storage:
    """S3-compatible implementation of the StorageBackend protocol."""

    def __init__(self) -> None:
        try:
            import boto3  # noqa: PLC0415  (deliberately lazy -- see module docstring)
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover
            raise StorageError(
                "STORAGE_BACKEND=s3 requires boto3. Install it with: pip install boto3"
            ) from exc

        if not settings.S3_BUCKET:
            raise StorageError("STORAGE_BACKEND=s3 requires S3_BUCKET to be set")

        self.bucket = settings.S3_BUCKET
        self.public_base_url = (settings.S3_PUBLIC_BASE_URL or "").rstrip("/")
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=settings.S3_ENDPOINT_URL,      # None => real AWS
            region_name=settings.S3_REGION,
            aws_access_key_id=settings.S3_ACCESS_KEY_ID,
            aws_secret_access_key=settings.S3_SECRET_ACCESS_KEY,
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )

    # boto3 is synchronous; every call is pushed to a thread so it never blocks the
    # event loop. This is why the protocol is async even though LocalStorage could
    # have been sync -- the interface has to fit the slower backend, not the faster.
    async def write(self, key: str, data: bytes, content_type: str) -> StoredObject:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            # Uploads are immutable (content-addressed), so they can be cached hard.
            CacheControl="public, max-age=31536000, immutable",
        )
        return StoredObject(key=key, size_bytes=len(data), content_type=content_type)

    async def read(self, key: str) -> bytes:
        def _get() -> bytes:
            try:
                resp = self._client.get_object(Bucket=self.bucket, Key=key)
                return resp["Body"].read()  # type: ignore[no-any-return]
            except self._client.exceptions.NoSuchKey as exc:
                raise FileNotFoundError(key) from exc

        return await asyncio.to_thread(_get)

    async def delete(self, key: str) -> bool:
        if not await self.exists(key):
            return False
        await asyncio.to_thread(self._client.delete_object, Bucket=self.bucket, Key=key)
        return True

    async def exists(self, key: str) -> bool:
        def _head() -> bool:
            try:
                self._client.head_object(Bucket=self.bucket, Key=key)
                return True
            except Exception:
                return False

        return await asyncio.to_thread(_head)

    async def size(self, key: str) -> int:
        def _head() -> int:
            try:
                return int(self._client.head_object(Bucket=self.bucket, Key=key)["ContentLength"])
            except Exception:
                return 0

        return await asyncio.to_thread(_head)

    def url_for(self, key: str) -> str:
        if self.public_base_url:
            return f"{self.public_base_url}/{key}"
        # No CDN configured: hand out a short-lived signed URL so a private bucket
        # stays private.
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key},
            ExpiresIn=3600,
        )

    async def total_size(self, prefix: str = "") -> int:
        def _sum() -> int:
            paginator = self._client.get_paginator("list_objects_v2")
            total = 0
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                total += sum(obj["Size"] for obj in page.get("Contents", []))
            return total

        return await asyncio.to_thread(_sum)

    async def list_keys(self, prefix: str = "") -> list[str]:
        def _list() -> list[str]:
            paginator = self._client.get_paginator("list_objects_v2")
            keys: list[str] = []
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                keys.extend(obj["Key"] for obj in page.get("Contents", []))
            return keys

        return await asyncio.to_thread(_list)
