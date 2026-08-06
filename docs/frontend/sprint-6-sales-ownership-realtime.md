# Sprint 6 — Sales Ownership, Realtime & Performance Hardening (frontend/engineering)

**Status:** Implemented · 2026-08-05 · Phase 2 (B2B Sales Operating Workflow)
**Branch:** `feature/sales-ownership-realtime` · PR → `main` · Base `main` @ `5a47011`

Closes the remaining post-create **ownership** gaps in the B2B sales workflow,
adds a carefully **scoped Realtime** layer, and establishes **executed** E2E,
real-browser visual-QA, and production-performance merge gates. Arabic-first RTL +
English + light/dark + mobile/tablet/desktop preserved; real Supabase data and
trusted RPCs only; RLS remains the security boundary.

## 1. Ownership edit paths (new trusted RPCs)

Migration `20260806090001_sales_ownership_and_realtime.sql` adds two
security-definer, `authenticated`-only, optimistic-concurrent, transactionally
audited RPCs — and nothing else on the write side.

| Entity | RPC | Editable | Concurrency | Capability | Audit |
|---|---|---|---|---|---|
| Customer | `set_customer_ownership` | branch, assigned salesperson | `p_expected_updated_at` → 40001 | `sales.assign` (+ branch scope; org-wide needs `sales.manage`) | `customer.reassigned` (old/new branch+assignee) |
| Lead | `set_lead_source_branch` | source, branch, (+ compatible reassignment) | `p_expected_version` → 40001 | `sales.write` for source; `sales.assign` for branch/reassign | `lead.details_changed` (old/new source+branch+assignee) |

**Invariants enforced in the database (not the UI):** caller derived from
`auth.uid()`; active-org membership + branch scope; the selected branch must be in
caller scope (managers reach all); a non-manager cannot create an org-wide
(null-branch) record; the effective assignee must be able to reach the effective
branch, so a **branch move that would strand the current assignee is rejected**
unless the caller supplies a compatible reassignment in the same call (never a
silent unassign); cross-tenant branches are rejected early; **lead lifecycle
(status/stage/won-lost/closed_at/lost_reason) is structurally out of bounds** for
`set_lead_source_branch`. No audit row is written on any failure or conflict.

### Customer type is immutable (decision)

No product/domain document approves mutating `customer_type`. Per the sprint rule
(“if documentation does not explicitly approve mutation, keep it immutable”), it
is **not** editable. A mis-typed customer is corrected by archive + re-create,
which preserves the audit trail. (Recorded in `DECISION_LOG` / `TECHNICAL_DEBT`.)

### UI

The customer and lead **edit** pages gain an ownership card (rendered only with
`sales.assign`). The controls live inside the accessible `ConfirmDialog` so a
branch move is explicitly confirmed with its **visibility consequence** spelled
out; selects are **controlled** so picked values survive an expected
validation/conflict error (the dialog stays open and shows the localized message).
The form actions send **only the axes that actually changed** (current values are
carried as hidden fields and diffed), and the RPC re-reads + re-authorizes.

## 2. Scoped Realtime

**Approach chosen: Postgres Changes** (not Broadcast-from-database). Rationale for
pilot volume: Postgres Changes authorizes every change against the subscriber’s
own RLS `SELECT` policy with zero extra schema, whereas Broadcast would require
per-table triggers, a `realtime.messages` RLS policy, and a second write path.
The smaller, RLS-native option wins here; Broadcast is the future upgrade if
change volume outgrows per-row authorization. (See `ADR-0008` addendum.)

**Publication** (`supabase_realtime`): exactly `leads` + `follow_up_tasks` — the
two surfaces with daily-sales value (pipeline, follow-up board, and the related
lists on customer/lead detail). No identity/verification/audit/customer-PII table
is published. Replica identity stays default (primary key).

**Client boundary** (`features/sales/sales-realtime.tsx`, mounted once in the B2B
shell for the active org):

- Subscribes through the caller’s **anon** browser client (never service_role),
  filtered to the **server-derived** active scope. **(Corrected in Sprint 6.1 — see
  the closeout below):** the filter matches what the pages display — All Branches →
  `organization_id=eq.<orgId>`; a selected branch → `branch_id=eq.<branchId>`
  (which, like the list queries, excludes org-wide NULL-branch rows). A forged
  cookie can’t widen it. The socket is authenticated with the caller’s access token
  via `realtime.setAuth`, so Postgres Changes are authorized as the user.
