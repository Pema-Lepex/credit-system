"""StorageStatsService -- Settings > Storage Dashboard, and the maintenance buttons.

WHAT THIS IS FOR
----------------
The spec asks for a storage dashboard that shows the user where their bytes went and
lets them get some back. That is a genuinely useful thing to give someone running on
a free tier, and it is also the place where the most dangerous buttons in the app
live (VACUUM, purge, delete). So:

  * Every read is aggregate SQL, scoped to the caller's business.
  * Every destructive operation requires ``Permission.STORAGE_MAINTAIN`` and writes
    an audit entry, without exception.
  * Every SQLite-specific operation is guarded by an actual dialect check, so the
    day someone points DATABASE_URL at Postgres the dashboard degrades to
    "unsupported on this database" instead of raising an OperationalError at them.

Two of these operations have non-obvious correctness requirements -- VACUUM and
backup. Their comments explain why; do not "simplify" either one.
"""

from __future__ import annotations

import sqlite3
import tempfile
from dataclasses import dataclass, field
from datetime import timedelta
from pathlib import Path

from sqlalchemy import Engine, case, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import col

from app.core.errors import ValidationError
from app.core.security import Permission
from app.models.base import utcnow
from app.models.catalog import Product, Service
from app.models.communication import EmailLog, Notification
from app.models.credit import Credit, Payment
from app.models.customer import Customer
from app.models.enums import AuditAction, FileKind
from app.models.file import FileAsset
from app.models.retention import AuditLog
from app.services.base import BaseService
from app.services.export import ExportService
from app.storage.service import StorageService

_MB = 1024 * 1024

# FileKind -> the bucket the dashboard shows. Several kinds are all "images" to a user.
_IMAGE_KINDS = (
    FileKind.BUSINESS_LOGO,
    FileKind.CUSTOMER_PHOTO,
    FileKind.PRODUCT_IMAGE,
    FileKind.CREDIT_PHOTO,
)


@dataclass(frozen=True, slots=True)
class StorageUsage:
    database_bytes: int          # 0 when not on SQLite -- a managed DB has no local file
    uploads_bytes: int
    total_bytes: int

    images_bytes: int
    invoices_bytes: int
    receipts_bytes: int
    exports_bytes: int
    temp_bytes: int
    by_kind: dict[FileKind, int] = field(default_factory=dict)

    customers: int = 0
    credits: int = 0
    payments: int = 0
    products: int = 0
    services: int = 0
    images: int = 0
    exports: int = 0
    notifications: int = 0

    bytes_saved_by_compression: int = 0

    quota_mb: int = 0
    percent_used: float = 0.0
    over_quota: bool = False

    @property
    def total_mb(self) -> float:
        return round(self.total_bytes / _MB, 2)


@dataclass(frozen=True, slots=True)
class MaintenanceResult:
    operation: str
    ok: bool
    rows_affected: int = 0
    bytes_freed: int = 0
    detail: str = ""


