import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.models import Base, Event, Session, Ticket, User
from conftest import Actor, Clock, ORIGIN, create_ticket


@pytest.mark.skipif(not os.getenv("OPSDESK_TEST_DATABASE_URL"), reason="Dedicated PostgreSQL test database not configured")
def test_same_version_concurrent_writes_have_exactly_one_winner(password_hash):
    url = os.environ["OPSDESK_TEST_DATABASE_URL"]
    assert url.startswith(("postgresql://", "postgresql+psycopg://")), "Concurrency evidence requires PostgreSQL"
    database = Database(url)
    Base.metadata.create_all(database.engine)
    clock = Clock()
    app = create_app(
        settings=Settings(database_url=url, allowed_origins=(ORIGIN,), cookie_secure=False, login_limit=1000),
        database=database, clock=clock,
    )
    marker = uuid4().hex
    emails = [f"race-{marker}-{index}@example.test" for index in range(3)]
    actors = []
    ids = []
    try:
        with database.session_factory() as session:
            for index, email in enumerate(emails):
                user = User(email=email, name=f"Race test {index}", role="requester" if index == 0 else "agent",
                            password_hash=password_hash, is_active=True)
                session.add(user)
                session.flush()
                ids.append(user.id)
            session.commit()
        actors = [Actor(app, email) for email in emails]
        ticket = create_ticket(actors[0], title=f"Concurrent submission {marker}")
        with database.session_factory() as session:
            before_events = session.scalar(select(func.count()).select_from(Event).where(Event.ticket_id == ticket["id"]))
        gate = Barrier(2)

        def submit(index):
            gate.wait(timeout=10)
            return actors[index].post(
                f"/api/tickets/{ticket['id']}/comments",
                {"expected_version": ticket["version"], "body": f"Concurrent agent response {index}", "internal": False},
            )

        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(submit, (1, 2)))
        assert sorted(response.status_code for response in responses) == [200, 409], [response.text for response in responses]
        final = actors[1].get(f"/api/tickets/{ticket['id']}").json()
        assert final["version"] == ticket["version"] + 1
        assert len(final["comments"]) == 1
        winner = next(response.json() for response in responses if response.status_code == 200)
        assert final["comments"] == winner["comments"]
        with database.session_factory() as session:
            after_events = session.scalar(select(func.count()).select_from(Event).where(Event.ticket_id == ticket["id"]))
            assert after_events == before_events + 1
    finally:
        for actor in actors:
            actor.client.close()
        if ids:
            with database.session_factory() as session:
                for ticket in session.scalars(select(Ticket).where(Ticket.requester_id.in_(ids))).all():
                    session.delete(ticket)
                session.flush()
                session.execute(delete(Session).where(Session.user_id.in_(ids)))
                session.execute(delete(User).where(User.id.in_(ids)))
                session.commit()
        database.engine.dispose()
