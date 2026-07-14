"""Timezone and period helpers.

ARCHITECTURE NOTE — the one timezone rule
------------------------------------------
Store UTC. Compute in UTC. Convert to the business's timezone ONLY at two edges:

  * REPORTING  -- "today's collections" means today in Thimphu, not in UTC. A shop
                  closing at 21:00 UTC+6 would otherwise see takings land on
                  tomorrow's report.
  * SCHEDULING -- "remind at 09:00" means 09:00 where the shop is.

Every other line of code sees UTC. This is the discipline that stops the classic
"the reminder fired a day early for half our users" bug.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.enums import ReportPeriod


def get_tz(timezone: str) -> ZoneInfo:
    """Resolve an IANA name, falling back to UTC rather than exploding on a typo."""
    try:
        return ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return ZoneInfo("UTC")


def ensure_utc(value: datetime) -> datetime:
    """Force tz-awareness.

    SQLite has no timezone-aware column type, so a datetime written as tz-aware
    comes back NAIVE. Comparing a naive datetime to an aware one raises TypeError --
    a crash that only ever shows up against SQLite, never in a Postgres test. Every
    datetime read from the DB goes through here.
    """
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def today_in(timezone: str) -> date:
    """The current calendar date where the business is."""
    return datetime.now(get_tz(timezone)).date()


def start_of_day(day: date, timezone: str) -> datetime:
    """Local midnight, returned in UTC -- the lower bound for a day's records."""
    tz = get_tz(timezone)
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)


def end_of_day(day: date, timezone: str) -> datetime:
    """Exclusive upper bound: local midnight of the NEXT day, in UTC.

    Exclusive, not 23:59:59.999999, because a half-open range [start, end) cannot
    silently drop a record that lands in the last microsecond.
    """
    tz = get_tz(timezone)
    return datetime.combine(day + timedelta(days=1), time.min, tzinfo=tz).astimezone(UTC)


def period_bounds(
    period: ReportPeriod,
    timezone: str,
    *,
    reference: date | None = None,
    start: date | None = None,
    end: date | None = None,
) -> tuple[datetime, datetime]:
    """UTC [start, end) bounds for a report period, anchored in local time."""
    ref = reference or today_in(timezone)

    if period is ReportPeriod.DAILY:
        first, last = ref, ref
    elif period is ReportPeriod.WEEKLY:
        first = ref - timedelta(days=ref.weekday())   # Monday
        last = first + timedelta(days=6)
    elif period is ReportPeriod.MONTHLY:
        first = ref.replace(day=1)
        last = _last_day_of_month(ref)
    elif period is ReportPeriod.YEARLY:
        first = ref.replace(month=1, day=1)
        last = ref.replace(month=12, day=31)
    else:  # CUSTOM
        if start is None or end is None:
            raise ValueError("ReportPeriod.CUSTOM requires an explicit start and end")
        first, last = start, end

    return start_of_day(first, timezone), end_of_day(last, timezone)


def _last_day_of_month(day: date) -> date:
    if day.month == 12:
        return day.replace(day=31)
    return day.replace(month=day.month + 1, day=1) - timedelta(days=1)


def month_range(months: int, timezone: str, *, reference: date | None = None) -> list[date]:
    """The first day of each of the last ``months`` months, oldest first.

    Powers the dashboard's monthly charts. Returning every month -- including ones
    with no activity -- is deliberate: a chart that silently omits empty months
    misrepresents a downward trend as a flat line.
    """
    ref = (reference or today_in(timezone)).replace(day=1)
    out: list[date] = []
    for _ in range(months):
        out.append(ref)
        ref = (ref - timedelta(days=1)).replace(day=1)
    return list(reversed(out))
