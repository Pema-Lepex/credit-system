"""The schema, and the error boundary in front of it.

TWO SECURITY CONTROLS LIVE HERE. BOTH ARE LOAD-BEARING.
=======================================================

1. ERROR MASKING (``MaskedSchema.process_errors``)
--------------------------------------------------
GraphQL's default behaviour is to put ``str(exception)`` into the response. That is
a disclosure vulnerability the moment an exception is not one we wrote:

    IntegrityError: UNIQUE constraint failed: user.email
    [SQL: INSERT INTO user (id, email, hashed_password, ...) VALUES (?, ?, ?, ...)]

...tells an attacker the table names, the column names, the ORM, and confirms an
account exists. A ``FileNotFoundError`` leaks an absolute filesystem path. A
``KeyError`` in a resolver leaks internal field names.

So exactly two things can come out of this schema:

  * An ``AppError`` -- which we raised ON PURPOSE, whose message we wrote FOR the
    user, and whose ``code``/``field`` the client is meant to branch on. Surfaced
    verbatim, with ``extensions: {"code": "CONFLICT", "field": "amount"}``.
  * Anything else -- logged server-side IN FULL (with the traceback, so it can be
    fixed), and returned to the client as the single word "Internal server error"
    with no detail whatsoever.

The distinction is ``isinstance(original, AppError)``, not a message pattern or a
status code. An exception is either one we anticipated or one we did not, and only
the first kind is safe to describe.

``process_errors`` is the right hook because it is called ONCE, with the final
error list, before the response is serialised -- so mutating the GraphQLErrors here
is what the client actually receives. (GraphQLError.formatted reads ``.message``
and ``.extensions`` off the object at serialisation time.)

2. QUERY DEPTH LIMITING
-----------------------
GraphQL lets a client compose a query the server never anticipated. A cyclic path
through the type graph turns a handful of request bytes into an exponential number
of database queries. Today's schema happens to be acyclic -- the deepest legitimate
query is about ``dashboard -> upcomingDue -> customer``, i.e. 3 -- so depth 12 costs
no legitimate client anything. It is here so that the day someone adds
``CustomerType.credits`` (which closes a cycle: credit -> customer -> credit -> ...)
the DoS does not ship with it.

3. INTROSPECTION IS OFF IN PRODUCTION
-------------------------------------
NOTE, because it is not obvious and it bit this schema: Strawberry's
``QueryDepthLimiter`` does NOT limit introspection. ``determine_depth`` calls
``is_introspection_key()`` and returns 0 for any field starting with ``__``, so the
classic introspection bomb --

    { __schema { types { fields { type { ofType { ofType { ... x20 } } } } } } }

-- is NOT caught by ``max_depth``, at any setting. Verified against strawberry
0.321.

The mitigation is the correct one anyway: production does not answer introspection
at all. That also stops handing an attacker a complete map of the schema, which is
the same reasoning main.py already applies to GraphiQL. Development keeps
introspection on, because the frontend's typed-codegen step needs it.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

import strawberry
from graphql import GraphQLError, NoSchemaIntrospectionCustomRule
from strawberry.extensions import AddValidationRules, QueryDepthLimiter
from strawberry.extensions.base_extension import SchemaExtension
from strawberry.schema.config import StrawberryConfig
from strawberry.types import ExecutionContext

from app.core.config import settings
from app.core.errors import AppError
from app.graphql.mutations import Mutation
from app.graphql.queries import Query

log = logging.getLogger("app.graphql")

# The ONLY message an unexpected exception is allowed to produce.
_INTERNAL = "Internal server error"

# A malicious deeply-nested query is a DoS vector. See the module docstring.
MAX_QUERY_DEPTH = 12


class MaskedSchema(strawberry.Schema):
    """A schema that cannot leak an unanticipated exception to a client."""

    def process_errors(
        self,
        errors: list[GraphQLError],
        execution_context: ExecutionContext | None = None,
    ) -> None:
        operation = getattr(execution_context, "operation_name", None) or "anonymous"

        for error in errors:
            original = error.original_error

            if isinstance(original, AppError):
                # Ours. We wrote this message for a human to read. The code and field
                # are the machine-readable contract the frontend branches on.
                error.message = original.message
                extensions = dict(error.extensions or {})
                extensions["code"] = original.code
                if original.field:
                    extensions["field"] = original.field
                error.extensions = extensions

                # INFO, not ERROR: a 404 or a rejected overpayment is the system working
                # correctly. Logging it at ERROR trains everyone to ignore the log.
                log.info(
                    "%s in %s: %s", original.code, operation, original.message
                )
                continue

            if original is None:
                # No Python exception behind it: a parse/validation/depth-limit error
                # about the client's OWN query. It describes the request, not our
                # internals, and the client needs it to fix their query. Safe as-is.
                log.info("Invalid query (%s): %s", operation, error.message)
                continue

            # Everything else is a bug. The full traceback goes to the server log --
            # and NOTHING goes to the client. Not the type, not the message, not the
            # path through our code. See the module docstring.
            log.error(
                "Unhandled exception in %s", operation, exc_info=original
            )
            error.message = _INTERNAL
            error.extensions = {"code": "INTERNAL_SERVER_ERROR"}
            # Scrub the trace of our own source out of the payload. `nodes` and
            # `path` refer to the client's query and are safe (and useful) to keep.
            error.original_error = None


def _extensions() -> list[Callable[[], SchemaExtension]]:
    """Extension FACTORIES, not instances.

    Strawberry constructs a fresh extension per request; handing it a shared instance
    is deprecated (and would let one request's state bleed into the next).
    """
    extensions: list[Callable[[], SchemaExtension]] = [
        lambda: QueryDepthLimiter(max_depth=MAX_QUERY_DEPTH),
    ]
    if not settings.DEBUG:
        # See section 3 of the module docstring: max_depth cannot police introspection,
        # so production simply does not answer it.
        extensions.append(lambda: AddValidationRules([NoSchemaIntrospectionCustomRule]))
    return extensions


schema = MaskedSchema(
    query=Query,
    mutation=Mutation,
    config=StrawberryConfig(auto_camel_case=True),
    extensions=_extensions(),
)

__all__ = ["MAX_QUERY_DEPTH", "MaskedSchema", "schema"]
