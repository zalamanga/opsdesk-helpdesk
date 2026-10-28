import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, ApiError, errorText, setCsrfToken } from "./api";
import {
  categoryLabels,
  dateTime,
  priorityLabels,
  statusLabels,
} from "./format";
import type {
  AuthSession,
  Filters,
  Person,
  QueueResponse,
  TicketDetail,
  TicketSummary,
} from "./types";
import TicketPanel from "./TicketPanel";
import CreateTicket from "./CreateTicket";
import { Feedback, SlaLabel } from "./ui";

function Login({
  onLogin,
  message,
}: {
  onLogin: (session: AuthSession) => void;
  message: string;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      onLogin(
        await api.login(
          String(form.get("email")).trim(),
          String(form.get("password")),
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-context" aria-label="Tentang OpsDesk">
        <span className="brand">
          OpsDesk<span className="brand-description">Meja layanan TI</span>
        </span>
        <div>
          <h1>
            Setiap masalah
            <br />
            punya tindak lanjut.
          </h1>
          <p>
            Catat kendala, ikuti percakapan, dan lihat batas waktu penanganannya
            dalam satu tiket.
          </p>
        </div>
        <p className="login-policy">
          SLA dihitung sepanjang waktu, termasuk akhir pekan. Status dan riwayat
          tercatat pada tiket.
        </p>
      </section>
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit}>
          <h2>Masuk ke meja layanan</h2>
          <p className="muted">
            Gunakan akun pemohon atau agen yang sudah terdaftar.
          </p>
          {message && <Feedback kind="notice">{message}</Feedback>}
          {error && <Feedback>{error}</Feedback>}
          <label>
            Email
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              autoFocus
              maxLength={254}
            />
          </label>
          <label>
            Kata sandi
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              maxLength={256}
            />
          </label>
          <button className="primary" type="submit" disabled={busy}>
            {busy ? "Sedang masuk..." : "Masuk"}
          </button>
          <p className="fine-print">
            Belum memiliki akun? Hubungi pengelola aplikasi untuk akses.
          </p>
        </form>
      </section>
    </main>
  );
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [startupError, setStartupError] = useState("");
  const [message, setMessage] = useState("");
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const acceptSession = useCallback((value: AuthSession) => {
    setCsrfToken(value.csrf_token);
    setSession(value);
    setMessage("");
  }, []);
  const initialize = useCallback(async () => {
    setInitializing(true);
    setStartupError("");
    try {
      acceptSession(await api.me());
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401))
        setStartupError(errorText(e));
    } finally {
      setInitializing(false);
    }
  }, [acceptSession]);
  useEffect(() => {
    void initialize();
  }, [initialize]);
  useEffect(() => {
    const expired = () => {
      if (!sessionRef.current) return;
      setSession(null);
      setCsrfToken("");
      setMessage("Sesi berakhir. Silakan masuk kembali.");
    };
    window.addEventListener("opsdesk:unauthorized", expired);
    return () => window.removeEventListener("opsdesk:unauthorized", expired);
  }, []);
  if (initializing)
    return (
      <main className="startup" role="status">
        <span className="brand">OpsDesk</span>
        <p>Memeriksa sesi...</p>
      </main>
    );
  if (startupError)
    return (
      <main className="startup">
        <h1>OpsDesk belum dapat dihubungi</h1>
        <Feedback>{startupError}</Feedback>
        <button onClick={() => void initialize()}>Coba lagi</button>
      </main>
    );
  if (!session) return <Login onLogin={acceptSession} message={message} />;
  return (
    <Workspace
      session={session}
      onLogout={() => {
        setSession(null);
        setCsrfToken("");
      }}
    />
  );
}

const initialFilters: Filters = {
  q: "",
  status: "",
  priority: "",
  assigned: "all",
  sla: "all",
  page: 1,
  page_size: 30,
};
function hashTicket(): number | null {
  const match = /^#ticket\/(\d+)$/.exec(window.location.hash);
  return match ? Number(match[1]) : null;
}

