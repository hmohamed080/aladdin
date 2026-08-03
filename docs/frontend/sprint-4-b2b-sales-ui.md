# Sprint 4 — Authenticated B2B Sales Vertical Slice (frontend)

**Status:** Implemented · 2026-08-04 · Phase 2 (B2B Sales Operating Workflow)
**Branch:** `feature/b2b-sales-ui` · PR → `main`

The first real product UI: a usable, end-to-end B2B Sales experience wired to the
**real** Supabase schema, RLS, and RPCs from Sprint 3 (ADR-0008). Arabic-first
(RTL), English switch, light/dark, responsive. No mock data in any core flow; the
service-role key never reaches the browser; authorization stays in the database.

## Implemented routes (App Router)

| Route | Purpose |
|---|---|
| `/auth/sign-in` | Passwordless **Email-OTP** sign-in (two steps: email → 6-digit code). |
| `/b2b` | Sales cockpit: my open leads, leads-by-stage, overdue + due-today follow-ups, recent activity, quick actions. |
| `/b2b/customers` | Customer list — search (name/phone), status + branch filters; responsive table/cards. |
| `/b2b/customers/new` | Create customer (real `create_customer` RPC). |
| `/b2b/customers/[id]` | Customer detail: contact, related leads, activity; create lead / archive. |
| `/b2b/leads` | Leads **list + pipeline (kanban)** views; stage/status/priority/branch filters. |
| `/b2b/leads/new` | Create lead (real `create_lead` RPC; optional intent note). |
| `/b2b/leads/[id]` | Lead detail: summary, **stage/won/lost/reopen/archive**, assign/reassign, timeline (note/call/meeting), inline follow-ups. Optimistic concurrency via `version`. |
| `/b2b/follow-ups` | Overdue / due-today / upcoming / completed sections; complete/reopen/cancel. |

## Authentication

- **Supabase Auth Email-OTP** via `@supabase/ssr` (cookie session). `signInWithOtp`
  → `verifyOtp({ type: "email" })`. No passwords, no SMS, no WhatsApp (deferred).
- **Middleware** (`src/middleware.ts`) refreshes the session and guards `/b2b/*`
  (redirects to `/auth/sign-in?next=…`, bounces a signed-in user off sign-in).
- Sign-out clears the session. The `next` destination is validated (`/b2b`-only)
  to prevent open redirects.

## Organization / branch context

- Derived from **real active memberships + capabilities + branch access** — never a
  role switcher, never a client-supplied org id (PRODUCT_DIRECTION_GUIDE / ADR-0007).
- A single-org user isn't asked to choose; multi-org users get an org selector.
- Branch-limited users only see their assigned branches; org-wide users additionally
  get "All branches". Selection is a **cookie preference only** — it grants no
  authority; every read is RLS-scoped and every RPC re-checks membership/branch.

## Data access

- **Server Components** read via a caller-scoped client (`getServerSupabase()`);
  RLS enforces tenant/branch/assignment scope in Postgres.
- **Server Actions** wrap the Sprint-3 `server-only` sales helpers (which forward
  the caller JWT to the RPCs). Errors map to translation **keys** (never raw DB
  text); the service-role key is never imported.
- Dashboard reads use the `security_invoker` views (`sales_lead_stage_counts`,
  `sales_my_open_leads`, `sales_overdue_follow_ups`, `sales_follow_ups_due_today`,
  `sales_recent_activities`).

## i18n / theme / responsive

- **Arabic-first** (`APP_DEFAULT_LOCALE = "ar"`), cookie-based locale (not in the
  URL, so the flat route structure is preserved), `<html dir>` set on the server.
  English is a one-click switch. `ar`/`en` catalogs are key-parity-tested.
- **Light/dark** via a cookie + `.dark` class on `<html>` (server-rendered, no
  flash), consuming the design-system semantic tokens.
- Responsive: desktop tables + side panels; tablet adapts; mobile uses single-column
  cards + a bottom nav; the leads kanban falls back to grouped columns/cards.

## Local testing (product owner)

Prerequisites: Docker running.

```bash
corepack pnpm exec supabase start
corepack pnpm exec supabase db reset            # migrations + base seed
docker exec -i supabase_db_aladdin psql -U postgres -d postgres \
    < supabase/demo-seed.sql                    # sample customers/leads/follow-ups
cd frontend && cp .env.example .env.local       # then fill the two NEXT_PUBLIC_* values
corepack pnpm --filter frontend dev             # http://localhost:3000
```

`.env.local` values (from `supabase status`):
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>`.

**Sign-in identities** (read the one-time code from **Mailpit** at
`http://127.0.0.1:54324`):

| Email | Role in the demo |
|---|---|
| `a-owner@example.test` | Org A manager — org-wide sales authority, both branches. |
| `a-cairo@example.test` | Org A salesperson — branch-limited to Cairo (read/write, no assign). |

Try: sign in as the manager (see all leads incl. Sheikh Zayed), then as the Cairo
salesperson (Sheikh Zayed lead is **not** visible — RLS scope), and confirm the
salesperson cannot assign or reach org-wide records.

> The local email template (`supabase/templates/magic_link.html`) is customized to
> show the 6-digit `{{ .Token }}` so the code flow works locally; production uses
> its own template.

## Known limitations / deferred

- **WhatsApp OTP** — future integration sprint (Email-OTP only here).
- **Notifications / reminders** on follow-ups — schema is reminder-ready; UI deferred.
- **Products, inventory, RFQ, quotations, projects, advertisements, payments, OCR,
  AI, native mobile** — out of scope for this sprint.
- Bulk **import/export** UI — schema-ready (ADR-0008 debt), not built.
- Advanced team-permission management UI — capabilities are managed by the Sprint-2
  membership RPCs, not this UI.
