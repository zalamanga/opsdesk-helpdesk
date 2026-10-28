import { describe, expect, it } from "vitest";
import { duration, slaText, timeline } from "./format";
import { queryString } from "./api";
import type { Filters, TicketDetail } from "./types";

describe("SLA labels", () => {
  it("distinguishes due now, pending, completed late, and met", () => {
    const base = {
      due_at: "2026-10-28T00:00:00Z",
      completed_at: null,
      remaining_seconds: 0,
    };
    expect(slaText({ ...base, state: "pending" })).toBe("Jatuh tempo sekarang");
    expect(slaText({ ...base, state: "pending", remaining_seconds: 61 })).toBe(
      "Sisa 2 mnt",
    );
    expect(
      slaText({ ...base, state: "breached", remaining_seconds: -3600 }),
    ).toBe("Lewat 1 jam");
    expect(
      slaText({
        ...base,
        state: "breached",
        remaining_seconds: -3600,
        completed_at: "2026-10-28T01:00:00Z",
      }),
    ).toBe("Selesai terlambat 1 jam");
    expect(slaText({ ...base, state: "met" })).toBe("Tepat waktu");
  });
  it("expresses long durations without discarding complete hours", () => {
    expect(duration(90000)).toBe("1 hari 1 jam");
    expect(duration(-60)).toBe("1 mnt");
  });
});

describe("export scope", () => {
  it("exports the matching filter scope without current-page parameters", () => {
    const filters: Filters = {
      q: "VPN & akses",
      status: "open",
      priority: "",
      assigned: "mine",
      sla: "breached",
      page: 3,
      page_size: 30,
    };
    const params = new URLSearchParams(queryString(filters, false));
    expect(params.get("q")).toBe("VPN & akses");
    expect(params.get("assigned")).toBe("mine");
    expect(params.get("sla")).toBe("breached");
    expect(params.has("page")).toBe(false);
    expect(params.has("page_size")).toBe(false);
    expect(params.has("priority")).toBe(false);
    expect(new URLSearchParams(queryString(filters)).get("page")).toBe("3");
  });
});

describe("ticket timeline", () => {
  it("merges real events and comments in chronological order, retaining visibility", () => {
    const ticket = {
      comments: [
        {
          id: 1,
          author: { id: 1, name: "Agen latihan" },
          body: "Pemeriksaan",
          internal: true,
          created_at: "2026-10-28T09:00:00Z",
        },
      ],
      events: [
        {
          id: 7,
          actor: { id: 2, name: "Pemohon latihan" },
          kind: "created",
          summary: "Tiket dibuat",
          internal: false,
          created_at: "2026-10-28T08:00:00Z",
        },
      ],
    } as TicketDetail;
    expect(timeline(ticket).map((item) => item.key)).toEqual([
      "event-7",
      "comment-1",
    ]);
    expect(timeline(ticket)[1].internal).toBe(true);
    expect(timeline(ticket)[0].author).toBe("Pemohon latihan");
  });
});
