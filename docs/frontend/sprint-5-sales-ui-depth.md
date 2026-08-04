# Sprint 5 — Sales UI Depth & Product QA (frontend)

**Status:** Implemented · 2026-08-04 · Phase 2 (B2B Sales Operating Workflow)
**Branch:** `feature/sales-ui-depth` · PR → `main` · Base `main` @ `e949f2b`

Deepens the Sprint‑4 B2B sales UI into a workflow a salesperson can run end to end:
real **edit** flows for customers, leads, and follow‑ups; richer customer detail;
explicit confirmations for destructive/terminal actions; and a local **Playwright**
E2E foundation. Arabic‑first RTL + English + light/dark preserved; real Supabase
data and trusted RPCs only; RLS remains the boundary. **No new migration was
required** — every edit flow is expressible through the existing Sprint‑3 RPCs.

## Routes added

| Route | Purpose |
|---|---|
| `/b2b/customers/[id]/edit` | Edit a customer (RPC‑supported fields) via `update_customer`. |
| `/b2b/leads/[id]/edit` | Edit non‑lifecycle lead details (title, priority) via `update_lead_details` with optimistic version. |
| `/b2b/follow-ups/[id]/edit` | Edit an open follow‑up (title/description/due/priority) via `update_follow_up`. |

## Trusted RPC edit surfaces (and the exact editable fields)

The editable fields are **limited to what the trusted update RPC supports** — no
invented fields, no direct table DML.

| Entity | RPC | Editable here | Concurrency | Not editable here (why) |
|---|---|---|---|---|
| Customer | `update_customer` | display name, phone, email, preferred language, location, source | row‑lock (no version col) | type / branch / assignee — **not in the update RPC** (set at creation) |
| Lead details | `update_lead_details` | title, priority | **optimistic `expected_version`** | stage/status/won‑lost → `transition_lead`; assignment → `assign_lead` (both versioned) |
| Follow‑up | `update_follow_up` | title, description, due date, priority | row‑lock + version bump; **`status='open'` guard** | reassign → `reassign_follow_up`; complete/reopen/cancel → lifecycle RPCs |

**Customer archive** uses `update_customer(p_archive=true)` (idempotent) behind an
explicit confirmation dialog.

## Concurrency & conflict behavior

- **Leads** are optimistically concurrent end to end: edit, transition, and assign
  all carry the current `version`. A stale submit raises “modified concurrently” →
  mapped to `leads.conflict`; the edit form then `router.refresh()`es so it
  re‑renders against the newer server version and the user retries.
- **Follow‑ups** are guarded by the `status='open'` check (a non‑open task can’t be
  edited → `states.followUpNotOpen`), preventing silent mutation of a
  completed/cancelled task; the RPC bumps `version` under a row lock.
- **Customers** have no version column; the RPC edits a single field‑set under a
  `for update` row lock (last‑write‑wins on a small, low‑contention field set).

## Permissions

Every read is RLS‑scoped and every write re‑checks capability/scope in the RPC.
Edit routes additionally guard `canWrite(org)` and render a localized
permission‑denied panel when the caller lacks `sales.write`. Assignment stays on
its own capability‑gated action (`sales.assign`). No service‑role browser path.

## Detail depth

- **Customer detail** now has: edit action, add‑activity (real `add_sales_activity`),
  add‑follow‑up (self‑assign default), open + completed follow‑up lists with
  per‑row Edit/Complete/Cancel(confirm), related leads, and success flashes
  (created/updated/archived). Empty sections explain the next useful action.
- **Lead detail** now has an **Edit details** link and per‑follow‑up row actions
  (Edit / Complete / Cancel‑with‑confirm), plus the existing lifecycle/assign/
  activity/inline‑follow‑up controls and a differentiated timeline.
- **Follow‑ups board** gains an Edit link and puts **Cancel** behind a
  confirmation. The mobile board is grouped cards (overdue/due‑today/upcoming/
  completed), not a desktop‑only drag surface. No unauthorized drag transitions.

## Confirmations & form feedback

