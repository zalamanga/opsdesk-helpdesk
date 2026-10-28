import csv
import io
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import and_, case, delete, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session as OrmSession, joinedload
from sqlalchemy.orm.exc import StaleDataError

from .config import Settings
from .db import Database
from .models import Comment, Event, RateLimitBucket, Session, Ticket, User, utcnow
from .schemas import Assignment, Login, NewComment, NewTicket, Transition
from .security import new_token, token_hash, verify_password
from .sla import POLICY, iso, snapshot


COOKIE = "opsdesk_session"


def get_db(request: Request):
    with request.app.state.database.session_factory() as db:
        yield db


DB = Annotated[OrmSession, Depends(get_db)]


def get_auth(request: Request, db: DB):
    token = request.cookies.get(COOKIE, "")
    if not token or len(token) > 128:
        raise HTTPException(401, "Sign in to continue")
    session = db.scalar(select(Session).where(Session.token_hash == token_hash(token)))
    if session is None or session.expires_at <= request.app.state.clock() or not session.user.is_active:
        raise HTTPException(401, "Session expired; sign in again")
    return session


Auth = Annotated[Session, Depends(get_auth)]


def mutation_auth(request: Request, auth: Auth):
    csrf = request.headers.get("x-csrf-token", "")
    if not csrf or not secrets.compare_digest(csrf.encode("utf-8"), auth.csrf_token.encode("ascii")):
        raise HTTPException(403, "Invalid CSRF token; refresh your session")
    return auth


MutationAuth = Annotated[Session, Depends(mutation_auth)]


def require_agent(user: User):
    if user.role != "agent":
        raise HTTPException(403, "An agent account is required")


def person(user: User | None):
    return {"id": user.id, "name": user.name} if user else None


def session_response(auth: Session, settings: Settings):
    user = auth.user
    return {"user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role},
            "csrf_token": auth.csrf_token, "demo_mode": settings.demo_mode}


def accessible(user: User):
    return Ticket.requester_id == user.id if user.role == "requester" else text("1=1")


def ticket_summary(ticket: Ticket, now: datetime):
    return {
        "id": ticket.id, "key": f"OPS-{ticket.id:04d}", "title": ticket.title,
        "category": ticket.category, "priority": ticket.priority, "status": ticket.status,
        "requester": person(ticket.requester), "assignee": person(ticket.assignee),
        "created_at": iso(ticket.created_at), "updated_at": iso(ticket.updated_at),
        "first_response_at": iso(ticket.first_response_at), "resolved_at": iso(ticket.resolved_at),
        "response_due_at": iso(ticket.response_due_at), "resolution_due_at": iso(ticket.resolution_due_at),
        "response_sla": snapshot(ticket.response_due_at, ticket.first_response_at, now),
        "resolution_sla": snapshot(ticket.resolution_due_at, ticket.resolved_at, now), "version": ticket.version,
    }


def ticket_detail(ticket: Ticket, user: User, now: datetime):
    result = ticket_summary(ticket, now)
    result["description"] = ticket.description
    result["comments"] = [{"id": row.id, "author": person(row.author), "body": row.body,
                           "internal": row.internal, "created_at": iso(row.created_at)}
                          for row in ticket.comments if not row.internal or user.role == "agent"]
    result["events"] = [{"id": row.id, "actor": person(row.actor), "kind": row.kind,
                         "summary": row.summary, "internal": row.internal, "created_at": iso(row.created_at)}
                        for row in ticket.events if not row.internal or user.role == "agent"]
    return result


def load_ticket(db: OrmSession, ticket_id: int, user: User, *, lock=False):
    statement = select(Ticket).where(Ticket.id == ticket_id, accessible(user))
    if lock:
        statement = statement.with_for_update()
    ticket = db.scalar(statement)
    if ticket is None:
        raise HTTPException(404, "Ticket not found")
    return ticket


def locked_ticket(db: OrmSession, ticket_id: int, user: User, expected_version: int):
    ticket = load_ticket(db, ticket_id, user, lock=True)
    if ticket.version != expected_version:
        raise HTTPException(409, "This ticket changed. Refresh before trying again")
    return ticket


def audit(db: OrmSession, ticket: Ticket, user: User, kind: str, summary: str, now: datetime, internal=False):
    db.add(Event(ticket_id=ticket.id, actor_id=user.id, kind=kind, summary=summary,
                 internal=internal, created_at=now))


