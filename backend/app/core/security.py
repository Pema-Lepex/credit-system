"""Password hashing, JWT issuing/verification, and the permission matrix.

ARCHITECTURE NOTE
-----------------
Authorisation is expressed as an explicit ROLE -> PERMISSION matrix rather than
scattered ``if user.role == "admin"`` checks. Resolvers ask
``require(user, Permission.CREDIT_DELETE)`` and never reason about roles
themselves, so adding a role later (e.g. "Accountant") touches only this file.

Tenancy: every non-superadmin user belongs to exactly one business, and every
query is scoped by ``business_id``. Superadmin is the only role that may cross
business boundaries.
"""

from __future__ import annotations

import base64
import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import Enum

import bcrypt
import jwt

from app.core.config import settings

# WHY NOT passlib
# ---------------
# passlib is the usual choice here, but it has been unmaintained since 2020 and its
# bcrypt backend probes the driver at import time with a >72-byte password. bcrypt
# 4.1+ raises on that instead of truncating, so `import passlib` now dies with
# "password cannot be longer than 72 bytes" before any of our code runs. We call the
# bcrypt library directly: one less dependency, and no version-detection landmine.

_BCRYPT_ROUNDS = 12  # ~250ms/hash. Slow enough to hurt an offline cracker.


# ---------------------------------------------------------------------------
# Roles & permissions
# ---------------------------------------------------------------------------
class Role(str, Enum):
    SUPER_ADMIN = "SUPER_ADMIN"   # platform operator: sees every business
    ADMIN = "ADMIN"               # business owner: full control of one business
    STAFF = "STAFF"               # employee: day-to-day credit/payment entry


class Permission(str, Enum):
    # Business
    BUSINESS_READ = "business:read"
    BUSINESS_UPDATE = "business:update"
    BUSINESS_CREATE = "business:create"
    BUSINESS_DELETE = "business:delete"
    # Users
    USER_READ = "user:read"
    USER_MANAGE = "user:manage"
    # Customers
    CUSTOMER_READ = "customer:read"
    CUSTOMER_WRITE = "customer:write"
    CUSTOMER_DELETE = "customer:delete"
    # Catalog
    CATALOG_READ = "catalog:read"
    CATALOG_WRITE = "catalog:write"
    CATALOG_DELETE = "catalog:delete"
    # Credits
    CREDIT_READ = "credit:read"
    CREDIT_WRITE = "credit:write"
    CREDIT_DELETE = "credit:delete"
    # Payments
    PAYMENT_READ = "payment:read"
    PAYMENT_WRITE = "payment:write"
    PAYMENT_DELETE = "payment:delete"
    # Reports & exports
    REPORT_READ = "report:read"
    EXPORT_CREATE = "export:create"
    # Settings / templates / reminders
    SETTINGS_READ = "settings:read"
    SETTINGS_WRITE = "settings:write"
    TEMPLATE_WRITE = "template:write"
    REMINDER_SEND = "reminder:send"
    # Storage & retention (destructive)
    STORAGE_READ = "storage:read"
    STORAGE_MAINTAIN = "storage:maintain"
    RETENTION_MANAGE = "retention:manage"
    # Audit
    AUDIT_READ = "audit:read"


_STAFF_PERMISSIONS: frozenset[Permission] = frozenset(
    {
        Permission.BUSINESS_READ,
        Permission.CUSTOMER_READ,
        Permission.CUSTOMER_WRITE,
        Permission.CATALOG_READ,
        Permission.CREDIT_READ,
        Permission.CREDIT_WRITE,
        Permission.PAYMENT_READ,
        Permission.PAYMENT_WRITE,
        Permission.REPORT_READ,
        Permission.SETTINGS_READ,
        Permission.STORAGE_READ,
    }
)

