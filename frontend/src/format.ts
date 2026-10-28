import type { Priority, Sla, Status, TicketDetail } from "./types";

export const statusLabels: Record<Status, string> = {
  open: "Baru",
  in_progress: "Dikerjakan",
  resolved: "Selesai",
};
export const priorityLabels: Record<Priority, string> = {
  low: "Rendah",
  normal: "Normal",
  high: "Tinggi",
  critical: "Kritis",
};
export const categoryLabels = {
  access: "Akses akun",
  hardware: "Perangkat",
  network: "Jaringan",
  software: "Aplikasi",
  other: "Lainnya",
};
export const dateTime = (value: string) =>
  new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));

export function duration(seconds: number): string {
  const minutes = Math.max(1, Math.ceil(Math.abs(seconds) / 60));
  if (minutes < 60) return `${minutes} mnt`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `${hours} jam${remainder ? ` ${remainder} mnt` : ""}`;
  return `${Math.floor(hours / 24)} hari${hours % 24 ? ` ${hours % 24} jam` : ""}`;
}

export function slaText(sla: Sla): string {
  if (sla.state === "met") return "Tepat waktu";
  if (sla.state === "breached")
    return `${sla.completed_at ? "Selesai terlambat" : "Lewat"} ${duration(sla.remaining_seconds)}`;
  if (sla.remaining_seconds === 0) return "Jatuh tempo sekarang";
  return `Sisa ${duration(sla.remaining_seconds)}`;
}

export type TimelineItem = {
  key: string;
  author: string;
  body: string;
  internal: boolean;
  at: string;
  type: "comment" | "event";
};
export function timeline(ticket: TicketDetail): TimelineItem[] {
  return [
    ...ticket.comments.map((c) => ({
      key: `comment-${c.id}`,
      author: c.author.name,
      body: c.body,
      internal: c.internal,
      at: c.created_at,
      type: "comment" as const,
    })),
    ...ticket.events.map((e) => ({
      key: `event-${e.id}`,
      author: e.actor.name,
      body: e.summary,
      internal: e.internal,
      at: e.created_at,
      type: "event" as const,
    })),
  ].sort(
    (a, b) =>
      new Date(a.at).getTime() - new Date(b.at).getTime() ||
      a.key.localeCompare(b.key),
  );
}
