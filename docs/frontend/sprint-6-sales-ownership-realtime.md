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
  filtered to the **server-derived** active `organization_id` (a forged cookie
  can’t widen it). The socket is authenticated with the caller’s access token via
  `realtime.setAuth`, so Postgres Changes are authorized as the user.
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

## Known limitations / deferred

- **Lighthouse score + TBT** — runner not installable in-sandbox (documented).
- **Realtime on Broadcast** — reconsider if per-row Postgres Changes volume grows.
- **customer_type mutation** — intentionally not implemented (no domain approval).
- Products, inventory, RFQ, quotations, orders, projects, B2C, WhatsApp, OCR,
  payments, advertising, AI, community, academy — out of scope.
