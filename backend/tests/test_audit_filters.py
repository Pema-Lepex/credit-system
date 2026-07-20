"""Filtering the activity log by date, and downloading it.

The load-bearing case is the END date. ``AuditLog.created_at`` is an INSTANT, so a
naive ``created_at <= end_date`` compares a timestamp against midnight and silently
drops everything that happened during the last day of the range -- which, for a
report someone runs at 4pm about today, is all of it.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlmodel import Session

from app.models.enums import AuditAction, ExportFormat
from app.models.retention import AuditLog
from app.services.base import ServiceContext
from app.services.export import DATASETS, ExportService

TODAY = date.today()


def _log(session: Session, ctx: ServiceContext, *, days_ago: int, summary: str) -> AuditLog:
    from app.models.base import utcnow

    row = AuditLog(
        business_id=ctx.business_id,
        action=AuditAction.CREATE,
        entity_type="credit",
        entity_id=None,
        summary=summary,
        changes={},
        actor_label="Tashi Owner",
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    # Back-date after the insert: created_at has a default_factory, so it cannot be
    # set on construction.
    row.created_at = utcnow() - timedelta(days=days_ago)
    session.add(row)
    session.commit()
    return row


def _export_rows(ctx: ServiceContext, **filters: object) -> list[list[object]]:
    return ExportService(ctx)._build_dataset("audit_log", filters).rows  # noqa: SLF001


# ===========================================================================
# The export
# ===========================================================================
def test_the_audit_log_is_exportable() -> None:
    assert "audit_log" in DATASETS


def test_an_entry_from_today_survives_an_end_date_of_today(
    ctx: ServiceContext, session: Session
) -> None:
    """THE test. Someone running "up to today" at 4pm must see this afternoon's
    activity, not an empty file."""
    _log(session, ctx, days_ago=0, summary="Something that happened today")

    rows = _export_rows(ctx, start=TODAY - timedelta(days=7), end=TODAY)

    assert len(rows) == 1


def test_the_date_range_excludes_what_falls_outside_it(
    ctx: ServiceContext, session: Session
) -> None:
    _log(session, ctx, days_ago=0, summary="today")
    _log(session, ctx, days_ago=10, summary="ten days ago")
    _log(session, ctx, days_ago=60, summary="two months ago")

    recent = _export_rows(ctx, start=TODAY - timedelta(days=30), end=TODAY)
    summaries = {str(r[4]) for r in recent}

    assert summaries == {"today", "ten days ago"}


def test_no_dates_means_everything(ctx: ServiceContext, session: Session) -> None:
    _log(session, ctx, days_ago=0, summary="a")
    _log(session, ctx, days_ago=400, summary="b")

    assert len(_export_rows(ctx)) == 2


def test_the_export_can_be_filtered_by_action(
    ctx: ServiceContext, session: Session
) -> None:
    _log(session, ctx, days_ago=0, summary="created something")
    row = _log(session, ctx, days_ago=0, summary="deleted something")
    row.action = AuditAction.DELETE
    session.add(row)
    session.commit()

    rows = _export_rows(ctx, action=AuditAction.DELETE.value)

    assert [str(r[4]) for r in rows] == ["deleted something"]


def test_the_change_diff_is_flattened_into_one_readable_cell(
    ctx: ServiceContext, session: Session
) -> None:
    """A nested JSON blob in a spreadsheet column helps nobody."""
    row = _log(session, ctx, days_ago=0, summary="Customer updated")
    row.changes = {"name": ["Old Name", "New Name"], "phone": [None, "+975 17"]}
    session.add(row)
    session.commit()

    cell = str(_export_rows(ctx)[0][5])

    assert "name: Old Name -> New Name" in cell
    assert "phone: None -> +975 17" in cell


def test_the_export_is_tenant_scoped(
    ctx: ServiceContext, other_ctx: ServiceContext, session: Session
) -> None:
    _log(session, ctx, days_ago=0, summary="ours")

    assert _export_rows(other_ctx) == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "fmt", [ExportFormat.CSV, ExportFormat.XLSX, ExportFormat.JSON, ExportFormat.PDF]
)
async def test_the_audit_log_downloads_in_every_format(
    ctx: ServiceContext, session: Session, fmt: ExportFormat
) -> None:
    """A FAILED job is a dead button."""
    _log(session, ctx, days_ago=1, summary="Recorded a payment")

    job = await ExportService(ctx).create_export(
        ctx,
        format=fmt,
        datasets=["audit_log"],
        filters={"start": TODAY - timedelta(days=30), "end": TODAY},
    )

    assert job.state.value in {"READY", "ready"}, job.error
    assert job.size_bytes > 0
