"""The background jobs. Everything automatic in the product happens here.

WHY THE REMINDER JOB RUNS HOURLY, NOT DAILY
--------------------------------------------
Each business chooses the hour it wants reminders sent (``reminder_send_hour``), in
its OWN timezone. A single daily cron at, say, 08:00 UTC would fire at 14:00 in
Thimphu and 03:00 in Denver -- the shop in Bhutan sends its "due tomorrow" notices
in the middle of the afternoon, and the one in Colorado wakes its customers up.

So the reminder job wakes every hour and asks each business a simple question: "is
it now your chosen hour, where you are, and have I not already run for you today?"
Businesses whose hour it isn't are skipped in microseconds. This handles every
timezone, and DST transitions, without a per-business cron entry.

The ``_ran_today`` guard is what makes that safe: an hourly job that only acts once
per business per local day. It is derived from the data (the last SENT reminder),
not from in-memory state, so a restart cannot cause a double-send.

IDEMPOTENCY, GENERALLY
----------------------
Every job here can be run twice with no ill effect. That is a hard requirement, not
an aspiration: APScheduler will re-run a job after a crash, a deploy can overlap two
workers, and an admin can hit "Run now". Idempotency is enforced structurally --
unique constraints on reminders, `warnings_sent` ladders on archive batches,
state machines on exports -- rather than by hoping the job runs exactly once.

FAILURE ISOLATION
-----------------
One business's broken data must never stop the sweep for everyone else. Every
per-business step is wrapped: it logs, records, and moves on.
"""

from __future__ import annotations

import logging
from datetime import date

from sqlmodel import col, select

from app.db.session import session_scope
from app.models.business import Business
from app.models.communication import ScheduledReminder
from app.models.enums import AuditAction, ReminderStatus
from app.models.retention import AuditLog
from app.services.base import ServiceContext
from app.services.credit import CreditService
from app.services.export import ExportService
from app.services.reminder import ReminderService, SweepResult
from app.services.retention import RetentionService
from app.services.statement import StatementService
from app.services.storage_stats import StorageStatsService

log = logging.getLogger("app.scheduler")


def _system_ctx(session, business_id: str | None = None) -> ServiceContext:
    """A context with no user -- the scheduler acts as the system.

    ``user=None`` means permission checks are bypassed for jobs (they are not
    reachable from an HTTP request), and audit rows are attributed to "system",
    which is exactly how an operator reading the audit log wants to see them.
    """
    return ServiceContext(
        session=session, user=None, business_id=business_id, system=True
    )


def _active_businesses(session) -> list[Business]:
    return list(
        session.exec(
            select(Business).where(
                Business.is_active == True,  # noqa: E712  (SQL, not Python truthiness)
                col(Business.deleted_at).is_(None),
            )
        ).all()
    )


# ---------------------------------------------------------------------------
# HOURLY: reminders (the product's whole point)
# ---------------------------------------------------------------------------
async def reminder_sweep() -> None:
    """Plan and send due-date reminders for every business whose hour it is."""
    with session_scope() as session:
        for business in _active_businesses(session):
            try:
                local_now = _local_now(business)
                if local_now.hour != business.reminder_send_hour:
                    continue
                today = local_now.date()
                if _ran_today(session, business.id, today):
                    continue

                ctx = _system_ctx(session, business.id)
                service = ReminderService(ctx)

                # Promote overdue FIRST, so a credit that fell due today is already
                # OVERDUE by the time we decide which template to send. Otherwise the
                # customer gets a cheerful "due soon" note about a debt that is late.
                promoted = CreditService(ctx).promote_overdue(
                    business_id=business.id, today=today
                )

                planned = service.plan_for_business(business, today=today)
                result: SweepResult = await service.send_due(business, today=today, ctx=ctx)

                session.add(
                    AuditLog(
                        business_id=business.id,
                        action=AuditAction.REMINDER,
                        entity_type="scheduler",
                        summary=(
                            f"Reminder sweep: {promoted} promoted to overdue, "
                            f"{planned} planned, {result.sent} sent, "
                            f"{result.failed} failed, {result.skipped} skipped"
                        ),
                        actor_label="scheduler",
                    )
                )
                if result.errors:
                    log.warning(
                        "Reminder errors for %s: %s", business.name, result.errors[:3]
                    )
                log.info(
                    "Reminders for %s: sent=%d failed=%d skipped=%d",
                    business.name,
                    result.sent,
                    result.failed,
                    result.skipped,
                )
            except Exception:
                # Isolate: this business is broken, the rest are not.
                log.exception("Reminder sweep failed for business %s", business.id)