- **Never renders a Realtime payload.** An event is only a hint: a debounced
  `router.refresh()` re-fetches through RLS on the server. This is the keystone —
  an unauthorized row can never surface, and duplicate/out-of-order events can’t
  corrupt local state because there is **no client-side card state**; the server
  is the single source of truth.
- Rebuilds on active org/branch change; removes the channel on unmount and on
  `SIGNED_OUT`.
- **Never overwrites an open edit:** while a form field is focused the refresh is
  deferred to a manual “Updated ↻” affordance (a polite live region), so incoming
  data never moves focus or discards unsaved input.
- Shows reconnecting/paused status via `aria-live="polite"`; raw channel errors
  are never surfaced.

## 3. Query & performance

- **Query dedupe:** the customer/lead edit pages called both `memberNameMap`
  (which itself calls `listOrgMembers`) and `listOrgMembers` — one member query
  now serves both the label and the select.
- **Bundle:** First Load JS unchanged at ~103 kB shared (Realtime reuses the
  already-bundled `@supabase/supabase-js`); per-route 113–119 kB.
- **Production measurement** (`next build` + `next start`, median of 3):

  | Route | TTFB | DCL | Load | LCP | CLS | reqs |
  |---|---|---|---|---|---|---|
  | /auth/sign-in | 15 | 43 | 46 | 60 | 0 | 13 |
  | /b2b | 197 | 299 | 299 | 572 | 0 | 27 |
  | /b2b/customers | 237 | 347 | 348 | 604 | 0 | 29 |
  | /b2b/leads | 732 | 866 | 867 | 1128 | 0 | 31 |
  | /b2b/follow-ups | 176 | 215 | 236 | 516 | 0 | 33 |

  All **LCP ≤ 2.5 s** and **CLS ≤ 0.1** (targets met); slowest route is
  `/b2b/leads`. Measured with Playwright Navigation Timing + LCP/CLS observers
  (times in ms; transfer sizes are unreliable on localhost). Lighthouse’s
  Performance score and **TBT** require the Lighthouse runner, which was not
  installable in-sandbox — a documented follow-up; field metrics pass.

## 4. Executed merge gates

- **E2E** (`playwright test`): 14 passed / 14 skipped (project-gated) / 0 failed.
  New `sales-ownership-realtime.spec.ts` proves customer branch change, lead
  source/branch change with reassignment, incompatible-assignment rejection
  (dialog stays open with a localized error), and **two real browser contexts**:
  a lead created through the trusted UI in one manager context appears in another
  with no manual reload (exactly one row — no duplicate), while a Cairo-limited rep
  never receives a Sheikh-Zayed lead (RLS-scoped refetch, no leak).
- **Visual QA** (`VQA=1`): executed 4 viewports (360×800, 390×844, 768×1024,
  1440×900) × {en,ar} × {light,dark} for manager + branch-limited rep, plus
  unauthenticated sign-in — asserting no horizontal overflow, correct `dir` and
  dark class, with a screenshot per matrix cell. **Defect found & fixed:** ~64px
  cockpit horizontal overflow at 360px (grid items needed `min-w-0`).
- **Performance** (`PERF=1`, production server): table above.

## 5. Tests

- **pgTAP 382 → 416** (+34 in `19_sales_ownership_test.sql`) across 19 files; two
  clean DB cycles.
- **Concurrency scripts 5 → 6** (added `lead_ownership_concurrency_test.sh`).
- **Frontend 114 → 125** (+11: wrapper contract shape + delta-computing form
  actions for both new RPCs).

## Sprint 6.1 — merge-gate closeout (2026-08-05)

Closes the confirmed Realtime-scope, E2E, visual-QA, and performance-gate gaps.
**These correct/supersede the Sprint-6 claims above where noted.**

**Active-branch Realtime scope (fix).** The subscription previously filtered only
by `organization_id`, so an org-wide manager with one branch selected still
refreshed on every branch. The filter now matches the visible data: All Branches →
`organization_id=eq.<orgId>`; a selected branch → `branch_id=eq.<branchId>`
(excludes org-wide NULL-branch rows, exactly like the list queries). The channel is
keyed by that scope and rebuilt on branch change (old removed before the new
becomes effective).

