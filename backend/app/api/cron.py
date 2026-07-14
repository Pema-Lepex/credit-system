"""External cron trigger -- how reminders survive a free, scale-to-zero host.

THE PROBLEM
-----------
APScheduler runs *inside* this process (see app/scheduler/__init__.py). Free hosts
suspend the process when no request has arrived for a while: Render's free web
service sleeps after ~15 minutes idle. A sleeping process runs no scheduler, so a
reminder whose send-hour passes while the app is asleep is never sent at all -- it
is MISSED, not queued. That silently breaks the one feature the product exists for.

THE FIX
-------
Let something outside the process do the waking. A free cron service (cron-job.org,
UptimeRobot, GitHub Actions on a schedule) calls:

    POST https://your-api.onrender.com/api/cron/reminders
    Authorization: Bearer $CRON_SECRET

hourly. The request itself wakes the host, and the handler runs the very same
``reminder_sweep()`` the in-process scheduler would have run. No duplicated logic:
this is a second *trigger* for one implementation, not a second implementation.

WHY HOURLY IS THE RIGHT CADENCE, AND WHY DOUBLE-FIRING IS HARMLESS
------------------------------------------------------------------
``reminder_sweep`` already asks each business "is it now your chosen hour, in your
timezone, and have I not already sent for you today?" -- so 23 of every 24 pings do
essentially nothing and return in milliseconds. It is also idempotent by
construction (the ``_ran_today`` guard is derived from the last SENT reminder in the
database, not from memory). That matters here more than it does for APScheduler: a
cron service that times out and retries, or one that overlaps with a scheduler that
happens to be awake, cannot cause a double-send.

SECURITY
--------
The endpoint triggers email sends and database maintenance, so it is authenticated
with a shared secret compared in constant time. With CRON_SECRET unset it refuses to
run anything -- it fails closed rather than existing as an open trigger.
"""

from __future__ import annotations

import hmac
import logging
from typing import Annotated, Literal

from fastapi import APIRouter, Header, HTTPException, Query

from app.core.config import settings
from app.scheduler.jobs import run_job_now

log = logging.getLogger("app.cron")

router = APIRouter(prefix="/cron", tags=["cron"])

# The jobs an external caller may trigger, mapped to the cadence to schedule them at.
# Anything not named here is not reachable, so adding a job to the scheduler does not
# silently widen this endpoint's surface.
JobName = Literal["reminders", "daily", "weekly", "monthly"]


def _authorise(authorization: str | None, token: str | None) -> None:
    """Constant-time check of the shared secret.

    The secret is accepted either as a Bearer header (correct) or as a ``?token=``
    query parameter (grubby, but several free cron services can only fetch a plain
    URL and cannot set headers -- refusing them would push the user toward leaving
    the endpoint unauthenticated, which is strictly worse).
    """
    if not settings.CRON_SECRET:
        # Fail closed. An unauthenticated route that sends email and VACUUMs the
        # database is not something to leave lying around by default.
        raise HTTPException(
            status_code=503,
            detail=(
                "Cron endpoint is disabled: CRON_SECRET is not set. Set it in the "
                "environment to enable external scheduling."
            ),
        )

    supplied = ""
    if authorization and authorization.lower().startswith("bearer "):
        supplied = authorization[7:].strip()
    elif token:
        supplied = token.strip()

    # compare_digest, not ==: a plain comparison leaks the secret one byte at a time
    # to anyone who can time the response.
    if not supplied or not hmac.compare_digest(supplied, settings.CRON_SECRET):
        raise HTTPException(status_code=401, detail="Invalid cron secret")


@router.api_route("/{job}", methods=["GET", "POST"])
async def run_cron_job(
    job: JobName,
    authorization: Annotated[str | None, Header()] = None,
    token: Annotated[str | None, Query()] = None,
) -> dict[str, object]:
    """Run one scheduler job now.

    GET is allowed alongside POST for the same reason ``?token=`` is: the free cron
    services people actually reach for often issue nothing but a GET. This is not a
    REST purity contest -- an unreachable endpoint protects nobody.

    Runs synchronously and reports what happened, so the cron service's own dashboard
    shows a red run when the sweep fails. That costs a slow first request on a cold
    host (Render can take ~50s to wake), which may exceed a cron service's timeout on
    the first ping. Harmless: the job still completes server-side, and because these
    jobs are idempotent, the retry that follows is a no-op.
    """
    _authorise(authorization, token)

    log.info("Cron trigger: %s", job)
    try:
        detail = await run_job_now(job)
    except ValueError as exc:  # unknown job name -- Literal should prevent it
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        # Report the failure to the caller so its dashboard goes red, rather than
        # returning 200 and letting a broken sweep look healthy for weeks.
        log.exception("Cron job %s failed", job)
        raise HTTPException(status_code=500, detail=f"Job {job!r} failed: {exc!r}") from exc

    return {"job": job, "status": "completed", "detail": detail}
