"""Data retention: archive batches, export jobs, and the audit log.

THE DELETION PIPELINE (spec: "nothing should be deleted immediately")
---------------------------------------------------------------------
Closed credits (PAID/CANCELLED) older than the business's retention window are
swept into an ArchiveBatch. A batch is a *unit of consent*: it is what the owner
is warned about, what they download, what they postpone, and what eventually gets
purged.

    day 0    sweep finds eligible records -> ArchiveBatch(ARCHIVED)
             records get archived_at set (hidden from normal lists, still on disk)
             delete_scheduled_for = now + ARCHIVE_GRACE_DAYS
    -7 days  warning email + dashboard notification (with a Download button)
    -3 days  warning
    -1 day   warning
    day N    state -> PENDING_DELETION, then purge. Every purge is audited.

At any point before the purge the owner may POSTPONE (pushes delete_scheduled_for
out) or RESTORE (clears archived_at, records come back). ``NEVER`` retention skips
the sweep entirely.

Why a batch table instead of just a timestamp on each record: the owner needs one
notification saying "312 records, 4.2 MB, deleting on the 30th", not 312 of them --
and they need one button that postpones all of it atomically.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, Index
from sqlmodel import Field

from app.models.base import TZDateTime, TenantEntity
from app.models.enums import ArchiveState, AuditAction, ExportFormat, ExportState


class ArchiveBatch(TenantEntity, table=True):
    __tablename__ = "archive_batch"
    __table_args__ = (Index("ix_archive_state_scheduled", "state", "delete_scheduled_for"),)

    state: ArchiveState = Field(default=ArchiveState.ARCHIVED, max_length=20, index=True)

    # What is in the batch (shown verbatim in the warning email).
    credit_count: int = Field(default=0)
    payment_count: int = Field(default=0)
    record_count: int = Field(default=0)
    storage_bytes: int = Field(default=0)

    # The retention window this batch was created under, for the audit trail.
    retention_policy: str = Field(max_length=16)
    cutoff_date: datetime = Field(sa_type=TZDateTime)  # type: ignore[call-overload]

    delete_scheduled_for: datetime = Field(sa_type=TZDateTime, index=True)  # type: ignore[call-overload]

    # Which of the 7/3/1-day warnings have already gone out. A list, so re-running
    # the notifier is idempotent -- it only sends warnings not already in here.
    warnings_sent: list[int] = Field(default_factory=list, sa_column=Column(JSON))

    postponed_count: int = Field(default=0)
    postponed_until: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]

    # Snapshot export produced at archive time so the owner always has something to
    # download even after the rows are purged.
    export_id: str | None = Field(default=None, max_length=32)

    deleted_records_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    restored_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]


class ExportJob(TenantEntity, table=True):
    """A requested data export.

    ARCHITECTURE NOTE: exports are generated on demand and expire (default 24h,
    ``EXPORT_TTL_HOURS``). Nothing generated is kept permanently -- that is what
    keeps a free-tier disk from filling up with stale spreadsheets. The daily
    cleanup job flips expired jobs to EXPIRED and removes the underlying file.

    PDFs specifically are NEVER persisted (spec): invoices and receipts are
    streamed straight to the client from ReportService and never touch disk.
    """

    __tablename__ = "export_job"
    __table_args__ = (Index("ix_export_state_expires", "state", "expires_at"),)

    format: ExportFormat = Field(max_length=8)
    state: ExportState = Field(default=ExportState.PENDING, max_length=12, index=True)

    # Which datasets to include: ["customers", "credits", "payments", ...]
    datasets: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    filters: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    file_id: str | None = Field(
        default=None, foreign_key="file_asset.id", max_length=32, ondelete="SET NULL"
    )
    row_count: int = Field(default=0)
    size_bytes: int = Field(default=0)

    expires_at: datetime | None = Field(default=None, sa_type=TZDateTime, index=True)  # type: ignore[call-overload]
    completed_at: datetime | None = Field(default=None, sa_type=TZDateTime)  # type: ignore[call-overload]
    error: str | None = Field(default=None, max_length=1000)

    requested_by_user_id: str | None = Field(
        default=None, foreign_key="user.id", max_length=32, ondelete="SET NULL"
    )


class AuditLog(TenantEntity, table=True):
    """Append-only audit trail.

    The spec requires that "all deletion operations must be logged". Rather than
    special-casing deletes, every mutating service call lands here -- a deletion is
    only trustworthy in the context of what came before it.

    ``changes`` holds a {field: [before, after]} diff, never the whole row: storing
    full snapshots of every update would make the audit table larger than the data
    it audits.
    """

    __tablename__ = "audit_log"
    __table_args__ = (
        Index("ix_audit_business_created", "business_id", "created_at"),
        Index("ix_audit_entity", "entity_type", "entity_id"),
    )

    action: AuditAction = Field(max_length=20, index=True)
    entity_type: str = Field(max_length=60, index=True)   # "credit", "payment", ...
    entity_id: str | None = Field(default=None, max_length=32, index=True)

    summary: str = Field(max_length=500)
    changes: dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    # NULL actor = the scheduler (an automated maintenance/retention job).
    actor_user_id: str | None = Field(
        default=None, foreign_key="user.id", index=True, max_length=32, ondelete="SET NULL"
    )
    actor_label: str = Field(default="system", max_length=160)
    ip_address: str | None = Field(default=None, max_length=45)
    user_agent: str | None = Field(default=None, max_length=255)