def _local_now(business: Business):
    from datetime import datetime

    from app.utils.dates import get_tz

    return datetime.now(get_tz(business.timezone))


def _ran_today(session, business_id: str, today: date) -> bool:
    """Have we already sent for this business today, in its own local day?

    Derived from the data rather than from memory, so a restart mid-sweep cannot
    cause a second run.
    """
    stmt = select(ScheduledReminder.id).where(
        ScheduledReminder.business_id == business_id,
        ScheduledReminder.status == ReminderStatus.SENT,
        col(ScheduledReminder.sent_at).is_not(None),
        col(ScheduledReminder.scheduled_for) == today,
    )
    return session.exec(stmt).first() is not None


# ---------------------------------------------------------------------------
# HOURLY: purge expired exports
# ---------------------------------------------------------------------------
async def export_purge() -> None:
    """Delete exports past their 24h TTL -- file and row -- across all tenants.

    HOURLY, not folded into daily_maintenance, because the TTL is a promise. With a
    single 02:30 sweep, an export generated at 03:00 expires at 03:00 the next day
    but survives until 02:30 the day after -- nearly 24 extra hours of a file the
    user was told had been deleted, still on disk and still on their quota. Hourly
    makes "24 hours" mean at most 25.

    Runs at :20 to stay clear of the reminder sweep on the hour, which holds
    SQLite's single write lock while it sends.
    """
    with session_scope() as session:
        try:
            purged, freed = await ExportService.purge_stale(session)
        except Exception:
            log.exception("Export purge failed")
            return

    if purged:
        log.info("Purged %d expired export(s), freeing %.1f KB", purged, freed / 1024)


# ---------------------------------------------------------------------------
# DAILY: storage hygiene + the retention pipeline
# ---------------------------------------------------------------------------
async def daily_maintenance() -> None:
    """Temp files, expired exports, orphaned uploads, retention warnings, purges."""
    with session_scope() as session:
        ctx = _system_ctx(session)
        stats = StorageStatsService(ctx)

        freed = 0
        try:
            for result in (
                await stats.clean_temp_files(),
                await stats.delete_expired_exports(),
                await stats.sweep_orphan_files(),
            ):
                freed += result.bytes_freed
                if not result.ok:
                    log.warning("%s: %s", result.operation, result.detail)
        except Exception:
            log.exception("Storage cleanup failed")

        log.info("Daily cleanup freed %.1f KB", freed / 1024)

        for business in _active_businesses(session):
            try:
                retention = RetentionService(_system_ctx(session, business.id))
                # Order matters: archive first (so new batches exist), then warn,
                # then purge. A batch created today is warned about today, and cannot
                # be purged until its grace period AND its warning ladder are done.
                batch = retention.archive_eligible(business)
                warned = await retention.send_warnings(business)
                purged_batches, purged_records = retention.purge_due(business)

                if batch or warned or purged_batches:
                    log.info(
                        "Retention for %s: archived=%s warned=%d purged=%d/%d",
                        business.name,
                        batch.record_count if batch else 0,
                        warned,
                        purged_batches,
                        purged_records,
                    )
            except Exception:
                log.exception("Retention failed for business %s", business.id)


