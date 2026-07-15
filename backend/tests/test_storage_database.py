"""The database storage driver (STORAGE_BACKEND=db).

This backend puts file bytes in the ``stored_blob`` table so a deployment with a
persistent DB but an ephemeral disk keeps its exports/uploads across redeploys. The
whole point is that a written file can be read back later, so these tests exercise the
full protocol round-trip against an isolated in-memory database.

The driver talks to ``app.db.session.engine`` directly (it opens its own short-lived
Sessions), so the fixture monkeypatches that engine to a throwaway one — the shared
``session`` fixture's engine is a different connection the driver never sees.
"""

from __future__ import annotations

import asyncio

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

import app.models  # noqa: F401  -- register every table on the metadata
import app.storage.database as dbmod
from app.storage.database import DatabaseStorage


@pytest.fixture
def storage(monkeypatch: pytest.MonkeyPatch) -> DatabaseStorage:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # one connection => the in-memory DB survives the test
    )
    SQLModel.metadata.create_all(engine)
    monkeypatch.setattr(dbmod, "engine", engine)
    return DatabaseStorage()


def test_write_then_read_round_trips(storage: DatabaseStorage) -> None:
    async def go() -> None:
        key = "businesses/b1/exports/ab/report.csv"
        obj = await storage.write(key, b"name,amount\nAlice,100\n", "text/csv")
        assert obj.size_bytes == 22
        assert obj.content_type == "text/csv"
        assert await storage.exists(key) is True
        assert await storage.read(key) == b"name,amount\nAlice,100\n"
        assert await storage.size(key) == 22

    asyncio.run(go())


def test_overwrite_replaces_bytes(storage: DatabaseStorage) -> None:
    async def go() -> None:
        key = "businesses/b1/logo.webp"
        await storage.write(key, b"old", "image/webp")
        await storage.write(key, b"newer-bytes", "image/webp")
        assert await storage.read(key) == b"newer-bytes"
        assert await storage.size(key) == len(b"newer-bytes")

    asyncio.run(go())


def test_read_missing_key_raises_file_not_found(storage: DatabaseStorage) -> None:
    async def go() -> None:
        with pytest.raises(FileNotFoundError):
            await storage.read("nope/missing.csv")
        assert await storage.exists("nope/missing.csv") is False
        assert await storage.size("nope/missing.csv") == 0

    asyncio.run(go())


def test_total_size_and_list_keys_honour_prefix(storage: DatabaseStorage) -> None:
    async def go() -> None:
        await storage.write("businesses/b1/a.csv", b"12345", "text/csv")
        await storage.write("businesses/b1/b.csv", b"123", "text/csv")
        await storage.write("businesses/b2/c.csv", b"1", "text/csv")

        assert await storage.total_size("businesses/b1/") == 8
        assert await storage.total_size() == 9
        assert set(await storage.list_keys("businesses/b1/")) == {
            "businesses/b1/a.csv",
            "businesses/b1/b.csv",
        }

    asyncio.run(go())


def test_delete_and_clear_prefix(storage: DatabaseStorage) -> None:
    async def go() -> None:
        await storage.write("businesses/b1/a.csv", b"12345", "text/csv")
        await storage.write("businesses/b1/b.csv", b"123", "text/csv")

        assert await storage.delete("businesses/b1/a.csv") is True
        assert await storage.delete("businesses/b1/a.csv") is False  # already gone

        freed = await storage.clear_prefix("businesses/b1/")
        assert freed == 3  # only b.csv remained
        assert await storage.list_keys() == []

    asyncio.run(go())


def test_url_for_points_at_the_files_route(storage: DatabaseStorage) -> None:
    # The browser fetches db-backed files through the same /api/files route the local
    # backend uses; app/api/files.py serves them by reading via this backend.
    assert storage.url_for("businesses/b1/x.csv") == "/api/files/businesses/b1/x.csv"