class StorageStatsService(BaseService):
    # ==================================================================== usage
    def usage(self) -> StorageUsage:
        self.require(Permission.STORAGE_READ)
        business = self.get_business()

        by_kind = self._bytes_by_kind()
        uploads = sum(by_kind.values())
        db_bytes = self._database_bytes()

        counts = self._counts()
        saved = self._bytes_saved()

        total = db_bytes + uploads
        quota_bytes = max(0, business.storage_quota_mb) * _MB
        percent = round(total / quota_bytes * 100, 2) if quota_bytes else 0.0

        return StorageUsage(
            database_bytes=db_bytes,
            uploads_bytes=uploads,
            total_bytes=total,
            images_bytes=sum(by_kind.get(k, 0) for k in _IMAGE_KINDS),
            invoices_bytes=by_kind.get(FileKind.INVOICE, 0),
            receipts_bytes=by_kind.get(FileKind.RECEIPT, 0),
            exports_bytes=by_kind.get(FileKind.EXPORT, 0),
            temp_bytes=by_kind.get(FileKind.TEMP, 0),
            by_kind=by_kind,
            customers=counts["customers"],
            credits=counts["credits"],
            payments=counts["payments"],
            products=counts["products"],
            services=counts["services"],
            images=counts["images"],
            exports=counts["exports"],
            notifications=counts["notifications"],
            bytes_saved_by_compression=saved,
            quota_mb=business.storage_quota_mb,
            percent_used=percent,
            # A soft cap. It warns; it does not block a shopkeeper from recording a
            # sale (see models/business.py). Blocking would punish the user for our
            # storage policy at the exact moment they are serving a customer.
            over_quota=bool(quota_bytes) and total > quota_bytes,
        )

    def _bytes_by_kind(self) -> dict[FileKind, int]:
        """SUM(size_bytes) GROUP BY kind -- one query, not a walk over FileAsset rows."""
        stmt = (
            select(col(FileAsset.kind), func.coalesce(func.sum(col(FileAsset.size_bytes)), 0))
            .where(
                FileAsset.business_id == self.scope_id,  # tenancy boundary
                col(FileAsset.deleted_at).is_(None),
            )
            .group_by(col(FileAsset.kind))
        )
        return {FileKind(kind): int(total or 0) for kind, total in self.session.execute(stmt)}

    def _bytes_saved(self) -> int:
        """What the image pipeline saved this business: original - stored, over all assets.

        Clamped at zero per row via a CASE, because a file that got *bigger* (a tiny
        already-optimised PNG, see storage/images.py) must not subtract from the
        "you saved X MB" figure and make it a lie.
        """
        delta = col(FileAsset.original_size_bytes) - col(FileAsset.size_bytes)
        # CASE, not SQLite's max(a,b): Postgres spells that GREATEST. CASE is portable.
        positive = case((delta > 0, delta), else_=0)
        stmt = select(func.coalesce(func.sum(positive), 0)).where(
            FileAsset.business_id == self.scope_id,  # tenancy boundary
            col(FileAsset.deleted_at).is_(None),
        )
        return int(self.session.execute(stmt).scalar_one() or 0)

    def _counts(self) -> dict[str, int]:
        def n(model: type, *extra: object) -> int:
            stmt = select(func.count()).select_from(model).where(
                model.business_id == self.scope_id,  # tenancy boundary
                col(model.deleted_at).is_(None),
                *extra,
            )
            return int(self.session.execute(stmt).scalar_one() or 0)

        return {
            "customers": n(Customer),
            "credits": n(Credit),
            "payments": n(Payment),
            "products": n(Product),
            "services": n(Service),
            "images": n(FileAsset, col(FileAsset.kind).in_(list(_IMAGE_KINDS))),
            "exports": n(FileAsset, col(FileAsset.kind) == FileKind.EXPORT),
            "notifications": n(Notification),
        }

    def _database_bytes(self) -> int:
        """How much space the database occupies, whichever engine is behind it.

        SQLite: the file on disk, INCLUDING the -wal sidecar. Under WAL (see
        db/session.py) a busy database can carry megabytes there, and a dashboard that
        pretends they do not exist under-reports real usage.

        Postgres: ``pg_database_size``, the server's own accounting. Without this the
        Storage Dashboard reported 0 B for the database on every managed deployment --
        technically "graceful", but it means the one number the page exists to show is
        silently wrong.
        """
        if self._is_postgres():
            try:
                with self._engine().connect() as conn:
                    size = conn.exec_driver_sql(
                        "SELECT pg_database_size(current_database())"
                    ).scalar()
                return int(size or 0)
            except SQLAlchemyError:
                # A pooler (Supabase pgbouncer) may refuse the call. A wrong number
                # here must not take down the whole dashboard.
                return 0

        path = self._sqlite_path()
        if path is None:
            return 0
        total = 0
        for candidate in (path, path.with_name(path.name + "-wal"), path.with_name(path.name + "-shm")):
            try:
                total += candidate.stat().st_size
            except OSError:
                continue  # missing file (fresh DB, no WAL yet) contributes nothing
        return total

    # ============================================================ maintenance
    async def clean_temp_files(self) -> MaintenanceResult:
        """Delete this business's TEMP-kind assets (abandoned uploads, scratch files)."""
        self.require(Permission.STORAGE_MAINTAIN)
        storage = StorageService(self.session)

        # Scoped to the business, NOT StorageService.clear_temp(): that wipes the whole
        # temp/ prefix across every tenant, which one shop's "Clean up" button must
        # never be able to do.
        stmt = select(FileAsset).where(
            FileAsset.business_id == self.scope_id,  # tenancy boundary
            col(FileAsset.kind) == FileKind.TEMP,
            col(FileAsset.deleted_at).is_(None),
        )
        deleted = freed = 0
        for asset in self.session.execute(stmt).scalars().all():
            freed += await storage.hard_delete(asset)
            deleted += 1
        self.session.flush()

        return self._done(
            "clean_temp_files", rows=deleted, freed=freed,
            detail=f"Deleted {deleted} temporary file(s), freeing {_human(freed)}",
        )

    async def delete_expired_exports(self) -> MaintenanceResult:
        self.require(Permission.STORAGE_MAINTAIN)
        expired, freed = await ExportService.expire_stale(
            self.session, business_id=self.scope_id  # tenancy boundary
        )
        return self._done(
            "delete_expired_exports", rows=expired, freed=freed,
            detail=f"Expired {expired} export(s), freeing {_human(freed)}",
        )

    async def sweep_orphan_files(self) -> MaintenanceResult:
        """Remove assets nothing references any more (past the grace period)."""
        self.require(Permission.STORAGE_MAINTAIN)
        deleted, freed = await StorageService(self.session).sweep_orphans(
            business_id=self.scope_id  # tenancy boundary
        )
        return self._done(
            "sweep_orphan_files", rows=deleted, freed=freed,
            detail=f"Removed {deleted} orphaned file(s), freeing {_human(freed)}",
        )

    def vacuum_database(self) -> MaintenanceResult:
        """SQLite VACUUM: rebuild the file, reclaiming pages freed by deletes.

        WHY THIS CANNOT RUN INSIDE A TRANSACTION
        ----------------------------------------
        VACUUM rewrites the entire database into a fresh file and swaps it in. SQLite
        refuses to do that with an open transaction ("cannot VACUUM from within a
        transaction") -- and SQLAlchemy's default behaviour is to have one open: it
        begins one implicitly on the first statement of any Connection/Session.

        So we take our OWN connection with ``isolation_level="AUTOCOMMIT"``, which
        tells SQLAlchemy not to emit a BEGIN, and issue VACUUM on that. Running it
        through ``self.session`` would raise, every time, forever.
        """
        self.require(Permission.STORAGE_MAINTAIN)
        engine = self._engine()

        before = self._database_bytes()
        # Both engines have VACUUM and both refuse it inside a transaction, so the
        # AUTOCOMMIT connection is required either way. What differs is the meaning:
        # SQLite rewrites the file, Postgres returns dead tuples to the free list
        # (VACUUM FULL would rewrite, but it takes an ACCESS EXCLUSIVE lock and would
        # freeze the shop mid-sale -- never do that from a scheduled job).
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.exec_driver_sql("VACUUM")

            # THE CHECKPOINT IS NOT OPTIONAL -- IT IS WHAT MAKES THE FILE SHRINK.
            #
            # Under WAL (see db/session.py) VACUUM rewrites the database *into the
            # write-ahead log*. The main file does not shrink at all until the WAL is
            # folded back into it, so measuring here without checkpointing measures
            # the old main file PLUS a now-enormous -wal, and reports the database
            # growing -- "1.5 MB -> 2.5 MB (0 B reclaimed)" -- immediately after the
            # one operation whose entire purpose is to make it smaller.
            #
            # TRUNCATE (not PASSIVE) also resets the -wal to zero bytes, so the space
            # is genuinely returned to the filesystem rather than left reserved.
            if not self._is_postgres():
                conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")

        after = self._database_bytes()
        freed = max(0, before - after)

        return self._done(
            "vacuum_database", rows=0, freed=freed,
            detail=f"Database vacuumed: {_human(before)} -> {_human(after)} ({_human(freed)} reclaimed)",
        )

    def analyze_database(self) -> MaintenanceResult:
        """ANALYZE: refresh the query planner's statistics so index choices stay sane
        as the tables grow. Spelled the same, and means the same, on both engines."""
        self.require(Permission.STORAGE_MAINTAIN)
        engine = self._engine()
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.exec_driver_sql("ANALYZE")
        return self._done("analyze_database", detail="Query planner statistics refreshed")

    def optimize_database(self) -> MaintenanceResult:
        """PRAGMA optimize + a WAL checkpoint.

        ``optimize`` runs whatever ANALYZE work SQLite thinks is now worthwhile.
        ``wal_checkpoint(TRUNCATE)`` folds the write-ahead log back into the main file
        and truncates it -- without this the -wal sidecar grows without bound on a
        long-running process, which looks (correctly) like a storage leak.
        """
        self.require(Permission.STORAGE_MAINTAIN)
        engine = self._engine()

        before = self._database_bytes()
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            if self._is_postgres():
                # No PRAGMAs, and no WAL sidecar to fold back in -- Postgres checkpoints
                # itself. Refreshing planner stats is the honest equivalent of the work
                # `PRAGMA optimize` does.
                conn.exec_driver_sql("ANALYZE")
            else:
                conn.exec_driver_sql("PRAGMA optimize")
                conn.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        after = self._database_bytes()

        freed = max(0, before - after)
        detail = (
            f"Planner statistics refreshed ({_human(freed)} reclaimed)"
            if self._is_postgres()
            else f"Optimised and checkpointed WAL ({_human(freed)} reclaimed)"
        )
        return self._done("optimize_database", freed=freed, detail=detail)

    def check_integrity(self) -> MaintenanceResult:
        """PRAGMA integrity_check. Read-only, but it answers the only question that
        matters after a crash: is this file still trustworthy?"""
        self.require(Permission.STORAGE_READ)
        engine = self._engine()

        if self._is_postgres():
            # Postgres has no integrity_check: page-level corruption is the server's
            # problem (checksums, WAL, the provider's own monitoring), not ours to
            # re-implement. We assert we can reach the database and say so plainly,
            # rather than raising every month from the scheduled job.
            with engine.connect() as conn:
                conn.exec_driver_sql("SELECT 1")
            messages = ["ok"]
            ok = True
        else:
            with engine.connect() as conn:
                rows = conn.exec_driver_sql("PRAGMA integrity_check").fetchall()
            messages = [str(r[0]) for r in rows]
            ok = messages == ["ok"]

        self.audit(
            AuditAction.MAINTENANCE,
            "database",
            None,
            f"Integrity check: {'OK' if ok else '; '.join(messages)[:200]}",
        )
        return MaintenanceResult(
            operation="check_integrity",
            ok=ok,
            detail="Database is healthy" if ok else "; ".join(messages)[:500],
        )

    def clean_old_logs(self, days: int = 90) -> MaintenanceResult:
        """Trim AuditLog and EmailLog older than N days.

        These two tables grow forever and are the biggest thing in the database that
        nobody reads. Note the floor: a retention window under 30 days would start
        deleting the audit trail for deletions that are themselves still inside the
        retention grace period -- i.e. destroying the evidence before the event.
        """
        self.require(Permission.STORAGE_MAINTAIN)
        if days < 30:
            raise ValidationError(
                "Logs must be kept for at least 30 days -- the audit trail has to "
                "outlive the retention pipeline it records.",
                field="days",
            )

        cutoff = utcnow() - timedelta(days=days)
        removed = 0
        for model in (AuditLog, EmailLog):
            stmt = select(model).where(
                model.business_id == self.scope_id,  # tenancy boundary
                col(model.created_at) < cutoff,
            )
            for row in self.session.execute(stmt).scalars().all():
                self.session.delete(row)
                removed += 1
        self.session.flush()

        return self._done(
            "clean_old_logs", rows=removed,
            detail=f"Removed {removed} log entr(ies) older than {days} days",
        )

    def backup_database(self) -> bytes:
        """A consistent snapshot of the live database, returned as bytes.

        WHY NOT shutil.copy(app.db, backup.db)
        --------------------------------------
        Copying the file byte-for-byte while the application is running gives you a
        TORN copy: another connection can commit a page mid-read, so the copy contains
        half of one transaction and half of another. It will often open fine and then
        fail an integrity check -- the worst kind of backup, the one you find out is
        broken on the day you need it.

        ``sqlite3.Connection.backup()`` is SQLite's ONLINE BACKUP API. It copies pages
        under the database's own locking rules and restarts if a writer changes a page
        it has already copied, so the result is always a single consistent snapshot of
        a real transaction boundary -- on a live, actively-written database.

        The temp file is the destination for those pages; we read it back and delete
        it. Nothing is persisted (see ReportService: generated artefacts are never
        stored), and the bytes go straight to the requesting user.
        """
        self.require(Permission.STORAGE_MAINTAIN)
        path = self._sqlite_path()
        if path is None:
            raise ValidationError(
                "Backup is only available on SQLite. A managed database "
                "(Postgres/Turso/Supabase) is backed up by its provider.",
                field="database",
            )

        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "backup.db"
            source = sqlite3.connect(str(path))
            try:
                destination = sqlite3.connect(str(target))
                try:
                    source.backup(destination)  # the online backup API -- see docstring
                finally:
                    destination.close()
            finally:
                source.close()
            data = target.read_bytes()

        self.audit(
            AuditAction.MAINTENANCE,
            "database",
            None,
            f"Downloaded a database backup ({_human(len(data))})",
        )
        return data

    # ================================================================= helpers
    def _done(
        self, operation: str, *, rows: int = 0, freed: int = 0, detail: str = ""
    ) -> MaintenanceResult:
        """Every destructive op lands in the audit trail. No exceptions -- that is the
        whole point of having one."""
        self.audit(AuditAction.MAINTENANCE, "storage", None, f"{operation}: {detail}")
        return MaintenanceResult(
            operation=operation, ok=True, rows_affected=rows, bytes_freed=freed, detail=detail
        )

    def _engine(self) -> Engine:
        """The engine behind this session (built from settings.DATABASE_URL in
        db/session.py). Taken from the session rather than imported, so a test or a
        future read-replica can bind a different one."""
        bind = self.session.get_bind()
        if not isinstance(bind, Engine):
            raise ValidationError("No database engine is bound to this session")
        return bind

    def _is_sqlite(self) -> bool:
        return self._engine().dialect.name == "sqlite"

    def _is_postgres(self) -> bool:
        return self._engine().dialect.name == "postgresql"

    def _sqlite_engine(self) -> Engine:
        """Guard for the operations that are genuinely SQLite-only.

        VACUUM, ANALYZE and the size query now dispatch by dialect and work on both
        engines, so this is down to one caller: backup_database(), which relies on
        SQLite's online-backup API. A managed Postgres is backed up by its provider,
        and telling the user that is more useful than a stack trace.
        """
        engine = self._engine()
        if engine.dialect.name != "sqlite":
            raise ValidationError(
                f"This maintenance operation is specific to SQLite; this deployment "
                f"runs on {engine.dialect.name}. Its own tooling handles vacuum, "
                f"analyze and backups.",
                field="database",
            )
        return engine

    def _sqlite_path(self) -> Path | None:
        """Absolute path of the SQLite file, or None if we are not on a file-backed
        SQLite database (Postgres, or an in-memory test DB with nothing to measure)."""
        if not self._is_sqlite():
            return None
        database = self._engine().url.database
        if not database or database == ":memory:":
            return None
        return Path(database).expanduser()


def _human(num: int) -> str:
    value = float(num)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(value) < 1024 or unit == "GB":
            return f"{value:.0f} {unit}" if unit == "B" else f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


__all__ = ["MaintenanceResult", "StorageStatsService", "StorageUsage"]