# ---------------------------------------------------------------------------
# WEEKLY: database optimisation
# ---------------------------------------------------------------------------
async def weekly_maintenance() -> None:
    with session_scope() as session:
        ctx = _system_ctx(session)
        stats = StorageStatsService(ctx)
        try:
            stats.analyze_database()
            stats.optimize_database()
            trimmed = stats.clean_old_logs(days=90)
            log.info("Weekly maintenance: trimmed %d old log rows", trimmed.rows_affected)
        except Exception:
            log.exception("Weekly maintenance failed")

    # VACUUM must run on its own connection, outside any transaction -- see
    # StorageStatsService.vacuum_database(). Doing it here, after session_scope has
    # committed and closed, is what keeps it legal.
    try:
        with session_scope() as session:
            result = StorageStatsService(_system_ctx(session)).vacuum_database()
        log.info("VACUUM reclaimed %.1f KB", result.bytes_freed / 1024)
    except Exception:
        log.exception("VACUUM failed")


# ---------------------------------------------------------------------------
# MONTHLY: integrity
# ---------------------------------------------------------------------------
async def monthly_maintenance() -> None:
    with session_scope() as session:
        ctx = _system_ctx(session)
        stats = StorageStatsService(ctx)

        integrity = stats.check_integrity()
        if not integrity.ok:
            log.error("DATABASE INTEGRITY CHECK FAILED -- investigate immediately")

        # Re-derive every credit's totals from its payment ledger. This is the safety
        # net under the stored-totals denormalisation (see services/credit.py). If it
        # ever finds drift, a write path bypassed CreditService.recalculate().
        for business in _active_businesses(session):
            try:
                drift = CreditService(
                    _system_ctx(session, business.id)
                ).verify_integrity(business_id=business.id)
                if drift:
                    log.error(
                        "Balance drift corrected for %d credits in %s: %s",
                        len(drift),
                        business.name,
                        drift[:5],
                    )
                    session.add(
                        AuditLog(
                            business_id=business.id,
                            action=AuditAction.MAINTENANCE,
                            entity_type="credit",
                            summary=(
                                f"Integrity check corrected balance drift on "
                                f"{len(drift)} credit(s)"
                            ),
                            changes={"drift": drift[:50]},
                            actor_label="scheduler",
                        )
                    )
            except Exception:
                log.exception("Integrity check failed for business %s", business.id)


async def statement_run() -> None:
    """Close last month for every business that has opted in, and re-derive statuses.

    Runs DAILY, not monthly, and that is deliberate on both counts:

      * CLOSING is guarded by ``close_period``'s idempotency (UNIQUE customer+period)
        and by the "period has not finished" check, so a daily attempt is a no-op on
        every day except the first few of a new month. A monthly cron that fires
        while the host happens to be asleep -- which is the normal state of a
        scale-to-zero deployment -- would skip a shop's billing for a whole month.
        Retrying daily costs one cheap query and cannot double-bill.

      * REFRESHING statuses genuinely is daily work: a statement falls overdue on a
        particular morning, and a payment settles one the moment it lands.

    Per-business local time, like every other job here: "the 1st" is the 1st in the
    shop's timezone, not in UTC.
    """
    with session_scope() as session:
        for business in _active_businesses(session):
            if not business.statements_enabled:
                continue
            try:
                ctx = _system_ctx(session, business.id)
                service = StatementService(ctx)
                today = _local_now(business).date()

                result = service.close_period()
                if result.created:
                    log.info(
                        "Issued %d statement(s) for %s (%s) totalling %s",
                        result.created,
                        business.name,
                        result.period_start.strftime("%b %Y"),
                        result.total_billed,
                    )
                changed = service.refresh_statuses(today=today)
                if changed:
                    log.info("Updated %d statement status(es) for %s", changed, business.name)
                session.commit()
            except Exception:
                # One shop's bad month must not stop every other shop being billed.
                session.rollback()
                log.exception("Statement run failed for business %s", business.id)


# ---------------------------------------------------------------------------
# Manual triggers (the "Run now" buttons in the Storage Dashboard)
# ---------------------------------------------------------------------------
async def run_job_now(name: str) -> str:
    jobs = {
        "reminders": reminder_sweep,
        "statements": statement_run,
        "daily": daily_maintenance,
        "weekly": weekly_maintenance,
        "monthly": monthly_maintenance,
    }
    job = jobs.get(name)
    if job is None:
        raise ValueError(f"Unknown job: {name}. Known jobs: {', '.join(jobs)}")
    await job()
    return f"Job '{name}' completed"
