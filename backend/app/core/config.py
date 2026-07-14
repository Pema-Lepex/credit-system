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

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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

    ``local`` writes to ``uploads/`` on disk. It is the free default, but it does
    NOT survive a Vercel/serverless deploy (ephemeral filesystem) -- see
    docs/DEPLOYMENT.md. ``s3`` covers AWS S3, Cloudflare R2, Supabase Storage and
    any other S3-compatible endpoint.
    """

    local = "local"
    s3 = "s3"


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
    CORS_ORIGINS: list[str] = Field(
    default_factory=lambda: [
        "http://localhost:3000",
        "https://credit-system-xi.vercel.app",
    ]
)

    # --- Database -----------------------------------------------------------
    # Default: file-backed SQLite inside /database. To migrate:
    #   Postgres : postgresql+psycopg://user:pass@host:5432/db
    #   Turso    : sqlite+libsql://<db>.turso.io?authToken=...
    DATABASE_URL: str = f"sqlite:///{ROOT_DIR / 'database' / 'app.db'}"
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 5          # ignored by SQLite, honoured by Postgres
    DB_MAX_OVERFLOW: int = 10

    # --- Storage ------------------------------------------------------------
    STORAGE_BACKEND: StorageBackend = StorageBackend.local
    UPLOAD_DIR: Path = ROOT_DIR / "uploads"
    PUBLIC_FILES_URL: str = "/api/files"       # how the frontend addresses a file
    MAX_UPLOAD_MB: int = 10
    IMAGE_MAX_DIMENSION: int = 1600            # long edge, px -- everything larger is downscaled
    IMAGE_QUALITY: int = 82                    # WebP/JPEG quality after compression
    THUMBNAIL_DIMENSION: int = 320             # long edge, px

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

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT is Environment.production

    def assert_production_ready(self) -> None:
        """Fail fast rather than run production on dev defaults."""
        if not self.is_production:
            return
        problems: list[str] = []
        if self.SECRET_KEY == "dev-only-insecure-secret-change-me":
            problems.append("SECRET_KEY is still the development placeholder")
        if self.DEBUG:
            problems.append("DEBUG must be false in production")
        if self.EMAIL_PROVIDER is EmailProvider.console:
            problems.append("EMAIL_PROVIDER=console will not deliver real mail")
        if problems:
            raise RuntimeError("Refusing to start in production: " + "; ".join(problems))


@lru_cache
def get_settings() -> Settings:
    """Cached accessor. Import this, never instantiate ``Settings()`` directly."""
    return Settings()


settings = get_settings()
