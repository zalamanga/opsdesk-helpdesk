# OpsDesk interface direction

The user chose: "Terang, rapi seperti aplikasi kerja". The audience is staff who report IT problems and agents who handle the queue. ENERGY 1, RHYTHM 2, MOTION 1.

The primary task is to identify the next ticket and carry it through an accountable handoff, conversation, and resolution. The queue occupies the left reading area on a wide screen; the selected ticket, SLA deadlines, forms, and history occupy the right. The application has no charts because there is no reporting dataset or reporting workflow in this release.

## Visual choices and reasons

- Warm light gray separates the workspace from white ticket surfaces. Dark ink text keeps long issue descriptions readable.
- Petrol is used for primary actions and the selected row. It ties a selected queue item to the work being done. Amber and rust carry actual SLA or urgency information, always accompanied by words.
- The brand is the text OpsDesk. There is no invented mark, customer logo, portrait, or decorative illustration.
- Segoe UI is the first typeface on Windows, followed by system fonts. Staff read dense forms and timelines, so the interface uses familiar operating system letterforms and does not download a webfont. Numeric deadlines use tabular figures.
- Queue totals are one compact definition list, not separate statistic cards. Their caption states that they cover the entire accessible queue before filters.
- Flat surfaces and dividers show content ownership. The create-ticket dialog has the only substantial shadow because it is genuinely above the workspace. Small corners distinguish controls and messages from list rows.
- Text labels carry status, priority, internal visibility, SLA outcomes, and loading states. Color does not carry a state alone.
- Motion is restricted to short control feedback. There is no automatic carousel, pulse, animated chart, or decorative background.

## Reflow and interaction

At narrow widths, selecting a ticket opens a dedicated detail view with a visible return button. Below 560px, ticket metadata and forms stack. Between 560px and 1099px, the queue has more breathing room without squeezing a second pane. At 1100px, queue and detail share the screen. Wider filters use four columns only when their labels fit.

All controls have at least a 44px target. Visible keyboard focus uses a rust outline. The native dialog provides a focus trap and Escape dismissal; submission temporarily prevents dismissal to avoid an ambiguous in-flight create. The selected detail heading receives focus once when opened, never during polling. The page has a skip link, semantic headings, labels, status announcements, and text errors.

Polling runs every 15 seconds while the tab is visible. It updates data without resetting the selected ticket, comment draft, internal-note choice, transition reason, or unsaved assignment. A form remembers its starting version; a conflict offers a deliberate reload while retaining unsent text. Each agent or requester sees only data returned by the backend. Training data is labelled only when the authenticated session returns `demo_mode: true`.

## Boundaries

There is no signup, forgot-password flow, email delivery, upload control, AI suggestion, theme toggle, or billing interface. Those endpoints and services do not exist in the implementation contract. Credentials and cookie tokens are never stored in localStorage.
