"""APScheduler wiring.

ARCHITECTURE NOTE — the scheduler lives in the API process, and what that costs
------------------------------------------------------------------------------
An in-process AsyncIOScheduler is the right call for this product's constraints:
zero extra infrastructure, zero extra cost, and it works on a $5 VPS or a
Raspberry Pi in the back of the shop. It is what makes "free hosting" viable.

The trade-off, stated plainly:
  * If you run TWO API instances, BOTH schedulers wake up and both run the jobs.
    The jobs are idempotent (see jobs.py), so this is not a correctness disaster --
    but it is wasted work, and duplicate emails are possible in the window between
    two workers reading the same SCHEDULED row. Run ONE instance, or set
    SCHEDULER_ENABLED=false on all but one.
  * On serverless (Vercel/Lambda) there is no long-lived process, so the scheduler
    never fires at all. That is why the DEPLOYMENT guide puts the backend on a
    persistent host and only the frontend on Vercel.

The migration path when you outgrow this: swap MemoryJobStore for
SQLAlchemyJobStore (the DB becomes the lock) or move the jobs to a real queue
(Celery/Dramatiq/ARQ). Nothing in jobs.py changes -- they are plain async
functions with no APScheduler dependency, deliberately.
"""

from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.scheduler.jobs import (
    daily_maintenance,
    monthly_maintenance,
    reminder_sweep,
    statement_run,
    weekly_maintenance,
)

log = logging.getLogger("app.scheduler")

_scheduler: AsyncIOScheduler | None = None


def start_scheduler() -> AsyncIOScheduler | None:
    global _scheduler
    if not settings.SCHEDULER_ENABLED:
        log.info("Scheduler disabled (SCHEDULER_ENABLED=false)")
        return None
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler(
        timezone=settings.SCHEDULER_TIMEZONE,
        job_defaults={
            # If the process was down when a job was due, run it once on startup
            # rather than skipping the day entirely -- a missed reminder sweep means
            # customers were not reminded.
            "coalesce": True,          # collapse a backlog into a single run
            "misfire_grace_time": 3600,
            "max_instances": 1,        # never overlap a job with itself
        },
    )

    # Hourly, on the hour. Each business is filtered to its own local send hour
    # inside the job -- see jobs.py for why this beats a daily cron.
    scheduler.add_job(
        reminder_sweep,
        CronTrigger(minute=0),
        id="reminder_sweep",
        name="Send due-date reminders",
        replace_existing=True,
    )

    # 01:15 -- before the cleanup, and well before any shop's reminder hour, so a
    # statement that falls due today is already OVERDUE when the morning's reminders
    # are chosen. Same ordering logic as promote_overdue inside the reminder sweep.
    #
    # DAILY, not monthly: closing is idempotent and refuses an unfinished period, so
    # this is a no-op on ~28 days of every month. A monthly cron that misses its one
    # firing (a scale-to-zero host asleep at 04:30 on the 1st) skips a shop's billing
    # for a month; retrying daily costs one cheap query. See jobs.statement_run.
    scheduler.add_job(
        statement_run,
        CronTrigger(hour=1, minute=15),
        id="statement_run",
        name="Close the month + refresh statement statuses",
        replace_existing=True,
    )

    # 02:30 -- quiet hours, and offset from the top of the hour so it never
    # contends with the reminder sweep for SQLite's write lock.
    scheduler.add_job(
        daily_maintenance,
        CronTrigger(hour=2, minute=30),
        id="daily_maintenance",
        name="Daily cleanup + retention pipeline",
        replace_existing=True,
    )

    # Sunday 03:30 -- VACUUM rewrites the whole database file and briefly locks it.
    scheduler.add_job(
        weekly_maintenance,
        CronTrigger(day_of_week="sun", hour=3, minute=30),
        id="weekly_maintenance",
        name="Weekly database optimisation",
        replace_existing=True,
    )

    # 1st of the month, 04:30.
    scheduler.add_job(
        monthly_maintenance,
        CronTrigger(day=1, hour=4, minute=30),
        id="monthly_maintenance",
        name="Monthly integrity verification",
        replace_existing=True,
    )

    scheduler.start()
    _scheduler = scheduler
    log.info(
        "Scheduler started (%s) with jobs: %s",
        settings.SCHEDULER_TIMEZONE,
        ", ".join(j.id for j in scheduler.get_jobs()),
    )
    return scheduler


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
        log.info("Scheduler stopped")


def get_scheduler() -> AsyncIOScheduler | None:
    return _scheduler


__all__ = ["get_scheduler", "shutdown_scheduler", "start_scheduler"]
