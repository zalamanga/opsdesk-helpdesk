import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api, errorText } from "./api";
import { Feedback } from "./ui";
import { categoryLabels, priorityLabels } from "./format";
import type { TicketDetail } from "./types";

export default function CreateTicket({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ticket: TicketDetail) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [priority, setPriority] = useState("normal");
  const policy: Record<string, string> = {
    low: "Rendah: respons 8 jam, penyelesaian 72 jam.",
    normal: "Normal: respons 4 jam, penyelesaian 24 jam.",
    high: "Tinggi: respons 1 jam, penyelesaian 8 jam.",
    critical: "Kritis: respons 15 menit, penyelesaian 4 jam.",
  };
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    dialog.current
      ?.querySelector<HTMLInputElement>('input[name="title"]')
      ?.focus();
    return () => {
      opener?.focus();
    };
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      onCreated(
        await api.create({
          title: String(values.get("title")).trim(),
          description: String(values.get("description")).trim(),
          category: values.get("category"),
          priority: values.get("priority"),
        }),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="create-dialog"
      ref={dialog}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="create-title"
    >
      <div className="dialog-heading">
        <h2 id="create-title">Buat tiket layanan</h2>
        <button type="button" onClick={onClose} disabled={busy}>
          Tutup
        </button>
      </div>
      <p className="muted">
        Jelaskan kendala dan dampaknya agar agen dapat menindaklanjuti.
      </p>
      <form onSubmit={submit}>
        {error && <Feedback>{error}</Feedback>}
        <label>
          Judul kendala
          <input
            name="title"
            required
            minLength={5}
            maxLength={160}
            autoFocus
            placeholder="Contoh: tidak bisa masuk ke aplikasi inventaris"
          />
        </label>
        <label>
          Deskripsi
          <textarea
            name="description"
            required
            minLength={10}
            maxLength={10000}
            rows={5}
            placeholder="Apa yang terjadi, sejak kapan, dan langkah yang sudah dicoba?"
          />
        </label>
        <div className="form-columns">
          <label>
            Kategori
            <select name="category" defaultValue="software">
              {Object.entries(categoryLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Prioritas
            <select
              name="priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
            >
              {Object.entries(priorityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="fine-print" aria-live="polite">
          Prioritas menentukan tenggat dan tidak dapat diubah setelah tiket
          dibuat. {policy[priority]}
        </p>
        <div className="dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Membuat tiket..." : "Kirim tiket"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
