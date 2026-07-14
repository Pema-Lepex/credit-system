# ---------------------------------------------------------------------------
# Backend container.
#
# NOTE: this image runs the API *and* the scheduler in one process (see
# app/scheduler/__init__.py). Scale it to ONE instance, or set
# SCHEDULER_ENABLED=false on every replica but one -- otherwise every replica
# wakes up and runs the same reminder sweep.
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Pillow needs these at runtime for WebP/JPEG; build-essential is only needed while
# compiling wheels, so it is installed and removed in the same layer.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libwebp7 libjpeg62-turbo zlib1g curl \
    && rm -rf /var/lib/apt/lists/*

# Dependencies first, so a source change doesn't invalidate the pip layer.
COPY requirements.txt .
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y build-essential && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY app ./app

# The database and uploads live on a MOUNTED VOLUME. Without one, both are inside
# the container's writable layer and are destroyed on every redeploy -- taking the
# shop's entire ledger with them. See docs/DEPLOYMENT.md.
RUN mkdir -p /data/database /data/uploads
ENV DATABASE_URL=sqlite:////data/database/app.db \
    UPLOAD_DIR=/data/uploads

# Don't run as root.
RUN useradd --system --uid 1001 appuser && chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

# One worker, deliberately: see the scheduler note above.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
