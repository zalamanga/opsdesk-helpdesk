# Backend verification

Tests exercise the HTTP contract with independently authenticated requester and agent sessions. Each ordinary test uses an isolated SQLite database and a controlled UTC clock. Test users and ticket content are synthetic.

| Area | Observable result |
| --- | --- |
| Authentication | Cookie session works, logout revokes the old cookie, expiration returns 401, and unauthenticated requests cannot read tickets. |
| Request isolation | A requester cannot read another requester's detail, comments, event history, queue, counts, or CSV rows. Internal agent notes and their audit events stay hidden. |
| Mutation protection | Missing or wrong CSRF tokens and an unapproved Origin fail before data changes. Login also rejects an unapproved Origin. |
| Workflow | Assignment and state transitions respect role, ownership, version, resolution-note length, and active/resolved state. Invalid input cannot change deadlines or add audit rows. |
| SLA | All four policies, exact due boundaries, late completion, first public agent response, and reopening retain the documented elapsed-time behavior. |
| Atomic writes | A forced database failure during audit creation rolls back the ticket mutation and any comment. |
| Export | Filters apply to every exported row, not just a visible page. Quoting preserves commas, quotes and newlines; spreadsheet formula prefixes are neutralized. |
| Seed | Running the demo seed twice does not duplicate records or overwrite user changes. |
| PostgreSQL race | Two independent clients submit the same ticket version concurrently. Exactly one succeeds; the other receives 409, with one version increment and one audit addition. |

Run the ordinary suite from `backend` with `python -m pytest -q`. The PostgreSQL concurrency test is skipped unless `OPSDESK_TEST_DATABASE_URL` is supplied. Use a dedicated disposable PostgreSQL database: the test creates the schema if needed and removes only the unique records it creates. It never starts Docker or chooses a database from the application environment automatically.

The suite checks authorization and transaction outcomes. Browser layout, keyboard navigation, empty/loading/error states, and responsive behavior are verified separately by the browser suite.
