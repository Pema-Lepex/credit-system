"""Storage maintenance against a REAL database file.

The shared `session` fixture is an in-memory SQLite, where `_sqlite_path()` is None
and `_database_bytes()` is always 0 -- so it cannot see the bug these tests exist to
pin. VACUUM under WAL rewrites the database *into the write-ahead log*, and the main
file does not shrink until the WAL is folded back in. Measuring without checkpointing
reports the database GROWING immediately after the one operation whose whole purpose
is to shrink it.

So these use a file on disk, with WAL on, exactly like production.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401  (registers every table)
from app.core.security import Role, hash_password
from app.models.business import Business
from app.models.enums import ApprovalStatus
from app.models.user import User
from app.services.base import ServiceContext
from app.services.storage_stats import StorageStatsService


@pytest.fixture
def file_db(tmp_path: Path) -> Iterator[tuple[Session, Path]]:
    """A file-backed SQLite in WAL mode -- what actually ships."""
    path = tmp_path / "app.db"
    engine = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _wal(dbapi_conn, _record) -> None:  # noqa: ANN001
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        yield session, path
    engine.dispose()


@pytest.fixture
def file_ctx(file_db: tuple[Session, Path]) -> ServiceContext:
    session, _ = file_db
    business = Business(
        name="Tashi General Store",
        slug="tashi-general-store",
        email="owner@tashi.bt",
        approval_status=ApprovalStatus.APPROVED,
    )
    session.add(business)
    session.commit()
    session.refresh(business)

    user = User(
        email="owner@tashi.bt",
        hashed_password=hash_password("Password123"),
        full_name="Tashi Owner",
        role=Role.ADMIN,
        business_id=business.id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    return ServiceContext(session=session, user=user, business_id=business.id)


def _bloat_then_delete(session: Session) -> None:
    """Leave the file full of free pages -- real work for VACUUM to reclaim."""
    conn = session.connection()
    conn.exec_driver_sql("CREATE TABLE IF NOT EXISTS bloat (id INTEGER PRIMARY KEY, b TEXT)")
    for _ in range(1500):
        conn.exec_driver_sql("INSERT INTO bloat (b) VALUES (hex(randomblob(2000)))")
    session.commit()
    session.connection().exec_driver_sql("DELETE FROM bloat")
    session.commit()


def _total_bytes(path: Path) -> int:
    total = 0
    for candidate in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
        if candidate.exists():
            total += candidate.stat().st_size
    return total


def test_vacuum_actually_shrinks_the_file_and_says_so(file_db, file_ctx) -> None:
    """The regression: VACUUM must report the space it really reclaimed.

    Before the WAL checkpoint was added, this reported `bytes_freed == 0` and a
    database that had grown -- because the rewritten pages were sitting in the -wal.
    """
    session, path = file_db
    _bloat_then_delete(session)

    before = _total_bytes(path)
    result = StorageStatsService(file_ctx).vacuum_database()
    after = _total_bytes(path)

    assert result.ok
    # The file on disk really did shrink...
    assert after < before, f"file did not shrink: {before} -> {after}"
    # ...and the number we told the user is the truth, not zero.
    assert result.bytes_freed > 0
    assert result.bytes_freed == before - after
    assert "reclaimed" in result.detail


def test_vacuum_leaves_no_wal_behind(file_db, file_ctx) -> None:
    """TRUNCATE, not PASSIVE: the space must go back to the filesystem."""
    session, path = file_db
    _bloat_then_delete(session)

    StorageStatsService(file_ctx).vacuum_database()

    wal = path.with_name(path.name + "-wal")
    assert not wal.exists() or wal.stat().st_size == 0


def test_vacuum_preserves_the_data(file_db, file_ctx) -> None:
    """A maintenance button that loses rows is worse than no button."""
    session, path = file_db
    _bloat_then_delete(session)
    before = session.connection().exec_driver_sql("SELECT count(*) FROM business").scalar()

    StorageStatsService(file_ctx).vacuum_database()

    after = session.connection().exec_driver_sql("SELECT count(*) FROM business").scalar()
    assert after == before == 1


def test_database_bytes_counts_the_wal(file_db, file_ctx) -> None:
    """A dashboard that ignores the -wal under-reports real usage."""
    session, path = file_db
    _bloat_then_delete(session)

    reported = StorageStatsService(file_ctx)._database_bytes()
    assert reported == _total_bytes(path)
    assert reported > 0


def test_every_maintenance_operation_runs(file_ctx) -> None:
    """Smoke test for the buttons on Settings > Storage.

    Each one opens its own AUTOCOMMIT connection while the caller's session is live;
    if that ever deadlocks or raises 'cannot VACUUM from within a transaction', this
    is where it shows up.
    """
    service = StorageStatsService(file_ctx)

    for run in (
        service.vacuum_database,
        service.analyze_database,
        service.optimize_database,
        service.check_integrity,
        service.clean_old_logs,
    ):
        result = run()
        assert result.ok, f"{result.operation} failed: {result.detail}"
        assert result.detail, f"{result.operation} reported nothing to the user"


def test_clean_old_logs_refuses_a_dangerous_window(file_ctx) -> None:
    """Under 30 days would delete the audit trail of deletions still in grace."""
    from app.core.errors import ValidationError

    with pytest.raises(ValidationError, match="at least 30 days"):
        StorageStatsService(file_ctx).clean_old_logs(days=7)


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------
def test_backup_returns_a_valid_consistent_snapshot(file_db, file_ctx) -> None:
    import sqlite3

    session, _ = file_db
    data = StorageStatsService(file_ctx).backup_database()

    assert data.startswith(b"SQLite format 3\x00")

    # Not just "it is bytes" -- open it and prove it is a sound database holding the
    # real rows. A torn copy (shutil.copy of a live file) opens fine and fails here.
    target = Path(session.get_bind().url.database).parent / "restored.db"
    target.write_bytes(data)
    conn = sqlite3.connect(str(target))
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT count(*) FROM business").fetchone()[0] == 1
        assert conn.execute("SELECT name FROM business").fetchone()[0] == "Tashi General Store"
    finally:
        conn.close()


def test_backup_does_not_need_a_business_context(file_db, file_ctx) -> None:
    """A SUPER_ADMIN is attached to no business, and the backup is the whole file --
    not one tenant's rows. It must work for them, or the one account that can always
    reach it cannot."""
    session, _ = file_db
    super_admin = User(
        email="root@example.com",
        hashed_password=hash_password("Password123"),
        full_name="Root",
        role=Role.SUPER_ADMIN,
        business_id=None,
    )
    session.add(super_admin)
    session.commit()

    ctx = ServiceContext(session=session, user=super_admin, business_id=None)
    data = StorageStatsService(ctx).backup_database()
    assert data.startswith(b"SQLite format 3\x00")
