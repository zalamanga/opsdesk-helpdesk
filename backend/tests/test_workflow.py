from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import create_app

from conftest import change, create_ticket, owned_in_progress


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


@pytest.mark.parametrize("priority,response_hours,resolution_hours", [
    ("low", 8, 72), ("normal", 4, 24), ("high", 1, 8), ("critical", .25, 4),
])
def test_creation_snapshots_deadlines_for_each_policy(world, priority, response_hours, resolution_hours):
    ticket = create_ticket(world.requester, priority=priority)
    assert timestamp(ticket["response_due_at"]) == world.clock.now + timedelta(hours=response_hours)
    assert timestamp(ticket["resolution_due_at"]) == world.clock.now + timedelta(hours=resolution_hours)
    assert ticket["status"] == "open" and ticket["first_response_at"] is None
    assert ticket["response_sla"]["state"] == ticket["resolution_sla"]["state"] == "pending"


def test_first_response_is_first_public_agent_comment_only_and_does_not_move(world):
    ticket = create_ticket(world.requester)
    world.clock.advance(minutes=5)
    ticket = change(world.agent, ticket, "assign", assignee_id=world.agent.user["id"])
    assert ticket["first_response_at"] is None
    ticket = change(world.agent, ticket, "comments", body="Checking inventory privately", internal=True)
    assert ticket["first_response_at"] is None
    ticket = change(world.requester, ticket, "comments", body="More details from requester", internal=False)
    assert ticket["first_response_at"] is None
    world.clock.advance(minutes=5)
    ticket = change(world.agent, ticket, "comments", body="We are checking the printer now", internal=False)
    first = ticket["first_response_at"]
    assert timestamp(first) == world.clock.now
    world.clock.advance(hours=1)
    ticket = change(world.second_agent, ticket, "comments", body="A second agent adds an update", internal=False)
    assert ticket["first_response_at"] == first
    assert ticket["response_sla"]["state"] == "met"
    assert ticket["response_sla"]["remaining_seconds"] == 3 * 3600 + 50 * 60


def test_agent_cannot_satisfy_first_response_by_replying_to_own_request(world):
    ticket = create_ticket(world.agent, title="Agent reports their own workstation problem")
    ticket = change(world.agent, ticket, "assign", assignee_id=world.agent.user["id"])
    ticket = change(world.agent, ticket, "transition", status="in_progress")
    world.clock.advance(minutes=1)
    ticket = change(world.agent, ticket, "comments", body="Adding details to my own request", internal=False)
    assert ticket["first_response_at"] is None
    ticket = change(world.agent, ticket, "transition", status="resolved", note="I completed my own workstation repair")
    assert ticket["first_response_at"] is None
    ticket = change(world.agent, ticket, "transition", status="open", note="The workstation problem happened again")
    assert ticket["first_response_at"] is None
    world.clock.advance(minutes=1)
    ticket = change(world.second_agent, ticket, "comments", body="A different agent is now checking this report", internal=False)
    assert timestamp(ticket["first_response_at"]) == world.clock.now


def test_resolution_note_counts_as_first_response_and_reopen_keeps_deadlines(world):
    ticket = owned_in_progress(world, priority="critical")
    original_due = ticket["resolution_due_at"]
    original_response_due = ticket["response_due_at"]
    world.clock.advance(minutes=15)
    ticket = change(world.agent, ticket, "transition", status="resolved", note="Restarted network service successfully")
    assert timestamp(ticket["first_response_at"]) == world.clock.now
    assert ticket["response_sla"]["state"] == "met"
    assert any(c["body"] == "Restarted network service successfully" and not c["internal"] for c in ticket["comments"])
    resolved_at = ticket["resolved_at"]
    first_response = ticket["first_response_at"]
    world.clock.advance(hours=5)
    ticket = change(world.requester, ticket, "transition", status="open", note="The same network failure happened again")
    assert ticket["resolved_at"] is None and ticket["status"] == "open"
    assert ticket["resolution_due_at"] == original_due
    assert ticket["response_due_at"] == original_response_due
    assert ticket["first_response_at"] == first_response
    assert ticket["resolution_sla"]["state"] == "breached"
    assert ticket["resolution_sla"]["remaining_seconds"] == -(75 * 60)
    assert any(event["kind"] for event in ticket["events"] if event["created_at"] == resolved_at)


def test_response_at_exact_due_is_pending_then_late_response_is_breached(world):
    ticket = create_ticket(world.requester, priority="high")
    world.clock.advance(hours=1)
    due = world.requester.get(f"/api/tickets/{ticket['id']}").json()
    assert due["response_sla"]["state"] == "pending"
    assert due["response_sla"]["remaining_seconds"] == 0
    world.clock.advance(seconds=1)
    late = change(world.agent, ticket, "comments", body="We have started investigating", internal=False)
    assert late["response_sla"]["state"] == "breached"
    assert late["response_sla"]["remaining_seconds"] == -1


@pytest.mark.parametrize("override", [
    {"title": "tiny"}, {"description": "short"}, {"category": "billing"},
    {"priority": "urgent"}, {"status": "resolved"}, {"requester_id": 999},
    {"response_due_at": "2099-01-01T00:00:00Z"}, {"title": "x" * 161},
])
def test_invalid_creation_and_extra_fields_do_not_create_records(world, override):
    payload = {"title": "Invalid request probe", "description": "This request must be rejected.",
               "category": "other", "priority": "normal", **override}
    response = world.requester.post("/api/tickets", payload)
    assert response.status_code == 422, response.text
    assert world.agent.get("/api/tickets").json()["total"] == 0


