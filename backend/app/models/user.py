"""Users, refresh tokens, and password-reset tokens.

No ``from __future__ import annotations`` here -- see the note in models/business.py.
It breaks SQLModel's Relationship resolution.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship

from app.core.security import Role
from app.models.base import BaseEntity, TimestampMixin, TZDateTime, UUIDMixin

if TYPE_CHECKING:
    from app.models.business import Business


class User(BaseEntity, table=True):
    __tablename__ = "user"

    email: str = Field(unique=True, index=True, max_length=255)
    hashed_password: str = Field(max_length=255)
    full_name: str = Field(max_length=160)
    phone: str | None = Field(default=None, max_length=40)
    # Not a FK, for the same reason as Business.logo_file_id -- FileAsset points back
    # at User (uploaded_by_user_id), and the cycle breaks CREATE TABLE on PostgreSQL.
    avatar_file_id: str | None = Field(default=None, index=True, max_length=32)

    role: Role = Field(default=Role.STAFF, max_length=20, index=True)

    # NULL only for SUPER_ADMIN, who operates above any single business.
    business_id: str | None = Field(
        default=None, foreign_key="business.id", index=True, max_length=32, ondelete="CASCADE"
    )

    is_active: bool = Field(default=True, index=True)
    last_login_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]

    # Brute-force defence: N failed attempts locks the account until `locked_until`.
    failed_login_attempts: int = Field(default=0)
    locked_until: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]

    # UI preferences -- kept on the user, not the business, because two staff at the
    # same shop can want different themes.
    theme: str = Field(default="system", max_length=10)   # light | dark | system
    language: str = Field(default="en", max_length=10)

    # Optional["Business"], not "Business | None": a PEP-604 union inside a string is
    # one opaque ForwardRef that SQLModel cannot unwrap. Optional[] keeps the
    # forward reference resolvable against SQLAlchemy's registry.
    business: Optional["Business"] = Relationship(
        back_populates="users",
        sa_relationship_kwargs={"foreign_keys": "User.business_id"},
    )

    @property
    def is_super_admin(self) -> bool:
        return Role(self.role) is Role.SUPER_ADMIN


class RefreshToken(UUIDMixin, TimestampMixin, table=True):
    """Server-side refresh-token registry.

    ARCHITECTURE NOTE: JWTs are stateless and cannot be un-issued, so a stolen
    refresh token would be valid until it expires. Persisting a *digest* of each
    refresh token gives us real revocation (logout, password change, admin kill)
    while a DB leak still yields nothing replayable.
    """

    __tablename__ = "refresh_token"

    user_id: str = Field(foreign_key="user.id", index=True, max_length=32, ondelete="CASCADE")
    token_hash: str = Field(unique=True, index=True, max_length=64)  # sha256 hex
    expires_at: datetime = Field(sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    revoked_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    user_agent: str | None = Field(default=None, max_length=255)
    ip_address: str | None = Field(default=None, max_length=45)


class PasswordResetToken(UUIDMixin, TimestampMixin, table=True):
    __tablename__ = "password_reset_token"

    user_id: str = Field(foreign_key="user.id", index=True, max_length=32, ondelete="CASCADE")
    token_hash: str = Field(unique=True, index=True, max_length=64)
    expires_at: datetime = Field(sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    used_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
