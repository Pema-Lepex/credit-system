"""Cloudinary storage driver. The production default.

WHY THIS EXISTS
---------------
LocalStorage writes to the container filesystem, which Render/Fly/Vercel rebuild on
every redeploy -- so every uploaded photo, logo and receipt vanishes. Cloudinary is
free (no card), serves over a CDN, and survives redeploys.

It implements exactly the same Protocol as LocalStorage and S3Storage
(app/storage/base.py), so switching is `STORAGE_BACKEND=cloudinary` and three env
vars. No service, resolver or model changes -- business logic never learns which
driver it is talking to.

THE KEY -> public_id MAPPING (the one thing that is not obvious)
---------------------------------------------------------------
The rest of the app addresses objects by an opaque storage key, which looks like a
path and carries the content hash:

    businesses/<bid>/customers/ab/abcd1234.webp

Cloudinary does not have "paths" and "extensions" the way a filesystem does. It has
a `public_id` (which may contain slashes, forming virtual folders) and a `format`
derived from the file. If you hand it `…/abcd1234.webp` as the public_id, you get an
asset whose public_id is `…/abcd1234.webp` and whose format is `webp`, and the URL
comes back as `…/abcd1234.webp.webp`. So the extension is STRIPPED for the public_id
and remembered separately; `_public_id()` and `url_for()` are the only two places
that know this, and they are inverses of each other.

Everything is namespaced under CLOUDINARY_FOLDER so one account can host staging and
production without collisions.

RAW vs IMAGE
------------
Cloudinary distinguishes resource types. Images (jpg/png/webp…) get `image`, and
everything else -- PDFs we stream, CSV/XLSX exports, the .db backup -- gets `raw`.
Guessing wrong means a 404 on read, because the resource type is part of the URL. We
derive it from the extension, the same way the upload pipeline already does.

BLOCKING SDK
------------
The cloudinary SDK is synchronous (it uses requests under the hood). Every call is
wrapped in ``asyncio.to_thread`` so a slow upload cannot stall the event loop and
freeze every other request in the process.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import cloudinary
import cloudinary.api
import cloudinary.exceptions
import cloudinary.uploader
import cloudinary.utils

from app.core.config import settings
from app.storage.base import StorageError, StoredObject

logger = logging.getLogger(__name__)

# Extensions Cloudinary treats as images. Everything else is uploaded as `raw`.
_IMAGE_EXTENSIONS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "tiff", "ico"})


class CloudinaryStorage:
    """Cloudinary implementation of the StorageBackend protocol."""

    def __init__(self) -> None:
        self.folder = settings.CLOUDINARY_FOLDER.strip("/")
        self._configure()

    def _configure(self) -> None:
        """Configure the SDK's global state from settings.

        CLOUDINARY_URL wins when present: it is the single value the dashboard shows
        you, so it is the one people actually paste. The three-part form exists for
        platforms whose secret manager dislikes URL-shaped values.
        """
        if settings.CLOUDINARY_URL:
            # cloudinary.config() parses the cloudinary:// URL itself.
            cloudinary.config(cloudinary_url=settings.CLOUDINARY_URL, secure=True)
        elif all(
            (
                settings.CLOUDINARY_CLOUD_NAME,
                settings.CLOUDINARY_API_KEY,
                settings.CLOUDINARY_API_SECRET,
            )
        ):
            cloudinary.config(
                cloud_name=settings.CLOUDINARY_CLOUD_NAME,
                api_key=settings.CLOUDINARY_API_KEY,
                api_secret=settings.CLOUDINARY_API_SECRET,
                secure=True,  # always https:// URLs; an http:// image on an https page is blocked
            )
        else:
            raise StorageError(
                "STORAGE_BACKEND=cloudinary but no credentials are set. Provide "
                "CLOUDINARY_URL, or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + "
                "CLOUDINARY_API_SECRET."
            )

    # -- key <-> public_id ----------------------------------------------------
    @staticmethod
    def _split_extension(key: str) -> tuple[str, str]:
        """('a/b/c.webp') -> ('a/b/c', 'webp'). No extension -> ('a/b/c', '')."""
        head, sep, ext = key.rpartition(".")
        # A dot in a directory name but not in the filename is not an extension.
        if not sep or "/" in ext:
            return key, ""
        return head, ext.lower()

    def _public_id(self, key: str) -> str:
        """The Cloudinary public_id for a storage key, namespaced and extension-free."""
        stem, _ = self._split_extension(key)
        return f"{self.folder}/{stem}" if self.folder else stem

    def _resource_type(self, key: str) -> str:
        _, ext = self._split_extension(key)
        return "image" if ext in _IMAGE_EXTENSIONS else "raw"

    # -- write ----------------------------------------------------------------
    async def write(self, key: str, data: bytes, content_type: str) -> StoredObject:
        def _upload() -> dict[str, Any]:
            return cloudinary.uploader.upload(
                data,
                public_id=self._public_id(key),
                resource_type=self._resource_type(key),
                # The key already contains a content hash, so the same bytes always land
                # on the same public_id. Overwriting is therefore a no-op re-write of
                # identical content, never a destructive surprise.
                overwrite=True,
                invalidate=True,  # purge the CDN edge, or the old bytes linger
                # Our own pipeline already compressed and resized (storage/images.py).
                # Cloudinary must not re-encode on top of that.
                unique_filename=False,
                use_filename=False,
            )

        try:
            result = await asyncio.to_thread(_upload)
        except Exception as exc:  # the SDK raises a zoo of exception types
            raise StorageError(f"Cloudinary upload failed for {key!r}: {exc!r}") from exc

        return StoredObject(
            key=key,
            size_bytes=int(result.get("bytes", len(data))),
            content_type=content_type,
        )

    # -- read -----------------------------------------------------------------
    async def read(self, key: str) -> bytes:
        """Fetch the bytes back.

        Cloudinary is a CDN, not a filesystem: there is no "read object" API, so we
        fetch a delivery URL over HTTP. Used for server-side work only (streaming a
        stored export, re-reading a logo to embed in a PDF); the browser never comes
        through here.

        We do NOT reconstruct the URL with ``url_for`` here. For a ``raw`` file (every
        CSV/XLSX/PDF/ZIP export) Cloudinary stores the asset under the extension-free
        ``public_id`` we uploaded, and a reconstructed URL that re-appends the original
        extension points at a path that does not exist -> 404 -> a bogus "expired". So
        we ask the Admin API for the asset it ACTUALLY stored under that public_id
        (the same lookup ``size()`` does) and fetch its own ``secure_url``, whatever
        extension Cloudinary did or did not give it.
        """
        import httpx

        def _resource() -> dict[str, Any]:
            return cloudinary.api.resource(
                self._public_id(key), resource_type=self._resource_type(key)
            )

        try:
            info = await asyncio.to_thread(_resource)
        except cloudinary.exceptions.NotFound as exc:
            # The contract the whole app is written against (StorageService.read and the
            # export-download route turn this into a clean 410).
            raise FileNotFoundError(key) from exc
        except Exception as exc:  # the SDK raises a zoo of types
            raise StorageError(f"Cloudinary lookup failed for {key!r}: {exc!r}") from exc

        url = info.get("secure_url") or info.get("url")
        if not url:
            raise FileNotFoundError(key)

        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                response = await client.get(str(url))
        except httpx.HTTPError as exc:
            raise StorageError(f"Cloudinary fetch failed for {key!r}: {exc!r}") from exc

        if response.status_code == 404:
            raise FileNotFoundError(key)
        if response.status_code >= 400:
            # e.g. 401/403 when the account has PDF/ZIP delivery disabled. The export
            # route maps StorageError to a clean, retryable 502.
            raise StorageError(
                f"Cloudinary returned HTTP {response.status_code} for {key!r}"
            )
        return response.content

    # -- delete ---------------------------------------------------------------
    async def delete(self, key: str) -> bool:
        def _destroy() -> dict[str, Any]:
            return cloudinary.uploader.destroy(
                self._public_id(key),
                resource_type=self._resource_type(key),
                invalidate=True,
            )

        try:
            result = await asyncio.to_thread(_destroy)
        except Exception as exc:
            logger.warning("Cloudinary delete failed for %s: %r", key, exc)
            return False
        # "not found" is a successful no-op, per the Protocol: delete() never raises.
        return str(result.get("result")) == "ok"

    async def exists(self, key: str) -> bool:
        return await self.size(key) > 0

    async def size(self, key: str) -> int:
        def _resource() -> dict[str, Any]:
            return cloudinary.api.resource(
                self._public_id(key), resource_type=self._resource_type(key)
            )

        try:
            result = await asyncio.to_thread(_resource)
        except Exception:
            return 0  # missing object -> 0 bytes, per the Protocol
        return int(result.get("bytes", 0))

    # -- URL ------------------------------------------------------------------
    def url_for(self, key: str) -> str:
        """The CDN URL the browser fetches directly.

        Note this returns an ABSOLUTE https URL, unlike LocalStorage, which returns a
        path relative to the API. The frontend already handles both (lib/media.ts
        passes absolute URLs through untouched), so nothing changes for it.
        """
        _, ext = self._split_extension(key)
        url, _options = cloudinary.utils.cloudinary_url(
            self._public_id(key),
            resource_type=self._resource_type(key),
            format=ext or None,
            secure=True,
        )
        return str(url)

    # -- introspection (Storage Dashboard + orphan sweep) ---------------------
    async def _list_resources(self, prefix: str = "") -> list[dict[str, Any]]:
        """Every resource under a prefix, across both resource types.

        Cloudinary paginates at 500 and partitions by resource_type, so a complete
        listing means walking the cursor for `image` AND `raw`. Missing that is how an
        orphan sweep silently stops seeing half the files -- and then deletes their
        database rows.
        """
        full_prefix = f"{self.folder}/{prefix}".strip("/") if self.folder else prefix.strip("/")
        collected: list[dict[str, Any]] = []

        def _page(resource_type: str, cursor: str | None) -> dict[str, Any]:
            return cloudinary.api.resources(
                type="upload",
                resource_type=resource_type,
                prefix=full_prefix,
                max_results=500,
                next_cursor=cursor,
            )

        for resource_type in ("image", "raw"):
            cursor: str | None = None
            while True:
                try:
                    page = await asyncio.to_thread(_page, resource_type, cursor)
                except Exception as exc:
                    logger.warning(
                        "Cloudinary listing failed (%s, prefix=%r): %r",
                        resource_type,
                        full_prefix,
                        exc,
                    )
                    break
                collected.extend(page.get("resources", []))
                cursor = page.get("next_cursor")
                if not cursor:
                    break

        return collected

    async def total_size(self, prefix: str = "") -> int:
        resources = await self._list_resources(prefix)
        return sum(int(r.get("bytes", 0)) for r in resources)

    async def list_keys(self, prefix: str = "") -> list[str]:
        """Public_ids mapped BACK to storage keys.

        The inverse of _public_id(): strip the namespace folder, and restore the
        extension from Cloudinary's `format`. The orphan sweep compares these against
        FileAsset.storage_key, so a mismatch here would make every stored file look
        orphaned -- and get it deleted.
        """
        keys: list[str] = []
        for resource in await self._list_resources(prefix):
            public_id = str(resource.get("public_id", ""))
            if not public_id:
                continue
            if self.folder and public_id.startswith(f"{self.folder}/"):
                public_id = public_id[len(self.folder) + 1 :]
            fmt = str(resource.get("format", "")).lower()
            keys.append(f"{public_id}.{fmt}" if fmt else public_id)
        return keys
