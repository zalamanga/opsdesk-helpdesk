from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.db import Database
from app.main import create_app
from app.models import Base, User
from app.security import hash_password


PASSWORD = "TestOnly-Office42!"
ORIGIN = "http://testserver"


@dataclass
class Clock:
    now: datetime = datetime(2026, 10, 28, 8, 0, tzinfo=timezone.utc)

    def __call__(self):
        return self.now

    def advance(self, **kwargs):
        self.now += timedelta(**kwargs)


class Actor:
    def __init__(self, app, email):
        self.client = TestClient(app)
        response = self.client.post(
            "/api/auth/login",
            json={"email": email, "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert response.status_code == 200, response.text
        self.auth = response.json()
        self.user = self.auth["user"]
        self.csrf = self.auth["csrf_token"]

    def get(self, path, **kwargs):
        return self.client.get(path, **kwargs)

    def post(self, path, body=None, **kwargs):
        headers = {"Origin": ORIGIN, "X-CSRF-Token": self.csrf}
        headers.update(kwargs.pop("headers", {}))
        return self.client.post(path, json=body, headers=headers, **kwargs)


def create_ticket(actor, **overrides):
    payload = {
        "title": "Printer finance cannot connect",
        "description": "The finance printer has no network connection since this morning.",
        "category": "hardware",
        "priority": "normal",
    }
    payload.update(overrides)
    response = actor.post("/api/tickets", payload)
    assert response.status_code == 201, response.text
    return response.json()


def change(actor, ticket, endpoint, **fields):
    response = actor.post(
        f"/api/tickets/{ticket['id']}/{endpoint}",
        {"expected_version": ticket["version"], **fields},
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["version"] == ticket["version"] + 1
    return result


def owned_in_progress(world, **overrides):
    ticket = create_ticket(world.requester, **overrides)
    ticket = change(world.agent, ticket, "assign", assignee_id=world.agent.user["id"])
    return change(world.agent, ticket, "transition", status="in_progress")


@pytest.fixture(scope="session")
def password_hash():
    return hash_password(PASSWORD)


@pytest.fixture
def world(tmp_path, password_hash):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'opsdesk-test.sqlite3').as_posix()}"
    database = Database(database_url)
    Base.metadata.create_all(database.engine)
    clock = Clock()
    settings = Settings(
        database_url=database_url,
        allowed_origins=(ORIGIN,),
        cookie_secure=False,
    )
    app = create_app(settings=settings, database=database, clock=clock)
    identities = [
        ("requester", "requester@example.test", "Requester A"),
        ("other", "other@example.test", "Requester B"),
        ("agent", "agent@example.test", "Agent A"),
        ("second_agent", "agent2@example.test", "Agent B"),
    ]
    with database.session_factory() as session:
        for key, email, name in identities:
            role = "agent" if "agent" in key else "requester"
            session.add(User(email=email, name=name, role=role, password_hash=password_hash, is_active=True))
        session.commit()
    actors = {key: Actor(app, email) for key, email, _name in identities}
    yield SimpleNamespace(app=app, db=database, clock=clock, settings=settings, **actors)
    for actor in actors.values():
        actor.client.close()
    database.engine.dispose()
