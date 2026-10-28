from datetime import datetime, timedelta, timezone

import pytest

from app.sla import POLICY, snapshot


NOW = datetime(2026, 10, 28, 8, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    "priority,response,resolution",
    [("low", 8 * 3600, 72 * 3600), ("normal", 4 * 3600, 24 * 3600),
     ("high", 3600, 8 * 3600), ("critical", 15 * 60, 4 * 3600)],
)
def test_policy_continuous_utc_durations(priority, response, resolution):
    response_delta, resolution_delta = POLICY[priority]
    assert response_delta.total_seconds() == response
    assert resolution_delta.total_seconds() == resolution


@pytest.mark.parametrize(
    "completion_offset,now_offset,state,remaining",
    [(None, -1, "pending", 1), (None, 0, "pending", 0),
     (None, 1, "breached", -1), (-1, 900, "met", 1),
     (0, 900, "met", 0), (1, 900, "breached", -1)],
)
def test_exact_deadline_boundaries(completion_offset, now_offset, state, remaining):
    completion = None if completion_offset is None else NOW + timedelta(seconds=completion_offset)
    actual = snapshot(NOW, completion, NOW + timedelta(seconds=now_offset))
    assert actual["state"] == state
    assert actual["remaining_seconds"] == remaining
    assert (actual["completed_at"] is None) == (completion is None)
