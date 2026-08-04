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
| `/b2b/leads/new` | Create lead (real `create_lead` RPC only; the intent is added as a real note from Lead details — no best-effort write that could be silently lost). |
| `/b2b/leads/[id]` | Lead detail: summary, **stage/won/lost/reopen/archive**, assign/reassign, timeline (note/call/meeting), inline follow-ups. Optimistic concurrency via `version`. |
| `/b2b/follow-ups` | Overdue / due-today / upcoming / completed sections; complete/reopen/cancel. |

## Authentication

- **Supabase Auth Email-OTP** via `@supabase/ssr` (cookie session). `signInWithOtp`
  → `verifyOtp({ type: "email" })`. No passwords, no SMS, no WhatsApp (deferred).
- **Sign In is not registration.** `signInWithOtp` runs with
  `shouldCreateUser: false`, so an unknown email never creates an `auth.users`
  row. A "user not found / signups not allowed" rejection is mapped to the SAME
  "code sent" response as a real send, so Sign In can't be used to enumerate
  identities. Registration / invitation is a separate, reviewed workflow.
- **Middleware** (`src/middleware.ts`) refreshes the session and guards `/b2b/*`
  (redirects to `/auth/sign-in?next=…`, bounces a signed-in user off sign-in).
- Sign-out clears the session. The `next` destination is validated (`/b2b`-only)
  to prevent open redirects.
- The sign-in UI's two steps are **sibling forms** (never nested); "Use a
  different email" is a plain reset button that refocuses the email field, and a
  **Resend** control enforces a client cooldown. The submit button is disabled
  while pending.

### Session / cookie / cache model (accurate)

- The session lives in cookies managed by `@supabase/ssr` and **shared with the
  browser client**, so they are deliberately **not HttpOnly** — the browser
  client reads them to stay signed in. The value is a Supabase-issued JWT, not a
  raw credential. RLS remains the security boundary.
- A **new** Supabase client is created per request (never module-scoped), so one
  request cannot reuse another request's session. All authenticated routes are
  `force-dynamic` (verified: every `/b2b/*` route builds as `ƒ (Dynamic)`), so no
  user-scoped content is statically/ISR cached. No access or refresh token is
  logged.
- **OTP abuse:** rate limiting relies on Supabase/GoTrue defaults; the UI adds a
  resend cooldown and disables duplicate submits. **Production still requires
  CAPTCHA/Turnstile on this public endpoint** (tracked in TECHNICAL_DEBT).

## Organization / branch context

- Derived from **real active memberships + capabilities + branch access** — never a
  role switcher, never a client-supplied org id (PRODUCT_DIRECTION_GUIDE / ADR-0007).
- A single-org user isn't asked to choose; multi-org users get an org selector.
  A forged/stale org cookie grants nothing (it falls back to the first real org).
- **Honest branch semantics** — the value shown always matches the data scope:
  - exactly one branch in scope → **auto-selected** and shown as read-only text
    (no dropdown implying a choice);
  - multiple branches → a dropdown whose "all" option is **"All branches"** for an
    org-wide caller and **"All my branches"** for a branch-limited caller (whose
    "all" = the union of their assigned branches);
  - a forged/removed branch cookie resolves to full scope (`null`), never to an
    out-of-scope branch.
- The **active org + branch narrow every cockpit widget** (my open leads,
  leads-by-stage, overdue, due-today, recent activity) and the follow-ups board —
  a caller in two orgs never sees org B's rows in org A's cockpit. Selection is a
  **cookie preference only**; every read is RLS-scoped and every RPC re-checks
  membership/branch (UI narrows, DB enforces).

## Data access

- **Server Components** read via a caller-scoped client (`getServerSupabase()`);
  RLS enforces tenant/branch/assignment scope in Postgres.
- **Server Actions** wrap the Sprint-3 `server-only` sales helpers (which forward
  the caller JWT to the RPCs). Errors map to translation **keys** (never raw DB
  text); the service-role key is never imported.
