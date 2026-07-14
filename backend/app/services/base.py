"""ServiceContext and BaseService -- the seam every service sits on.

ARCHITECTURE NOTE — why a context object instead of loose arguments
-------------------------------------------------------------------
Every mutating operation needs the same four things: a session, who is acting,
which tenant they are acting on, and where the request came from (for the audit
trail). Threading those through as four parameters means every new service method
re-derives them, and one forgotten ``business_id`` filter is a cross-tenant data
leak. ``ServiceContext`` makes them one object, and ``BaseService.scope_id`` makes
"which business may this caller touch" a single, auditable decision.

The scheduler builds a ``ServiceContext`` with ``user=None`` and an explicit
``business_id``; there is no HTTP request involved, and nothing here imports one.

TRANSACTIONS: services are the transaction boundary -- a mutating method commits
before it returns. That is not incidental: ``AuthService.login`` must persist a
failed-attempt counter *and then raise*, and a caller-owned transaction would roll
that write back, quietly disabling account lockout.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, TypeVar

from sqlmodel import Session

from app.core.errors import (
    AuthenticationError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.core.security import Permission, Role, has_permission
from app.models.enums import AuditAction
from app.models.retention import AuditLog
from app.models.user import User

if TYPE_CHECKING:
    from app.models.business import Business

T = TypeVar("T")


@dataclass(slots=True)
class ServiceContext:
    """Everything a service call needs to know about its caller.

    ``business_id`` is the tenant the caller *asked* to act on. It is a request,
    not a grant -- ``BaseService.scope_id`` decides whether it is honoured.
    """

    session: Session
    user: User | None = None
    business_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None

    # SECURITY: the system-actor flag. Set to True ONLY by app/scheduler/jobs.py.
    #
    # It is deliberately an explicit flag rather than being inferred from
    # `user is None`. An anonymous GraphQL request ALSO has user=None -- inferring
    # system identity from a missing user would hand every unauthenticated caller a
    # permission bypass, which is precisely the bug this flag exists to prevent.
    # app/graphql/context.py never sets it, and there is no code path from an HTTP
    # request that can.
    system: bool = False

    @property
    def actor_label(self) -> str:
        if self.user:
            return self.user.full_name
        return "scheduler" if self.system else "system"

    @property
    def is_system(self) -> bool:
        """True when a background job (not a person) is the actor.

        Jobs must call the very same services a human does -- promote_overdue,
        archive_eligible, purge_due. Rather than duplicating every service with a
        "system" variant, or inventing a fake superuser row (which would then be a
        real, loginable account with every destructive permission granted), the
        scheduler declares itself.
        """
        return self.system


class BaseService:
    def __init__(self, ctx: ServiceContext) -> None:
        self.ctx = ctx
        self.session: Session = ctx.session
        self._business: Business | None = None

    # -- identity ------------------------------------------------------------
    @property
    def user(self) -> User:
        if self.ctx.user is None:
            raise AuthenticationError("Authentication is required")
        return self.ctx.user

    @property
    def is_super_admin(self) -> bool:
        return self.ctx.user is not None and Role(self.ctx.user.role) is Role.SUPER_ADMIN

    # -- authorisation -------------------------------------------------------
    def require(self, permission: Permission) -> User | None:
        """Assert the caller holds ``permission``.

        The scheduler (ctx.is_system) is exempt: it is not reachable from an HTTP
        request, it already had to name a business explicitly, and gating it behind a
        permission would mean granting some account every destructive permission in
        the system just so a cron job can run.
        """
        if self.ctx.is_system:
            return None

        user = self.user
        if not user.is_active:
            raise AuthenticationError("This account has been deactivated")
        if not has_permission(user.role, permission):
            raise PermissionDeniedError(
                f"Your role ({Role(user.role).value}) is not allowed to {permission.value}"
            )
        return user

    @property
    def scope_id(self) -> str:
        """The one business_id this caller is permitted to read or write.

        THIS IS THE TENANCY BOUNDARY. Every query in every service filters on it.

        * SUPER_ADMIN operates above the tenants, so it may nominate any business
          via ``ctx.business_id``.
        * ADMIN and STAFF are pinned to ``user.business_id``. A supplied
          ``ctx.business_id`` that disagrees is not ignored -- it is rejected. A
          silent fallback would turn a probing client into a silent no-op instead
          of a logged failure, and would let a bug in the GraphQL layer (passing an
          attacker-controlled id through) go unnoticed.
        * The scheduler names its business explicitly, one tenant at a time.
        """
        if self.ctx.is_system:
            if not self.ctx.business_id:
                # A global job (temp-file cleanup) has no tenant and must not be able
                # to reach tenant-scoped queries by accident.
                raise ValidationError(
                    "This operation is tenant-scoped; the job did not name a business",
                    field="business_id",
                )
            return self.ctx.business_id

        user = self.user

        if Role(user.role) is Role.SUPER_ADMIN:
            if not self.ctx.business_id:
                raise ValidationError(
                    "A business must be selected before performing this action",
                    field="business_id",
                )
            return self.ctx.business_id

        if not user.business_id:
            raise PermissionDeniedError("This account is not attached to a business")
        if self.ctx.business_id and self.ctx.business_id != user.business_id:
            raise PermissionDeniedError("Cross-business access is not permitted")
        return user.business_id

    def get_scoped(self, model: type[T], entity_id: str, *, label: str | None = None) -> T:
        """Fetch a tenant-owned row, or raise NotFound.

        A row belonging to another business raises NotFound, NOT Forbidden: telling
        a caller "that exists but isn't yours" confirms the existence of another
        tenant's record, which is itself a leak.
        """
        name = label or model.__name__
        obj = self.session.get(model, entity_id)
        if (
            obj is None
            or getattr(obj, "deleted_at", None) is not None
            or getattr(obj, "business_id", None) != self.scope_id
        ):
            raise NotFoundError(f"{name} not found", code="NOT_FOUND")
        return obj

    def assert_in_scope(self, business_id: str | None) -> None:
        """Guard for a row fetched by primary key.

        ``session.get(Credit, id)`` bypasses every WHERE clause, so a caller who
        guesses (or enumerates) another tenant's UUID would otherwise read it. Every
        get-by-id path in every service calls this immediately after the fetch.

        Raises NotFound, not Forbidden: "that exists but isn't yours" confirms the
        existence of another tenant's record, which is itself a leak.
        """
        if business_id != self.scope_id:
            raise NotFoundError("Not found")

    def get_business(self) -> "Business":
        """The tenant this call is acting on. Cached per service instance."""
        from app.models.business import Business  # local: avoids a model<->service cycle

        if self._business is None or self._business.id != self.scope_id:
            business = self.session.get(Business, self.scope_id)
            if business is None or business.deleted_at is not None:
                raise NotFoundError("Business not found")
            self._business = business
        return self._business

    # -- audit ---------------------------------------------------------------
    def audit(
        self,
        action: AuditAction,
        entity_type: str,
        entity_id: str | None,
        summary: str,
        changes: dict[str, Any] | None = None,
        *,
        business_id: str | None = None,
    ) -> AuditLog | None:
        """Append to the audit trail.

        Returns None -- writing nothing -- when there is no tenant to file the entry
        under (a SUPER_ADMIN platform action, or a failed login for an address that
        matches no user). AuditLog is tenant-scoped by design; inventing a
        business_id to satisfy the FK would corrupt the very trail we are keeping.
        """
        bid = business_id or self._audit_business_id()
        if not bid:
            return None

        entry = AuditLog(
            business_id=bid,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            summary=summary[:500],
            changes=changes or {},
            actor_user_id=self.ctx.user.id if self.ctx.user else None,
            actor_label=self.ctx.actor_label[:160],
            ip_address=self.ctx.ip_address,
            user_agent=(self.ctx.user_agent or None) and self.ctx.user_agent[:255],
        )
        self.session.add(entry)
        return entry

    def _audit_business_id(self) -> str | None:
        """Best-effort tenant for an audit row; never raises (auditing must not fail
        an otherwise-valid operation)."""
        if self.ctx.user and self.ctx.user.business_id:
            return self.ctx.user.business_id
        return self.ctx.business_id


def diff_fields(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """{field: [before, after]} for the fields that actually changed.

    Matches AuditLog.changes: a diff, not a row snapshot.
    """
    out: dict[str, Any] = {}
    for key, new in after.items():
        old = before.get(key)
        if old != new:
            out[key] = [_jsonable(old), _jsonable(new)]
    return out


def _jsonable(value: Any) -> Any:
    """Decimals and datetimes are not JSON-serialisable; the audit column is JSON."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)