**Realtime lifecycle instrumentation.** `realtime-debug.ts` mirrors channel
scope/count, refresh count, and deferred-while-editing count to
`window.__salesRealtime` **only** when `NEXT_PUBLIC_REALTIME_DEBUG=1` (a dev/E2E
flag; a production build never sets it). It holds no secrets and is not application
state.

**Realtime E2E (`realtime-scope.spec.ts`, executed via two real browser
contexts).** A+B manager scope narrows to `branch:<cairo>` on selecting Cairo
(exactly one channel); a Cairo mutation refreshes while a Sheikh-Zayed mutation
does **not**; switching to SZ tears down Cairo and one SZ channel remains; an SZ
mutation then refreshes. C a follow-up created elsewhere is observed without
reload. D sign-out removes every channel and a later mutation causes no refresh
(the mutator is a different user — Supabase `signOut()` is global per user). E a
revoked membership (revoked via the DB harness, restored after) can no longer
surface data. F an in-scope event never overwrites an open edit (typed value +
focus preserved, deferred not refreshed; the manual affordance then applies it). G
repeated events render exactly one row.

**Visual QA (complete matrix, corrected coverage).** Both roles now run the **full**
4 viewports × {en,ar} × {light,dark} — earlier the rep ran only 2×2. Added a
dialogs+states pass (customer-ownership dialog, lead source/branch dialog,
follow-up edit/reassign, validation error, not-found, empty state) at 360 and 1440
in en/light and ar/dark, asserting no overflow, dialog height ≤ viewport, and a
reachable submit control, with 64 screenshots under `test-results/vqa/`. **Defect
found & fixed:** the customer-**detail** Contact card overflowed ~42px at 360px in
LTR (a long email couldn’t wrap) — fixed with `[&>*]:min-w-0` + `break-words`.

**Lighthouse (now actually run** via `pnpm dlx lighthouse` with the local Chromium;
authenticated routes measured with a captured session header — supersedes the
“runner not installable” note):

| Route | Form factor | Performance | LCP | CLS | TBT |
|---|---|---|---|---|---|
| /auth/sign-in | Desktop | **100** | 726 ms | 0 | 52 ms |
| /auth/sign-in | Mobile | **98** | 1748 ms | 0.009 | 108 ms |
| /b2b (auth) | Desktop | **98** | 795 ms | 0.032 | 19 ms |
| /b2b/leads (auth) | Desktop | **96** | 1236 ms | 0.012 | 2 ms |

All meet the targets (Desktop ≥ 90, Mobile ≥ 80, LCP ≤ 2.5 s, CLS ≤ 0.1, TBT ≤
200 ms).

**Extended Playwright production perf (`PERF=1`, median of 3 warm + cold).** Warm
LCP: sign-in 52 · /b2b 552 · customers 648 · leads 908 · follow-ups 588 ms; CLS 0
everywhere. Slowest **actual** request: the `/b2b` document (~0.9 s SSR), not TTFB.
Failed requests **0** (navigation-cancelled `ERR_ABORTED` excluded); **page errors
0**; **1 console error** = a `/favicon.ico` 404 (no favicon configured — benign,
pre-existing). **Active Realtime channels = 1, duplicates = 0.**

**CI flake (fixed).** The `sign-in-form` test failed ~2/8 full-suite runs (0/8
isolated): `advanceToVerifyStep` clicked a submit button whose React 19
`javascript:throw` native-submit guard occasionally beat `preventDefault`.
Switching to `fireEvent.submit(form)` made it deterministic — **0/14** full-suite
runs fail. Frontend **125 → 125** (no count change; the flake fix + realtime
adapter are covered by the executed E2E).

## Sprint 6.2 — final merge gate (2026-08-05)

Closes the last confirmed items; no schema change.

**Realtime teardown.** `SalesRealtime` now clears the flash timer (not only the
debounce) on unmount / org / branch change / sign-out, and guards every `setState`
behind a mount ref (no post-unmount work). Covered by a component test
(`sales-realtime.test.tsx`).

