import csv
import io

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import Session, User

from conftest import ORIGIN, PASSWORD, change, create_ticket


def test_login_sets_opaque_cookie_and_logout_revokes_replay(world):
    actor = world.requester
    cookie = actor.client.cookies.get("opsdesk_session")
    assert cookie and actor.user["email"] not in cookie
    assert "token" not in actor.auth["user"]
    with world.db.session_factory() as session:
        stored = session.scalar(select(Session).where(Session.user_id == actor.user["id"]))
        assert stored.token_hash != cookie
        assert cookie not in str(stored.__dict__)
    assert actor.get("/api/auth/me").json()["user"] == actor.user
    response = actor.post("/api/auth/logout")
    assert response.status_code == 204
    assert actor.get("/api/auth/me").status_code == 401
    replay = TestClient(world.app)
    replay.cookies.set("opsdesk_session", cookie)
    assert replay.get("/api/auth/me").status_code == 401
    replay.close()


def test_session_expires_according_to_server_clock(world):
    world.clock.advance(hours=23, minutes=59, seconds=59)
    assert world.requester.get("/api/auth/me").status_code == 200
    world.clock.advance(seconds=1)
    assert world.requester.get("/api/auth/me").status_code == 401
    assert world.requester.get("/api/tickets").status_code == 401


def test_bad_credentials_and_unapproved_login_origin(world):
    client = TestClient(world.app)
    wrong = client.post("/api/auth/login", json={"email": "requester@example.test", "password": "wrong"})
    assert wrong.status_code == 401
    assert not client.cookies.get("opsdesk_session")
    origin = client.post(
        "/api/auth/login", json={"email": "requester@example.test", "password": PASSWORD},
        headers={"Origin": "https://untrusted.example"},
    )
    assert origin.status_code == 403
    assert not client.cookies.get("opsdesk_session")
    client.close()


def test_session_cookie_has_browser_protection_flags(world):
    client = TestClient(world.app)
    response = client.post(
        "/api/auth/login", json={"email": "requester@example.test", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    value = response.headers["set-cookie"].lower()
    assert "httponly" in value and "samesite=lax" in value
    assert "path=/" in value
    client.close()


def test_deactivated_user_cannot_keep_using_an_existing_session(world):
    with world.db.session_factory() as session:
        session.get(User, world.requester.user["id"]).is_active = False
        session.commit()
    assert world.requester.get("/api/auth/me").status_code == 401
    response = world.requester.client.post(
        "/api/auth/login", json={"email": "requester@example.test", "password": PASSWORD}
    )
    assert response.status_code == 401


def test_shared_peer_allows_multiple_accounts_but_retains_per_email_limit(world):
    client = TestClient(world.app)
    emails = ["requester@example.test", "other@example.test", "agent@example.test", "agent2@example.test"]
    try:
        for _round in range(2):
            for email in emails:
                response = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
                assert response.status_code == 200, response.text
        for _attempt in range(world.settings.login_limit - 3):
            response = client.post("/api/auth/login", json={"email": emails[0], "password": "incorrect"})
            assert response.status_code == 401, response.text
        response = client.post("/api/auth/login", json={"email": emails[0], "password": PASSWORD})
        assert response.status_code == 429
        assert int(response.headers["retry-after"]) > 0
    finally:
        client.close()


@pytest.mark.parametrize("headers", [{}, {"X-CSRF-Token": "not-the-session-token"}])
def test_authenticated_write_requires_matching_csrf_without_origin_bypass(world, headers):
    response = world.requester.client.post(
        "/api/tickets",
        json={"title": "Unauthorized mutation", "description": "This request must not create a ticket.",
              "category": "other", "priority": "normal"},
        headers=headers,
    )
    assert response.status_code == 403
    assert world.requester.get("/api/tickets").json()["total"] == 0


def test_valid_csrf_cannot_override_unapproved_origin(world):
    response = world.requester.post(
        "/api/tickets", {"title": "Untrusted request", "description": "Do not create this request.",
                         "category": "other", "priority": "normal"},
        headers={"Origin": "http://testserver.evil.example"},
    )
    assert response.status_code == 403
    assert world.requester.get("/api/tickets").json()["total"] == 0


def test_requester_scope_includes_detail_list_counts_and_csv(world):
    own = create_ticket(world.requester, title="Owner private request")
    foreign = create_ticket(world.other, title="Hidden requester request", priority="critical")
    for endpoint, body in [
        ("assign", {"assignee_id": world.agent.user["id"]}),
        ("comments", {"body": "Trying another person's ticket", "internal": False}),
        ("transition", {"status": "open", "note": "Trying another person's ticket"}),
    ]:
        response = world.requester.post(
            f"/api/tickets/{foreign['id']}/{endpoint}", {"expected_version": foreign["version"], **body}
        )
        assert response.status_code == 404, response.text
    assert world.requester.get(f"/api/tickets/{foreign['id']}").status_code == 404
    assert world.requester.get("/api/tickets/999999999").status_code == 404
    queue = world.requester.get("/api/tickets").json()
    assert [ticket["id"] for ticket in queue["items"]] == [own["id"]]
    assert queue["total"] == queue["counts"]["active"] == queue["counts"]["unassigned"] == 1
    rows = list(csv.DictReader(io.StringIO(world.requester.get("/api/tickets/export.csv").text)))
    assert len(rows) == 1 and "Owner private request" in rows[0].values()
    assert "Hidden requester request" not in str(rows)


def test_internal_notes_and_their_audit_events_never_leak_to_requester(world):
    ticket = create_ticket(world.requester)
    marker = "INTERNAL-ONLY vendor password investigation"
    ticket = change(world.agent, ticket, "comments", body=marker, internal=True)
    assert any(comment["body"] == marker and comment["internal"] for comment in ticket["comments"])
    assert any(event["internal"] for event in ticket["events"])
    public = world.requester.get(f"/api/tickets/{ticket['id']}").json()
    assert all(not comment["internal"] for comment in public["comments"])
    assert all(not event["internal"] for event in public["events"])
    assert marker not in str(public)
    assert marker not in world.requester.get("/api/tickets/export.csv").text
    response = world.requester.post(
        f"/api/tickets/{ticket['id']}/comments",
        {"expected_version": ticket["version"], "body": "Requester private note", "internal": True},
    )
    assert response.status_code == 403


def test_requester_cannot_access_agents_or_assign_own_ticket(world):
    ticket = create_ticket(world.requester)
    assert world.requester.get("/api/agents").status_code == 403
    assert world.agent.get("/api/agents").status_code == 200
    response = world.requester.post(
        f"/api/tickets/{ticket['id']}/assign",
        {"assignee_id": world.agent.user["id"], "expected_version": ticket["version"]},
    )
    assert response.status_code == 403
    assert world.requester.get(f"/api/tickets/{ticket['id']}").json()["version"] == ticket["version"]
