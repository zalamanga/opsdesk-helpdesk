import type {
  AuthSession,
  Filters,
  Person,
  QueueResponse,
  TicketDetail,
} from "./types";

let csrfToken = "";
export function setCsrfToken(token: string) {
  csrfToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorText(value: unknown): string {
  if (value instanceof TypeError)
    return "Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.";
  if (value instanceof ApiError || value instanceof Error) return value.message;
  return "Permintaan gagal. Coba lagi.";
}

function detailMessage(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((item) => {
        if (typeof item === "object" && item !== null && "msg" in item)
          return String(item.msg);
        return "Periksa isian formulir.";
      })
      .join(" ");
  return "Server tidak dapat memproses permintaan.";
}

async function check(response: Response): Promise<Response> {
  if (response.ok) return response;
  let message = `Permintaan gagal (${response.status}).`;
  try {
    const body = await response.json();
    message = detailMessage(body.detail ?? body.message);
  } catch {
    /* A reverse proxy may return a non-JSON error page. */
  }
  if (response.status === 401)
    window.dispatchEvent(new Event("opsdesk:unauthorized"));
  throw new ApiError(response.status, message);
}

export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers:
      body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  await check(response);
  return response.status === 204 ? (undefined as T) : response.json();
}

export function queryString(filters: Filters, includePage = true): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (!includePage && (key === "page" || key === "page_size")) continue;
    if (value !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const api = {
  me: () => request<AuthSession>("/auth/me"),
  login: (email: string, password: string) =>
    request<AuthSession>("/auth/login", { email, password }),
  logout: () => request<void>("/auth/logout", {}),
  agents: (signal?: AbortSignal) =>
    request<{ items: Person[] }>("/agents", undefined, signal),
  queue: (filters: Filters, signal?: AbortSignal) =>
    request<QueueResponse>(
      `/tickets?${queryString(filters)}`,
      undefined,
      signal,
    ),
  ticket: (id: number, signal?: AbortSignal) =>
    request<TicketDetail>(`/tickets/${id}`, undefined, signal),
  create: (body: unknown) => request<TicketDetail>("/tickets", body),
  mutate: (id: number, action: string, body: unknown) =>
    request<TicketDetail>(`/tickets/${id}/${action}`, body),
  async export(filters: Filters) {
    const response = await fetch(
      `/api/tickets/export.csv?${queryString(filters, false)}`,
      { credentials: "same-origin" },
    );
    await check(response);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "opsdesk-tickets.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