**Dirty-form protection (not just focus).** Focus-only detection was replaced by a
persistent **dirty-form guard**: a document-capture listener marks a B2B edit form
modified on the first `input`/`change`, and it **stays** dirty after the edited
control loses focus, until a navigation resets it. Search/filter forms opt out with
`data-no-dirty`. Realtime defers while any form is dirty; the manual affordance
still applies. No global state, no new library, no PII in the adapter (it holds
counters/scope strings only). The two-context E2E now moves focus **off** the input
before the incoming event (scenario F) and protects an entered lost-reason in a
**terminal dialog** (scenario H).

**ConfirmDialog focus fix.** The focusables query excluded hidden inputs — an
ownership dialog leads with hidden inputs, so focus was landing on a no-op hidden
input and never entering the dialog. Fixed; the visual QA now asserts focus starts
inside, Tab stays trapped, Escape closes, and focus returns to the trigger.

**Completed state coverage** (browser unless noted): rep matrix asserts the theme
exactly like the manager matrix + an out-of-scope direct-URL check per cell;
reconnecting status (deterministic debug hook, scenario J); permission-denied panel
for a read-only member (DB harness, scenario K); **stale-conflict** rendering is a
**component** test (`customer-edit-form.test.tsx`) because React controls the
optimistic-token hidden input in-page (the RPC 40001 is pgTAP- + race-script-proven,
the mapping is unit-tested).

**Exact performance console gate.** `perf.spec` now asserts `failed=0`,
`page-errors=0`, non-favicon `4xx/5xx=0`, and that the **only** tolerated console
error is the documented `/favicon.ico` 404 (any other fails). No approved brand
icon asset exists outside the encrypted `.pen`, so the favicon stays explicit debt.

**Lighthouse (re-run)** — sign-in Desktop **100** / Mobile **99**; /b2b **99**;
/b2b/leads **93**. All targets met. Warm LCP (median 3): sign-in 64 · /b2b 548 ·
customers 528 · leads 984 · follow-ups 532 ms; CLS 0; slowest actual request `/b2b`
doc ~0.9 s; channels = 1, duplicates = 0.

**Flake (fully fixed).** Adding the new component tests resurfaced the sign-in
change-email flake (~1/30 full-suite; 0 isolated). `requestSubmit()` inside `act`
(React intercepts + preventDefaults before jsdom runs the guard) + settling the
post-send effect made it deterministic — **0 failures across 50+ full-suite runs**.
Frontend **125 → 130** (+5: SalesRealtime timer/dirty + edit-form stale-conflict).

**Deterministic full E2E.** Data-mutating desktop/mobile specs shared local
Supabase state, so a single combined `pnpm e2e` could fail on drift (e.g. a
concurrency-script `sales.manage` grant leaking onto the Cairo rep) unless each
project was run separately after a fresh seed. A Playwright **`globalSetup`**
(`e2e/global-setup.ts`, run once — `workers=1`, never concurrent) now truncates the
sales fixtures, restores the two seeded memberships to their exact scope (rep =
read+write only, no leaked org-wide caps), and re-applies the demo seed before any
project. Destructive scenarios still restore state in `finally`; records are
created with unique names. After one `supabase db reset`, the standard command
`corepack pnpm --filter frontend e2e` runs **twice consecutively with no manual
reset**, each: **23 passed / 35 skipped / 0 failed**.

## Known limitations / deferred

- **Favicon 404** — no `app/icon`/`favicon.ico`; one benign console 404 (pre-existing).
- **Realtime on Broadcast** — reconsider if per-row Postgres Changes volume grows.
- **Realtime surfaces** limited to `leads` + `follow_up_tasks` (customer-table
  changes reflected via related lead/follow-up events, not a direct subscription).
- **customer_type mutation** — intentionally not implemented (no domain approval).
- **CI Actions Node runtime** — workflows are current (checkout@v4/setup-node@v4 on
  Node 20, setup-python@v5); Node 20 → 24 is a future maintenance bump when GitHub
  deprecates it. No deprecated (Node 16) action is in use.
- Products, inventory, RFQ, quotations, orders, projects, B2C, WhatsApp, OCR,
  payments, advertising, AI, community, academy — out of scope.