function Workspace({
  session,
  onLogout,
}: {
  session: AuthSession;
  onLogout: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState<QueueResponse | null>(null);
  const [queueError, setQueueError] = useState("");
  const [queueLoading, setQueueLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(hashTicket);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [agents, setAgents] = useState<Person[]>([]);
  const [agentsError, setAgentsError] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(
    session.user.role === "agent",
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [pollPaused, setPollPaused] = useState(
    document.visibilityState !== "visible",
  );
  const queueAbort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const queueSequence = useRef(0);
  const detailSequence = useRef(0);
  const isAgent = session.user.role === "agent";
  const loadQueue = useCallback(
    async (foreground = false) => {
      queueAbort.current?.abort();
      const controller = new AbortController();
      queueAbort.current = controller;
      const sequence = ++queueSequence.current;
      if (foreground) setQueueLoading(true);
      try {
        const result = await api.queue(filters, controller.signal);
        if (sequence !== queueSequence.current) return;
        const lastPage = Math.max(
          1,
          Math.ceil(result.total / result.page_size),
        );
        if (filters.page > lastPage) {
          setFilters((current) => ({ ...current, page: lastPage }));
          return;
        }
        setQueue(result);
        setQueueError("");
        setRefreshedAt(new Date().toISOString());
      } catch (e) {
        if (!controller.signal.aborted && sequence === queueSequence.current)
          setQueueError(errorText(e));
      } finally {
        if (sequence === queueSequence.current) setQueueLoading(false);
      }
    },
    [filters],
  );
  const loadDetail = useCallback(
    async (foreground = false): Promise<TicketDetail | null> => {
      if (selectedId === null) return null;
      detailAbort.current?.abort();
      const controller = new AbortController();
      detailAbort.current = controller;
      const sequence = ++detailSequence.current;
      if (foreground) setDetailLoading(true);
      try {
        const result = await api.ticket(selectedId, controller.signal);
        if (sequence !== detailSequence.current) return null;
        setDetail((current) =>
          current?.id === result.id && current.version > result.version
            ? current
            : result,
        );
        setDetailError("");
        return result;
      } catch (e) {
        if (!controller.signal.aborted && sequence === detailSequence.current)
          setDetailError(errorText(e));
        return null;
      } finally {
        if (sequence === detailSequence.current) setDetailLoading(false);
      }
    },
    [selectedId],
  );
  useEffect(() => {
    void loadQueue(true);
    return () => queueAbort.current?.abort();
  }, [loadQueue]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (selectedId !== null) void loadDetail(true);
    return () => detailAbort.current?.abort();
  }, [selectedId, loadDetail]);
  const loadAgents = useCallback(async () => {
    if (!isAgent) return;
    setAgentsLoading(true);
    try {
      setAgents((await api.agents()).items);
      setAgentsError("");
    } catch (e) {
      setAgentsError(errorText(e));
    } finally {
      setAgentsLoading(false);
    }
  }, [isAgent]);
  useEffect(() => {
    void loadAgents();
  }, [loadAgents]);
  useEffect(() => {
    const changed = () => setSelectedId(hashTicket());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") {
        void loadQueue();
        void loadDetail();
      }
    };
    const changed = () => {
      setPollPaused(document.visibilityState !== "visible");
      poll();
    };
    const interval = window.setInterval(poll, 15000);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", changed);
    };
  }, [loadQueue, loadDetail]);
  function select(id: number | null) {
    window.location.hash = id === null ? "" : `ticket/${id}`;
    setSelectedId(id);
  }
  function filter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value, page: 1 }));
  }
  function changedTicket(ticket: TicketDetail) {
    ++detailSequence.current;
    detailAbort.current?.abort();
    setDetail(ticket);
    setDetailError("");
    setDetailLoading(false);
    void loadQueue();
  }
  async function logout() {
    setLogoutBusy(true);
    setLogoutError("");
    try {
      await api.logout();
      window.location.hash = "";
      onLogout();
    } catch (e) {
      setLogoutError(errorText(e));
    } finally {
      setLogoutBusy(false);
    }
  }
  async function exportCsv() {
    setExporting(true);
    setExportError("");
    try {
      await api.export(filters);
    } catch (e) {
      setExportError(errorText(e));
    } finally {
      setExporting(false);
    }
  }
  const counts = queue?.counts;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Lewati ke antrean
      </a>
      <header className="app-header">
        <a href="#" className="brand" onClick={() => select(null)}>
          OpsDesk<span className="brand-description">Meja layanan TI</span>
        </a>
        <div className="account">
          <span>
            {session.user.name}
            <small>{isAgent ? "Agen layanan" : "Pemohon"}</small>
          </span>
          <button onClick={() => void logout()} disabled={logoutBusy}>
            {logoutBusy ? "Keluar..." : "Keluar"}
          </button>
        </div>
      </header>
      {session.demo_mode && (
        <div className="training-notice" role="note">
          <strong>Lingkungan latihan.</strong> Akun dan tiket seed merupakan
          data sintetis. Aktivitas baru tersimpan sampai database diatur ulang.
        </div>
      )}
      {logoutError && (
        <div className="page-message">
          <Feedback>{logoutError}</Feedback>
        </div>
      )}
      <main
        id="main-content"
        className={`workspace ${selectedId !== null ? "has-selection" : ""}`}
      >
        <section className="queue-section" aria-labelledby="queue-title">
          <div className="page-heading">
            <div>
              <h1 id="queue-title">
                {isAgent ? "Antrean layanan" : "Tiket saya"}
              </h1>
              <p className="muted">
                {isAgent
                  ? "Tinjau urgensi, ambil tanggung jawab, lalu tindak lanjuti."
                  : "Pantau penanganan kendala dan balasan dari agen."}
              </p>
            </div>
            <button className="primary" onClick={() => setCreateOpen(true)}>
              Buat tiket
            </button>
          </div>
          <section
            className="queue-overview"
            aria-label="Ringkasan seluruh tiket yang dapat diakses"
          >
            <p className="scope-label">
              Seluruh {isAgent ? "antrean" : "tiket Anda"}, sebelum filter
            </p>
            <dl>
              <div>
                <dt>Aktif</dt>
                <dd>{counts?.active ?? "..."}</dd>
              </div>
              <div>
                <dt>Belum ditugaskan</dt>
                <dd>{counts?.unassigned ?? "..."}</dd>
              </div>
              <div className={counts?.response_breached ? "overdue-count" : ""}>
                <dt>Respons lewat SLA</dt>
                <dd>{counts?.response_breached ?? "..."}</dd>
              </div>
              <div
                className={counts?.resolution_breached ? "overdue-count" : ""}
              >
                <dt>Solusi lewat SLA</dt>
                <dd>{counts?.resolution_breached ?? "..."}</dd>
              </div>
              <div>
                <dt>Selesai</dt>
                <dd>{counts?.resolved ?? "..."}</dd>
              </div>
            </dl>
          </section>
          <form
            className="filters"
            aria-label="Filter tiket"
            onSubmit={(event) => {
              event.preventDefault();
              filter("q", search.trim());
            }}
          >
            <div className="search-row">
              <label>
                Cari tiket
                <input
                  type="search"
                  placeholder="Judul atau isi tiket"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <button type="submit">Cari</button>
            </div>
            <div className="filter-row">
              <label>
                Status
                <select
                  value={filters.status}
                  onChange={(e) =>
                    filter("status", e.target.value as Filters["status"])
                  }
                >
                  <option value="">Semua status</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Prioritas
                <select
                  value={filters.priority}
                  onChange={(e) =>
                    filter("priority", e.target.value as Filters["priority"])
                  }
                >
                  <option value="">Semua prioritas</option>
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {isAgent && (
                <label>
                  Penugasan
                  <select
                    value={filters.assigned}
                    onChange={(e) =>
                      filter("assigned", e.target.value as Filters["assigned"])
                    }
                  >
                    <option value="all">Semua agen</option>
                    <option value="mine">Ditugaskan ke saya</option>
                    <option value="unassigned">Belum ditugaskan</option>
                  </select>
                </label>
              )}
              <label>
                SLA
                <select
                  value={filters.sla}
                  onChange={(e) =>
                    filter("sla", e.target.value as Filters["sla"])
                  }
                >
                  <option value="all">Semua SLA</option>
                  <option value="breached">Melewati batas</option>
                </select>
              </label>
            </div>
            {(filters.q ||
              filters.status ||
              filters.priority ||
              filters.assigned !== "all" ||
              filters.sla !== "all") && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSearch("");
                  setFilters(initialFilters);
                }}
              >
                Hapus filter
              </button>
            )}
          </form>
          <div className="queue-toolbar">
            <p className="fine-print">
              {queueLoading
                ? "Memuat antrean..."
                : queue
                  ? `${queue.total} tiket${queueError ? " pada pembaruan terakhir" : " cocok"}`
                  : "Antrean belum tersedia"}
              <span className="poll-status">
                {pollPaused
                  ? "Pembaruan dijeda saat tab tersembunyi."
                  : "Otomatis setiap 15 detik."}
                {refreshedAt && (
                  <>
                    {" "}
                    Terakhir{" "}
                    {new Date(refreshedAt).toLocaleTimeString("id-ID", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                    .
                  </>
                )}
              </span>
            </p>
            <div className="toolbar-actions">
              <button
                type="button"
                onClick={() => {
                  void loadQueue(true);
                  void loadDetail();
                }}
                disabled={queueLoading}
              >
                {queueLoading ? "Memuat..." : "Perbarui"}
              </button>
              <button
                type="button"
                onClick={() => void exportCsv()}
                disabled={exporting}
              >
                {exporting ? "Mengunduh..." : "Ekspor CSV"}
              </button>
            </div>
          </div>
          {queueError && (
            <Feedback>
              {queueError}{" "}
              {queue &&
                "Data terakhir masih ditampilkan. Antrean belum diperbarui. "}
              <button
                className="text-button"
                onClick={() => void loadQueue(true)}
              >
                Coba lagi
              </button>
            </Feedback>
          )}
          {exportError && <Feedback>{exportError}</Feedback>}
          <div className="ticket-list" aria-busy={queueLoading}>
            {!queue && queueLoading ? (
              <p className="empty-state" role="status">
                Memuat tiket...
              </p>
            ) : queue?.items.length === 0 ? (
              <div className="empty-state">
                <h2>Tidak ada tiket yang cocok</h2>
                <p>Ubah filter atau buat tiket baru untuk mencatat kendala.</p>
              </div>
            ) : (
              queue?.items.map((ticket) => (
                <QueueTicket
                  key={ticket.id}
                  ticket={ticket}
                  selected={selectedId === ticket.id}
                  onSelect={() => select(ticket.id)}
                />
              ))
            )}
          </div>
          {queue && queue.total > 0 && (
            <nav className="pagination" aria-label="Halaman antrean">
              <label className="page-size-control">
                Tiket per halaman
                <select
                  value={filters.page_size}
                  onChange={(event) =>
                    filter("page_size", Number(event.target.value))
                  }
                >
                  <option value={10}>10</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <button
                disabled={filters.page <= 1 || queueLoading}
                onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
              >
                Sebelumnya
              </button>
              <span>
                Halaman {queue.page} dari{" "}
                {Math.max(1, Math.ceil(queue.total / queue.page_size))}
              </span>
              <button
                disabled={
                  queue.page * queue.page_size >= queue.total || queueLoading
                }
                onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
              >
                Berikutnya
              </button>
            </nav>
          )}
        </section>
        <aside className="detail-section" aria-label="Detail tiket">
          {selectedId === null ? (
            <div className="detail-placeholder">
              <span className="placeholder-label">Detail tiket</span>
              <h2>Pilih tiket untuk menindaklanjuti</h2>
              <p>
                Deskripsi, batas waktu SLA, penugasan, dan riwayat percakapan
                tampil di sini.
              </p>
              <p className="fine-print">
                Urutan antrean: tiket aktif, prioritas tertinggi, lalu tiket
                terlama.
              </p>
            </div>
          ) : (
            <>
              <button className="back-button" onClick={() => select(null)}>
                Kembali ke antrean
              </button>
              {detailError && (
                <Feedback>
                  {detailError}{" "}
                  <button
                    className="text-button"
                    onClick={() => void loadDetail(true)}
                  >
                    Muat ulang
                  </button>
                </Feedback>
              )}
              {!detail && detailLoading && (
                <p className="empty-state" role="status">
                  Memuat detail tiket...
                </p>
              )}
              {detail && (
                <TicketPanel
                  key={detail.id}
                  ticket={detail}
                  session={session}
                  agents={agents}
                  agentsLoading={agentsLoading}
                  agentsError={agentsError}
                  reloadAgents={loadAgents}
                  reload={() => loadDetail(true)}
                  onChange={changedTicket}
                />
              )}
            </>
          )}
        </aside>
      </main>
      {createOpen && (
        <CreateTicket
          onClose={() => setCreateOpen(false)}
          onCreated={(ticket) => {
            setCreateOpen(false);
            select(ticket.id);
            changedTicket(ticket);
          }}
        />
      )}
    </>
  );
}

function QueueTicket({
  ticket,
  selected,
  onSelect,
}: {
  ticket: TicketSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`ticket-row ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      data-testid={`ticket-${ticket.id}`}
    >
      <div className="ticket-row-heading">
        <span className="ticket-key">{ticket.key}</span>
        <span className={`priority priority-${ticket.priority}`}>
          {priorityLabels[ticket.priority]}
        </span>
        <span className={`status status-${ticket.status}`}>
          {statusLabels[ticket.status]}
        </span>
      </div>
      <h2>{ticket.title}</h2>
      <p className="ticket-people">
        {ticket.requester.name}
        <span aria-hidden="true"> / </span>
        {ticket.assignee?.name ?? "Belum ditugaskan"}
      </p>
      <div className="ticket-row-footer">
        <span>
          {categoryLabels[ticket.category]}
          <span className="ticket-created">
            Dibuat {dateTime(ticket.created_at)}
          </span>
        </span>
        <span className="queue-sla">
          <span>
            Respons: <SlaLabel sla={ticket.response_sla} />
          </span>
          <span>
            Solusi: <SlaLabel sla={ticket.resolution_sla} />
          </span>
        </span>
      </div>
    </button>
  );
}
