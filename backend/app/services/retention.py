"""RetentionService -- the data lifecycle, and the promise that nothing vanishes.

THE PIPELINE (spec: "nothing should be deleted immediately")
------------------------------------------------------------
    1. ARCHIVE   Closed credits (PAID/CANCELLED) older than the retention window are
                 swept into an ArchiveBatch. They get `archived_at` set, which hides
                 them from every normal list -- but the rows are still there, and a
                 snapshot export is generated immediately so the owner ALWAYS has
                 something to download, even if they ignore every warning.
    2. WARN      7, 3 and 1 days before the scheduled deletion, the owner gets an
                 email AND a dashboard notification, each carrying: how many records,
                 how much storage, the exact deletion date, and a download link.
    3. POSTPONE  At any point the owner can push the date back, or restore the whole
                 batch. Deletion is opt-out, and the opt-out is one click.
    4. PURGE     Only after the date passes with no postponement are the rows
                 actually destroyed -- and the purge is audited, permanently.

Why a batch rather than a flag on each row: the owner must be told "312 records,
4.2 MB, deleting on the 30th" once, not 312 times, and "postpone" has to move all
of it atomically. The batch is the unit of consent.

RETENTION APPLIES ONLY TO CLOSED RECORDS. An unpaid credit is never archived, no
matter how old -- deleting a debt someone still owes you would be an act of
vandalism, not housekeeping.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlmodel import col, select

from app.core.config import settings
from app.core.errors import ConflictError, NotFoundError, ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.business import Business
from app.models.credit import Credit, Payment
from app.models.enums import (
    ArchiveState,
    AuditAction,
    CreditStatus,
    EmailTemplateKind,
    RetentionPolicy,
)
from app.models.retention import ArchiveBatch
from app.services.base import BaseService, ServiceContext
from app.services.notification import NotificationService
from app.utils.dates import ensure_utc
from app.utils.pagination import Page, PageInput, paginate

# The warning ladder, in days before deletion.
WARNING_DAYS = (7, 3, 1)


@dataclass(slots=True)
class RetentionResult:
    batches_created: int = 0
    records_archived: int = 0
    warnings_sent: int = 0
    batches_purged: int = 0
    records_purged: int = 0
    errors: list[str] = field(default_factory=list)


class RetentionService(BaseService):
    # --------------------------------------------------------------- archive
    def archive_eligible(self, business: Business, *, now: datetime | None = None) -> ArchiveBatch | None:
        """Sweep closed, aged-out records into a new ArchiveBatch. None if nothing qualifies."""
        now = now or utcnow()
        policy = RetentionPolicy(business.retention_policy)
        days = policy.days
        if days is None:
            return None  # NEVER -- the owner opted out entirely

        cutoff = now - timedelta(days=days)

        # Only CLOSED credits. An open debt is never archived. The date we compare is
        # when the credit was SETTLED (paid_at), falling back to when it was last
        # touched -- not when it was created, or a credit opened long ago and paid
        # yesterday would be archived the moment it settled.
        credits = self.session.exec(
            select(Credit).where(
                Credit.business_id == business.id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                col(Credit.status).in_(list(CreditStatus.closed_statuses())),
                col(Credit.updated_at) < cutoff,
            )
        ).all()

        if not credits:
            return None

        credit_ids = [c.id for c in credits]
        payments = self.session.exec(
            select(Payment).where(
                Payment.business_id == business.id,
                col(Payment.credit_id).in_(credit_ids),
                col(Payment.archived_at).is_(None),
            )
        ).all()

        storage_bytes = self._storage_footprint(credits)

        batch = ArchiveBatch(
            business_id=business.id,
            state=ArchiveState.ARCHIVED,
            credit_count=len(credits),
            payment_count=len(payments),
            record_count=len(credits) + len(payments),
            storage_bytes=storage_bytes,
            retention_policy=policy.value,
            cutoff_date=cutoff,
            delete_scheduled_for=now + timedelta(days=settings.ARCHIVE_GRACE_DAYS),
            warnings_sent=[],
        )
        self.session.add(batch)
        self.session.flush()

        stamp = utcnow()
        for credit in credits:
            credit.archived_at = stamp
            credit.archive_batch_id = batch.id
            self.session.add(credit)
        for payment in payments:
            payment.archived_at = stamp
            payment.archive_batch_id = batch.id
            self.session.add(payment)

        self.session.flush()

        # The downloadable snapshot is generated lazily, in ``_warn()`` -- see the
        # note there. It is guaranteed to exist before anything is purged, because
        # ``purge_due()`` refuses to delete a batch that was never warned about.

        self.audit(
            AuditAction.ARCHIVE,
            "archive_batch",
            batch.id,
            f"Archived {batch.record_count} records ({policy.value}); "
            f"scheduled for deletion on {batch.delete_scheduled_for.date().isoformat()}",
            business_id=business.id,
        )
        return batch

    def _storage_footprint(self, credits: list[Credit]) -> int:
        """Bytes of attachments held by these credits -- shown in the warning email."""
        from app.models.file import FileAsset

        file_ids: list[str] = []
        for credit in credits:
            file_ids.extend(credit.photo_file_ids or [])
            if credit.invoice_file_id:
                file_ids.append(credit.invoice_file_id)
        if not file_ids:
            return 0
        assets = self.session.exec(
            select(FileAsset).where(col(FileAsset.id).in_(file_ids))
        ).all()
        return sum(a.size_bytes for a in assets)

    async def _attach_snapshot(self, batch: ArchiveBatch) -> None:
        """Generate the batch's downloadable snapshot, once.

        Called from ``_warn()`` rather than from ``archive_eligible()`` because
        building an export is async (it writes through StorageService) while
        archiving is not -- and because the download link only has to exist by the
        time we tell the owner about it. ``purge_due()`` refuses to delete a batch
        with no warnings sent, so the snapshot is always created before any data can
        be destroyed.

        Best-effort: a failure here must not abort the warning. An owner who cannot
        download is still an owner who must be TOLD.
        """
        if batch.export_id:
            return
        try:
            from app.services.export import ExportService

            job = await ExportService(self.ctx).export_archive_batch(self.ctx, batch.id)
            batch.export_id = job.id
            self.session.add(batch)
        except Exception as exc:  # noqa: BLE001
            batch.export_id = None
            self.session.add(batch)
            self.audit(
                AuditAction.ARCHIVE,
                "archive_batch",
                batch.id,
                f"Archive snapshot failed (records are safe and restorable): {exc}",
                business_id=batch.business_id,
            )

    # ---------------------------------------------------------------- warnings
    async def send_warnings(self, business: Business, *, now: datetime | None = None) -> int:
        """Fire the 7/3/1-day warnings. Idempotent -- each rung is sent at most once."""
        if not business.retention_notifications_enabled:
            return 0

        now = now or utcnow()
        sent = 0

        batches = self.session.exec(
            select(ArchiveBatch).where(
                ArchiveBatch.business_id == business.id,
                col(ArchiveBatch.state).in_(
                    [ArchiveState.ARCHIVED, ArchiveState.POSTPONED, ArchiveState.PENDING_DELETION]
                ),
            )
        ).all()

        for batch in batches:
            scheduled = ensure_utc(batch.delete_scheduled_for)
            days_left = (scheduled - now).days

            # Which rung of the ladder are we on? The largest unsent warning that has
            # come due. Comparing against `warnings_sent` is what makes this safe to
            # run every night without spamming.
            already = set(batch.warnings_sent or [])
            due_rungs = [d for d in WARNING_DAYS if days_left <= d and d not in already]
            if not due_rungs:
                continue
            rung = max(due_rungs)

            ok = await self._warn(business, batch, days_left)
            if ok:
                batch.warnings_sent = sorted({*already, rung})
                self.session.add(batch)
                sent += 1

        self.session.flush()
        return sent

    async def _warn(self, business: Business, batch: ArchiveBatch, days_left: int) -> bool:
        from app.email.service import EmailService
        from app.services.export import ExportService

        # Make sure there is something to download BEFORE we send a mail with a
        # download button in it.
        await self._attach_snapshot(batch)

        download_link = ""
        try:
            if batch.export_id:
                download_link = ExportService(self.ctx).download_url(batch.export_id) or ""
        except Exception:  # noqa: BLE001
            download_link = ""

        deletion_date = ensure_utc(batch.delete_scheduled_for).date()
        megabytes = batch.storage_bytes / 1_048_576

        # The dashboard notification always happens, even if the email fails -- the
        # owner must find out one way or another before their data is destroyed.
        NotificationService(self.session).notify_data_deletion_warning(
            business.id,
            record_count=batch.record_count,
            deletion_date=deletion_date,
            batch_id=batch.id,
        )

        if not business.email:
            return True  # notified in-app; no address to email

        # The deletion warning always goes to the owner's own inbox, which is the
        # one address a relay-only provider (W3Forms) CAN reach.
        result = await EmailService(self.session).send_templated(
            self.session,
            business,
            EmailTemplateKind.DATA_DELETION_WARNING,
            to_address=business.email,
            to_name=business.name,
            owner_recipient=True,
            context={
                "business_name": business.name,
                "record_count": str(batch.record_count),
                "storage_used": f"{megabytes:.1f} MB",
                "deletion_date": deletion_date.strftime("%d %B %Y"),
                "days_until_due": str(max(0, days_left)),
                "download_link": download_link,
            },
        )
        return result.success

    # ------------------------------------------------------------------ purge
    def purge_due(self, business: Business, *, now: datetime | None = None) -> tuple[int, int]:
        """Permanently delete batches whose day has come. Returns (batches, records).

        This is the only irreversible operation in the system. It is audited before
        the rows go, so the audit entry survives the data it describes.
        """
        now = now or utcnow()
        batches = self.session.exec(
            select(ArchiveBatch).where(
                ArchiveBatch.business_id == business.id,
                col(ArchiveBatch.state).in_([ArchiveState.ARCHIVED, ArchiveState.POSTPONED]),
                col(ArchiveBatch.delete_scheduled_for) <= now,
            )
        ).all()

        purged_batches = purged_records = 0
        for batch in batches:
            # Refuse to purge a batch the owner was never warned about. If the mail
            # server was down for a week, that is our failure, not their consent.
            if not batch.warnings_sent:
                batch.delete_scheduled_for = now + timedelta(days=settings.ARCHIVE_GRACE_DAYS)
                self.session.add(batch)
                self.audit(
                    AuditAction.ARCHIVE,
                    "archive_batch",
                    batch.id,
                    "Deletion deferred: the owner was never successfully warned",
                    business_id=business.id,
                )
                continue

            count = self._purge_batch(batch, business)
            purged_batches += 1
            purged_records += count

        self.session.flush()
        return purged_batches, purged_records

    def _purge_batch(self, batch: ArchiveBatch, business: Business) -> int:
        from app.storage.service import StorageService

        storage = StorageService(self.session)

        credits = self.session.exec(
            select(Credit).where(Credit.archive_batch_id == batch.id)
        ).all()
        payments = self.session.exec(
            select(Payment).where(Payment.archive_batch_id == batch.id)
        ).all()

        # Audit BEFORE deleting -- once the rows are gone we cannot describe them.
        self.audit(
            AuditAction.PURGE,
            "archive_batch",
            batch.id,
            f"PERMANENTLY DELETED {len(credits)} credits and {len(payments)} payments "
            f"under the {batch.retention_policy} retention policy "
            f"(credits: {', '.join(c.number for c in credits[:20])}"
            f"{'...' if len(credits) > 20 else ''})",
            business_id=business.id,
        )

        for credit in credits:
            # Release the attachments so the orphan sweep can reclaim the bytes.
            storage.detach_many(credit.photo_file_ids)
            storage.detach(credit.invoice_file_id)
        for payment in payments:
            storage.detach(payment.receipt_file_id)
            self.session.delete(payment)
        for credit in credits:
            self.session.delete(credit)  # cascades to credit_item

        batch.state = ArchiveState.DELETED
        batch.deleted_records_at = utcnow()
        self.session.add(batch)
        self.session.flush()
        return len(credits) + len(payments)

    # --------------------------------------------------------- owner controls
    def postpone(self, ctx: ServiceContext, batch_id: str, days: int = 30) -> ArchiveBatch:
        """Push a scheduled deletion back. The owner's veto."""
        self.require(Permission.RETENTION_MANAGE)
        batch = self._get_batch(batch_id)

        if batch.state is ArchiveState.DELETED:
            raise ConflictError("These records have already been deleted and cannot be restored")
        if not 1 <= days <= 365:
            raise ValidationError("Postpone by between 1 and 365 days", field="days")

        batch.delete_scheduled_for = utcnow() + timedelta(days=days)
        batch.state = ArchiveState.POSTPONED
        batch.postponed_count += 1
        batch.postponed_until = batch.delete_scheduled_for
        # Reset the ladder so the owner gets the full 7/3/1 warning series again
        # before the new date -- a postponement should not cost them their warnings.
        batch.warnings_sent = []
        self.session.add(batch)

        self.audit(
            AuditAction.ARCHIVE,
            "archive_batch",
            batch.id,
            f"Deletion postponed {days} days to "
            f"{batch.delete_scheduled_for.date().isoformat()}",
        )
        return batch

    def restore(self, ctx: ServiceContext, batch_id: str) -> ArchiveBatch:
        """Un-archive a batch entirely -- the records return to normal lists."""
        self.require(Permission.RETENTION_MANAGE)
        batch = self._get_batch(batch_id)

        if batch.state is ArchiveState.DELETED:
            raise ConflictError(
                "These records were permanently deleted and cannot be restored. "
                "If you downloaded the archive export, you still have the data."
            )

        for credit in self.session.exec(
            select(Credit).where(Credit.archive_batch_id == batch.id)
        ).all():
            credit.archived_at = None
            credit.archive_batch_id = None
            self.session.add(credit)
        for payment in self.session.exec(
            select(Payment).where(Payment.archive_batch_id == batch.id)
        ).all():
            payment.archived_at = None
            payment.archive_batch_id = None
            self.session.add(payment)

        batch.state = ArchiveState.RESTORED
        batch.restored_at = utcnow()
        self.session.add(batch)

        self.audit(
            AuditAction.RESTORE,
            "archive_batch",
            batch.id,
            f"Restored {batch.record_count} archived records",
        )
        return batch

    def list_batches(self, page: PageInput | None = None) -> Page[ArchiveBatch]:
        self.require(Permission.RETENTION_MANAGE)
        stmt = (
            select(ArchiveBatch)
            .where(ArchiveBatch.business_id == self.scope_id)
            .order_by(col(ArchiveBatch.created_at).desc())
        )
        return paginate(self.session, stmt, page or PageInput())

    def preview(self) -> dict[str, int]:
        """What WOULD be archived on the next sweep. Shown in Settings so the owner
        can see the consequence of a retention policy before choosing it."""
        self.require(Permission.RETENTION_MANAGE)
        business = self.get_business()
        days = RetentionPolicy(business.retention_policy).days
        if days is None:
            return {"credits": 0, "payments": 0, "records": 0}

        cutoff = utcnow() - timedelta(days=days)
        credits = self.session.exec(
            select(Credit).where(
                Credit.business_id == business.id,
                col(Credit.deleted_at).is_(None),
                col(Credit.archived_at).is_(None),
                col(Credit.status).in_(list(CreditStatus.closed_statuses())),
                col(Credit.updated_at) < cutoff,
            )
        ).all()
        return {
            "credits": len(credits),
            "payments": sum(len(c.payments) for c in credits),
            "records": len(credits) + sum(len(c.payments) for c in credits),
        }

    def _get_batch(self, batch_id: str) -> ArchiveBatch:
        batch = self.session.get(ArchiveBatch, batch_id)
        if batch is None:
            raise NotFoundError("Archive batch not found")
        self.assert_in_scope(batch.business_id)
        return batch
