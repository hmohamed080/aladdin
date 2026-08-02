# Runtime State

<!-- CANONICAL PROJECT MEMORY — mutable current-state snapshot. Refresh at the end of every substantive session. -->

This is a **mutable snapshot** of the current live repository state — not an append-only history (that is [`AGENT_WORK_LOG.md`](./AGENT_WORK_LOG.md)). Overwrite it each session with verified values.

| | |
|---|---|
| **Version** | Runtime snapshot · 2026-08-02 |
| **Owner** | Foundation / Operations |
| **Last updated** | 2026-08-02 |
| **Updated by** | Claude Code (Opus 4.8) — Phase 1, Sprint 1.2 (Account-Type & Public-Profile Authorization Fix) |
| **Current focus** | **Phase 1 — Identity & Multi-Tenancy · Sprint 1.2 (Account-Type & Public-Profile Authorization Fix).** Closed a merge-blocking self-promotion path: `authenticated` had a column UPDATE grant on `users.primary_account_type` and `profile_public_directory` treated any non-consumer account type as public — so an end consumer could self-promote to a professional type and appear in public discovery (confirmed empirically). Fix: `primary_account_type` is now **server-controlled** (removed from the authenticated update grant; `service_role`/future RPC only), and a server-controlled `profiles.public_profile_status` (`hidden`/`listed`) gates discovery (professional type alone is not enough). pgTAP grew 98→**112**. Prior Sprint 1.1 (default-privilege/TRUNCATE + view hardening) remains in place. See [ADR-0007 §Amendments](../decisions/ADR-0007-identity-and-tenancy-model.md) and [`../database/phase1-identity-tenancy-review.md`](../database/phase1-identity-tenancy-review.md#7-account-type--public-eligibility-fix-sprint-12-2026-08-02). |

## Phase & repository

| Field | Value |
|---|---|
| **Current Phase** | **Phase 1 — Identity & Multi-Tenancy** (canonical identity, orgs/branches/memberships/capabilities, RLS helpers + organization-isolation tests) |
| **Current Sprint** | **Sprint 1.2 — Account-Type & Public-Profile Authorization Fix** |
| **Current Feature** | Identity, Organizations, Memberships, Branches, RLS, Audit Foundation |
| **Next Phase** | **Phase 2** — first product workflow (per [`ROADMAP`](../roadmap/ROADMAP.md); design order starts at 05C B2B Sales) once identity/tenancy merges |
| **Current Branch** | `feature/identity-multitenancy` (created from `main` @ `64e68d6`) |
| **Current Milestone** | Phase 1 tenant-isolation foundation — schema, RLS spine, audit, tenant-aware clients, isolation tests |
| **Current Remote Repository** | `origin` = `https://github.com/hmohamed080/aladdin.git` |
| **Last Stable Commit** | `64e68d6` — merged `main` (PR #2: foundation closeout); tagged `v0.1.0-foundation`. Phase 1 commits land on `feature/identity-multitenancy` and merge into `main` via PR |
| **Last Stable Tag** | `v0.1.0-foundation` (repo `0.1.0`) — created on merged `main` after the closeout PR; Design System stays independently at `1.0.0` |
| **Foundation Release** | Tagged `v0.1.0-foundation` on `main` @ `64e68d6` |
| **Repository Status** | Published to GitHub (`origin`, full history, no squash/force); `main` protection recommended (ADR-0006), not yet applied |
| **Documentation Status** | Updated for Phase 1 — see [`../DOCUMENTATION_STATUS.md`](../DOCUMENTATION_STATUS.md); 0 broken links; no orphan docs |
| **Implementation Status** | **In progress** — Phase 1 identity & tenancy foundation implemented (schema + RLS + audit + tests + tenant-aware clients); no other product features/endpoints/screens |

## Live engineering state

Always reflects the current live engineering state of the project. Overwrite each session with verified values.

| Field | Value |
|---|---|
| **Current Sprint** | **Sprint 1.2 — Account-Type & Public-Profile Authorization Fix** (Phase 1) |
| **Current Epic** | Identity & Multi-Tenancy (canonical identity, organizations, memberships, branches, RLS spine, audit) |
| **Current Feature** | Identity, Organizations, Memberships, Branches, RLS, Audit Foundation |
| **Current UI Status** | Design system **v1.0.0** ("The Aperture") finalized + implemented as tokens; only the Next.js scaffold page exists — **no product screens** (Phase 1 is schema/RLS/data-access only) |
| **Current Backend Status** | FastAPI scaffold — `GET /health` only; **no product endpoints**. Data-access boundaries added: `app.database.create_user_client` (preserves caller JWT → RLS) + `create_service_client` (trusted-path, bypasses RLS) — `supabase-py`, ADR-0005 |
| **Current Database Status** | 4 migrations; **Phase 1 identity/tenancy tables implemented** (`users`, `profiles`, `contacts`, `organizations`, `branches`, `memberships`, `membership_capabilities`, `membership_branch_access`, `platform_role_grants`, `audit_log`) + public-discovery views (`organization_public_directory`, `profile_public_directory`); `app` helper schema; **RLS + explicit policies on every table**, default `TRUNCATE` privileges stripped from client roles, explicit `service_role` DML; **112 pgTAP** isolation/privilege tests; schema source = `supabase/migrations/*.sql` |
| **Current Design System Version** | **1.0.0** (`DESIGN.md` / `design/tokens/*`) |
| **Current Documentation Version** | Technical spec **1.0.0** (Phase 0.7); engineering standards **1.0.0** (Phase 0.8); governance/planning **1.0.0** (Phase 0.9 — ADR-0006, ROADMAP, BACKLOG, TECHNICAL_DEBT, DOCUMENTATION_STATUS, DECISION_LOG); docs index **1.0.0** |
| **Current Deployment Status** | **not deployed** — no Vercel/Railway/Supabase cloud project connected; **no CD**; a minimum **PR-validation CI** workflow (`.github/workflows/ci.yml`: `frontend`/`backend`/`docs`) is present (must run once, then be selected as required checks in branch protection); repository published to GitHub (`origin`) |

## Git & branch

- **Baseline:** `main` @ `64e68d6` — foundation merged (PR #2) and tagged `v0.1.0-foundation`.
- **Current work branch:** `feature/identity-multitenancy` (cut from `main` @ `64e68d6`) — Phase 1 identity & tenancy foundation.
- **Remote:** `origin` → `https://github.com/hmohamed080/aladdin.git` (push preserves full history; no squash, no force). Phase 1 merges into `main` via PR; direct pushes to `main` are prohibited.

> HEAD moves with each commit; this file trails HEAD by its own commit. Re-derive live values with the [resume commands](#exact-resume-commands) below rather than trusting a pasted hash.

## Architecture state

- **Foundation:** scaffolded and validated. Modular monolith per ADR-0001 (Next.js + Supabase + specialized FastAPI + workers).
- **Python data access:** `supabase-py` (ADR-0005); SQLAlchemy deferred/removed; Alembic excluded.
- **No product features, product tables, or production connections exist.**
- **MVP technical blueprint:** authored under [`../technical/`](../technical/) (Phase 0.7) — system overview, domain model, database design, ERD, storage, RLS, permissions, API contracts, jobs, events, state machines, validation, integrations, future scope. Specification only; open decisions marked `⚑ OPEN`.

## Design system state

- **Version `1.0.0`** — approved, hardened, pre-feature. North star: **"The Aperture."**
- **Authority chain:** `PRODUCT_DIRECTION_GUIDE.md` → `DESIGN.md` → `design/tokens/*.json` → `UI-UX/UI_UX_SYSTEM_GUIDE.md` → `design.pen` → frontend code.
- **Canonical machine tokens:** `design/tokens/{colors,typography,spacing,radii,shadows,motion,breakpoints,z-index}.json` (+ README). Governance: `design/GOVERNANCE.md`; changelog: `design/CHANGELOG.md`; inventory: `design/COMPONENT_INVENTORY.md`; icons: `design/icons/README.md`.
- **Frontend implementation:** `frontend/src/styles/tokens.css` (primitives + light/dark semantics + motion + z-index), `frontend/tailwind.config.ts` (semantic/brand colors, type roles, spacing, radii, shadows, motion, z-index, canonical `tablet`/`desktop`/`wide` screens), `frontend/src/app/globals.css` (base + `prefers-reduced-motion`), `frontend/src/app/layout.tsx` (four self-hosted fonts).
- **Defect fixed this session:** dark-theme `--primary` referenced an undefined `--lime` → corrected to `--on-dark`.
- **Components implemented:** none yet — inventory entries are `Proposed`/`Draft`. Icon library (Lucide) decided but not installed. PDF/Arabic font strategy is an open item.

## Implemented routes

- **Frontend (Next.js):** `/` (`src/app/page.tsx`) · `/api/health` (`src/app/api/health/route.ts`) — scaffold only.
- **Backend (FastAPI):** `GET /health` (`app/api/v1/health.py`) — scaffold only.

## Auth state

Passwordless model (WhatsApp/Email OTP) is specified; **no auth UI/OTP/session handling wired yet** (explicitly out of Phase 1 scope). The **identity backbone** now exists: a `security definer` trigger `app.handle_new_user()` on `auth.users` bootstraps the canonical `public.users` + `public.profiles` rows atomically (no client-side profile creation; duplicate base identity is structurally impossible). Backend JWT verification for FastAPI is still a later item.

## Database & migration state

- **Migrations (4):**
  - `20260729000000_extensions.sql` — `pgcrypto`, `pg_trgm`, `vector`/pgvector, `postgis` (in the `extensions` schema).
  - `20260802090001_identity_core.sql` — `app` helper schema + `set_updated_at`; enums (`account_type`, `platform_role`, `contact_channel`, `user_status`, `public_profile_status`); `users`, `profiles` (incl. server-controlled `public_profile_status`), `contacts`; profile-bootstrap trigger; identity RLS + grants (`primary_account_type` server-controlled).
  - `20260802090002_organizations_tenancy.sql` — enums (`org_status`, `membership_status`); `organizations`, `branches`, `memberships`, `membership_capabilities`, `membership_branch_access`, `platform_role_grants`; tenancy helpers (`current_org_ids`, `is_org_member`, `has_capability`, `current_branch_ids`, `is_platform`); RLS + grants.
  - `20260802090003_audit_foundation.sql` — append-only `audit_log` (immutability trigger; service-role insert; admin read).
- **Public discovery:** curated views `organization_public_directory` / `profile_public_directory` expose only approved columns; base tables are private (Sprint 1.1 B1). Professional discovery requires server-controlled `profiles.public_profile_status='listed'` (Sprint 1.2) — a professional account type alone is not enough; `users.primary_account_type` is server-controlled (not client-updatable).
- **RLS + privileges:** enabled with explicit policies on **every** table; Supabase's default `TRUNCATE`/`REFERENCES`/`TRIGGER` grants are **revoked** from `anon`/`authenticated`/`service_role` and re-granted intentionally; `service_role` has explicit DML (append-only preserved for `audit_log`). Covered by **112 pgTAP tests** in `supabase/tests/` (repeatable across `db reset`) and gated by the `supabase-rls` CI workflow.
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

- **None.** The previously environment-blocked network checks are now **executed and passing** (2026-08-01): the backend Docker image builds/runs (non-root, healthy `/health`), and the Supabase local stack starts, resets (×2), and lints cleanly with the extensions migration applied. See *Infrastructure validation status* below.
- **Residual environment note (not a code defect):** `ghcr.io` still shows intermittent TLS-handshake timeouts that **slow** (no longer block) multi-image pulls; retries succeed. Docker Hub and `public.ecr.aws` are reachable.

## Known warnings (benign)

- Frontend: pnpm peer-dep warning (`unrs-resolver` / `@emnapi`).
- Backend: `StarletteDeprecationWarning` from `fastapi.testclient` under pytest. No functional impact.

## Active files (this session)

- Private visual source: `UI-UX/design.pen` — 8 top-level groups, 207 product screens, 0 generic missing placeholders, 48 explicitly classified remaining gaps, and updated `00I` coverage.
- Approved design record: root `DESIGN.md` — The Aperture concept, exact brand/token values, typography, component defaults, and usage rules.
- Frontend token bridge: `frontend/src/styles/tokens.css`, `frontend/tailwind.config.ts`, `frontend/src/app/globals.css`, and `frontend/src/app/layout.tsx`.
- Product/UI memory: root `PRODUCT.md` and `UI-UX/UI_UX_SYSTEM_GUIDE.md` now record the approved identity and artifact-authority chain.
- Local tooling sidecar: `.impeccable/design.json` is synchronized but remains intentionally ignored; `DESIGN.md` is the versioned durable record.
- Operations memory: `docs/operations/AGENT_WORK_LOG.md` and this file.

## Design validation status (2026-08-01)

- `design.pen`: 8 top-level groups; 0 top-level overlaps; 0 organizational sibling overlaps.
- 120 original product screens preserved; 87 copied variants added, for 207 product screens total.
- 0 generic `MISSING —` placeholders remain; 48 gaps are explicitly Partial, Blocked, Responsive Decision, Unresolved, or Not Required.
- Known inherited source-screen warnings remain untouched; copied variants reproduce those source conditions where applicable.
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

## Phase 1 validation status (2026-08-02 — Sprint 1.2 account-type/eligibility fix)

- **Supabase — PASSED:** `db reset` applies all 4 migrations + seed cleanly; **repeated** (reset → tests → reset → tests). `db lint --schema public,app` → **"No schema errors found"**. `supabase test db` → **112/112 pgTAP tests pass** across two clean resets.
- **Sprint 1.2 fix verified:** `authenticated` column UPDATE grant on `users` is now **`locale` only** (no `primary_account_type`/`is_verified`/`status`); `profiles` update grant excludes `public_profile_status` — confirmed via `information_schema.role_column_grants` + empirical consumer self-promote → **denied**. `service_role` retains full `users` DML (trusted transition path). Public directory requires `public_profile_status='listed'` + professional type + active + not deleted.
- **Sprint 1.1 hardening still in place + verified:** `anon`/`authenticated` default `TRUNCATE` stripped (empirical `anon TRUNCATE audit_log` → denied); `service_role` audit insert → ok; RLS scoping proven end-to-end via signed-JWT REST round-trip; public views expose only approved columns; account type ≠ platform authority; single-source branch authority.
- **Frontend — GREEN:** `install --frozen-lockfile` · `typecheck` · `lint` · `test` (3) · `build`. Types regenerated (`public_profile_status` present; no client write path to it or `primary_account_type`).
- **Backend — GREEN:** `uv sync --frozen` · `ruff` (clean) · `pytest` (**10 passed**).
- **CI:** `supabase-rls` workflow (existing, not duplicated) runs the expanded 112-test suite on PRs to `main`.
- **No `.pen` file modified.** No service-role key in client code. No duplicate base profile possible.

## Deferred validation / follow-ups

- Docker-image + Supabase RLS/isolation **CI jobs** (the pgTAP suite is CI-ready; not yet wired into `.github/workflows/ci.yml` — TECHNICAL_DEBT §5).
- JWT custom-claim optimization for the `app` helper functions (ADR-0007 D1; TECHNICAL_DEBT).
- "Last `org.manage` owner cannot be revoked" invariant — enforced in the membership write path (not this migration).
- Org-visible audit scope; org-creation anti-abuse cap; storage-bucket creation (deferred to the feature that uploads).

## Next planned work

1. Open the Phase 1 PR (`feature/identity-multitenancy` → `main`); after CI runs, select `frontend`/`backend`/`docs` as required checks.
2. Build the membership/org **write-path** feature (Server Actions): org creation, invitations, capability grants (no-escalation), last-owner protection — with authorization tests.
3. Begin **05C — B2B Sales operating workflow** on the tenant spine: first sales tenant tables + RLS + isolation tests reusing the `app` helpers.
4. During the first approved frontend feature, consume the semantic tokens and wire theme selection/persistence.

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
