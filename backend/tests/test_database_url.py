"""DATABASE_URL normalisation.

Providers hand out connection strings in forms SQLAlchemy 2 will not accept:

    postgres://…      -> SQLAlchemy removed this alias; it raises outright
    postgresql://…    -> resolves to psycopg2, which we do NOT install (we use psycopg 3)

Both must be rewritten to `postgresql+psycopg://`, or a correctly-pasted Supabase URL
fails at boot with a driver error that says nothing about the real problem. This is the
single most common way this migration goes wrong, so it is pinned here.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings

PG = "user:pw@db.abc.supabase.co:5432/postgres"


@pytest.mark.parametrize(
    "given",
    [
        f"postgres://{PG}",  # Supabase / Heroku style
        f"postgresql://{PG}",  # Render / psql style
        f"postgresql+psycopg://{PG}",  # already correct -- must be left alone
    ],
)
def test_every_postgres_form_lands_on_psycopg3(given: str) -> None:
    assert Settings(DATABASE_URL=given).DATABASE_URL == f"postgresql+psycopg://{PG}"


def test_query_parameters_survive() -> None:
    """Supabase appends ?sslmode=require; dropping it breaks the connection."""
    settings = Settings(DATABASE_URL=f"postgres://{PG}?sslmode=require")
    assert settings.DATABASE_URL.endswith("?sslmode=require")
    assert settings.DATABASE_URL.startswith("postgresql+psycopg://")


def test_sqlite_is_untouched() -> None:
    settings = Settings(DATABASE_URL="sqlite:///./database/app.db")
    assert settings.DATABASE_URL == "sqlite:///./database/app.db"
    assert settings.is_sqlite is True


def test_turso_url_is_untouched() -> None:
    """A URL that already names its driver must pass through verbatim."""
    url = "sqlite+libsql://db.turso.io?authToken=xyz"
    assert Settings(DATABASE_URL=url).DATABASE_URL == url


def test_postgres_is_not_reported_as_sqlite() -> None:
    assert Settings(DATABASE_URL=f"postgres://{PG}").is_sqlite is False


# --- the production data-loss guards ---------------------------------------
def test_production_refuses_sqlite() -> None:
    """SQLite on an ephemeral host silently loses every row on redeploy."""
    settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        SECRET_KEY="a-real-secret",
        EMAIL_PROVIDER="smtp",
        DATABASE_URL="sqlite:///./database/app.db",
        STORAGE_BACKEND="cloudinary",
    )
    with pytest.raises(RuntimeError, match="ALL DATA IS LOST"):
        settings.assert_production_ready()


def test_production_refuses_local_storage() -> None:
    settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        SECRET_KEY="a-real-secret",
        EMAIL_PROVIDER="smtp",
        DATABASE_URL=f"postgres://{PG}",
        STORAGE_BACKEND="local",
    )
    with pytest.raises(RuntimeError, match="wiped on every redeploy"):
        settings.assert_production_ready()


def test_a_correct_production_config_boots() -> None:
    settings = Settings(
        ENVIRONMENT="production",
        DEBUG=False,
        SECRET_KEY="a-real-secret",
        EMAIL_PROVIDER="smtp",
        DATABASE_URL=f"postgres://{PG}",
        STORAGE_BACKEND="cloudinary",
    )
    settings.assert_production_ready()  # must not raise
