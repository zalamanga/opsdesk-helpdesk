from datetime import datetime, timedelta

from sqlalchemy import select, text
from sqlalchemy.orm import Session as OrmSession

from .models import Comment, Event, SeedMarker, Ticket, User
from .security import hash_password
from .sla import POLICY


SEED_NAME = "opsdesk-training-v1"
DEMO_EMAILS = ("agent@opsdesk.test", "agent2@opsdesk.test", "requester@opsdesk.test", "another@opsdesk.test")


def seed_demo(db: OrmSession, password: str, now: datetime) -> bool:
    """Populate labelled training records once; the caller owns the transaction."""
    if len(password) < 12 or len(password) > 128:
        raise ValueError("OPSDESK_DEMO_PASSWORD must contain 12-128 characters")
    if db.bind.dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(1735061201)"))
    if db.get(SeedMarker, SEED_NAME):
        return False
    if db.scalar(select(User.id).where(User.email.in_(DEMO_EMAILS)).limit(1)) is not None:
        raise ValueError("Training account addresses already exist without a seed marker; refusing to overwrite them")
    db.add(SeedMarker(name=SEED_NAME, completed_at=now))
    db.flush()
    hashed = hash_password(password)
    users = [User(email=email, name=name, role=role, password_hash=hashed, created_at=now-timedelta(days=4))
             for email, name, role in zip(DEMO_EMAILS,
                 ("Nadia (Training)", "Bima (Training)", "Dina (Training)", "Raka (Training)"),
                 ("agent", "agent", "requester", "requester"))]
    db.add_all(users)
    db.flush()
    agent, other_agent, requester, other_requester = users
    # All historical offsets are relative to this one seed clock; every subject and actor is labelled training.
    cases = [
        ("[Training] VPN tidak bisa terhubung", "network", "critical", 2, "open", None, None, requester),
        ("[Training] Printer lantai dua tersangkut", "hardware", "high", 5, "in_progress", agent, 4.5, requester),
        ("[Training] Akses folder tim pemasaran", "access", "normal", 3, "open", None, None, other_requester),
        ("[Training] Instalasi editor untuk onboarding", "software", "low", 12, "open", None, None, requester),
        ("[Training] Monitor eksternal tidak terdeteksi", "hardware", "normal", 30, "in_progress", other_agent, 29, other_requester),
        ("[Training] Reset akses aplikasi inventaris", "access", "high", 6, "resolved", agent, 5.5, requester),
        ("[Training] Wi-Fi ruang rapat terputus", "network", "critical", 9, "resolved", other_agent, 8.5, other_requester),
        ("[Training] Lisensi spreadsheet perlu diperiksa", "software", "normal", 28, "open", agent, 27, requester),
        ("[Training] Permintaan panduan desktop", "other", "low", 1, "open", None, None, other_requester),
    ]
    for title, category, priority, age_hours, status, assignee, response_age_hours, owner in cases:
        created = now-timedelta(hours=age_hours)
        first_response = now-timedelta(hours=response_age_hours) if response_age_hours is not None else None
        resolved = created+timedelta(hours=2) if status == "resolved" else None
        response_delta, resolution_delta = POLICY[priority]
        ticket = Ticket(title=title, description="Data latihan sintetis untuk demonstrasi alur helpdesk. Jangan gunakan tiket ini sebagai insiden perusahaan nyata.",
                        category=category, priority=priority, status=status, requester_id=owner.id,
                        assignee_id=assignee.id if assignee else None, created_at=created,
                        updated_at=(now-timedelta(minutes=15)) if status == "in_progress" else (resolved or first_response or created), first_response_at=first_response,
                        resolved_at=resolved, response_due_at=created+response_delta,
                        resolution_due_at=created+resolution_delta,
                        version=1 + int(assignee is not None) + int(first_response is not None)
                        + int(status in {"in_progress", "resolved"}) + int(status == "resolved") + int(status == "in_progress"))
        db.add(ticket)
        db.flush()
        db.add(Event(ticket_id=ticket.id, actor_id=owner.id, kind="created", summary="Synthetic training ticket created", created_at=created))
        if assignee:
            db.add(Event(ticket_id=ticket.id, actor_id=assignee.id, kind="assigned", summary=f"Assigned to {assignee.name}", created_at=created+timedelta(minutes=1)))
        if first_response:
            db.add(Comment(ticket_id=ticket.id, author_id=assignee.id, body="[Training] Laporan sudah diterima; agen sedang memeriksa gejalanya.", internal=False, created_at=first_response))
            db.add(Event(ticket_id=ticket.id, actor_id=assignee.id, kind="commented", summary="Public training reply added", created_at=first_response))
        if status in {"in_progress", "resolved"}:
            db.add(Event(ticket_id=ticket.id, actor_id=assignee.id, kind="in_progress", summary="Status changed from open to in_progress", created_at=first_response or created+timedelta(minutes=2)))
        if status == "resolved":
            db.add(Comment(ticket_id=ticket.id, author_id=assignee.id, body="[Training] Konfigurasi diperbaiki dan hasilnya telah diuji bersama pelapor.", internal=False, created_at=resolved))
            db.add(Event(ticket_id=ticket.id, actor_id=assignee.id, kind="resolved", summary="Status changed from in_progress to resolved", created_at=resolved))
        if status == "in_progress":
            db.add(Comment(ticket_id=ticket.id, author_id=assignee.id, body="[Training, internal] Periksa konfigurasi perangkat sebelum mengirim instruksi kepada pelapor.", internal=True, created_at=now-timedelta(minutes=15)))
            db.add(Event(ticket_id=ticket.id, actor_id=assignee.id, kind="internal_note", summary="Internal training note added", internal=True, created_at=now-timedelta(minutes=15)))
    db.flush()
    return True
