import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError, errorText } from "./api";
import { Feedback, SlaLabel } from "./ui";
import {
  categoryLabels,
  dateTime,
  priorityLabels,
  statusLabels,
  timeline,
} from "./format";
import type { AuthSession, Person, TicketDetail } from "./types";

type Props = {
  ticket: TicketDetail;
  session: AuthSession;
  agents: Person[];
  agentsLoading: boolean;
  agentsError: string;
  reloadAgents: () => Promise<void>;
  reload: () => Promise<TicketDetail | null>;
  onChange: (ticket: TicketDetail) => void;
};

export default function TicketPanel({
  ticket,
  session,
  agents,
  agentsLoading,
  agentsError,
  reloadAgents,
  reload,
  onChange,
}: Props) {
  const [editorVersion, setEditorVersion] = useState(ticket.version);
  const [assignee, setAssignee] = useState(
    ticket.assignee ? String(ticket.assignee.id) : "",
  );
  const [assigneeDirty, setAssigneeDirty] = useState(false);
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [reopenReason, setReopenReason] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);
  const reloadInFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const isAgent = session.user.role === "agent";
  const isOwner = ticket.assignee?.id === session.user.id;
  const active = ticket.status !== "resolved";
  const note = active ? resolutionNote : reopenReason;
  const newer = ticket.version !== editorVersion;
  const mutationDisabled = busy || reloading;
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current
      ?.closest(".detail-section")
      ?.scrollIntoView({ block: "start", behavior: "auto" });
  }, []);
  useEffect(() => {
    if (!assigneeDirty)
      setAssignee(ticket.assignee ? String(ticket.assignee.id) : "");
  }, [ticket.assignee?.id, assigneeDirty]);

  async function mutate(
    action: string,
    body: Record<string, unknown>,
    success: string,
    clear?: () => void,
  ) {
    if (busy || reloading || reloadInFlight.current) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api.mutate(ticket.id, action, {
        ...body,
        expected_version: editorVersion,
      });
      onChange(result);
      setEditorVersion(result.version);
      setConflict(false);
      setNotice(success);
      clear?.();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function reloadLatest() {
    if (busy || reloadInFlight.current) return;
    reloadInFlight.current = true;
    setReloading(true);
    try {
      const result = await reload();
      if (result) {
        setEditorVersion(result.version);
        setError("");
        setConflict(false);
        setNotice(
          "Versi terbaru dimuat. Teks yang belum dikirim tetap tersimpan di formulir.",
        );
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      reloadInFlight.current = false;
      setReloading(false);
    }
  }
  function submitComment(event: FormEvent) {
    event.preventDefault();
    void mutate(
      "comments",
      { body: comment.trim(), internal: isAgent && internal },
      internal ? "Catatan internal ditambahkan." : "Balasan terkirim.",
      () => setComment(""),
    );
  }
  function submitTransition(event: FormEvent) {
    event.preventDefault();
    const status = ticket.status === "resolved" ? "open" : "resolved";
    void mutate(
      "transition",
      { status, note: note.trim() },
      status === "open" ? "Tiket dibuka kembali." : "Tiket diselesaikan.",
      () => (status === "open" ? setReopenReason("") : setResolutionNote("")),
    );
  }
  return (
    <article className="ticket-detail" data-testid="ticket-detail">
      <header className="detail-heading">
        <div className="ticket-row-heading">
          <span className="ticket-key">{ticket.key}</span>
          <span className={`status status-${ticket.status}`}>
            {statusLabels[ticket.status]}
          </span>
        </div>
        <h2 ref={heading} tabIndex={-1}>
          {ticket.title}
        </h2>
        <p className="muted">Dibuat {dateTime(ticket.created_at)}</p>
      </header>
      <dl className="ticket-facts">
        <div>
          <dt>Pemohon</dt>
          <dd>{ticket.requester.name}</dd>
        </div>
        <div>
          <dt>Agen</dt>
          <dd>{ticket.assignee?.name ?? "Belum ditugaskan"}</dd>
        </div>
        <div>
          <dt>Kategori</dt>
          <dd>{categoryLabels[ticket.category]}</dd>
        </div>
        <div>
          <dt>Prioritas</dt>
          <dd>
            <span className={`priority priority-${ticket.priority}`}>
              {priorityLabels[ticket.priority]}
            </span>
          </dd>
        </div>
      </dl>
      <section className="detail-block" aria-labelledby="description-title">
        <h3 id="description-title">Kendala yang dilaporkan</h3>
        <p className="preserve-text">{ticket.description}</p>
      </section>
      <section className="sla-section" aria-labelledby="sla-title">
        <h3 id="sla-title">Batas waktu penanganan</h3>
        <div className="sla-grid">
          <div>
            <h4>Respons pertama</h4>
            <SlaLabel sla={ticket.response_sla} />
            <time dateTime={ticket.response_due_at}>
              {dateTime(ticket.response_due_at)}
            </time>
            {ticket.first_response_at && (
              <span className="fine-print">
                Direspons {dateTime(ticket.first_response_at)}
              </span>
            )}
          </div>
          <div>
            <h4>Penyelesaian</h4>
            <SlaLabel sla={ticket.resolution_sla} />
            <time dateTime={ticket.resolution_due_at}>
              {dateTime(ticket.resolution_due_at)}
            </time>
            {ticket.resolved_at && (
              <span className="fine-print">
                Selesai {dateTime(ticket.resolved_at)}
              </span>
            )}
          </div>
        </div>
        <p className="fine-print">
          Waktu berjalan terus selama 24 jam. Membuka kembali tiket memakai
          batas awal yang sama.
        </p>
      </section>
      {(newer || conflict) && (
        <Feedback kind="notice">
          <p>
            {conflict
              ? "Perubahan belum disimpan. Tiket mungkin sudah berubah atau tindakan tidak lagi tersedia."
              : "Ada pembaruan pada tiket ini. Muat versi terbaru sebelum mengirim perubahan."}{" "}
            Teks formulir tetap tersimpan.
          </p>
          <button
            onClick={() => void reloadLatest()}
            disabled={reloading || busy}
          >
            {reloading ? "Memuat..." : "Muat versi terbaru"}
          </button>
        </Feedback>
      )}
      {error && <Feedback>{error}</Feedback>}
      {notice && <Feedback kind="notice">{notice}</Feedback>}
      {isAgent && active && (
        <section className="detail-block" aria-labelledby="assignment-title">
          <h3 id="assignment-title">Penugasan agen</h3>
          {agentsLoading ? (
            <p role="status" className="muted">
              Memuat daftar agen...
            </p>
          ) : agentsError ? (
            <Feedback>
              Daftar agen tidak dapat dimuat: {agentsError}{" "}
              <button onClick={() => void reloadAgents()}>Coba lagi</button>
            </Feedback>
          ) : agents.length === 0 ? (
            <p className="muted">
              Belum ada agen terdaftar. Hubungi pengelola aplikasi.
            </p>
          ) : (
            <form
              className="assignment-form"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate(
                  "assign",
                  { assignee_id: assignee ? Number(assignee) : null },
                  "Penugasan diperbarui.",
                  () => setAssigneeDirty(false),
                );
              }}
            >
              <label>
                Agen penanggung jawab
                <select
                  value={assignee}
                  onChange={(e) => {
                    setAssignee(e.target.value);
                    setAssigneeDirty(true);
                  }}
                >
                  <option value="">Belum ditugaskan</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                      {agent.id === session.user.id ? " (saya)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                disabled={
                  mutationDisabled ||
                  assignee ===
                    (ticket.assignee ? String(ticket.assignee.id) : "")
                }
              >
                Simpan penugasan
              </button>
            </form>
          )}
          {ticket.status === "open" && (
            <div className="start-work">
              <button
                className="primary"
                disabled={mutationDisabled || !isOwner}
                onClick={() =>
                  void mutate(
                    "transition",
                    { status: "in_progress" },
                    "Penanganan dimulai.",
                  )
                }
              >
                Mulai kerjakan
              </button>
              {!isOwner && (
                <p className="fine-print">
                  Tugaskan tiket kepada diri Anda untuk mulai mengerjakan.
                </p>
              )}
            </div>
          )}
        </section>
      )}
      <section
        className="detail-block timeline-section"
        aria-labelledby="timeline-title"
      >
        <h3 id="timeline-title">Percakapan dan riwayat</h3>
        {timeline(ticket).length === 0 ? (
          <p className="muted">Belum ada aktivitas tambahan pada tiket ini.</p>
        ) : (
          <ol className="timeline">
            {timeline(ticket).map((item) => (
              <li
                key={item.key}
                className={`${item.type} ${item.internal ? "internal" : ""}`}
              >
                <div className="activity-meta">
                  <strong>{item.author}</strong>
                  <span>
                    {item.internal
                      ? item.type === "comment"
                        ? "Catatan internal"
                        : "Riwayat internal"
                      : item.type === "event"
                        ? "Riwayat"
                        : "Balasan"}
                  </span>
                  <time dateTime={item.at}>{dateTime(item.at)}</time>
                </div>
                <p className="preserve-text">{item.body}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
      {active ? (
        <section className="detail-block" aria-labelledby="reply-title">
          <h3 id="reply-title">
            Tambahkan {internal && isAgent ? "catatan internal" : "balasan"}
          </h3>
          <form className="reply-form" onSubmit={submitComment}>
            <label htmlFor="comment-body">
              Pesan
              <textarea
                id="comment-body"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                required
                minLength={1}
                maxLength={10000}
                rows={4}
                placeholder="Tulis tindak lanjut atau informasi tambahan"
              />
            </label>
            {isAgent && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                />
                Catatan internal, hanya untuk agen
              </label>
            )}
            <p className="fine-print">
              {internal && isAgent
                ? "Pemohon tidak dapat melihat catatan ini. Catatan internal tidak memenuhi SLA respons."
                : "Balasan ini dapat dilihat pemohon dan agen."}
            </p>
            <button
              className="primary"
              disabled={mutationDisabled || !comment.trim()}
            >
              {busy
                ? "Menyimpan..."
                : internal && isAgent
                  ? "Simpan catatan internal"
                  : "Kirim balasan"}
            </button>
          </form>
        </section>
      ) : (
        <p className="resolved-notice">
          Tiket selesai. Buka kembali jika kendala masih terjadi.
        </p>
      )}
      {((!active && (comment || resolutionNote)) ||
        (active && reopenReason)) && (
        <section className="detail-block" aria-label="Draf belum dikirim">
          <h3>Draf belum dikirim</h3>
          <p className="fine-print">
            Status tiket berubah. Teks berikut tetap tersedia untuk disalin dan
            belum dikirim ke server.
          </p>
          {!active && comment && (
            <label>
              Balasan yang belum dikirim
              <textarea readOnly value={comment} rows={3} />
            </label>
          )}
          {!active && resolutionNote && (
            <label>
              Ringkasan solusi yang belum dikirim
              <textarea readOnly value={resolutionNote} rows={3} />
            </label>
          )}
          {active && reopenReason && (
            <label>
              Alasan buka kembali yang belum dikirim
              <textarea readOnly value={reopenReason} rows={3} />
            </label>
          )}
        </section>
      )}
      {((isAgent && ticket.status === "in_progress") || !active) && (
        <section className="detail-block" aria-labelledby="transition-title">
          <h3 id="transition-title">
            {active ? "Selesaikan penanganan" : "Buka kembali tiket"}
          </h3>
          <form className="transition-form" onSubmit={submitTransition}>
            <label>
              {active ? "Ringkasan solusi" : "Alasan dibuka kembali"}
              <textarea
                value={note}
                onChange={(e) =>
                  active
                    ? setResolutionNote(e.target.value)
                    : setReopenReason(e.target.value)
                }
                required
                minLength={10}
                maxLength={10000}
                rows={3}
              />
            </label>
            <p className="fine-print">
              Minimal 10 karakter.{" "}
              {active
                ? "Ringkasan disimpan sebagai balasan publik."
                : "Riwayat sebelumnya dan tenggat awal tetap tersimpan."}
            </p>
            <button
              disabled={
                mutationDisabled ||
                (active && !isOwner) ||
                note.trim().length < 10
              }
            >
              {busy
                ? "Menyimpan..."
                : active
                  ? "Selesaikan tiket"
                  : "Buka kembali"}
            </button>
            {active && !isOwner && (
              <p className="fine-print">
                Hanya agen yang ditugaskan dapat menyelesaikan tiket.
              </p>
            )}
          </form>
        </section>
      )}
      <p className="detail-updated fine-print">
        Diperbarui {dateTime(ticket.updated_at)}. Versi {ticket.version}.
      </p>
    </article>
  );
}
