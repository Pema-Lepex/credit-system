"""FastAPI application entrypoint.

    /graphql      the API (queries, mutations, pagination, filtering, sorting)
    /api/upload   multipart upload           -- binary in
    /api/files/*  serve an uploaded file     -- binary out
    /api/.../pdf  generated documents        -- binary out, never stored
    /health       liveness + dependency check

See app/api/files.py for why binaries deliberately do not go through GraphQL.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from strawberry.fastapi import GraphQLRouter

from app.api.files import router as files_router
from app.core.config import Environment, settings
from app.core.errors import AppError
from app.db.session import check_database, init_db
from app.graphql.context import get_graphql_context
from app.graphql.schema import schema
from app.scheduler import shutdown_scheduler, start_scheduler

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s  %(levelname)-8s %(name)s  %(message)s",
)
log = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Fail fast rather than boot a production server on development defaults.
    settings.assert_production_ready()

    init_db()
    log.info("Database ready: %s", settings.DATABASE_URL.split("://")[0])

    # The scheduler lives in this process. See app/scheduler/__init__.py for the
    # single-instance caveat and the migration path to a real queue.
    start_scheduler()

    log.info(
        "%s ready  [env=%s  storage=%s  email=%s]",
        settings.APP_NAME,
        settings.ENVIRONMENT.value,
        settings.STORAGE_BACKEND.value,
        settings.EMAIL_PROVIDER.value,
    )
    yield
    shutdown_scheduler()


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Credit tracking and reminders for small businesses.",
    lifespan=lifespan,
    # The schema is self-documenting via GraphQL introspection; the REST surface is
    # four binary endpoints. Docs stay on in dev, off in production.
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.exception_handler(AppError)
async def app_error_handler(_, exc: AppError) -> JSONResponse:
    """Map domain errors onto HTTP for the REST routes.

    GraphQL does its own mapping (see app/graphql/schema.py) because a GraphQL error
    is a payload field, not a status code.
    """
    return JSONResponse(
        status_code=exc.http_status,
        content={"error": {"code": exc.code, "message": exc.message, "field": exc.field}},
    )


graphql_router: GraphQLRouter = GraphQLRouter(
    schema,
    context_getter=get_graphql_context,
    # GraphiQL is a developer tool. Serving it in production hands an attacker a
    # schema browser and a query console on a plate.
    graphql_ide="graphiql" if settings.DEBUG else None,
)
app.include_router(graphql_router, prefix=settings.GRAPHQL_PATH)
app.include_router(files_router, prefix=settings.API_PREFIX)


@app.get("/health", tags=["system"])
async def health() -> JSONResponse:
    """Liveness + dependency check. Point your uptime monitor here."""
    db_ok = check_database()
    from app.scheduler import get_scheduler

    scheduler = get_scheduler()
    healthy = db_ok

    return JSONResponse(
        status_code=200 if healthy else 503,
        content={
            "status": "ok" if healthy else "degraded",
            "environment": settings.ENVIRONMENT.value,
            "database": "ok" if db_ok else "unreachable",
            "scheduler": (
                "running"
                if scheduler and scheduler.running
                else ("disabled" if not settings.SCHEDULER_ENABLED else "stopped")
            ),
            "storage": settings.STORAGE_BACKEND.value,
            "email": settings.EMAIL_PROVIDER.value,
        },
    )


@app.get("/", tags=["system"])
async def root() -> dict[str, str]:
    return {
        "name": settings.APP_NAME,
        "graphql": settings.GRAPHQL_PATH,
        "health": "/health",
        "docs": "/docs" if settings.DEBUG else "disabled in production",
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",  # noqa: S104  (containers must bind all interfaces)
        port=8000,
        reload=settings.ENVIRONMENT is Environment.development,
    )
