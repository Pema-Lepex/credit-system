"""File upload / download / PDF routes.

WHY THESE ARE REST, NOT GRAPHQL
--------------------------------
GraphQL speaks JSON. Pushing a 6 MB photo through it means base64 (a 33% size tax,
plus the whole thing buffered in memory as a string), and pulling a PDF back out
means the browser cannot just follow a link -- it has to fetch JSON, decode, build
a Blob, and synthesise a download. Both are the wrong shape for binary.

So: binaries move over REST (multipart in, streamed bytes out), and GraphQL carries
the *identifiers*. Upload returns a file id; you attach that id to a credit via a
GraphQL mutation. The two protocols each do what they are actually good at.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.core.config import StorageBackend as BackendKind
from app.core.config import settings
from app.core.errors import AppError
from app.core.security import Permission, TokenError, TokenType, decode_token
from app.db.session import get_session
from app.models.enums import FileKind
from app.models.file import FileAsset
from app.models.user import User
from app.services.base import ServiceContext
from app.services.reports import ReportService
from app.storage.base import StorageError
from app.storage.service import StorageService

router = APIRouter(tags=["files"])


# ---------------------------------------------------------------------------
# Auth (mirrors the GraphQL context, but raises instead of returning None --
# a REST endpoint has no resolver to defer the decision to)
# ---------------------------------------------------------------------------
def current_user(
    request: Request,
    session: Annotated[Session, Depends(get_session)],
) -> User:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(header[7:].strip(), expected_type=TokenType.ACCESS)
    except TokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    user = session.get(User, payload.subject)
    if user is None or not user.is_active or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def service_ctx(
    request: Request,
    user: Annotated[User, Depends(current_user)],
    session: Annotated[Session, Depends(get_session)],
) -> ServiceContext:
    return ServiceContext(
        session=session,
        user=user,
        business_id=user.business_id,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )


CtxDep = Annotated[ServiceContext, Depends(service_ctx)]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------
@router.post("/upload")
async def upload_file(
    ctx: CtxDep,
    file: Annotated[UploadFile, File()],
    kind: FileKind = FileKind.TEMP,
) -> dict[str, object]:
    """Upload one file. Returns the FileAsset id to attach via GraphQL.

    The response reports the compression saving, which the UI surfaces as
    "saved 4.1 MB" -- worth showing a user whose free tier you are protecting.
    """
    if ctx.user is None or not ctx.user.business_id:
        raise HTTPException(status_code=403, detail="No business context")

    data = await file.read()

    # Trust the sniffed extension over the client-declared content type: a browser
    # will happily send application/octet-stream for a perfectly good JPEG, and a
    # malicious client will happily send image/png for an executable.
    content_type = file.content_type or "application/octet-stream"

    service = StorageService(ctx.session)
    try:
        asset = await service.upload(
            business_id=ctx.user.business_id,
            kind=kind,
            filename=file.filename or "upload",
            data=data,
            content_type=content_type,
            user_id=ctx.user.id,
        )
    except StorageError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    ctx.session.commit()
    ctx.session.refresh(asset)

    return {
        "id": asset.id,
        "url": service.url_for(asset),
        "thumbnailUrl": service.url_for(asset, thumb=True),
        "filename": asset.original_filename,
        "contentType": asset.content_type,
        "sizeBytes": asset.size_bytes,
        "originalSizeBytes": asset.original_size_bytes,
        "bytesSaved": asset.bytes_saved,
        "width": asset.width,
        "height": asset.height,
    }


# ---------------------------------------------------------------------------
# Download / serve
# ---------------------------------------------------------------------------
@router.get("/files/{file_path:path}")
async def serve_file(
    file_path: str,
    session: Annotated[Session, Depends(get_session)],
) -> Response:
    """Serve an uploaded file (local storage only).

    NOTE ON ACCESS CONTROL: this route is intentionally unauthenticated, and that is
    a deliberate, bounded trade-off rather than an oversight.

    The path contains a SHA-256 of the file's contents, so a URL is effectively an
    unguessable capability -- you cannot enumerate other tenants' files, you can only
    fetch one whose full hash you were already given. That is the same model
    Cloudinary/S3 pre-signed public URLs use.

    What it does NOT give you is revocation: anyone who is handed the URL keeps
    access. For customer photos in a shop that is acceptable; if you need strict
    per-request authorisation, switch STORAGE_BACKEND to s3 (url_for() then issues
    short-lived signed URLs) or put an auth dependency on this route and have the
    frontend fetch images with the bearer token.

    When STORAGE_BACKEND=s3 this route is not used at all -- url_for() points the
    browser straight at the bucket/CDN.
    """
    if settings.STORAGE_BACKEND is not BackendKind.local:
        raise HTTPException(status_code=404, detail="Not served from this host")

    from app.storage.local import LocalStorage

    storage = LocalStorage()
    try:
        data = await storage.read(file_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except StorageError as exc:
        # Path traversal attempt -- LocalStorage._resolve refused it.
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # A key lookup, not a scan: storage_key is unique+indexed.
    asset = session.exec(
        select(FileAsset).where(FileAsset.storage_key == file_path)
    ).first()
    content_type = asset.content_type if asset else "application/octet-stream"

    return Response(
        content=data,
        media_type=content_type,
        headers={
            # Content-addressed => the bytes at this URL can never change => cache hard.
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------------------------------------------------------------------------
# Generated documents -- created on demand, NEVER stored (spec requirement)
# ---------------------------------------------------------------------------
@router.get("/credits/{credit_id}/invoice.pdf")
async def invoice_pdf(credit_id: str, ctx: CtxDep) -> StreamingResponse:
    from io import BytesIO

    try:
        pdf = ReportService(ctx).invoice_pdf(credit_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="invoice-{credit_id[:8]}.pdf"',
            # Never cached, never written to disk -- regenerated on every request, so
            # an edited credit can't serve a stale invoice.
            "Cache-Control": "no-store",
        },
    )


@router.get("/payments/{payment_id}/receipt.pdf")
async def receipt_pdf(payment_id: str, ctx: CtxDep) -> StreamingResponse:
    from io import BytesIO

    try:
        pdf = ReportService(ctx).receipt_pdf(payment_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return StreamingResponse(
        BytesIO(pdf),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="receipt-{payment_id[:8]}.pdf"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/exports/{export_id}/download")
async def download_export(export_id: str, ctx: CtxDep) -> Response:
    """Download a generated export (expires after EXPORT_TTL_HOURS)."""
    from io import BytesIO

    from app.services.export import ExportService

    try:
        service = ExportService(ctx)
        job = service.get_export(export_id)
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    if not job.file_id:
        raise HTTPException(status_code=404, detail="This export is no longer available")

    asset = ctx.session.get(FileAsset, job.file_id)
    if asset is None:
        raise HTTPException(
            status_code=410,
            detail="This export has expired. Generate a new one.",
        )

    storage = StorageService(ctx.session)
    try:
        data = await storage.read(asset)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=410, detail="This export has expired") from exc

    return StreamingResponse(
        BytesIO(data),
        media_type=asset.content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{asset.original_filename}"',
            "Cache-Control": "no-store",
        },
    )


@router.get("/storage/backup")
async def download_backup(ctx: CtxDep) -> Response:
    """Download a consistent snapshot of the SQLite database."""
    from io import BytesIO

    from app.services.storage_stats import StorageStatsService

    service = StorageStatsService(ctx)
    service.require(Permission.STORAGE_MAINTAIN)

    try:
        data = service.backup_database()
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return StreamingResponse(
        BytesIO(data),
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": 'attachment; filename="credit-system-backup.db"',
            "Cache-Control": "no-store",
        },
    )
