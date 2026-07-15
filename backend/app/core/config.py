"""Application configuration.

ARCHITECTURE NOTE
-----------------
Every environment-dependent value in this application funnels through this one
module. Nothing else in the codebase reads ``os.environ`` directly. That gives us
three properties we need for the "start free, migrate to cloud later" goal:

1. Swapping SQLite for Postgres/Turso/Supabase is a ``DATABASE_URL`` change.
2. Swapping local disk for S3/R2 is a ``STORAGE_BACKEND`` change.
3. Swapping the email provider is an ``EMAIL_PROVIDER`` change.

No secret is ever hardcoded; all of them are read from the environment (`.env`
locally, real env vars in production).
"""

from __future__ import annotations

from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

# Repo root = .../credit-system  (this file is backend/app/core/config.py)
BACKEND_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = BACKEND_DIR.parent


class Environment(str, Enum):
    development = "development"
    staging = "staging"
    production = "production"
    test = "test"


class StorageBackend(str, Enum):
    """Which object-storage driver to use.

    ``local``      writes to ``uploads/`` on disk. The zero-config default for
                   development. It does NOT survive a redeploy on an ephemeral host
                   (Render, Vercel, Fly): the container filesystem is rebuilt and
                   every uploaded photo is gone. Never use it in production.
    ``cloudinary`` the production default. Free tier, no card, and it serves images
                   over a CDN with on-the-fly transforms. Survives redeploys.
    ``s3``         AWS S3, Cloudflare R2, Supabase Storage, MinIO -- anything with an
                   S3-compatible endpoint.
    ``db``         stores file bytes in the SQL database itself (a ``stored_blob``
                   table). No external service, no extra credentials: if your
                   DATABASE_URL is persistent (Supabase/Neon/Render Postgres), your
                   files persist too, and survive redeploys on an ephemeral host.
                   Best for small artefacts (CSV/XLSX/PDF exports, logos); heavy
                   image galleries are better on cloudinary/s3 to keep the DB lean.

    All implement the same Protocol (app/storage/base.py), so no service, resolver
    or model changes when you switch.
    """

    local = "local"
    cloudinary = "cloudinary"
    s3 = "s3"
    db = "db"


