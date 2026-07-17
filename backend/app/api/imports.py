"""Bulk import routes: download a template, preview a sheet, commit a sheet.

WHY REST AND NOT GRAPHQL
------------------------
Same reason as app/api/files.py: a spreadsheet is binary going in and a workbook
is binary coming out, and GraphQL is a JSON transport. Multipart in, bytes out.
The *report* is JSON, which is why the response bodies below are plain dicts
rather than a stream -- it is the file that is binary, not the answer.

WHY PREVIEW AND COMMIT ARE TWO CALLS THAT BOTH TAKE THE FILE
-------------------------------------------------------------
The obvious alternative is to upload once, stash the parsed rows server-side
under a token, and have "confirm" reference it. That means storage, an expiry
job, and a place for half-imports to rot -- for a file that is a few hundred KB
and already in the browser's memory. Uploading it twice is cheaper than owning
that lifecycle, and it makes the commit self-contained: nothing to expire,
nothing to clean up, no state between the two calls.

The trade-off is honest: the preview and the commit are separate transactions, so
data *could* move between them (a customer deleted, say). The commit re-validates
from scratch for exactly that reason -- the preview is a courtesy, not a promise.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile

from app.core.errors import AppError
from app.services.imports import (
    DATASETS,
    ImportReport,
    ImportService,
    get_spec,
)

# Reuse the exact auth dependency the upload route uses. Rebuilding it here is how
# the two drift apart and one ends up without the business-context check.
from app.api.files import CtxDep

router = APIRouter(tags=["imports"])


# ---------------------------------------------------------------------------
# The field guide -- what the UI renders, generated from the same specs the
# importer validates against, so the two cannot disagree.
# ---------------------------------------------------------------------------
@router.get("/imports/{dataset}/fields")
async def import_fields(dataset: str, ctx: CtxDep) -> dict[str, object]:
    try:
        spec = get_spec(dataset)
        ImportService(ctx).require(spec.permission)
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return {
        "dataset": spec.name,
        "title": spec.title,
        "intro": spec.intro,
        "columns": [
            {
                "key": column.key,
                "label": column.label,
                "required": column.required,
                "help": column.help,
                "example": column.example,
                "choices": list(column.choices),
            }
            for column in spec.columns
        ],
    }


# ---------------------------------------------------------------------------
# Template download
# ---------------------------------------------------------------------------
@router.get("/imports/{dataset}/template")
async def import_template(
    dataset: str,
    ctx: CtxDep,
    format: Annotated[str, Query(pattern="^(csv|xlsx)$")] = "xlsx",
) -> Response:
    """A blank sheet with the right headings. Headings only -- see ImportService.template."""
    try:
        data, filename, content_type = ImportService(ctx).template(dataset, format)
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return Response(
        content=data,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Generated per request and never stored (the storage-optimisation rule
            # in the spec: no generated file outlives the request that asked for it).
            "Cache-Control": "no-store",
        },
    )


# ---------------------------------------------------------------------------
# Preview / commit
# ---------------------------------------------------------------------------
@router.post("/imports/{dataset}")
async def run_import(
    dataset: str,
    ctx: CtxDep,
    file: Annotated[UploadFile, File()],
    dry_run: bool = True,
) -> dict[str, object]:
    """Validate a sheet (``dry_run=true``, the default) or import it.

    ``dry_run`` defaults to TRUE on purpose. A client that forgets the parameter
    gets a preview, not several hundred unasked-for customers.
    """
    if ctx.user is None or not ctx.user.business_id:
        raise HTTPException(status_code=403, detail="No business context")

    data = await file.read()
    try:
        report = ImportService(ctx).run(
            ctx,
            dataset=dataset,
            filename=file.filename or "",
            data=data,
            dry_run=dry_run,
        )
    except AppError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc

    return _serialise(report)


def _serialise(report: ImportReport) -> dict[str, object]:
    return {
        "dataset": report.dataset,
        "dryRun": report.dry_run,
        "totalRows": report.total_rows,
        "created": report.created,
        "ok": report.ok,
        "errors": [
            {"row": i.row, "column": i.column, "message": i.message} for i in report.errors
        ],
        "warnings": [
            {"row": i.row, "column": i.column, "message": i.message} for i in report.warnings
        ],
    }


@router.get("/imports")
async def list_imports(ctx: CtxDep) -> dict[str, object]:
    """What can be imported. Lets the UI build its menu without hardcoding a list."""
    return {
        "datasets": [
            {"name": spec.name, "title": spec.title, "intro": spec.intro}
            for spec in DATASETS.values()
        ]
    }
