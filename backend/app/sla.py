import math
from datetime import datetime, timedelta, timezone


POLICY = {
    "low": (timedelta(hours=8), timedelta(hours=72)),
    "normal": (timedelta(hours=4), timedelta(hours=24)),
    "high": (timedelta(hours=1), timedelta(hours=8)),
    "critical": (timedelta(minutes=15), timedelta(hours=4)),
}


def iso(value: datetime | None):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value else None


def snapshot(due_at: datetime, completed_at: datetime | None, now: datetime):
    comparison = completed_at if completed_at is not None else now
    state = "breached" if comparison > due_at else ("met" if completed_at is not None else "pending")
    return {"state": state, "due_at": iso(due_at), "completed_at": iso(completed_at),
            "remaining_seconds": math.floor((due_at - comparison).total_seconds())}
