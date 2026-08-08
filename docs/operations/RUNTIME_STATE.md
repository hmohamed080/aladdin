# Runtime State

<!-- CANONICAL PROJECT MEMORY — mutable current-state snapshot. Refresh at the end of every substantive session. -->

This is a **mutable snapshot** of the current live repository state — not an append-only history (that is [`AGENT_WORK_LOG.md`](./AGENT_WORK_LOG.md)). Overwrite it each session with verified values.

| | |
|---|---|
| **Version** | Runtime snapshot · 2026-08-04 |
| **Owner** | Foundation / Operations |
| **Last updated** | 2026-08-08 |
| **Updated by** | Pi design agent — B2B product-decision closure and canonical screen completion |
| **Current focus** | **Phase 2 implementation remains active; canonical Private-Pilot B2B Pencil design is complete.** Product decisions, responsive behavior, AR/EN, Light/Dark, operational component families, and Aperture token mappings are closed in the private design source. Existing engineering state and validated sales/onboarding work remain unchanged by this design-only session. |

## Phase & repository

| Field | Value |
|---|---|
| **Current Phase** | **Phase 2 — B2B Sales Operating Workflow** (tenant-owned customers/leads/activities/follow-ups on the Phase 1 spine) |
| **Current Sprint** | **Sprint 6 — Sales Ownership, Realtime & Performance Hardening** (customer branch/assignee + lead source/branch ownership RPCs; scoped Postgres-Changes Realtime on `leads`+`follow_up_tasks`; executed E2E/visual-QA/production-perf gates; branch `feature/sales-ownership-realtime`, PR pending, base `main` @ `5a47011`). Sprint 5.1 merged (PR #8). |
| **Current Feature** | Passwordless Email-OTP auth + B2B app shell + customers/leads/follow-ups screens wired to the real Sprint-3 RLS/RPCs (Arabic-first, RTL, light/dark, responsive) |
| **Next Phase** | **Phase 2 continued** — sales UI/screens (05C) then the RFQ/Quote/Project journey; dashboards last |
| **Current Branch** | `docs/technical-finalization` (design/product records only in this session) |
| **Current Milestone** | Phase 2 implementation continues; canonical Private-Pilot B2B design contract is complete |
| **Current Remote Repository** | `origin` = `https://github.com/hmohamed080/aladdin.git` |
| **Last Stable Commit** | `54792a4` — `main` after PR #4 merged (Phase 1 identity/tenancy + Sprint 2/2.1). Sprint 3 commits land on `feature/b2b-sales-workflow` and merge into `main` via PR |
| **Last Stable Tag** | `v0.1.0-foundation` (repo `0.1.0`) — created on merged `main` after the closeout PR; Design System stays independently at `1.0.0` |
| **Foundation Release** | Tagged `v0.1.0-foundation` on `main` @ `64e68d6` |
| **Repository Status** | Published to GitHub (`origin`, full history, no squash/force); `main` protection recommended (ADR-0006), not yet applied |
| **Documentation Status** | Updated for Phase 1 — see [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md); 0 broken links; no orphan docs |
| **Implementation Status** | **Sprint 6 validated (frontend typecheck/lint/130 tests/build; backend ruff+pytest; Supabase two clean cycles reset+lint+416 pgTAP; 6 two-session races; Playwright E2E executed & green incl. two-context Realtime; executed visual-QA matrix; production perf measured; dev+prod runtime smoke).** Adds post-create **ownership** edits — `set_customer_ownership` (branch/assignee) and `set_lead_source_branch` (source/branch/compatible-reassign), both version/updated_at-guarded, scope+capability enforced, strand-rejecting, transactionally audited; **`customer_type` immutable** (no domain approval); lead lifecycle out of bounds for the lead RPC. Adds **scoped Realtime** (Postgres Changes on `leads`+`follow_up_tasks`; refresh-only client, RLS-scoped, defers on edit, rebuilds on org/branch change). **Sprint 6.1 closeout:** the Realtime filter now narrows to the **active branch** (`branch_id=eq.<branchId>`, matching the list queries) not just the org; a two-context `realtime-scope` E2E proves scope narrowing/teardown/single-channel, sign-out removal, revoked-membership no-leak, open-form deferral, and duplicate→one-row; the visual-QA matrix runs **both roles** full 4×{en,ar}×{light,dark} + dialogs/states (fixed a 42px customer-detail overflow); **Lighthouse was executed** (sign-in Desktop 100/Mobile 98, /b2b 98, /b2b/leads 96 — all targets met); a pre-existing sign-in test flake was made deterministic. Sprint 5.1 merged (PR #8, `5a47011`). Branch `feature/sales-ownership-realtime`, PR #9 to `main` pending. No products/RFQ/quotes/projects/B2C/payments/WhatsApp/OCR/AI. |

## Live engineering state

Always reflects the current live engineering state of the project. Overwrite each session with verified values.

| Field | Value |
|---|---|
| **Current Sprint** | **Sprint 6 / subsequent onboarding work on the Phase 2 implementation line** |
| **Current Epic** | B2B Sales Operating Workflow and shared/persona onboarding on the tenant spine |
| **Current Feature** | Validated sales workspace, ownership/realtime hardening, and shared/persona onboarding; this session changed design/docs only |
| **Current UI Status** | Implemented B2B sales workspace and onboarding work remain intact; private Pencil now contains the completed canonical MVP B2B screen set and Draft component contracts |
| **Current Backend Status** | FastAPI scaffold — `GET /health` only; sales write paths remain Next.js server actions per ADR-0001 |
| **Current Database Status** | Identity/tenancy, verification/upgrade, memberships/branches, sales domain, ownership/realtime migrations and validated RLS/RPC coverage remain unchanged by this design-only session |
| **Current Design System Version** | **1.1.0** (`DESIGN.md` / `design/tokens/*`; B2B Draft component-contract release) |
| **Current Documentation Version** | Technical spec **1.0.0** (Phase 0.7); engineering standards **1.0.0** (Phase 0.8); governance/planning **1.0.0** (Phase 0.9 — ADR-0006, ROADMAP, BACKLOG, TECHNICAL_DEBT, DOCUMENTATION_STATUS, DECISION_LOG); docs index **1.0.0** |
| **Current Deployment Status** | **not deployed** — no Vercel/Railway/Supabase cloud project connected; **no CD**; a minimum **PR-validation CI** workflow (`.github/workflows/ci.yml`: `frontend`/`backend`/`docs`) is present (must run once, then be selected as required checks in branch protection); repository published to GitHub (`origin`) |

## Git & branch

- **Baseline:** `main` @ `f9596a3` — Sprint 3 B2B sales domain foundation merged (PR #5).
- **Current work branch:** `feature/sales-ui-depth` (cut from `main` @ `e949f2b`) — Sprint 5 sales UI depth (edit flows + local E2E). (Sprint 4.2 `bugfix/public-directory-view-hardening` is merged: PR #7.)
- **Remote:** `origin` → `https://github.com/hmohamed080/aladdin.git` (push preserves full history; no squash, no force). Sprint 3 merges into `main` via PR; direct pushes to `main` are prohibited.

> HEAD moves with each commit; this file trails HEAD by its own commit. Re-derive live values with the [resume commands](#exact-resume-commands) below rather than trusting a pasted hash.

## Architecture state

- **Foundation:** scaffolded and validated. Modular monolith per ADR-0001 (Next.js + Supabase + specialized FastAPI + workers).
- **Python data access:** `supabase-py` (ADR-0005); SQLAlchemy deferred/removed; Alembic excluded.
- Product implementation exists on the Phase 2 line (identity/tenancy, verification/upgrade, memberships/branches, sales domain and UI/onboarding work); this session changed no application code, schema, runtime service, or deployment.
- **MVP technical blueprint:** authored under [`../technical/`](../technical/) (Phase 0.7) — system overview, domain model, database design, ERD, storage, RLS, permissions, API contracts, jobs, events, state machines, validation, integrations, future scope. Specification only; open decisions marked `⚑ OPEN`.

## Design system state

- **Version `1.1.0`** — approved, hardened, with canonical Private-Pilot B2B Draft component contracts. North star: **"The Aperture."**
- **Authority chain:** `PRODUCT_DIRECTION_GUIDE.md` → `DESIGN.md` → `design/tokens/*.json` → `UI-UX/UI_UX_SYSTEM_GUIDE.md` → `design.pen` → frontend code.
- **Canonical machine tokens:** `design/tokens/{colors,typography,spacing,radii,shadows,motion,breakpoints,z-index}.json` (+ README). Governance: `design/GOVERNANCE.md`; changelog: `design/CHANGELOG.md`; inventory: `design/COMPONENT_INVENTORY.md`; icons: `design/icons/README.md`.
- **Frontend implementation:** `frontend/src/styles/tokens.css` (primitives + light/dark semantics + motion + z-index), `frontend/tailwind.config.ts` (semantic/brand colors, type roles, spacing, radii, shadows, motion, z-index, canonical `tablet`/`desktop`/`wide` screens), `frontend/src/app/globals.css` (base + `prefers-reduced-motion`), `frontend/src/app/layout.tsx` (four self-hosted fonts).
- **Defect fixed this session:** dark-theme `--primary` referenced an undefined `--lime` → corrected to `--on-dark`.
- **Pencil components:** 142 reusable masters — the preserved 127 plus 15 Draft B2B operational families (data grid/mobile row, opportunity, pipeline, task, need, match, Smart Share, RFQ, quotation, project, timeline, notification, navigation). Quote Comparison is deliberately absent. Production component status remains governed independently in the inventory.

## Implemented routes

- **Frontend (Next.js):** `/` (`src/app/page.tsx`) · `/api/health` (`src/app/api/health/route.ts`) — scaffold only.
- **Backend (FastAPI):** `GET /health` (`app/api/v1/health.py`) — scaffold only.

## Auth state

Passwordless model (WhatsApp/Email OTP) is specified; **no auth UI/OTP/session handling wired yet** (explicitly out of Phase 1 scope). The **identity backbone** now exists: a `security definer` trigger `app.handle_new_user()` on `auth.users` bootstraps the canonical `public.users` + `public.profiles` rows atomically (no client-side profile creation; duplicate base identity is structurally impossible). Backend JWT verification for FastAPI is still a later item.

## Database & migration state

- **Migrations (7):**
  - `20260729000000_extensions.sql` — `pgcrypto`, `pg_trgm`, `vector`/pgvector, `postgis` (in the `extensions` schema).
  - `20260802090001_identity_core.sql` — `app` helper schema + `set_updated_at`; enums (`account_type`, `platform_role`, `contact_channel`, `user_status`, `public_profile_status`); `users`, `profiles` (incl. server-controlled `public_profile_status`), `contacts`; profile-bootstrap trigger; identity RLS + grants (`primary_account_type` server-controlled).
  - `20260802090002_organizations_tenancy.sql` — enums (`org_status`, `membership_status`); `organizations`, `branches`, `memberships`, `membership_capabilities`, `membership_branch_access`, `platform_role_grants`; tenancy helpers (`current_org_ids`, `is_org_member`, `has_capability`, `current_branch_ids`, `is_platform`); RLS + grants.
  - `20260802090003_audit_foundation.sql` — append-only `audit_log` (immutability trigger; service-role insert; admin read).
  - `20260803090001_verification_and_upgrade.sql` **(Sprint 2)** — enums (`verification_subject`/`verification_type`/`verification_status`); `verifications` + `verification_documents`; internal `app.record_audit_event()`; account-upgrade RPCs (`request_account_upgrade` self-service; `review_start`/`review_request_changes`/`review_reject`/`review_approve`; `apply_account_upgrade`; `set_profile_hidden`); widened audit action allow-list; RLS + grants.
  - `20260803090002_membership_branch_write_paths.sql` **(Sprint 2)** — membership RPCs (`membership_invite`/`activate`/`set_capabilities`/`suspend`/`revoke`, `app.assert_not_last_owner`) + branch RPCs (`branch_assign`/`unassign`).
  - `20260804090001_write_path_security_hardening.sql` **(Sprint 2.1)** — revokes direct privileged/service-role and membership-table DML; verification consistency/immutability/sticky-reviewer/expiry/resubmission guards; stable organization locking; hardened membership/capability/branch RPCs; structural branch tenant trigger; exact ACL reassertion.
- **Public discovery:** curated views `organization_public_directory` / `profile_public_directory` expose only approved columns; base tables are private (Sprint 1.1 B1). Professional discovery requires server-controlled `profiles.public_profile_status='listed'` (Sprint 1.2) — a professional account type alone is not enough; `users.primary_account_type` is server-controlled (not client-updatable).
- **RLS + privileges:** enabled with explicit policies on every table. On the ten reviewed base tables, `anon` has no privilege; `authenticated`/`service_role` have SELECT only, except safe column updates (`users.locale` for both; self-profile display columns for `authenticated`). No application role has direct privileged identity, verification, membership, capability, assignment, platform-role, or audit DML. Covered by **254 pgTAP** assertions and two race scripts in `supabase-rls`.
- **Seed:** synthetic local fixtures (2 orgs, 3 branches, 5 users incl. a branch-limited member and a platform admin) in `supabase/seed.sql` — clearly marked synthetic; no real data.
- **Generated types:** `frontend/src/types/database.types.ts` (from the local schema).
- **Schema source of truth:** `supabase/migrations/*.sql` only (ADR-0002). Design decisions: [ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md).

## Running services

None running as part of this session. Local dev is manual:

- Frontend dev → `http://localhost:3000`
- Backend API → `http://localhost:8000` (`/health`)
- Supabase local stack → Docker — started, validated (reset ×2 + lint + extension inspection), and **stopped** this session (not left running).

## Deployment state

None. No Vercel / Railway / Supabase cloud project connected. No CI/CD pipeline. Targets are decided (ADR-0004) but not provisioned.

## Environment state

- `frontend/.env.example` and `backend/.env.example` present; **no real `.env` committed** (correct).
- Config is validated per service (`frontend/src/lib/env/`, `backend/app/config.py`); fail-fast in staging/production.
- Toolchain: `uv` at `…/pythoncore-3.14-64/Scripts/uv` (add to PATH); backend uses uv-managed **Python 3.12** (system Python is 3.14). Supabase CLI via `pnpm exec supabase`.

## Current blockers

- **B2B design blockers:** none for the approved Private-Pilot canonical main-screen scope. Full Supplier/Showroom suites, Quote Comparison, payment/checkout, enterprise permissions, advanced scheduling, forecasting, competitor intelligence, and advanced notification automation remain explicitly deferred — not blockers.
- Previously environment-blocked network checks are executed and passing; see *Infrastructure validation status* below.
- **Residual environment note (not a code defect):** `ghcr.io` still shows intermittent TLS-handshake timeouts that **slow** (no longer block) multi-image pulls; retries succeed. Docker Hub and `public.ecr.aws` are reachable.

## Known warnings (benign)

- Frontend: pnpm peer-dep warning (`unrs-resolver` / `@emnapi`).
- Backend: `StarletteDeprecationWarning` from `fastapi.testclient` under pytest. No functional impact.

## Active files (this session)

- Private visual source: `UI-UX/design.pen` — 7 top-level groups, **423 product frames**, **302 B2B frames**, updated 21-row matrix/gap register, 15 new B2B masters, and QA trace board `00J`.
- Approved design record: root `DESIGN.md` — The Aperture concept, exact brand/token values, typography, component defaults, and usage rules.
- Frontend token bridge: `frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`, `frontend/src/app/globals.css`, and `frontend/src/app/layout.tsx`.
- Product/UI memory: root `PRODUCT.md` and `UI-UX/UI_UX_SYSTEM_GUIDE.md` now record the approved identity and artifact-authority chain.
- Local tooling sidecar: `.impeccable/design.json` is synchronized but remains intentionally ignored; `DESIGN.md` is the versioned durable record.
- Operations memory: `docs/operations/AGENT_WORK_LOG.md` and this file.

## Design validation status (2026-08-01)

- `design.pen`: 7 top-level groups; 0 top-level overlaps; 0 B2B organizational problems; 0 active canonical clipping/layout problems.
- Product frames: **207 → 423**; B2B frames: **86 → 302**. All 207 pre-existing product screens remain present; 216 canonical B2B variants were added.
- Canonical coverage: 18 MVP flow families × 12 variants each = Desktop 72 / Tablet 72 / Mobile 72; Light 108 / Dark 108; Arabic 108 / English 108.
- Matrix/gap register classify all approved P0/P1/P2 rows Completed; full Supplier and Showroom suites remain Deferred — Not MVP.
- Reusable masters: **127 → 142**; 15 new B2B Draft masters; 802 refs checked with 0 broken; new masters have 205 instances and 0 component-subtree layout problems.
- Pencil semantic variables and onboarding aliases map to the Aperture palette/fonts. Active canonical B2B screens contain 0 detected legacy blue/Inter/IBM Plex mappings. Eight overflow/overlay flags remain only in preserved historical/deferred Cockpit/payment references.
- Root `PRODUCT.md` and `UI_UX_SYSTEM_GUIDE.md` encode the permanent governance rule and the approved Aperture identity.
- Frontend primitives and light/dark semantic aliases mirror `DESIGN.md`; Impeccable detector returned 0 findings.
- Semantic normal-size text clears WCAG AA in both themes (minimum measured ratios: light 4.76:1; dark 5.40:1).

## Infrastructure validation status (2026-08-01 — Docker + Supabase gate)

- **Docker — PASSED:** server 29.6.2; `docker build --no-cache -t aladdin-backend-foundation ./backend` ✅. Image: Python **3.12.13**, user **appuser (uid 10001)**, HEALTHCHECK **healthy**; `docker run` → `curl --fail /health` **200 `{"status":"ok","service":"backend","env":"local"}`**; process **uid 10001**. No `.env`/`.pen`/PDF/customer-data/`.git`/app-logs (only base-image `apt/dpkg` logs); **no Alembic, no SQLAlchemy**. Test container removed.
- **Supabase — PASSED:** `start` ✅ (db/kong-API/auth/storage/realtime/studio healthy; imgproxy+pooler disabled in config; `vector` log-router flaps benignly). `db reset` ✅ ×2 (repeatable, no drift). `db lint` ✅ ×2 (all findings in bundled `extensions.*` PostGIS/pgcrypto functions; **zero** in our migration or `public`).
- **Extensions:** pgcrypto 1.3 · pg_trgm 1.6 · vector 0.8.2 · postgis 3.3.7 — all in the `extensions` schema. **0 product tables in `public`.** Applied migration: `20260729000000`.
- **Cleanup:** `supabase stop` ✅; backend test container removed; no repo artifact added. This gate modified **no `.pen` file**; the canonical `design.pen` changed on disk only via a concurrent design-agent flush (gitignored — outside the git tree, no merge impact).

## Validation status (2026-08-01 brand-token extraction)

- **Frontend — GREEN:** TypeScript ✅ · ESLint ✅ · Vitest 3 passed ✅ · Next.js 15.5.22 production build ✅.
- **Generated routes:** `/`, `/_not-found`, `/api/health`.
- **Repository checks:** `git diff --check` ✅; 154 internal Markdown links checked with 0 broken; no dependency or lockfile change.
- **Tooling note:** Codex's pnpm wrapper required a one-time locked dependency relink after its bundled runtime changed; validation ran successfully through the restored local binaries.

## Validation status (2026-07-30 foundation review)

- **Frontend — GREEN (fully re-run):** `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` (3 passed), and `build` (production build succeeds; routes `/`, `/_not-found`, `/api/health`).
- **Backend — GREEN (fully re-run):** `uv sync --frozen`, `ruff check` (clean), `pytest` (3 passed). Fail-fast verified (staging + missing secrets → `ValidationError`); `/health` → `200 {"status":"ok"}`.
- **Docker image build — PASSED (2026-08-01):** `docker build --no-cache` ✅; runtime Python 3.12.13, non-root appuser (uid 10001), HEALTHCHECK healthy, `/health` → 200; no `.env`/`.pen`/SQLAlchemy/Alembic in image. See *Infrastructure validation status*.
- **Supabase full stack — PASSED (2026-08-01):** `start` ✅, `db reset` ✅ ×2 (repeatable, no drift), `db lint` ✅ (findings only in bundled `extensions.*`); extensions installed in the `extensions` schema; 0 product tables.

## Phase 1 validation status (2026-08-03 — Sprint 2.1 independent review)

- **Supabase — GREEN:** two fully completed clean cycles — all **7 migrations** + seed apply from clean state; `db lint --schema public,app` has no findings; `supabase test db` is **254/254 PASS** across 14 files on both cycles. Two-session last-owner race PASS (second session blocked ≈2.74–2.80 s; one owner) and conflicting-approval race PASS (second blocked ≈2.70–2.71 s; one immutable approval/audit).
- **Catalog/behavior verified:** 14 workflow RPCs are postgres-owned, volatile, `security definer`, pinned `search_path=""`, executable by `authenticated` only; four internal helpers are postgres-only. Exact table/column grants prove no direct application-role privileged or membership DML. Service-role account-type update and audit spoof insert are denied. Audit failure rolls back account type and `applied_at`. Cross-subject/expired/stale/self approvals are denied; needs-more-info resubmission requires a fresh review claim.
- **Sprint 1.x hardening intact:** default `TRUNCATE` stripped; server-controlled `primary_account_type`/`public_profile_status`; public views expose only approved columns; single-source branch authority.
- **Frontend — GREEN:** frozen install · typecheck · lint · **7 tests** · production build. Server-action modules import `server-only`, preserve the caller client/JWT, use no service-role client, propagate errors, and validate UUID RPC results.
- **Backend — GREEN:** `uv sync --frozen` · `ruff` (clean) · `pytest` (**10 passed**). No backend helper added — the write paths are Next.js server actions, not the FastAPI AI service (ADR-0001).
- **CI:** existing `supabase-rls` workflow (not duplicated) runs reset/lint/254 pgTAP, both race scripts, then repeat reset+pgTAP. Required checks remain `frontend`, `backend`, `docs`, `supabase-rls`.
- **No `.pen` file modified.** No service-role key in client code. No duplicate base profile/identity possible.

## Deferred validation / follow-ups

- JWT custom-claim optimization for the `app` helper functions (ADR-0007 D1; TECHNICAL_DEBT).
- Org-visible audit scope; org-creation anti-abuse cap; storage-bucket creation (deferred to the feature that uploads).
- Platform-role administration remains a reviewed migration/DBA owner transaction until a constrained audited grant/revoke RPC is approved.
- `expires_at` is enforced at apply time; scheduled materialization of status=`expired` awaits the jobs feature.

## Next planned work

1. Continue the approved implementation roadmap from the latest validated Phase 2 baseline; do not infer deployment or merge authorization from this design session.
2. Implement remaining B2B journeys against the approved sequence: Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task.
3. Map the 15 Draft Pencil families to production components and validate keyboard, focus, screen-reader, responsive, RTL and theme behavior before promoting them to `Ready`.

## Exact resume commands

```bash
# Re-derive live git state
git branch --show-current
git rev-parse HEAD
git rev-list --count main..HEAD
git status --short

# Backend (uv-managed Python 3.12; ensure uv on PATH)
export PATH="$PATH:/c/Users/h0moh/AppData/Local/Python/pythoncore-3.14-64/Scripts"  # bash
cd backend && uv sync --python 3.12 && uv run ruff check . && uv run pytest && cd ..

# Frontend
pnpm --filter frontend typecheck && pnpm --filter frontend lint && pnpm --filter frontend test

# Supabase (needs Docker)
pnpm exec supabase start && pnpm exec supabase db reset
```
