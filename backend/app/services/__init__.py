"""The service layer -- all business logic lives here.

ARCHITECTURE NOTE
-----------------
Nothing in this package imports FastAPI or Strawberry. Services take a
``ServiceContext`` (session + caller + tenant + request metadata), raise the
exceptions in ``app.core.errors``, and return models. That is what lets the exact
same code be called from a GraphQL resolver, a REST route, a CLI script, and the
APScheduler jobs -- the scheduler has no HTTP request to raise an HTTPException
into, and a service that knew about one would be unusable from it.

The transport layers translate ``AppError`` subclasses into their own error shapes.
"""

from __future__ import annotations

from app.services.auth import (
    AuthService,
    normalise_email,
    user_from_access_token,
    validate_password,
)
from app.services.base import BaseService, ServiceContext, diff_fields
from app.services.business import BusinessService, unique_slug
from app.services.catalog import CategoryService, ProductService, ServiceItemService
from app.services.customer import (
    CustomerService,
    recompute_aggregates,
    recompute_credit_score,
    score_breakdown,
)
from app.services.user import UserService

__all__ = [
    # base
    "BaseService",
    "ServiceContext",
    "diff_fields",
    # services
    "AuthService",
    "BusinessService",
    "CategoryService",
    "CustomerService",
    "ProductService",
    "ServiceItemService",
    "UserService",
    # module-level helpers used by other services / the scheduler
    "normalise_email",
    "recompute_aggregates",
    "recompute_credit_score",
    "score_breakdown",
    "unique_slug",
    "user_from_access_token",
    "validate_password",
]
