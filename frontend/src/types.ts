export type Role = "requester" | "agent";
export type Status = "open" | "in_progress" | "resolved";
export type Priority = "low" | "normal" | "high" | "critical";
export type Category = "access" | "hardware" | "network" | "software" | "other";
export type Person = { id: number; name: string };
export type AuthSession = {
  user: Person & { email: string; role: Role };
  csrf_token: string;
  demo_mode: boolean;
};
export type Sla = {
  state: "pending" | "met" | "breached";
  due_at: string;
  completed_at: string | null;
  remaining_seconds: number;
};
export type TicketSummary = {
  id: number;
  key: string;
  title: string;
  category: Category;
  priority: Priority;
  status: Status;
  requester: Person;
  assignee: Person | null;
  created_at: string;
  updated_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  response_due_at: string;
  resolution_due_at: string;
  response_sla: Sla;
  resolution_sla: Sla;
  version: number;
};
export type TicketDetail = TicketSummary & {
  description: string;
  comments: {
    id: number;
    author: Person;
    body: string;
    internal: boolean;
    created_at: string;
  }[];
  events: {
    id: number;
    actor: Person;
    kind: string;
    summary: string;
    internal: boolean;
    created_at: string;
  }[];
};
export type QueueCounts = {
  active: number;
  unassigned: number;
  response_breached: number;
  resolution_breached: number;
  resolved: number;
};
export type QueueResponse = {
  items: TicketSummary[];
  total: number;
  page: number;
  page_size: number;
  counts: QueueCounts;
};
export type Filters = {
  q: string;
  status: "" | Status;
  priority: "" | Priority;
  assigned: "all" | "mine" | "unassigned";
  sla: "all" | "breached";
  page: number;
  page_size: number;
};
