"""GraphQL request context: who is asking, and what may they touch.

ARCHITECTURE NOTE — where authentication actually happens
---------------------------------------------------------
The bearer token is decoded ONCE per request, here, and turned into a
``ServiceContext``. Resolvers never parse a token, never look at a header, and
never decide what a user may do -- they call ``service.require(Permission.X)`` and
let the service raise.

That is the seam that keeps authorisation honest: there is exactly one place a
caller's identity is established, and exactly one place (core/security.py) that
says what an identity may do. A resolver cannot forget to check, because it never
had the ability to check in the first place -- it only has the ability to ask.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import Depends, Request
from sqlmodel import Session
from strawberry.fastapi import BaseContext

from app.core.security import TokenError, TokenType, decode_token
from app.db.session import get_session
from app.models.user import User
from app.services.base import ServiceContext


@dataclass
class GraphQLContext(BaseContext):
    session: Session
    user: User | None
    request: Request | None = None

    @property
    def is_authenticated(self) -> bool:
        return self.user is not None

    def service_ctx(self, business_id: str | None = None) -> ServiceContext:
        """Build the ServiceContext every service takes.

        ``business_id`` may only be overridden by a SUPER_ADMIN; BaseService.scope_id
        enforces that. Passing it from a resolver is therefore safe -- a malicious
        ADMIN cannot smuggle another tenant's id through, because the service pins
        them to their own regardless of what arrives here.
        """
        request = self.request
        return ServiceContext(
            session=self.session,
            user=self.user,
            business_id=business_id,
            ip_address=_client_ip(request),
            user_agent=(request.headers.get("user-agent") if request else None),
        )


def _client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    # Behind a reverse proxy (nginx, Cloudflare, Fly), request.client.host is the
    # proxy. The real client is the first hop in X-Forwarded-For.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else None


def _current_user(request: Request, session: Session) -> User | None:
    """Resolve the bearer token to a user. Returns None rather than raising.

    Anonymous requests are legitimate -- ``login`` and ``requestPasswordReset`` are
    GraphQL mutations like any other. Rejecting an unauthenticated request is the
    job of the individual resolver (via require()), not of the context builder,
    which cannot know whether the operation about to run needs a user.
    """
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None

    token = header[7:].strip()
    if not token:
        return None

    try:
        payload = decode_token(token, expected_type=TokenType.ACCESS)
    except TokenError:
        return None

    user = session.get(User, payload.subject)
    if user is None or not user.is_active or user.deleted_at is not None:
        # A token can outlive the account it names -- deactivating a user must take
        # effect immediately, not when their access token happens to expire.
        return None
    return user


async def get_graphql_context(
    request: Request,
    session: Session = Depends(get_session),
) -> GraphQLContext:
    return GraphQLContext(
        session=session,
        user=_current_user(request, session),
        request=request,
    )


Info = Any  # strawberry.Info[GraphQLContext, None], aliased to keep signatures short


def ctx_from(info: Any) -> GraphQLContext:
    return info.context  # type: ignore[no-any-return]
