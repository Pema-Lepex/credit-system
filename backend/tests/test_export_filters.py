"""ExportJob.filters is a JSON column, and dates are not JSON.

The Reports page always sends a date range, so `createExport` crashed on the INSERT
with "Object of type date is not JSON serializable" -- every report download failed
while the invoice PDF (which passes no filters) worked. These tests pin the
normalisation so the column can never again be handed a type it cannot store.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlmodel import Session

from app.models.enums import ExportFormat
from app.services.base import ServiceContext
from app.services.export import ExportService, _json_safe


def test_dates_become_iso_strings() -> None:
    out = _json_safe({"start": date(2026, 6, 1), "end": date(2026, 7, 14)})
    assert out == {"start": "2026-06-01", "end": "2026-07-14"}


def test_result_is_actually_json_serialisable() -> None:
    """The real bar: json.dumps must not raise. That is what the DB driver does."""
    payload = {
        "start": date(2026, 6, 1),
        "when": datetime(2026, 6, 1, 9, 30),
        "amount": Decimal("1234.50"),
        "nested": {"days": [date(2026, 1, 1)]},
    }
    json.dumps(_json_safe(payload))  # must not raise


def test_plain_values_pass_through() -> None:
    payload = {"period": "MONTHLY", "include_voided": False, "limit": 10}
    assert _json_safe(payload) == payload


@pytest.mark.asyncio
async def test_dated_export_persists(
    session: Session, ctx: ServiceContext
) -> None:
    """End to end: the exact shape the Reports page sends must reach READY."""
    job = await ExportService(ctx).create_export(
        ctx,
        format=ExportFormat.CSV,
        datasets=["credits"],
        filters={"start": date(2026, 6, 1), "end": date(2026, 7, 14)},
    )

    assert job.state.value in {"READY", "ready"}
    # Stored as strings, and still readable as dates by _as_date on the way out.
    assert job.filters["start"] == "2026-06-01"
