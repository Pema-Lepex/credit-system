"""Application exceptions.

ARCHITECTURE NOTE: services raise these; the GraphQL and REST layers translate
them into their own error shapes. Services never import FastAPI or Strawberry --
that is what keeps them unit-testable and reusable from the scheduler, which has
no HTTP request to raise an HTTPException into.
"""

from __future__ import annotations


class AppError(Exception):
    """Base class. ``code`` is a stable, machine-readable string for the client."""

    code = "APP_ERROR"
    http_status = 400

    def __init__(self, message: str, *, code: str | None = None, field: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.field = field
        if code:
            self.code = code


class NotFoundError(AppError):
    code = "NOT_FOUND"
    http_status = 404


class ValidationError(AppError):
    code = "VALIDATION_ERROR"
    http_status = 422


class ConflictError(AppError):
    """The request contradicts current state (duplicate SKU, overpayment...)."""

    code = "CONFLICT"
    http_status = 409


class AuthenticationError(AppError):
    code = "UNAUTHENTICATED"
    http_status = 401


class PermissionDeniedError(AppError):
    code = "FORBIDDEN"
    http_status = 403


class RateLimitError(AppError):
    code = "RATE_LIMITED"
    http_status = 429


class StorageQuotaError(AppError):
    code = "STORAGE_QUOTA_EXCEEDED"
    http_status = 507
