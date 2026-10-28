import csv
import io
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session as OrmSession

from app.models import Comment, Event, Ticket, User
from app.seed import seed_demo
from conftest import create_ticket


def counts(session):
    return tuple(session.scalar(select(func.count()).select_from(model)) for model in (User, Ticket, Comment, Event))


def test_failed_audit_write_rolls_back_comment_response_time_and_version(world):
    ticket = create_ticket(world.requester)
    marker = "Failed transaction must not appear"

    def reject_audit(session, _context, _instances):
        if any(isinstance(row, Event) for row in session.new):
            raise RuntimeError("Injected audit persistence failure")

    client = TestClient(world.app, raise_server_exceptions=False)
    client.cookies.update(world.agent.client.cookies)
    event.listen(OrmSession, "before_flush", reject_audit)
    try:
        response = client.post(
            f"/api/tickets/{ticket['id']}/comments",
            json={"body": marker, "internal": False, "expected_version": ticket["version"]},
            headers={"Origin": "http://testserver", "X-CSRF-Token": world.agent.csrf},
        )
        assert response.status_code == 500
    finally:
        event.remove(OrmSession, "before_flush", reject_audit)
        client.close()
    current = world.agent.get(f"/api/tickets/{ticket['id']}").json()
    assert current["version"] == ticket["version"]
    assert current["first_response_at"] is None
    assert current["comments"] == ticket["comments"]
    assert current["events"] == ticket["events"]
    with world.db.session_factory() as session:
        assert session.scalar(select(func.count()).select_from(Comment).where(Comment.body == marker)) == 0
        assert session.get(Ticket, ticket["id"]).version == ticket["version"]


@pytest.mark.parametrize("prefix", ["=", "+", "-", "@", "\t", "\r"])
def test_csv_neutralizes_formula_prefixes_and_preserves_quoted_content(world, prefix):
    title = prefix + 'HYPERLINK("https://example.test","open"),\nsecond line'
    created = create_ticket(world.requester, title=title)
    with world.db.session_factory() as session:
        session.get(Ticket, created["id"]).title = title
        session.commit()
    response = world.agent.get("/api/tickets/export.csv")
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    rows = list(csv.DictReader(io.StringIO(response.text, newline="")))
    assert len(rows) == 1 and None not in rows[0]
    candidates = [value for value in rows[0].values() if "HYPERLINK" in value]
    assert len(candidates) == 1
    exported = candidates[0]
    assert exported.startswith("'")
    assert exported[1:] == title


def test_csv_exports_entire_filtered_result_not_only_page(world):
    for index in range(3):
        create_ticket(world.requester, title=f"Network export sample {index}", priority="high")
    create_ticket(world.requester, title="Excluded hardware sample", priority="low")
    page = world.agent.get("/api/tickets", params={"priority": "high", "page_size": 1}).json()
    assert page["total"] == 3 and len(page["items"]) == 1
    response = world.agent.get("/api/tickets/export.csv", params={"priority": "high", "page_size": 1})
    rows = list(csv.DictReader(io.StringIO(response.text)))
    assert len(rows) == 3
    assert all("Network export sample" in str(row) for row in rows)


def test_csv_rejects_more_than_ten_thousand_accessible_rows(world):
    now = world.clock.now
    values = [
        {"title": f"Bulk export limit record {index}", "description": "Synthetic export boundary record.",
         "category": "other", "priority": "normal", "status": "open",
         "requester_id": world.requester.user["id"], "created_at": now, "updated_at": now,
         "response_due_at": now + timedelta(hours=4), "resolution_due_at": now + timedelta(hours=24), "version": 1}
        for index in range(10001)
    ]
    with world.db.session_factory() as session:
        session.execute(Ticket.__table__.insert(), values)
        session.commit()
    response = world.agent.get("/api/tickets/export.csv")
    assert 400 <= response.status_code < 500
    assert "text/csv" not in response.headers.get("content-type", "")
    assert "10000" in response.text.replace(",", "")


def test_seed_is_idempotent_and_does_not_overwrite_user_work(world):
    with world.db.session_factory() as session:
        assert seed_demo(session, "TrainingOnly-Office42!", world.clock.now) is True
        session.commit()
        ticket = session.scalars(select(Ticket).order_by(Ticket.id)).first()
        ticket_id = ticket.id
        ticket.title = "User changed this demo ticket after seeding"
        ticket.version += 1
        session.commit()
        before = counts(session)
    world.clock.advance(days=2)
    with world.db.session_factory() as session:
        assert seed_demo(session, "DifferentPassword-MustNotReset42!", world.clock.now) is False
        session.commit()
        assert counts(session) == before
        assert session.get(Ticket, ticket_id).title == "User changed this demo ticket after seeding"