# Admin = everything a staff member can do, plus destructive + configuration
# operations, minus cross-business platform administration.
_ADMIN_PERMISSIONS: frozenset[Permission] = _STAFF_PERMISSIONS | frozenset(
    {
        Permission.BUSINESS_UPDATE,
        Permission.USER_READ,
        Permission.USER_MANAGE,
        Permission.CUSTOMER_DELETE,
        Permission.CATALOG_WRITE,
        Permission.CATALOG_DELETE,
        Permission.CREDIT_DELETE,
        Permission.PAYMENT_DELETE,
        Permission.EXPORT_CREATE,
        Permission.SETTINGS_WRITE,
        Permission.TEMPLATE_WRITE,
        Permission.REMINDER_SEND,
        Permission.STORAGE_MAINTAIN,
        Permission.RETENTION_MANAGE,
        Permission.AUDIT_READ,
    }
)

_SUPER_ADMIN_PERMISSIONS: frozenset[Permission] = frozenset(Permission)

ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.STAFF: _STAFF_PERMISSIONS,
    Role.ADMIN: _ADMIN_PERMISSIONS,
    Role.SUPER_ADMIN: _SUPER_ADMIN_PERMISSIONS,
}


def permissions_for(role: Role | str) -> frozenset[Permission]:
    return ROLE_PERMISSIONS.get(Role(role), frozenset())


def has_permission(role: Role | str, permission: Permission) -> bool:
    return permission in permissions_for(role)


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def _prehash(password: str) -> bytes:
    """SHA-256 -> base64, so bcrypt's 72-byte ceiling never silently truncates.

    bcrypt ignores everything past byte 72. Without a pre-hash, two different long
    passphrases sharing a 72-byte prefix would be the SAME password -- and a user who
    pastes a 100-character generated secret gets 28 characters of it thrown away.

    base64 of the digest is 44 bytes (hex would be 64 -- also under the limit, but
    closer to it for no benefit). Base64 is used rather than the raw digest because
    bcrypt truncates at the first NUL byte, which a raw digest can contain.
    """
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        # A malformed/legacy hash in the DB must read as "wrong password", not crash
        # the login endpoint.
        return False


# A pre-computed hash of a random string. AuthService verifies against this when the
# email doesn't exist, so a bad-username login costs the same ~250ms as a bad-password
# one. Without it, response time is an oracle for "is this address registered?".
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(32))


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
class TokenType(str, Enum):
    ACCESS = "access"
    REFRESH = "refresh"
    PASSWORD_RESET = "password_reset"


@dataclass(frozen=True, slots=True)
class TokenPayload:
    subject: str            # user id
    token_type: TokenType
    business_id: str | None
    role: str | None
    jti: str
    expires_at: datetime


def _create_token(
    subject: str,
    token_type: TokenType,
    expires_delta: timedelta,
    *,
    business_id: str | None = None,
    role: str | None = None,
) -> str:
    now = datetime.now(UTC)
    expire = now + expires_delta
    payload = {
        "sub": subject,
        "type": token_type.value,
        "bid": business_id,
        "role": role,
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def create_access_token(subject: str, *, business_id: str | None, role: str) -> str:
    return _create_token(
        subject,
        TokenType.ACCESS,
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        business_id=business_id,
        role=role,
    )


def create_refresh_token(subject: str, *, business_id: str | None, role: str) -> str:
    return _create_token(
        subject,
        TokenType.REFRESH,
        timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        business_id=business_id,
        role=role,
    )


def create_password_reset_token(subject: str) -> str:
    return _create_token(
        subject,
        TokenType.PASSWORD_RESET,
        timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
    )


class TokenError(Exception):
    """Raised when a token is malformed, expired, or of the wrong type."""


def decode_token(token: str, *, expected_type: TokenType | None = None) -> TokenPayload:
    try:
        raw = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired") from exc
    except jwt.PyJWTError as exc:
        raise TokenError("Token is invalid") from exc

    token_type = TokenType(raw.get("type", ""))
    if expected_type is not None and token_type is not expected_type:
        raise TokenError(f"Expected a {expected_type.value} token, got {token_type.value}")

    return TokenPayload(
        subject=str(raw["sub"]),
        token_type=token_type,
        business_id=raw.get("bid"),
        role=raw.get("role"),
        jti=raw.get("jti", ""),
        expires_at=datetime.fromtimestamp(raw["exp"], tz=UTC),
    )


def hash_token(token: str) -> str:
    """Refresh/reset tokens are stored as digests so a DB leak can't replay them."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_secret(length: int = 32) -> str:
    return secrets.token_urlsafe(length)
