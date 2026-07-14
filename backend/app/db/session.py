"""Engine + session factory.

ARCHITECTURE NOTE — why this file exists
----------------------------------------
This is the ONLY module that knows which database we are talking to. Services and
GraphQL resolvers receive a ``Session`` and never construct engines, so migrating
SQLite -> Postgres/Turso/Supabase means changing ``DATABASE_URL`` and installing a
driver. The SQLite-specific tuning below is applied conditionally and is inert on
other backends.

SQLite tuning applied on every connection:
  * WAL journal      - readers don't block the writer (dashboard reads during a
                       scheduler write).
  * foreign_keys=ON  - SQLite disables FK enforcement per-connection by default,
                       which would silently break our cascade rules.
  * busy_timeout     - wait instead of instantly raising "database is locked" when
                       APScheduler and a request contend for the write lock.
"""

from __future__ import annotations

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from sqlalchemy import Engine, event, text
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.core.config import settings


def _engine_kwargs() -> dict[str, Any]:
    if settings.is_sqlite:
        # ``check_same_thread=False``: APScheduler's worker threads and FastAPI's
        # threadpool both touch the DB. Safety is preserved because a Session is
        # never shared across threads -- each gets its own from the factory.
        kwargs: dict[str, Any] = {
            "connect_args": {"check_same_thread": False, "timeout": 30},
            "echo": settings.DB_ECHO,
        }
        if ":memory:" in settings.DATABASE_URL:
            # Tests: keep one connection alive so the in-memory DB survives.
            kwargs["poolclass"] = StaticPool
        return kwargs

    # Server-based databases (Postgres, MySQL...): use a real connection pool.
    return {
        "echo": settings.DB_ECHO,
        "pool_size": settings.DB_POOL_SIZE,
        "max_overflow": settings.DB_MAX_OVERFLOW,
        "pool_pre_ping": True,   # transparently recycle connections dropped by the server
    }


def _ensure_sqlite_dir() -> None:
    """SQLite will not create a missing parent directory for us."""
    if not settings.is_sqlite or ":memory:" in settings.DATABASE_URL:
        return
    db_path = settings.DATABASE_URL.split("sqlite:///", 1)[-1]
    Path(db_path).expanduser().parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_dir()
engine: Engine = create_engine(settings.DATABASE_URL, **_engine_kwargs())


@event.listens_for(engine, "connect")
def _configure_sqlite(dbapi_connection: Any, _record: Any) -> None:
    if not settings.is_sqlite:
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA synchronous=NORMAL")  # durable enough with WAL, much faster
    cursor.close()


def get_session() -> Generator[Session, None, None]:
    """FastAPI dependency. One session per request, always closed."""
    with Session(engine) as session:
        yield session


@contextmanager
def session_scope() -> Generator[Session, None, None]:
    """Transactional scope for background jobs and scripts (not requests).

    Commits on success, rolls back on exception. Scheduler jobs use this so a
    half-finished maintenance run never leaves partial writes behind.
    """
    session = Session(engine)
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db() -> None:
    """Create tables from the SQLModel metadata.

    Fine for development and first boot. Alembic owns schema changes from there --
    see docs/INSTALLATION.md. Importing ``app.models`` is what registers every
    table on ``SQLModel.metadata``, so the import is load-bearing, not cosmetic.
    """
    import app.models  # noqa: F401  (registers all tables)

    SQLModel.metadata.create_all(engine)


def check_database() -> bool:
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))  # type: ignore[call-overload]
        return True
    except Exception:
        return False
