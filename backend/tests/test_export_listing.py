"""The exports list must return ExportJob models, not SQLAlchemy Rows.

`sqlalchemy.select(Model)` and `sqlmodel.select(Model)` look identical and are not:
Session.exec() unwraps only SQLModel's SelectOfScalar into model instances. Given a
plain SQLAlchemy Select it hands back Row objects, and `row.state` then raises
AttributeError -- which surfaced as "Could not load your exports" with a 500 behind
it. export.py was importing select from the wrong package.

Nothing in the suite caught it because every other test path builds ExportJobs
directly rather than reading them back through list_exports().
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlmodel import Session

from app.models.enums import ExportFormat
from app.models.retention import ExportJob
from app.services.base import ServiceContext
from app.services.export import ExportService


@pytest.mark.asyncio
async def test_list_exports_returns_models_not_rows(
    session: Session, ctx: ServiceContext
) -> None:
    await ExportService(ctx).create_export(
        ctx,
        format=ExportFormat.CSV,
        datasets=["credits"],
        filters={"start": date(2026, 1, 1), "end": date(2026, 7, 14)},
    )

    page = ExportService(ctx).list_exports()

    assert page.items, "the export we just created should come back"
    job = page.items[0]

    # The actual regression: a Row would raise AttributeError on any of these, which is
    # precisely what the GraphQL mapper (to_export_job) does to every row it is handed.
    assert isinstance(job, ExportJob)
    assert job.state is not None
    assert job.format is not None
    assert job.datasets == ["credits"]