def commit_ticket(db: OrmSession, ticket: Ticket, now: datetime):
    ticket.version += 1
    ticket.updated_at = now
    try:
        db.commit()
    except StaleDataError:
        db.rollback()
        raise HTTPException(409, "This ticket changed. Refresh before trying again") from None
    except OperationalError as error:
        db.rollback()
        if db.bind.dialect.name == "sqlite" and "locked" in str(error).lower():
            raise HTTPException(409, "This ticket is being changed. Refresh before trying again") from None
        raise
    db.expire(ticket, ["requester", "assignee", "comments", "events"])


def queue_filters(user, q, status, priority, assigned, sla, now):
    clauses = [accessible(user)]
    if q:
        escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        clauses.append(or_(Ticket.title.ilike(f"%{escaped}%", escape="\\"),
                           Ticket.description.ilike(f"%{escaped}%", escape="\\")))
    if status:
        clauses.append(Ticket.status == status)
    if priority:
        clauses.append(Ticket.priority == priority)
    if assigned == "mine":
        clauses.append(Ticket.assignee_id == user.id)
    elif assigned == "unassigned":
        clauses.append(Ticket.assignee_id.is_(None))
    if sla == "breached":
        clauses.append(or_(response_breached(now), resolution_breached(now)))
    return clauses


def response_breached(now):
    return or_(and_(Ticket.first_response_at.is_(None), Ticket.response_due_at < now),
               Ticket.first_response_at > Ticket.response_due_at)


def resolution_breached(now):
    return or_(and_(Ticket.resolved_at.is_(None), Ticket.resolution_due_at < now),
               Ticket.resolved_at > Ticket.resolution_due_at)


def queue_order():
    return (case((Ticket.status == "resolved", 1), else_=0),
            case((Ticket.priority == "critical", 0), (Ticket.priority == "high", 1),
                 (Ticket.priority == "normal", 2), else_=3), Ticket.created_at, Ticket.id)


def queue_counts(db, user, now):
    active = Ticket.status != "resolved"
    conditions = {"active": active, "unassigned": and_(active, Ticket.assignee_id.is_(None)),
                  "response_breached": response_breached(now), "resolution_breached": resolution_breached(now),
                  "resolved": Ticket.status == "resolved"}
    row = db.execute(select(*[func.coalesce(func.sum(case((condition, 1), else_=0)), 0)
                              for condition in conditions.values()]).where(accessible(user))).one()
    return dict(zip(conditions, row))


