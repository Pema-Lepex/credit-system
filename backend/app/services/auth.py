"""Authentication: login, token rotation, password reset, tenant registration.

SECURITY NOTES (read before editing)
------------------------------------
* **No user enumeration.** "Unknown email" and "wrong password" produce the exact
  same error message, and the unknown-email path still runs a full bcrypt verify
  against a dummy hash. Skipping that verify would make a miss return in ~0.1 ms
  and a hit in ~250 ms, which is an oracle: an attacker can harvest your customer
  list by timing the login endpoint.
* **Refresh tokens are stored as digests.** A database leak yields nothing
  replayable. Rotation (revoke-on-use) means a stolen refresh token is usable at
  most once, and the legitimate user's next refresh fails -- a detectable event.
* **A password reset revokes every refresh token.** Resetting a password is what a
  user does when they believe they are compromised; leaving the attacker's session
  alive would make the reset theatre.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlmodel import Session, select

from app.core.config import settings
from app.core.errors import AuthenticationError, ConflictError, NotFoundError, ValidationError
from app.core.security import (
    Role,
    TokenError,
    TokenType,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.models.base import utcnow
from app.models.business import Business
from app.models.enums import AuditAction
from app.models.user import PasswordResetToken, RefreshToken, User
from app.services.base import BaseService
from app.utils.dates import ensure_utc

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION = timedelta(minutes=15)

# One message for every credential failure. Do not "helpfully" split this.
_INVALID_CREDENTIALS = "Incorrect email or password"

# A real bcrypt hash (cost 12, same as the app's) of a random value nobody knows.
# The unknown-email path verifies against it so a miss costs the same wall-clock
# time as a hit. It is a literal, not hash_password(...) at import time: hashing on
# import costs ~250 ms of startup and makes the module fail to import at all if the
# bcrypt backend is unhappy -- a password hash is not something a module should be
# computing just to be loaded.
_DUMMY_HASH = "$2b$12$eG/kUZOfxec5jniGVeC3p.JuesqNo2z9iWsYkhtsVZG7JZ88VOtb."


def validate_password(password: str) -> None:
    """Policy: >=8 characters, at least one letter and at least one digit.

    Deliberately modest. Byzantine rules (symbols, mixed case, no repeats) push
    shopkeepers toward Password1! on a sticky note; length plus a digit is the
    part that actually costs an attacker something.
    """
    if len(password) < 8:
        raise ValidationError("Password must be at least 8 characters long", field="password")
    if not any(c.isalpha() for c in password):
        raise ValidationError("Password must contain at least one letter", field="password")
    if not any(c.isdigit() for c in password):
        raise ValidationError("Password must contain at least one number", field="password")


def normalise_email(email: str) -> str:
    return email.strip().lower()


class AuthService(BaseService):
    # -- login ---------------------------------------------------------------
    def login(
        self,
        email: str,
        password: str,
        ip_address: str | None = None,
        user_agent: str | None = None,
    ) -> tuple[User, str, str]:
        """Returns (user, access_token, refresh_token)."""
        ip = ip_address or self.ctx.ip_address
        ua = user_agent or self.ctx.user_agent

        user = self._find_by_email(normalise_email(email))

        if user is None:
            # Burn the same time a real verify would, then fail identically.
            verify_password(password, _DUMMY_HASH)
            raise AuthenticationError(_INVALID_CREDENTIALS)

        now = datetime.now(UTC)
        if user.locked_until and ensure_utc(user.locked_until) > now:
            minutes = max(1, int((ensure_utc(user.locked_until) - now).total_seconds() // 60) + 1)
            raise AuthenticationError(
                f"Too many failed attempts. Try again in {minutes} minute(s)."
            )

        if not verify_password(password, user.hashed_password):
            self._register_failure(user, ip, ua)
            raise AuthenticationError(_INVALID_CREDENTIALS)

        if not user.is_active:
            raise AuthenticationError("This account has been deactivated")

        user.failed_login_attempts = 0
        user.locked_until = None
        user.last_login_at = now
        self.session.add(user)

        access, refresh = self._issue_pair(user, ip=ip, user_agent=ua)
        self.audit(
            AuditAction.LOGIN,
            "user",
            user.id,
            f"{user.email} signed in",
            business_id=user.business_id,
        )
        self.session.commit()
        self.session.refresh(user)
        return user, access, refresh

    def _register_failure(self, user: User, ip: str | None, ua: str | None) -> None:
        user.failed_login_attempts += 1
        locked = user.failed_login_attempts >= MAX_FAILED_ATTEMPTS
        if locked:
            user.locked_until = datetime.now(UTC) + LOCKOUT_DURATION
        self.session.add(user)
        self.audit(
            AuditAction.LOGIN_FAILED,
            "user",
            user.id,
            (
                f"Failed sign-in for {user.email}"
                f" (attempt {user.failed_login_attempts}{'; account locked' if locked else ''})"
            ),
            business_id=user.business_id,
        )
        # Commit BEFORE the caller raises: the counter is the lockout. If the error
        # path rolled this back, brute-forcing would be unlimited.
        self.session.commit()

    def _issue_pair(
        self, user: User, *, ip: str | None = None, user_agent: str | None = None
    ) -> tuple[str, str]:
        access = create_access_token(user.id, business_id=user.business_id, role=Role(user.role).value)
        refresh = create_refresh_token(
            user.id, business_id=user.business_id, role=Role(user.role).value
        )
        self.session.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(refresh),
                expires_at=utcnow() + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
                user_agent=(user_agent or None) and user_agent[:255],
                ip_address=ip,
            )
        )
        return access, refresh

    # -- refresh / logout ----------------------------------------------------
    def refresh(self, refresh_token: str) -> tuple[User, str, str]:
        """Rotate: the presented token is revoked and a brand-new pair is issued."""
        try:
            payload = decode_token(refresh_token, expected_type=TokenType.REFRESH)
        except TokenError as exc:
            raise AuthenticationError(str(exc)) from exc

        row = self._find_refresh_row(refresh_token)
        if row is None:
            raise AuthenticationError("Session is no longer valid. Please sign in again.")
        if row.revoked_at is not None:
            # Either a logout, or a replay of a token we already rotated away.
            raise AuthenticationError("Session is no longer valid. Please sign in again.")
        if ensure_utc(row.expires_at) <= datetime.now(UTC):
            raise AuthenticationError("Session has expired. Please sign in again.")

        user = self.session.get(User, payload.subject)
        if user is None or user.deleted_at is not None or not user.is_active:
            raise AuthenticationError("Session is no longer valid. Please sign in again.")

        row.revoked_at = utcnow()
        self.session.add(row)
        access, new_refresh = self._issue_pair(
            user, ip=self.ctx.ip_address, user_agent=self.ctx.user_agent
        )
        self.session.commit()
        return user, access, new_refresh

    def logout(self, refresh_token: str) -> None:
        """Idempotent: logging out an unknown or already-revoked token is a no-op."""
        row = self._find_refresh_row(refresh_token)
        if row is None or row.revoked_at is not None:
            return
        row.revoked_at = utcnow()
        self.session.add(row)
        user = self.session.get(User, row.user_id)
        if user is not None:
            self.audit(
                AuditAction.LOGOUT,
                "user",
                user.id,
                f"{user.email} signed out",
                business_id=user.business_id,
            )
        self.session.commit()

    def _find_refresh_row(self, raw_token: str) -> RefreshToken | None:
        return self.session.exec(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token))
        ).first()

    def revoke_all_sessions(self, user_id: str) -> int:
        """Revoke every live refresh token for a user. Returns how many."""
        rows = self.session.exec(
            select(RefreshToken).where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),  # type: ignore[union-attr]
            )
        ).all()
        now = utcnow()
        for row in rows:
            row.revoked_at = now
            self.session.add(row)
        return len(rows)

    # -- password reset ------------------------------------------------------
    def request_password_reset(self, email: str) -> tuple[User, str] | None:
        """Returns (user, raw_token) so the caller can email it -- or None.

        None means "no such account". The caller MUST render the same
        "if that address exists we have sent a link" response either way; branching
        on None in the UI would rebuild the enumeration oracle we just closed.
        """
        user = self._find_by_email(normalise_email(email))
        if user is None or not user.is_active:
            return None

        raw = create_password_reset_token(user.id)
        self.session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_token(raw),  # digest only -- same rule as refresh tokens
                expires_at=utcnow()
                + timedelta(minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
            )
        )
        self.session.commit()
        return user, raw

    def reset_password(self, token: str, new_password: str) -> User:
        try:
            payload = decode_token(token, expected_type=TokenType.PASSWORD_RESET)
        except TokenError as exc:
            raise AuthenticationError("This reset link is invalid or has expired") from exc

        row = self.session.exec(
            select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(token))
        ).first()
        if row is None or row.used_at is not None:
            raise AuthenticationError("This reset link is invalid or has expired")
        if ensure_utc(row.expires_at) <= datetime.now(UTC):
            raise AuthenticationError("This reset link is invalid or has expired")

        user = self.session.get(User, payload.subject)
        if user is None or user.deleted_at is not None:
            raise AuthenticationError("This reset link is invalid or has expired")

        validate_password(new_password)

        row.used_at = utcnow()            # single use
        user.hashed_password = hash_password(new_password)
        user.failed_login_attempts = 0    # a successful reset clears the lockout
        user.locked_until = None
        self.session.add(row)
        self.session.add(user)

        revoked = self.revoke_all_sessions(user.id)
        self.audit(
            AuditAction.PASSWORD_RESET,
            "user",
            user.id,
            f"Password reset for {user.email}; {revoked} session(s) revoked",
            business_id=user.business_id,
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def change_password(self, current_password: str, new_password: str) -> User:
        user = self.user
        if not verify_password(current_password, user.hashed_password):
            raise AuthenticationError("Your current password is incorrect")
        if current_password == new_password:
            raise ValidationError(
                "The new password must be different from the current one", field="new_password"
            )
        validate_password(new_password)

        user.hashed_password = hash_password(new_password)
        self.session.add(user)
        # Same reasoning as reset: a deliberate password change should not leave
        # older sessions (possibly on a lost device) alive.
        revoked = self.revoke_all_sessions(user.id)
        self.audit(
            AuditAction.PASSWORD_RESET,
            "user",
            user.id,
            f"Password changed by {user.email}; {revoked} session(s) revoked",
            business_id=user.business_id,
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    # -- registration --------------------------------------------------------
    def register_business(
        self,
        business_name: str,
        full_name: str,
        email: str,
        password: str,
    ) -> tuple[Business, User]:
        """Create a tenant and its first ADMIN in one transaction.

        Atomic on purpose: a Business with no user is an orphan nobody can sign in
        to and nothing will ever clean up.
        """
        from app.services.business import unique_slug  # local: avoids an import cycle

        name = business_name.strip()
        if not name:
            raise ValidationError("Business name is required", field="business_name")
        if not full_name.strip():
            raise ValidationError("Your name is required", field="full_name")

        addr = normalise_email(email)
        if "@" not in addr:
            raise ValidationError("Enter a valid email address", field="email")
        validate_password(password)

        if self._find_by_email(addr) is not None:
            raise ConflictError("An account with that email already exists", field="email")

        business = Business(name=name, slug=unique_slug(self.session, name), email=addr)
        self.session.add(business)
        self.session.flush()  # need business.id for the user row

        user = User(
            email=addr,
            hashed_password=hash_password(password),
            full_name=full_name.strip(),
            role=Role.ADMIN,          # whoever registers the shop owns it
            business_id=business.id,
            is_active=True,
        )
        self.session.add(user)
        self.session.flush()

        # Default email templates are another service's business. Optional import so
        # registration does not hard-depend on it existing yet.
        try:
            from app.services.templates import seed_default_templates

            seed_default_templates(self.session, business.id)
        except ImportError:
            pass

        self.audit(
            AuditAction.CREATE,
            "business",
            business.id,
            f"Business '{business.name}' registered by {user.email}",
            business_id=business.id,
        )
        self.session.commit()
        self.session.refresh(business)
        self.session.refresh(user)
        return business, user

    # -- helpers -------------------------------------------------------------
    def _find_by_email(self, email: str) -> User | None:
        return self.session.exec(
            select(User).where(
                User.email == email,
                User.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()

    def me(self) -> User:
        return self.user


def user_from_access_token(session: Session, token: str) -> User:
    """Resolve an access token to a live user.

    Lives here rather than in the GraphQL layer so the same rules (deleted, locked,
    deactivated) apply to every entry point, including future REST or CLI ones.
    """
    try:
        payload = decode_token(token, expected_type=TokenType.ACCESS)
    except TokenError as exc:
        raise AuthenticationError(str(exc)) from exc

    user = session.get(User, payload.subject)
    if user is None or user.deleted_at is not None:
        raise NotFoundError("Account not found")
    if not user.is_active:
        raise AuthenticationError("This account has been deactivated")
    return user