- Dashboard reads use the `security_invoker` views (`sales_my_open_leads`,
  `sales_overdue_follow_ups`, `sales_follow_ups_due_today`,
  `sales_recent_activities`), each **filtered by the active org (+ branch)**.
  Stage counts are tallied from the base `leads` table (RLS-scoped) so a selected
  branch narrows them honestly — the `sales_lead_stage_counts` view aggregates by
  org only; an exact-at-scale aggregate RPC is a documented future upgrade.
- **Free-text customer search is sanitized** (`sanitizeSearchTerm`) before it is
  interpolated into a PostgREST `.or()` filter — a whitelist of letters (incl.
  Arabic), digits, whitespace and benign contact characters, so no filter-grammar
  or LIKE-wildcard metacharacter (`, ( ) % _ * " \`) can reach the query. RLS is
  still the boundary; this only prevents malformed/injected filters.
- **Route-level boundaries:** `b2b/error.tsx` (self-contained, bilingual, retry,
  logs no PII/raw DB text) and `b2b/not-found.tsx` (localized) mean archive /
  follow-up lifecycle failures and missing routes never land on the default
  Next.js error page.

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

## Sprint 4.1 — independent frontend/auth/UX review (2026-08-04)

An independent review of the committed Sprint 4 slice found and fixed the
following (no schema change; **337 pgTAP unchanged**, frontend tests **51 → 92**):

| # | Finding | Fix |
|---|---|---|
| 1 | **Nested `<form>`** in the sign-in verify step (invalid HTML; "change email" re-sent to the same address) | Sibling forms + a `type="button"` reset that refocuses the email field; added a Resend-with-cooldown sibling form. DOM test asserts `form form` count is 0. |
| 2 | **Sign In silently registered** unknown emails (`shouldCreateUser: true`) | `shouldCreateUser: false`; unknown-identity rejections mapped to the same "code sent" response (no enumeration, no implicit sign-up). Tests prove no `shouldCreateUser:true` path. |
| 3 | **Cockpit widgets ignored active org/branch** (relied on RLS only) — a two-org user could mix orgs; branch selection didn't narrow them | `myOpenLeads/overdueFollowUps/followUpsDueToday/recentActivities/stageCounts` now take `(orgId, branchId?)` and filter accordingly. Query tests cover org isolation + branch narrowing. |
| 4 | **Dishonest branch selector** (branch-limited multi-branch user saw a branch label while scope was "all") | `resolveActiveBranch` auto-selects a single branch, honors only in-scope cookies, and labels "all" as **All / All my branches**; single branch renders read-only. Pure-function tests for one/many/forged/removed. |
| 5 | **Silent lead-intent loss** (initial note inserted in a swallowed `try/catch`) | Removed the field from Create Lead; the intent is added as a real note from Lead details. No duplicate-on-retry. Test asserts no activity write on create. |
| 6 | **Customer search** raw-interpolated into `.or()` | `sanitizeSearchTerm` whitelist; matrix test (comma/paren/percent/underscore/star/quote/backslash/Arabic/phone). |
| 7 | **No route-level error/not-found** (raw Next.js error page on failures) | `b2b/error.tsx` + `b2b/not-found.tsx`, localized, no PII/raw-DB logging. |
| 8 | **Inaccurate SSR cookie docs** (claimed HttpOnly) | Corrected: `@supabase/ssr` cookies are shared with the browser client and not HttpOnly; per-request client; force-dynamic; no token logging. |
| 9 | **Awkward Arabic copy** (`تحديد كمكسوبة`) | Won-family copy → natural `رابحة/كرابحة` (pairs with `خاسرة`). |

**Validation run:** frontend typecheck/lint/**92 tests**/build ✓; backend ruff + 10 pytest ✓; Supabase `db reset` + lint + **337 pgTAP** + all three two-session race scripts ✓; 824 doc links/0 broken; whitespace/secret/tracked-artifact/`.pen` audits clean.

**Live-browser responsive re-validation was NOT performed this session** — the
Chrome automation extension was disconnected. Server-rendered structure was
verified via HTTP (Arabic `dir="rtl"`, single sign-in form, responsive
`max-w`/`flex` classes, no inline hex), and the no-nested-form invariant is proven
by a real-DOM test; but a maintainer should confirm the four breakpoints ×
light/dark × ar/en visually before relying on the responsive claim (Sprint 4's
prior session did do this live for the unchanged surfaces).
