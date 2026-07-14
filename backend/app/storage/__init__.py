"""Pluggable object storage. Import from here, not from the drivers."""

from __future__ import annotations

from app.storage.base import StorageBackend, StorageError, StoredObject
from app.storage.images import is_image, process_upload
from app.storage.local import LocalStorage
from app.storage.service import StorageService, get_backend, reset_backend

__all__ = [
    "LocalStorage",
    "StorageBackend",
    "StorageError",
    "StorageService",
    "StoredObject",
    "get_backend",
    "is_image",
    "process_upload",
    "reset_backend",
]
