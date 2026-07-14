"""The Cloudinary driver's key <-> public_id mapping.

This is the one piece of the driver with real teeth, and it is testable without ever
touching the network.

Cloudinary has no "paths with extensions": it has a public_id (slashes allowed) and a
separate `format`. So the driver strips the extension to build the public_id, and puts
it back to build the URL. `list_keys()` performs the INVERSE, and the orphan sweep
compares its output against FileAsset.storage_key -- so if the round-trip is not exact,
every stored file looks orphaned and the nightly sweep DELETES it. That is the failure
mode these tests exist to prevent.
"""

from __future__ import annotations

import pytest

from app.core.config import settings
from app.storage.base import StorageError


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "CLOUDINARY_URL", None)
    monkeypatch.setattr(settings, "CLOUDINARY_CLOUD_NAME", "demo-cloud")
    monkeypatch.setattr(settings, "CLOUDINARY_API_KEY", "key")
    monkeypatch.setattr(settings, "CLOUDINARY_API_SECRET", "secret")
    monkeypatch.setattr(settings, "CLOUDINARY_FOLDER", "credit-system")

    from app.storage.cloudinary import CloudinaryStorage

    return CloudinaryStorage()


KEY = "businesses/b1/customers/ab/abcd1234.webp"


def test_public_id_strips_extension_and_namespaces(storage) -> None:
    # Leaving ".webp" on the public_id yields URLs ending ".webp.webp".
    assert storage._public_id(KEY) == "credit-system/businesses/b1/customers/ab/abcd1234"


def test_images_and_raw_files_get_different_resource_types(storage) -> None:
    """Resource type is part of the delivery URL. Guess wrong and reads 404."""
    assert storage._resource_type("a/b.webp") == "image"
    assert storage._resource_type("a/b.PNG") == "image"  # case-insensitive
    assert storage._resource_type("a/b.pdf") == "raw"
    assert storage._resource_type("a/b.csv") == "raw"
    assert storage._resource_type("a/b.xlsx") == "raw"
    assert storage._resource_type("a/backup.db") == "raw"


def test_key_with_no_extension(storage) -> None:
    stem, ext = storage._split_extension("businesses/b1/thing")
    assert (stem, ext) == ("businesses/b1/thing", "")


def test_dot_in_a_directory_is_not_an_extension(storage) -> None:
    """`a.b/c` must not be read as extension "b/c"."""
    stem, ext = storage._split_extension("businesses/v1.2/file")
    assert (stem, ext) == ("businesses/v1.2/file", "")


def test_url_is_absolute_https_and_keeps_the_extension(storage) -> None:
    url = storage.url_for(KEY)
    assert url.startswith("https://"), "an http URL is blocked as mixed content"
    assert "demo-cloud" in url
    assert url.endswith(".webp"), "the extension must be restored by url_for"
    assert ".webp.webp" not in url


def test_list_keys_round_trips_back_to_the_storage_key(storage, monkeypatch) -> None:
    """THE important one: public_id -> key must invert _public_id exactly.

    If it does not, the orphan sweep sees a key it has no FileAsset for, concludes the
    file is unreferenced, and deletes a live customer photo.
    """

    async def fake_resources(prefix: str = ""):
        return [
            {
                "public_id": "credit-system/businesses/b1/customers/ab/abcd1234",
                "format": "webp",
                "bytes": 100,
            },
            {
                "public_id": "credit-system/businesses/b1/exports/cd/report",
                "format": "pdf",
                "bytes": 200,
            },
        ]

    monkeypatch.setattr(storage, "_list_resources", fake_resources)

    import asyncio

    keys = asyncio.run(storage.list_keys())

    assert KEY in keys, "a stored photo must map back to its exact storage key"
    assert "businesses/b1/exports/cd/report.pdf" in keys
    # And the round-trip is closed in both directions.
    assert storage._public_id(keys[0]) == "credit-system/businesses/b1/customers/ab/abcd1234"


def test_total_size_sums_resources(storage, monkeypatch) -> None:
    async def fake_resources(prefix: str = ""):
        return [{"bytes": 100}, {"bytes": 250}]

    monkeypatch.setattr(storage, "_list_resources", fake_resources)

    import asyncio

    assert asyncio.run(storage.total_size()) == 350


def test_missing_credentials_fail_loudly(monkeypatch: pytest.MonkeyPatch) -> None:
    """Silently falling back to local storage would lose files on the next redeploy."""
    for name in (
        "CLOUDINARY_URL",
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
    ):
        monkeypatch.setattr(settings, name, None)

    from app.storage.cloudinary import CloudinaryStorage

    with pytest.raises(StorageError, match="no credentials"):
        CloudinaryStorage()