def test_invalid_transitions_ownership_and_assignment_do_not_change_ticket(world):
    ticket = create_ticket(world.requester)
    endpoint = f"/api/tickets/{ticket['id']}"
    for actor, route, body, expected in [
        (world.agent, "transition", {"status": "resolved", "note": "Attempt a direct resolution"}, 409),
        (world.agent, "transition", {"status": "in_progress"}, 403),
        (world.requester, "transition", {"status": "in_progress"}, 403),
        (world.agent, "assign", {"assignee_id": world.other.user["id"]}, 422),
        (world.agent, "comments", {"body": "", "internal": False}, 422),
        (world.agent, "comments", {"body": "Valid body", "internal": False, "priority": "critical"}, 422),
    ]:
        response = actor.post(f"{endpoint}/{route}", {"expected_version": ticket["version"], **body})
        assert response.status_code == expected, response.text
        current = world.agent.get(endpoint).json()
        assert current["version"] == ticket["version"]
        assert len(current["events"]) == len(ticket["events"])
    ticket = change(world.agent, ticket, "assign", assignee_id=world.agent.user["id"])
    other = world.second_agent.post(
        f"{endpoint}/transition", {"expected_version": ticket["version"], "status": "in_progress"}
    )
    assert other.status_code == 403
    ticket = change(world.agent, ticket, "transition", status="in_progress")
    invalid = world.agent.post(
        f"{endpoint}/transition", {"expected_version": ticket["version"], "status": "resolved", "note": "short"}
    )
    assert invalid.status_code == 422
    ticket = change(world.agent, ticket, "transition", status="resolved", note="Repaired the damaged network cable")
    for route, body in [("assign", {"assignee_id": None}), ("comments", {"body": "Cannot add after resolution", "internal": False})]:
        response = world.agent.post(f"{endpoint}/{route}", {"expected_version": ticket["version"], **body})
        assert response.status_code == 409


def test_stale_version_rejects_comment_without_extra_comment_or_event(world):
    original = create_ticket(world.requester)
    current = change(world.agent, original, "comments", body="First update is accepted", internal=False)
    stale = world.agent.post(
        f"/api/tickets/{original['id']}/comments",
        {"expected_version": original["version"], "body": "Stale update must not persist", "internal": False},
    )
    assert stale.status_code == 409
    after = world.agent.get(f"/api/tickets/{original['id']}").json()
    assert after["version"] == current["version"]
    assert after["comments"] == current["comments"]
    assert after["events"] == current["events"]


@pytest.mark.parametrize("extra", [
    {"expected_version": True}, {"expected_version": "1"}, {"expected_version": 0}, {"internal": "false"},
])
def test_mutation_rejects_coerced_versions_and_boolean_fields(world, extra):
    ticket = create_ticket(world.requester)
    payload = {"expected_version": ticket["version"], "body": "Valid public reply body", "internal": False, **extra}
    response = world.agent.post(f"/api/tickets/{ticket['id']}/comments", payload)
    assert response.status_code == 422, response.text
    current = world.agent.get(f"/api/tickets/{ticket['id']}").json()
    assert current["version"] == ticket["version"] and current["comments"] == []


def test_resolved_tickets_follow_active_tickets_even_at_higher_priority(world):
    urgent = owned_in_progress(world, priority="critical")
    urgent = change(world.agent, urgent, "transition", status="resolved", note="Completed all urgent repair checks")
    low = create_ticket(world.requester, priority="low")
    result = world.agent.get("/api/tickets").json()
    assert [ticket["id"] for ticket in result["items"]] == [low["id"], urgent["id"]]
    assert result["counts"]["active"] == result["counts"]["resolved"] == 1


def test_counts_ignore_filters_and_queue_orders_urgency_first(world):
    low = create_ticket(world.requester, priority="low", title="Unrelated low priority printer")
    high = create_ticket(world.requester, priority="high", title="Searchable urgent connection")
    critical = create_ticket(world.requester, priority="critical", title="Critical connection outage")
    queue = world.agent.get("/api/tickets").json()
    assert [row["id"] for row in queue["items"]] == [critical["id"], high["id"], low["id"]]
    filtered = world.agent.get("/api/tickets", params={"q": "Searchable", "page_size": 1}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["id"] == high["id"]
    assert filtered["counts"]["active"] == filtered["counts"]["unassigned"] == 3


def test_all_sla_fields_in_queue_use_one_clock_value(world):
    create_ticket(world.requester, priority="high")
    create_ticket(world.requester, priority="normal")

    class AdvancingClock:
        def __init__(self, now):
            self.now = now

        def __call__(self):
            current = self.now
            self.now += timedelta(seconds=1)
            return current

    app = create_app(settings=world.settings, database=world.db, clock=AdvancingClock(world.clock.now))
    client = TestClient(app)
    client.cookies.update(world.agent.client.cookies)
    try:
        response = client.get("/api/tickets")
        assert response.status_code == 200, response.text
        comparisons = []
        for ticket in response.json()["items"]:
            for key in ("response_sla", "resolution_sla"):
                sla = ticket[key]
                comparisons.append(timestamp(sla["due_at"]) - timedelta(seconds=sla["remaining_seconds"]))
        assert len(comparisons) == 4
        assert len(set(comparisons)) == 1
    finally:
        client.close()
