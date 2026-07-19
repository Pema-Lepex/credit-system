"""Exports must actually go away -- on request, and on the 24h clock.

The previous behaviour only flipped a READY job to EXPIRED and dropped its file,
keeping the ExportJob row forever. That left dead rows piling up in the user's
exports table and kept a record of what had been exported long after the data was
supposed to be gone. Both paths now hard-delete the row, and both must leave an
AuditLog entry behind -- the spec's "all deletion operations must be logged" is the
only reason deleting the row is acceptable at all.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlmodel import Session, col, select

from app.core.errors import NotFoundError
from app.models.base import utcnow
from app.models.enums import AuditAction, ExportFormat
from app.models.file import FileAsset
from app.models.retention import AuditLog, ExportJob
from app.services.base import ServiceContext
from app.services.export import ExportService


async def _make_export(ctx: ServiceContext) -> ExportJob:
    return await ExportService(ctx).create_export(
        ctx,
        format=ExportFormat.CSV,
        datasets=["credits"],
        filters={"start": date(2026, 1, 1), "end": date(2026, 7, 14)},
    )


def _purge_logs(session: Session, entity_id: str) -> list[AuditLog]:
    return list(
        session.execute(
            select(AuditLog).where(
                col(AuditLog.entity_type) == "export_job",
                col(AuditLog.entity_id) == entity_id,
                col(AuditLog.action) == AuditAction.PURGE,
            )
        )
        .scalars()
        .all()
    )


@pytest.mark.asyncio
async def test_delete_export_removes_row_and_file(
    session: Session, ctx: ServiceContext
) -> None:
    job = await _make_export(ctx)
    job_id, file_id = job.id, job.file_id
    assert file_id, "a READY export should have a file attached"

    await ExportService(ctx).delete_export(job_id)

    # The row is gone outright -- not soft-deleted, not flipped to EXPIRED.
    assert session.get(ExportJob, job_id) is None
    assert session.get(FileAsset, file_id) is None


@pytest.mark.asyncio
async def test_delete_export_is_audited(session: Session, ctx: ServiceContext) -> None:
    job = await _make_export(ctx)
    job_id = job.id

    await ExportService(ctx).delete_export(job_id)

    logs = _purge_logs(session, job_id)
    assert len(logs) == 1, "a purge with no audit trail is data loss, not deletion"
    # Attributed to the person who clicked, not to "system" -- a user-initiated
    # delete and the scheduler's sweep must be tellable apart in the log.
    assert ctx.user is not None
    assert logs[0].actor_user_id == ctx.user.id


@pytest.mark.asyncio
async def test_delete_export_twice_raises_not_found(
    session: Session, ctx: ServiceContext
) -> None:
    """The second call must 404, not silently succeed -- the row really is gone."""
    job = await _make_export(ctx)
    await ExportService(ctx).delete_export(job.id)

    with pytest.raises(NotFoundError):
        await ExportService(ctx).delete_export(job.id)


@pytest.mark.asyncio
async def test_purge_stale_deletes_expired_rows(
    session: Session, ctx: ServiceContext
) -> None:
    job = await _make_export(ctx)
    job_id, file_id = job.id, job.file_id

    # Wind the clock past the TTL rather than waiting 24 hours for it.
    job.expires_at = utcnow() - timedelta(minutes=1)
    session.add(job)
    session.flush()

    purged, freed = await ExportService.purge_stale(session)

    assert purged == 1
    assert freed > 0, "the file's bytes should be reported as reclaimed"
    assert session.get(ExportJob, job_id) is None
    assert session.get(FileAsset, file_id) is None
    assert len(_purge_logs(session, job_id)) == 1


@pytest.mark.asyncio
async def test_purge_stale_spares_live_exports(
    session: Session, ctx: ServiceContext
) -> None:
    """The sweep runs hourly against every tenant; an off-by-one here deletes
    files users are still entitled to."""
    job = await _make_export(ctx)

    purged, _ = await ExportService.purge_stale(session)

    assert purged == 0
    assert session.get(ExportJob, job.id) is not None


@pytest.mark.asyncio
async def test_purge_stale_scoped_to_one_business(
    session: Session, ctx: ServiceContext
) -> None:
    """Storage Dashboard calls this with a business_id. A job belonging to another
    tenant must survive it."""
    job = await _make_export(ctx)
    job.expires_at = utcnow() - timedelta(minutes=1)
    session.add(job)
    session.flush()

    purged, _ = await ExportService.purge_stale(session, business_id="not-this-business")

    assert purged == 0
    assert session.get(ExportJob, job.id) is not None