def consume_login_attempt(db: OrmSession, ip: str, email: str, now: datetime, settings: Settings):
    seconds = settings.login_window_seconds
    start = datetime.fromtimestamp(int(now.timestamp()) // seconds * seconds, tz=timezone.utc)
    insert = pg_insert if db.bind.dialect.name == "postgresql" else sqlite_insert
    counts = []
    for scope, identity in (("ip", ip), ("email", email)):
        key = token_hash(f"{scope}:{identity}")
        statement = insert(RateLimitBucket).values(key=key, window_start=start, attempts=1)
        statement = statement.on_conflict_do_update(index_elements=[RateLimitBucket.key], set_={
            "window_start": start,
            "attempts": case((RateLimitBucket.window_start == start, RateLimitBucket.attempts + 1), else_=1),
        }).returning(RateLimitBucket.attempts)
        counts.append(db.execute(statement).scalar_one())
    db.execute(delete(RateLimitBucket).where(RateLimitBucket.window_start < now - timedelta(days=2)))
    db.commit()
    if counts[0] > settings.login_ip_limit or counts[1] > settings.login_limit:
        retry = max(1, int((start + timedelta(seconds=seconds) - now).total_seconds()))
        raise HTTPException(429, "Too many sign-in attempts. Try again later", headers={"Retry-After": str(retry)})


def csv_cell(value):
    string = str(value) if value is not None else ""
    if string.lstrip().startswith(("=", "+", "-", "@")) or string.startswith(("\t", "\r", "\n")):
        return "'" + string
    return string


def create_app(settings: Settings | None = None, database: Database | None = None,
               clock: Callable[[], datetime] = utcnow):
    settings = settings or Settings()
    app = FastAPI(title="OpsDesk API", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.state.database = database or Database(settings.database_url)
    app.state.settings = settings
    app.state.clock = clock

    @app.middleware("http")
    async def request_guards(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            if origin is not None and origin not in settings.allowed_origins:
                return JSONResponse({"detail": "Origin is not allowed"}, status_code=403)
            if request.headers.get("sec-fetch-site") == "cross-site":
                return JSONResponse({"detail": "Cross-site requests are not allowed"}, status_code=403)
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > 65536:
                    return JSONResponse({"detail": "Request body exceeds 64 KiB"}, status_code=413)
            request._body = bytes(body)
            if body and request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
                return JSONResponse({"detail": "Use application/json"}, status_code=415)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/health")
    def health(db: DB):
        try:
            db.execute(select(User.id).limit(1))
        except Exception:
            return JSONResponse({"status": "not_ready"}, status_code=503)
        return {"status": "ok"}

    @app.post("/api/auth/login")
    def login(payload: Login, request: Request, response: Response, db: DB):
        now = clock()
        email = payload.email.strip().lower()
        ip = request.client.host if request.client else "unknown"
        consume_login_attempt(db, ip, email, now, settings)
        user = db.scalar(select(User).where(User.email == email))
        if not verify_password(payload.password, user.password_hash if user else None) or not user or not user.is_active:
            raise HTTPException(401, "Email or password is incorrect")
        if request.cookies.get(COOKIE):
            db.execute(delete(Session).where(Session.token_hash == token_hash(request.cookies[COOKIE])))
        db.execute(delete(Session).where(Session.expires_at <= now))
        token = new_token()
        auth = Session(token_hash=token_hash(token), user_id=user.id, user=user, csrf_token=new_token(),
                       created_at=now, expires_at=now + timedelta(hours=settings.session_hours))
        db.add(auth)
        db.commit()
        response.set_cookie(COOKIE, token, httponly=True, secure=settings.cookie_secure, samesite="lax", path="/api",
                            max_age=settings.session_hours * 3600)
        return session_response(auth, settings)

    @app.get("/api/auth/me")
    def me(auth: Auth):
        return session_response(auth, settings)

    @app.post("/api/auth/logout", status_code=204)
    def logout(response: Response, auth: MutationAuth, db: DB):
        db.delete(auth)
        db.commit()
        response.delete_cookie(COOKIE, path="/api", secure=settings.cookie_secure, httponly=True, samesite="lax")

    @app.get("/api/agents")
    def agents(auth: Auth, db: DB):
        require_agent(auth.user)
        return {"items": [person(row) for row in db.scalars(select(User).where(User.role == "agent", User.is_active.is_(True)).order_by(User.name, User.id))]}

    @app.get("/api/tickets")
    def tickets(auth: Auth, db: DB, q: str = Query(default="", max_length=200),
                status: Literal["open", "in_progress", "resolved"] | None = None,
                priority: Literal["low", "normal", "high", "critical"] | None = None,
                assigned: Literal["all", "mine", "unassigned"] = "all", sla: Literal["all", "breached"] = "all",
                page: int = Query(default=1, ge=1, le=100000), page_size: int = Query(default=30, ge=1, le=100)):
        now = clock()
        filters = queue_filters(auth.user, q.strip(), status, priority, assigned, sla, now)
        total = db.scalar(select(func.count()).select_from(Ticket).where(*filters))
        rows = db.scalars(select(Ticket).options(joinedload(Ticket.requester), joinedload(Ticket.assignee)).where(*filters).order_by(*queue_order()).offset((page-1)*page_size).limit(page_size))
        return {"items": [ticket_summary(row, now) for row in rows], "total": total, "page": page, "page_size": page_size,
                "counts": queue_counts(db, auth.user, now)}

    @app.get("/api/tickets/export.csv")
    def export(auth: Auth, db: DB, q: str = Query(default="", max_length=200),
               status: Literal["open", "in_progress", "resolved"] | None = None,
               priority: Literal["low", "normal", "high", "critical"] | None = None,
               assigned: Literal["all", "mine", "unassigned"] = "all", sla: Literal["all", "breached"] = "all"):
        now = clock()
        filters = queue_filters(auth.user, q.strip(), status, priority, assigned, sla, now)
        total = db.scalar(select(func.count()).select_from(Ticket).where(*filters))
        if total > 10000:
            raise HTTPException(422, "Export exceeds 10000 tickets; narrow the filters")
        rows = list(db.scalars(select(Ticket).options(joinedload(Ticket.requester), joinedload(Ticket.assignee)).where(*filters).order_by(*queue_order()).limit(10001)))
        if len(rows) > 10000:
            raise HTTPException(422, "Export exceeds 10000 tickets; narrow the filters")
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer)
        writer.writerow(["key", "title", "category", "priority", "status", "requester", "assignee", "created_at", "response_sla", "resolution_sla"])
        for ticket in rows:
            data = ticket_summary(ticket, now)
            writer.writerow([csv_cell(value) for value in (data["key"], ticket.title, ticket.category, ticket.priority,
                             ticket.status, ticket.requester.name, ticket.assignee.name if ticket.assignee else "",
                             data["created_at"], data["response_sla"]["state"], data["resolution_sla"]["state"])])
        return Response("\ufeff" + buffer.getvalue(), media_type="text/csv; charset=utf-8",
                        headers={"Content-Disposition": 'attachment; filename="opsdesk-tickets.csv"'})

    @app.post("/api/tickets", status_code=201)
    def create_ticket(payload: NewTicket, auth: MutationAuth, db: DB):
        now = clock()
        response_delta, resolution_delta = POLICY[payload.priority]
        ticket = Ticket(**payload.model_dump(), requester_id=auth.user_id, created_at=now, updated_at=now,
                        response_due_at=now+response_delta, resolution_due_at=now+resolution_delta, version=1)
        db.add(ticket)
        db.flush()
        audit(db, ticket, auth.user, "created", "Ticket created", now)
        db.commit()
        return ticket_detail(ticket, auth.user, now)

    @app.get("/api/tickets/{ticket_id}")
    def detail(ticket_id: int, auth: Auth, db: DB):
        now = clock()
        return ticket_detail(load_ticket(db, ticket_id, auth.user), auth.user, now)

    @app.post("/api/tickets/{ticket_id}/assign")
    def assign(ticket_id: int, payload: Assignment, auth: MutationAuth, db: DB):
        ticket = locked_ticket(db, ticket_id, auth.user, payload.expected_version)
        require_agent(auth.user)
        if ticket.status == "resolved":
            raise HTTPException(409, "Reopen this ticket before changing assignment")
        assignee = db.get(User, payload.assignee_id) if payload.assignee_id is not None else None
        if payload.assignee_id is not None and (not assignee or assignee.role != "agent" or not assignee.is_active):
            raise HTTPException(422, "Assignee must be an active agent")
        if ticket.assignee_id == payload.assignee_id:
            raise HTTPException(409, "This assignment is already current")
        now = clock()
        ticket.assignee_id = payload.assignee_id
        audit(db, ticket, auth.user, "assigned", f"Assigned to {assignee.name}" if assignee else "Assignment cleared", now)
        commit_ticket(db, ticket, now)
        return ticket_detail(ticket, auth.user, now)

    @app.post("/api/tickets/{ticket_id}/comments")
    def comment(ticket_id: int, payload: NewComment, auth: MutationAuth, db: DB):
        ticket = locked_ticket(db, ticket_id, auth.user, payload.expected_version)
        if payload.internal:
            require_agent(auth.user)
        if ticket.status == "resolved":
            raise HTTPException(409, "Reopen this ticket before adding comments")
        now = clock()
        db.add(Comment(ticket_id=ticket.id, author_id=auth.user_id, body=payload.body,
                       internal=payload.internal, created_at=now))
        if auth.user.role == "agent" and auth.user_id != ticket.requester_id and not payload.internal and ticket.first_response_at is None:
            ticket.first_response_at = now
        audit(db, ticket, auth.user, "internal_note" if payload.internal else "commented",
              "Internal note added" if payload.internal else "Public reply added", now, internal=payload.internal)
        commit_ticket(db, ticket, now)
        return ticket_detail(ticket, auth.user, now)

    @app.post("/api/tickets/{ticket_id}/transition")
    def transition(ticket_id: int, payload: Transition, auth: MutationAuth, db: DB):
        ticket = locked_ticket(db, ticket_id, auth.user, payload.expected_version)
        old, new = ticket.status, payload.status
        if (old, new) not in {("open", "in_progress"), ("in_progress", "resolved"), ("resolved", "open")}:
            raise HTTPException(409, "This status transition is not allowed")
        if new != "open":
            require_agent(auth.user)
            if ticket.assignee_id != auth.user_id:
                raise HTTPException(403, "Assign this ticket to yourself before starting or resolving it")
        if new in {"open", "resolved"} and (not payload.note or len(payload.note.strip()) < 10):
            raise HTTPException(422, "A public explanation of at least 10 characters is required")
        now = clock()
        if new in {"open", "resolved"}:
            db.add(Comment(ticket_id=ticket.id, author_id=auth.user_id, body=payload.note,
                           internal=False, created_at=now))
            if auth.user.role == "agent" and auth.user_id != ticket.requester_id and ticket.first_response_at is None:
                ticket.first_response_at = now
        ticket.resolved_at = now if new == "resolved" else None
        ticket.status = new
        audit(db, ticket, auth.user, "reopened" if new == "open" else new,
              f"Status changed from {old} to {new}", now)
        commit_ticket(db, ticket, now)
        return ticket_detail(ticket, auth.user, now)

    return app


app = create_app()