class EmailProvider(str, Enum):
    """Outbound email driver.

    ``w3forms``  - free, zero-cost. IMPORTANT LIMITATION: W3Forms delivers only to
                   the inbox registered against the access key, so it can notify
                   the BUSINESS OWNER but cannot email an arbitrary customer.
    ``smtp``     - any SMTP server (Gmail, Brevo, Resend...). Required for
                   customer-facing reminders.
    ``console``  - writes the rendered email to the log. Used in dev/tests.
    """

    w3forms = "w3forms"
    smtp = "smtp"
    console = "console"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ----------------------------------------------------------------
    APP_NAME: str = "Credit Management System"
    ENVIRONMENT: Environment = Environment.development
    DEBUG: bool = True
    API_PREFIX: str = "/api"
    GRAPHQL_PATH: str = "/graphql"

    # --- Security -----------------------------------------------------------
    # MUST be overridden in production. The app refuses to boot in production
    # while this still holds the development placeholder (see validator below).
    SECRET_KEY: str = "dev-only-insecure-secret-change-me"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 30
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 60

    # Comma-separated in the env: CORS_ORIGINS=http://localhost:3000,https://app.example.com
    #
    # NoDecode is load-bearing. pydantic-settings treats any complex field (a list
    # here) as JSON and calls json.loads() on the raw env value INSIDE the settings
    # source -- i.e. before any field_validator runs. So the documented
    # comma-separated form raised SettingsError and took the whole app down at boot,
    # for both a .env file and a real env var. NoDecode switches that off and hands
    # the raw string to _split_origins below, which is what was meant to parse it.
    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "https://credit-system-xi.vercel.app",
        ]
    )

    # --- Database -----------------------------------------------------------
    # DEV default: file-backed SQLite in /database. Zero setup, and fine for one shop.
    #
    # PRODUCTION: set DATABASE_URL to a Postgres instance (Supabase / Neon / Render).
    # A local SQLite file on an ephemeral host is destroyed on every redeploy, taking
    # every customer and credit with it -- assert_production_ready() now refuses to
    # boot on that combination rather than let it happen quietly.
    #
    # Paste the connection string exactly as your provider gives it to you. Providers
    # hand out `postgres://…` or `postgresql://…`, and SQLAlchemy 2 maps the latter to
    # psycopg2 (which is not installed) and rejects the former outright. It is
    # normalised to `postgresql+psycopg://` for you -- see _normalise_database_url.
    DATABASE_URL: str = f"sqlite:///{ROOT_DIR / 'database' / 'app.db'}"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 5          # ignored by SQLite, honoured by Postgres
    DB_MAX_OVERFLOW: int = 10

    # --- Storage ------------------------------------------------------------
    STORAGE_BACKEND: StorageBackend = StorageBackend.local
    UPLOAD_DIR: Path = ROOT_DIR / "uploads"
    PUBLIC_FILES_URL: str = "/api/files"       # how the frontend addresses a file
    MAX_UPLOAD_MB: int = 25
    IMAGE_MAX_DIMENSION: int = 1600            # long edge, px -- everything larger is downscaled
    IMAGE_QUALITY: int = 82                    # WebP/JPEG quality after compression
    THUMBNAIL_DIMENSION: int = 320             # long edge, px

    # Cloudinary (only read when STORAGE_BACKEND=cloudinary).
    #
    # Either paste the single CLOUDINARY_URL from the dashboard --
    #     cloudinary://<api_key>:<api_secret>@<cloud_name>
    # -- or set the three parts separately. The single URL wins if both are present,
    # because that is the value Cloudinary actually shows you.
    CLOUDINARY_URL: str | None = None
    CLOUDINARY_CLOUD_NAME: str | None = None
    CLOUDINARY_API_KEY: str | None = None
    CLOUDINARY_API_SECRET: str | None = None
    # Every object is namespaced under this folder, so one Cloudinary account can host
    # staging and production without them overwriting each other's files.
    CLOUDINARY_FOLDER: str = "credit-system"

    # S3 / R2 / Supabase Storage (only read when STORAGE_BACKEND=s3)
    S3_ENDPOINT_URL: str | None = None
    S3_REGION: str = "auto"
    S3_BUCKET: str | None = None
    S3_ACCESS_KEY_ID: str | None = None
    S3_SECRET_ACCESS_KEY: str | None = None
    S3_PUBLIC_BASE_URL: str | None = None

    # --- Email --------------------------------------------------------------
    EMAIL_PROVIDER: EmailProvider = EmailProvider.console
    EMAIL_FROM_NAME: str = "Credit Management System"
    EMAIL_FROM_ADDRESS: str = "no-reply@localhost"

    W3FORMS_ACCESS_KEY: str | None = None
    W3FORMS_ENDPOINT: str = "https://api.web3forms.com/submit"

    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_USE_TLS: bool = True

    # --- Scheduler ----------------------------------------------------------
    SCHEDULER_ENABLED: bool = True
    SCHEDULER_TIMEZONE: str = "UTC"

    # Shared secret for the external cron endpoint (app/api/cron.py).
    #
    # WHY THIS EXISTS: APScheduler only fires while the process is alive, and a free
    # host (Render, Fly's scale-to-zero) suspends the process when nobody is
    # browsing. The suspended process runs no scheduler, so a due-date reminder whose
    # hour passes while the app is asleep is MISSED, not delayed. An external cron
    # service calling POST /api/cron/reminders hourly both wakes the process and runs
    # the sweep, which restores the product's core feature on a free tier.
    #
    # Unset => the endpoint returns 503 and runs nothing. It fails CLOSED: an
    # unauthenticated route that triggers email sends and a VACUUM is a gift to
    # anyone who finds it.
    CRON_SECRET: str | None = None
    # NOTE: there is deliberately no REMINDER_SCAN_HOUR here. The hour a reminder
    # goes out is a per-business decision (``Business.reminder_send_hour``, in that
    # business's own timezone) -- a single global hour would be wrong for every
    # tenant but one. The scheduler wakes hourly and asks each business whether it is
    # their hour; see app/scheduler/jobs.py.

    # --- Retention / storage hygiene ---------------------------------------
    # Likewise no DEFAULT_RETENTION_DAYS: retention is per-business
    # (``Business.retention_policy``), because it is the owner's data and the owner's
    # decision. The default for a new business is set on the model.
    EXPORT_TTL_HOURS: int = 24        # exported files self-destruct after this
    ARCHIVE_GRACE_DAYS: int = 7       # first "we will delete your data" warning

    # --- Pagination ---------------------------------------------------------
    DEFAULT_PAGE_SIZE: int = 25
    MAX_PAGE_SIZE: int = 100

    # --- Bootstrap superadmin (dev seed only) -------------------------------
    FIRST_SUPERADMIN_EMAIL: str = "admin@creditsystem.local"
    FIRST_SUPERADMIN_PASSWORD: str = "ChangeMe123!"

    # --- Super Admin (the platform operator) --------------------------------
    # The ONE platform administrator. Credentials are read from the environment and
    # are NEVER hardcoded in the frontend (the spec is explicit about this). On boot,
    # app.db.bootstrap.ensure_super_admin() reconciles a single SUPER_ADMIN user row
    # with these values -- creating it if missing, updating the password if it was
    # rotated -- so signing in as the super-admin goes through the ordinary JWT login
    # flow, not a special-cased credential check. Leave unset to run with no operator.
    SUPER_ADMIN_EMAIL: str | None = None
    SUPER_ADMIN_PASSWORD: str | None = None

    # W3Forms access key whose registered inbox is the super-admin's own. Used ONLY to
    # notify the operator when a new store owner registers. It is deliberately separate
    # from the per-business W3FORMS_ACCESS_KEY: with W3Forms the key IS the destination
    # inbox, and this destination is the platform operator, not any single tenant.
    SUPER_ADMIN_W3FORMS_ACCESS_KEY: str | None = None

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def _normalise_database_url(cls, v: object) -> object:
        """Accept the connection string providers actually hand out.

        Supabase, Render and Heroku give you one of:

            postgres://user:pass@host:5432/db        <- SQLAlchemy 2 rejects this scheme
            postgresql://user:pass@host:5432/db      <- routes to psycopg2, not installed

        Both are normalised to `postgresql+psycopg://`, which is psycopg 3 (what we
        install). Doing it here means nobody has to hand-edit a secret they copied out
        of a dashboard, and a paste-as-given cannot fail at boot with a driver error
        that says nothing about the real problem.

        A URL that already names a driver (`postgresql+psycopg://`, `sqlite://`,
        `sqlite+libsql://` for Turso) is passed through untouched.
        """
        if not isinstance(v, str):
            return v
        url = v.strip()

        if url.startswith("postgres://"):
            url = "postgresql+psycopg://" + url[len("postgres://"):]
        elif url.startswith("postgresql://"):
            url = "postgresql+psycopg://" + url[len("postgresql://"):]

        # Query-param cleanup applies ONLY to Postgres URLs, and must not run on a
        # sqlite URL: urlparse/urlunparse round-trips `sqlite:///path` (empty netloc)
        # back as `sqlite:/path`, dropping two slashes and breaking the connection.
        # Postgres URLs have a real netloc, so they survive the round-trip intact.
        if url.startswith("postgresql"):
            parsed = urlparse(url)
            query = parse_qs(parsed.query)
            # Supabase's pooler appends ?pgbouncer=true (a Prisma-ism); libpq/psycopg
            # does not know it and would reject the connection.
            query.pop("pgbouncer", None)
            url = urlunparse(parsed._replace(query=urlencode(query, doseq=True)))

        return url

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        """Accept both `a,b` and `["a","b"]` -- deployment dashboards encourage either."""
        if isinstance(v, str):
            raw = v.strip()
            if raw.startswith("["):
                import json

                try:
                    parsed = json.loads(raw)
                except ValueError:
                    pass
                else:
                    if isinstance(parsed, list):
                        return [str(o).strip() for o in parsed if str(o).strip()]
            return [o.strip() for o in raw.split(",") if o.strip()]
        return v

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT is Environment.production

    def assert_production_ready(self) -> None:
        """Fail fast rather than run production on dev defaults.

        The two data-loss checks below are new and are the point of this guard. Both
        configurations "work" -- the app boots, serves traffic and looks healthy -- and
        then silently destroy every customer, credit and photo on the next redeploy,
        because an ephemeral host rebuilds its filesystem. A crash at boot is a far
        better outcome than discovering that a week later.
        """
        if not self.is_production:
            return
        problems: list[str] = []
        if self.SECRET_KEY == "dev-only-insecure-secret-change-me":
            problems.append("SECRET_KEY is still the development placeholder")
        if self.DEBUG:
            problems.append("DEBUG must be false in production")
        if self.EMAIL_PROVIDER is EmailProvider.console:
            problems.append("EMAIL_PROVIDER=console will not deliver real mail")

        if self.is_sqlite:
            problems.append(
                "DATABASE_URL points at SQLite. On an ephemeral host (Render/Fly/"
                "Vercel) the database file is destroyed on every redeploy and ALL DATA "
                "IS LOST. Point DATABASE_URL at Postgres (Supabase/Neon/Render)"
            )
        if self.STORAGE_BACKEND is StorageBackend.local:
            problems.append(
                "STORAGE_BACKEND=local writes uploads to the container filesystem, "
                "which is wiped on every redeploy. Use STORAGE_BACKEND=cloudinary (or s3)"
            )
        # Selecting a backend but not configuring it is the subtler trap: the app boots,
        # then throws on the first request that renders any file URL. Catch it here so a
        # misconfiguration is a loud boot failure, not a mystery 500 on signup.
        if self.STORAGE_BACKEND is StorageBackend.cloudinary and not (
            self.CLOUDINARY_URL
            or (self.CLOUDINARY_CLOUD_NAME and self.CLOUDINARY_API_KEY and self.CLOUDINARY_API_SECRET)
        ):
            problems.append(
                "STORAGE_BACKEND=cloudinary but no credentials are set. Add CLOUDINARY_URL "
                "(cloudinary://key:secret@cloud-name from your Cloudinary dashboard)"
            )
        if self.STORAGE_BACKEND is StorageBackend.s3 and not self.S3_BUCKET:
            problems.append("STORAGE_BACKEND=s3 but S3_BUCKET is not set")

        if problems:
            raise RuntimeError("Refusing to start in production: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. Import this, never instantiate ``Settings()`` directly."""
    return Settings()


settings = get_settings()