- A shared, accessible **`ConfirmDialog`** (role="dialog", `aria-modal`, focus
  moved in on open, focus trap, Escape/backdrop to close, focus restored to the
  trigger) wraps the terminal actions: archive customer, cancel follow‑up. The
  confirm button is disabled while pending (no double submit).
- Forms disable submit while pending, show field‑level errors with `aria-invalid`,
  keep entered values on validation failure (uncontrolled inputs re‑seed from the
  submitted request), and map RPC errors to **translation keys** — never raw
  Postgres/Supabase text, no PII logged.

## Local E2E (Playwright)

A minimal, local‑only Playwright foundation (`frontend/playwright.config.ts`,
`frontend/e2e/`). It runs against **local Next.js + local Supabase** with the
seeded synthetic identities and the **real Email‑OTP path** (the code is read from
the local **Mailpit** inbox — no auth bypass, no production credentials).

**Test accounts** (from `supabase/demo-seed.sql`):

| Email | Role |
|---|---|
| `a-owner@example.test` | Org A manager — org‑wide sales authority, both branches. |
| `a-cairo@example.test` | Org A salesperson — branch‑limited to Cairo. |

**Setup (Windows / PowerShell):**

```powershell
corepack pnpm exec supabase start
corepack pnpm exec supabase db reset                 # migrations + base seed
docker exec -i supabase_db_aladdin psql -U postgres -d postgres `
  -f - < supabase/demo-seed.sql                      # sample sales data
cd frontend
corepack pnpm exec playwright install chromium       # one-time browser download
corepack pnpm e2e                                    # starts Next dev on :3100 and runs the suite
```

Reuse a running dev server instead of starting one: `E2E_PORT=3000 pnpm e2e`
(the config reuses an existing server locally). If only the full Chromium build is
available (no headless‑shell), set `PW_CHROMIUM` to its `chrome.exe` path.

**Smoke scenarios** (`e2e/sales.spec.ts`): manager sign‑in; customer list loads;
customer create+edit; lead create+edit+stage change; follow‑up create/edit/
complete/reopen; branch selector narrows data; **branch‑limited rep cannot see
another branch**; Arabic↔English switch; light↔dark switch; mobile navigation.
The desktop scenarios run on `chromium-desktop`; the mobile‑nav scenario on
`chromium-mobile` (Pixel 5).

## Validation status

- Frontend typecheck ✓, lint ✓, **104 tests** ✓ (was 92; +12 for edit actions,
  error mapping, and the confirm dialog), production build ✓ (all edit routes are
  `ƒ` dynamic).
- pgTAP **366** unchanged (no schema/RPC change). Backend ruff + 10 pytest ✓.
- Development‑runtime smoke: fresh `.next`, `next dev`, `/auth/sign-in` 200, all
  `/b2b/*` 307‑redirect (guard), no webpack/module‑runtime error.
- Structural QA (server‑rendered): Arabic `dir="rtl"`, English `dir="ltr"`, dark
  `.dark` class, new edit routes auth‑guarded with the correct `?next=`.

### Live‑browser QA / E2E execution — NOT run in this environment

The four‑viewport × light/dark × ar/en **visual QA** and the **Playwright suite
execution** were **not** performed here: this sandbox blocks launching a browser
process (`spawn UNKNOWN`) and the Playwright headless‑shell download is
unavailable, and the Chrome automation extension was disconnected. The E2E suite
is authored and type‑checks; it runs on a normal developer machine via the
commands above. **A maintainer should run `pnpm e2e` and do the visual pass**
before relying on the responsive/E2E claims.

## Known limitations / deferred

- **Customer branch/type/assignee edit** and **lead source/branch edit** — the
  current update RPCs don’t support these fields; a future minimal, audited RPC is
  required (recorded in TECHNICAL_DEBT). Assignment already has its own action.
- **Realtime** pipeline updates — explicitly deferred (no websockets this sprint).
- **Turnstile/CAPTCHA** on the OTP endpoint — pre‑production requirement (deferred).
- **Products, inventory, RFQ, quotations, orders, projects, B2C discovery,
  WhatsApp, OCR, payments, advertisements, AI** — out of scope.

## Sprint 5.1 — merge-gate hardening (2026-08-04)

Independent review of the committed Sprint 5 found and fixed:

| # | Finding | Fix |
|---|---|---|
| 1 | **Stale customer edits** — `update_customer` had no concurrency check (a row lock serializes but doesn't detect stale data); customers have no `version` column | New migration `20260805110000`: `update_customer` takes `p_expected_updated_at`, compares it under `FOR UPDATE`, and raises **40001** before any write/audit. The edit form carries the exact `updated_at`; on conflict it shows `states.staleConflict` and refreshes. |
| 2 | **Stale follow-up edits** — `update_follow_up` only checked `status='open'` | `update_follow_up` now takes `p_expected_version` (the table already has `version`) → **40001** on mismatch. The edit form carries the version; conflict → refresh. |
| 3 | **Stale reassignment** | `reassign_follow_up` takes an optional `p_expected_version`; the edit-page reassign form passes it. |
| 4 | **Optional fields couldn't be cleared** — `coalesce(p_x, x)` treated a blank submission as "leave unchanged" | Explicit PATCH: absent = unchanged, **blank = clear to NULL**, value = update. `p_clear_phone/email/location` (customer) and `p_clear_description` (follow-up; `p_clear_due` already existed). Clearing phone nulls the generated `primary_phone_e164` (a blank string was never a valid value). |
| 5 | **No follow-up reassignment UI** | An authorized reassign form on `/b2b/follow-ups/[id]/edit` (only with `sales.assign`; members from the active org; branch/active/same-org enforced by the RPC; version-guarded). |
| 6 | **Incomplete lead terminal confirmations** | Mark Won / Mark Lost / Archive all go through the (extended) `ConfirmDialog`; Mark Lost's required reason lives inside the confirmation and **survives a validation/concurrency error** (controlled field; the dialog stays open and shows the localized error). |
| 7 | **Non-deterministic OTP** — the E2E helper matched the first message and could reuse a stale code | The helper snapshots existing Mailpit message IDs before sending, then reads only a **genuinely new** message. No auth bypass. |
| 8 | **Dishonest E2E** — names claimed more than the assertions proved | Rewrote the suite to assert persisted results (not just URLs): customer create/edit/**clear**, lead create/edit/stage/**terminal confirm**, follow-up create/edit-every-field/**reassign**/complete/reopen, **branch narrowing by a specific SZ lead**, branch-limited absence + blocked direct URL + no leaked HTML, dir/theme/mobile-nav. Unique values via `randomUUID` (not a short `Date.now`). |

