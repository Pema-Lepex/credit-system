"""UserService -- staff and admin accounts inside a business.

PRIVILEGE-ESCALATION RULES (the whole point of this file)
---------------------------------------------------------
An ADMIN is the owner of ONE shop. Two things must therefore be impossible for
them, and both are enforced explicitly below rather than left to the permission
matrix:

  1. Minting a SUPER_ADMIN. USER_MANAGE lets an ADMIN create users; if the role
     field were taken at face value, any shop owner could POST role=SUPER_ADMIN and
     own the platform. Vertical privilege escalation.
  2. Setting a user's business_id. An ADMIN who could write that field could move
     themselves (or a puppet account) into another tenant, or drag a victim's
     account out of theirs. Horizontal escalation / cross-tenant access.

Both are checked on create AND on update -- the update path is the one people
forget, and it is the easier of the two to exploit.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import col, select

from app.core.errors import ConflictError, PermissionDeniedError, ValidationError
from app.core.security import Permission, Role, hash_password
from app.models.base import utcnow
from app.models.enums import AuditAction
from app.models.user import User
from app.services.auth import normalise_email, validate_password
from app.services.base import BaseService, diff_fields
from app.storage.service import StorageService
from app.utils.pagination import Page, PageInput, paginate

EDITABLE_FIELDS: frozenset[str] = frozenset(
    {"full_name", "phone", "avatar_file_id", "role", "is_active", "theme", "language"}
)

# Fields NOT on the allow-list above and named here for the reader's benefit:
#   business_id     -- see module docstring (horizontal escalation)
#   hashed_password -- changed only via AuthService.change_password / reset_password
#   email           -- changed via change_email(), which must re-check uniqueness


class UserService(BaseService):
    def __init__(self, ctx: Any) -> None:
        super().__init__(ctx)
        self.storage = StorageService(self.session)

    # -- read ----------------------------------------------------------------
    def get(self, user_id: str) -> User:
        self.require(Permission.USER_READ)
        return self.get_scoped(User, user_id, label="User")

    def list(
        self,
        page: PageInput | None = None,
        *,
        search: str | None = None,
        role: Role | str | None = None,
        is_active: bool | None = None,
    ) -> Page[User]:
        self.require(Permission.USER_READ)
        stmt = select(User).where(
            User.business_id == self.scope_id,
            User.deleted_at.is_(None),  # type: ignore[union-attr]
        )
        if search:
            like = f"%{search.strip()}%"
            stmt = stmt.where(
                col(User.full_name).ilike(like)
                | col(User.email).ilike(like)
                | col(User.phone).ilike(like)
            )
        if role is not None:
            stmt = stmt.where(User.role == Role(role))
        if is_active is not None:
            stmt = stmt.where(User.is_active == is_active)

        stmt = stmt.order_by(col(User.created_at).desc())
        return paginate(self.session, stmt, page or PageInput())

    # -- write ---------------------------------------------------------------
    def create(
        self,
        email: str,
        full_name: str,
        password: str,
        role: Role | str = Role.STAFF,
        *,
        phone: str | None = None,
        avatar_file_id: str | None = None,
        business_id: str | None = None,
    ) -> User:
        """Invite/create a user. ``business_id`` is honoured for SUPER_ADMIN only."""
        self.require(Permission.USER_MANAGE)
        target_role = self._coerce_role(role)

        if target_role is Role.SUPER_ADMIN:
            # Rule 1. Only the platform may create the platform's operators.
            if not self.is_super_admin:
                raise PermissionDeniedError("You are not allowed to create a platform administrator")
            target_business: str | None = None  # a SUPER_ADMIN belongs to no tenant
        else:
            # Rule 2. scope_id is the ONLY source of business_id for a non-superadmin;
            # a caller-supplied value that disagrees with it is rejected, never applied.
            if business_id and not self.is_super_admin and business_id != self.scope_id:
                raise PermissionDeniedError("You may only create users in your own business")
            target_business = business_id if self.is_super_admin else self.scope_id
            if not target_business:
                raise ValidationError("A business must be selected", field="business_id")

        addr = normalise_email(email)
        if "@" not in addr:
            raise ValidationError("Enter a valid email address", field="email")
        if not full_name.strip():
            raise ValidationError("Full name is required", field="full_name")
        validate_password(password)
        self._assert_email_free(addr)

        user = User(
            email=addr,
            hashed_password=hash_password(password),
            full_name=full_name.strip(),
            phone=phone,
            avatar_file_id=avatar_file_id,
            role=target_role,
            business_id=target_business,
            is_active=True,
        )
        self.session.add(user)
        self.session.flush()

        if avatar_file_id:
            self.storage.attach(avatar_file_id)

        self.audit(
            AuditAction.CREATE,
            "user",
            user.id,
            f"User {user.email} created as {target_role.value}",
            business_id=target_business,
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def update(self, user_id: str, **fields: Any) -> User:
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")

        payload = {k: v for k, v in fields.items() if k in EDITABLE_FIELDS}
        if not payload:
            return user

        if "role" in payload and payload["role"] is not None:
            new_role = self._coerce_role(payload["role"])
            # Rule 1 again, on the path people forget: an ADMIN must not be able to
            # promote anyone (including themselves) to SUPER_ADMIN.
            if new_role is Role.SUPER_ADMIN and not self.is_super_admin:
                raise PermissionDeniedError("You are not allowed to grant platform administrator")
            if Role(user.role) is Role.SUPER_ADMIN and not self.is_super_admin:
                raise PermissionDeniedError("You are not allowed to modify a platform administrator")
            payload["role"] = new_role

        if "is_active" in payload and not payload["is_active"] and self._is_self(user):
            # Deactivating yourself locks the last admin out of their own shop.
            raise ConflictError("You cannot deactivate your own account")

        if "full_name" in payload:
            name = str(payload["full_name"]).strip()
            if not name:
                raise ValidationError("Full name is required", field="full_name")
            payload["full_name"] = name

        before = {k: getattr(user, k) for k in payload}

        if "avatar_file_id" in payload and payload["avatar_file_id"] != user.avatar_file_id:
            self.storage.detach(user.avatar_file_id)
            self.storage.attach(payload["avatar_file_id"])

        for key, value in payload.items():
            setattr(user, key, value)
        self.session.add(user)

        self.audit(
            AuditAction.UPDATE,
            "user",
            user.id,
            f"User {user.email} updated",
            diff_fields(before, payload),
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def update_profile(self, **fields: Any) -> User:
        """Self-service edit. Cannot touch role or is_active -- only USER_MANAGE can."""
        user = self.user
        allowed = {"full_name", "phone", "avatar_file_id", "theme", "language"}
        payload = {k: v for k, v in fields.items() if k in allowed}
        if not payload:
            return user

        if "full_name" in payload:
            name = str(payload["full_name"]).strip()
            if not name:
                raise ValidationError("Full name is required", field="full_name")
            payload["full_name"] = name

        if "avatar_file_id" in payload and payload["avatar_file_id"] != user.avatar_file_id:
            self.storage.detach(user.avatar_file_id)
            self.storage.attach(payload["avatar_file_id"])

        before = {k: getattr(user, k) for k in payload}
        for key, value in payload.items():
            setattr(user, key, value)
        self.session.add(user)

        self.audit(
            AuditAction.UPDATE, "user", user.id, "Profile updated", diff_fields(before, payload)
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def change_email(self, user_id: str, new_email: str) -> User:
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")

        addr = normalise_email(new_email)
        if "@" not in addr:
            raise ValidationError("Enter a valid email address", field="email")
        if addr == user.email:
            return user
        self._assert_email_free(addr)

        old = user.email
        user.email = addr
        self.session.add(user)
        self.audit(
            AuditAction.UPDATE, "user", user.id, f"Email changed from {old}", {"email": [old, addr]}
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def set_password(self, user_id: str, new_password: str) -> User:
        """Admin-set password (a staff member who lost theirs and has no inbox)."""
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")
        validate_password(new_password)

        user.hashed_password = hash_password(new_password)
        user.failed_login_attempts = 0
        user.locked_until = None
        self.session.add(user)

        from app.services.auth import AuthService  # local: AuthService imports this module

        AuthService(self.ctx).revoke_all_sessions(user.id)

        self.audit(
            AuditAction.PASSWORD_RESET, "user", user.id, f"Password set by an administrator for {user.email}"
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def deactivate(self, user_id: str) -> User:
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")

        if self._is_self(user):
            raise ConflictError("You cannot deactivate your own account")
        if Role(user.role) is Role.SUPER_ADMIN and not self.is_super_admin:
            raise PermissionDeniedError("You are not allowed to modify a platform administrator")
        if not user.is_active:
            return user

        user.is_active = False
        self.session.add(user)

        # A deactivated user with a live refresh token keeps working for up to 30
        # days. Deactivation has to mean "signed out now".
        from app.services.auth import AuthService

        AuthService(self.ctx).revoke_all_sessions(user.id)

        self.audit(
            AuditAction.UPDATE,
            "user",
            user.id,
            f"User {user.email} deactivated",
            {"is_active": [True, False]},
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def activate(self, user_id: str) -> User:
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")
        if user.is_active:
            return user

        user.is_active = True
        user.failed_login_attempts = 0
        user.locked_until = None
        self.session.add(user)
        self.audit(
            AuditAction.UPDATE,
            "user",
            user.id,
            f"User {user.email} activated",
            {"is_active": [False, True]},
        )
        self.session.commit()
        self.session.refresh(user)
        return user

    def soft_delete(self, user_id: str) -> User:
        self.require(Permission.USER_MANAGE)
        user = self.get_scoped(User, user_id, label="User")

        if self._is_self(user):
            raise ConflictError("You cannot delete your own account")
        if Role(user.role) is Role.SUPER_ADMIN and not self.is_super_admin:
            raise PermissionDeniedError("You are not allowed to modify a platform administrator")

        user.deleted_at = utcnow()
        user.is_active = False
        self.session.add(user)
        self.storage.detach(user.avatar_file_id)

        from app.services.auth import AuthService

        AuthService(self.ctx).revoke_all_sessions(user.id)

        self.audit(AuditAction.DELETE, "user", user.id, f"User {user.email} deleted")
        self.session.commit()
        self.session.refresh(user)
        return user

    # -- helpers -------------------------------------------------------------
    def _is_self(self, user: User) -> bool:
        return self.ctx.user is not None and user.id == self.ctx.user.id

    def _assert_email_free(self, email: str) -> None:
        # Email is globally unique (it is the login identifier), so this check is
        # intentionally NOT business-scoped.
        existing = self.session.exec(
            select(User).where(
                User.email == email,
                User.deleted_at.is_(None),  # type: ignore[union-attr]
            )
        ).first()
        if existing is not None:
            raise ConflictError("An account with that email already exists", field="email")

    @staticmethod
    def _coerce_role(role: Role | str) -> Role:
        try:
            return Role(role)
        except ValueError as exc:
            raise ValidationError(f"Unknown role '{role}'", field="role") from exc
