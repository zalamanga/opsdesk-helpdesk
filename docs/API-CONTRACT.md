# OpsDesk implementation contract

All routes are under `/api`, use JSON, and are same-origin. Times are ISO 8601 UTC. IDs are integers. Roles are `requester` and `agent`.

## Authentication

- `POST /auth/login` accepts `{email,password}`. Returns `AuthSession` and sets an opaque HttpOnly SameSite=Lax session cookie. No token in localStorage.
- `GET /auth/me` returns `AuthSession` or 401.
- `POST /auth/logout` revokes the session and clears its cookie; returns 204.
- AuthSession: `{user:{id,name,email,role},csrf_token,demo_mode}`.
- All authenticated mutations require `X-CSRF-Token`. Browser Origin must match configured exact origins. Login accepts JSON and validates Origin if supplied. No wildcard CORS.
- `GET /health` reports readiness. `GET /agents` returns `{items:[{id,name}]}` for agents only.

## Tickets

`GET /tickets?q=&status=&priority=&assigned=all|mine|unassigned&sla=all|breached&page=1&page_size=30` returns:

```json
{"items":[],"total":0,"page":1,"page_size":30,"counts":{"active":0,"unassigned":0,"response_breached":0,"resolution_breached":0,"resolved":0}}
```

Counts cover the actor's entire accessible queue, independent of filters. Requesters only see their own tickets. Agents see all. Order: active before resolved; highest urgency first; oldest first within urgency. `GET /tickets/export.csv` exports all accessible matching filters (not only the current page), caps at 10000 with explicit rejection above the cap, and neutralizes spreadsheet formulas.

`GET /tickets/{id}` returns TicketDetail. `POST /tickets` accepts only `{title,description,category,priority}` and returns TicketDetail with 201. Title 5-160 characters, description 10-10000, category `access|hardware|network|software|other`, priority `low|normal|high|critical`. Priorities and deadlines are immutable after creation.

TicketSummary:

```ts
type Person = {id:number; name:string};
type Sla = {state:'pending'|'met'|'breached';due_at:string;completed_at:string|null;remaining_seconds:number};
type TicketSummary = {
 id:number;key:string;title:string;category:string;priority:string;status:'open'|'in_progress'|'resolved';
 requester:Person;assignee:Person|null;created_at:string;updated_at:string;
 first_response_at:string|null;resolved_at:string|null;response_due_at:string;resolution_due_at:string;
 response_sla:Sla;resolution_sla:Sla;version:number;
};
type TicketDetail = TicketSummary & {
 description:string;
 comments:{id:number;author:Person;body:string;internal:boolean;created_at:string}[];
 events:{id:number;actor:Person;kind:string;summary:string;internal:boolean;created_at:string}[];
};
```

Mutations return the new TicketDetail and require `expected_version`:

- `POST /tickets/{id}/assign`: `{assignee_id:number|null,expected_version}`. Agent only, active ticket only; assignee must be agent.
- `POST /tickets/{id}/transition`: `{status:'in_progress'|'resolved'|'open',note?:string,expected_version}`. Open -> in_progress -> resolved. Starting/resolving requires the acting agent to own the ticket. Resolution requires note >=10 chars, saved publicly. Resolved -> open requires reason >=10 chars and can be done by owning requester or agent. Reopen clears current resolved_at, preserves original deadlines/first response, and records history. No other transitions allowed.
- `POST /tickets/{id}/comments`: `{body:string,internal:boolean,expected_version}`. Body 1-10000. Active only. Requesters cannot post or read internal notes/events. First public comment from an agent other than the ticket requester (including a resolution note) sets first_response_at once; assignment/internal notes/requester comments do not. An agent reporting their own issue does not satisfy their own response SLA by replying to it.

Every change locks the ticket, compares expected_version inside the transaction, increments version, and writes audit atomically. Stale version: 409 with detail message. Missing/inaccessible ticket: 404. Wrong role: 403. Invalid transition: 409. Invalid payload: 422. Fields outside the schema are rejected.

## SLA policy

Continuous elapsed time in UTC, no pauses or business calendar. Low response 8h/resolution 72h; normal 4h/24h; high 1h/8h; critical 15m/4h. Snapshot deadlines at creation. Completion <= due is met. Completion > due is breached. Incomplete now > due is breached; exactly due is pending. Reopening uses the original resolution deadline. `remaining_seconds` is signed due minus now for pending, due minus completion for completed. Use one server clock value per response.

## Demo and boundaries

Explicit seed creates labelled synthetic training tickets/accounts. `demo_mode` indicates this in UI. No email, uploads, AI, billing, multi-tenant claims, or business-hour SLA. Poll every 15 seconds while visible, with manual refresh. Never overwrite user transactions when seed runs again.