### Concurrency model (final)

- **Leads** — optimistic `version` end to end (edit, transition, assign).
- **Follow-ups** — optimistic `version` (edit + reassign) plus the `status='open'` guard.
- **Customers** — optimistic `updated_at` (trigger-maintained) precondition; the true two-session serialization is proven by `customer_update_concurrency_test.sh` (single-transaction pgTAP can't, since `now()` is constant per transaction — the pgTAP asserts the precondition logic with a mismatched token).

### E2E execution — RUN in this environment

The full Playwright suite was **executed and passes** (9 scenarios; the mobile-nav scenario on `chromium-mobile`, the rest on `chromium-desktop`; project-gated scenarios are skipped on the other project). It runs against local Next.js + local Supabase with the real Email-OTP path. If only the full Chromium build is present (no headless-shell), set `PW_CHROMIUM` to its `chrome.exe`; the branch-limited direct-URL check reads a Sheikh-Zayed lead id via `SUPABASE_SERVICE_ROLE_KEY` (test harness only — never shipped to the browser). Live pixel-level visual QA across all four viewports remains a maintainer follow-up.

### Validation (Sprint 5.1)

Frontend typecheck/lint/**114 tests**/build ✓ · backend ruff + 10 pytest ✓ · Supabase **two** clean cycles (reset + lint + **382 pgTAP**, +16 in `18_sales_edit_concurrency_test`) ✓ · **5** two-session race scripts (incl. new customer + follow-up) ✓ · Playwright E2E ✓ · dev-runtime smoke (auth + all edit routes, no module error) ✓.
