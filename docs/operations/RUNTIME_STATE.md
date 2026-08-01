# Runtime State

<!-- CANONICAL PROJECT MEMORY — mutable current-state snapshot. Refresh at the end of every substantive session. -->

This is a **mutable snapshot** of the current live repository state — not an append-only history (that is [`AGENT_WORK_LOG.md`](./AGENT_WORK_LOG.md)). Overwrite it each session with verified values.

| | |
|---|---|
| **Last updated** | 2026-08-01 |
| **Updated by** | Pi design/coding agent — permanent device/theme canvas governance session |
| **Current focus** | Design workspace governance completed. `design.pen` now permanently follows Product Surface → Flow → Device → Theme → Sequence; missing approved variants remain explicit placeholders. |

## Git & branch

- **Branch:** `chore/repository-architecture-foundation`
- **Commits ahead of `main`:** 19 after the device/theme-governance documentation commit
- **Baseline:** `main` @ `643eb61` (repo as-found)
- **Remote:** none — **local-only**, not pushed
- **Working tree:** contains pre-existing unrelated frontend/design-document changes; this session commits only `PRODUCT.md`, `UI_UX_SYSTEM_GUIDE.md`, and operations-memory updates

> HEAD moves with each commit; this file trails HEAD by its own commit. Re-derive live values with the [resume commands](#exact-resume-commands) below rather than trusting a pasted hash.

## Architecture state

- **Foundation:** scaffolded and validated. Modular monolith per ADR-0001 (Next.js + Supabase + specialized FastAPI + workers).
- **Python data access:** `supabase-py` (ADR-0005); SQLAlchemy deferred/removed; Alembic excluded.
- **No product features, product tables, or production connections exist.**

## Implemented routes

- **Frontend (Next.js):** `/` (`src/app/page.tsx`) · `/api/health` (`src/app/api/health/route.ts`) — scaffold only.
- **Backend (FastAPI):** `GET /health` (`app/api/v1/health.py`) — scaffold only.

## Auth state

Not implemented. Passwordless model (WhatsApp/Email OTP) is specified only. No auth routes, no session handling, no JWT verification wired yet.

## Database & migration state

- **Migrations:** one — `supabase/migrations/20260729000000_extensions.sql` (enables `pgcrypto`, `pg_trgm`, `vector`/pgvector, `postgis`).
- **No product tables. No RLS policies yet** (none to protect until tables exist).
- **Schema source of truth:** `supabase/migrations/*.sql` only (ADR-0002).

## Running services

None running as part of this session. Local dev is manual:

- Frontend dev → `http://localhost:3000`
- Backend API → `http://localhost:8000` (`/health`)
- Supabase local stack → Docker (not started this session)

## Deployment state

None. No Vercel / Railway / Supabase cloud project connected. No CI/CD pipeline. Targets are decided (ADR-0004) but not provisioned.

## Environment state

- `frontend/.env.example` and `backend/.env.example` present; **no real `.env` committed** (correct).
- Config is validated per service (`frontend/src/lib/env/`, `backend/app/config.py`); fail-fast in staging/production.
- Toolchain: `uv` at `…/pythoncore-3.14-64/Scripts/uv` (add to PATH); backend uses uv-managed **Python 3.12** (system Python is 3.14). Supabase CLI via `pnpm exec supabase`.

## Current blockers

- **None blocking the foundation.** Code/docs verification is complete and green.
- **Environment-only (not a code defect):** this sandbox cannot reach the container registries (`ghcr.io` TLS handshake timeout; `public.ecr.aws` Supabase images uncached and unpullable). Reproduced 3× on `docker build` and on `docker pull`. Consequence: the backend **Docker image build** and the **Supabase local stack** (`start`/`db reset`/`db lint`) could not be executed here. Both are statically verified (Dockerfile correct; `config.toml` valid TOML; extensions migration correct; no product tables) and should run in CI / a stable network.

## Known warnings (benign)

- Frontend: pnpm peer-dep warning (`unrs-resolver` / `@emnapi`).
- Backend: `StarletteDeprecationWarning` from `fastapi.testclient` under pytest. No functional impact.

## Active files (this session)

- Private visual source: `UI-UX/design.pen` — 8 top-level product/resource groups, 120 existing product screens, 56 workspace-only missing-coverage placeholders, and `00I` device/theme status report.
- Policy: root `PRODUCT.md` — mandatory Screen Organization and Variant Governance.
- UI core memory: `UI-UX/UI_UX_SYSTEM_GUIDE.md` — matching canvas-organization rule.
- Operations memory: `docs/operations/AGENT_WORK_LOG.md` and this file.

Pre-existing unrelated working-tree changes (`frontend/src/app/globals.css`, `frontend/src/styles/tokens.css`, `DESIGN.md`) were not modified by this session.

## Design validation status (2026-08-01)

- `design.pen`: 8 top-level groups; 0 top-level overlaps; 0 organizational sibling overlaps; 0 device/theme/responsive-lane ancestry mismatches.
- 120 existing product-screen frames preserved; internal UI unchanged.
- 56 missing-coverage placeholders remain documentation-only.
- Known inherited product-screen warnings remain untouched because product screens are locked.
- Root `PRODUCT.md` and `UI_UX_SYSTEM_GUIDE.md` now encode the permanent governance rule.

## Validation status (2026-07-30 foundation review)

- **Frontend — GREEN (fully re-run):** `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test` (3 passed), and `build` (production build succeeds; routes `/`, `/_not-found`, `/api/health`).
- **Backend — GREEN (fully re-run):** `uv sync --frozen`, `ruff check` (clean), `pytest` (3 passed). Fail-fast verified (staging + missing secrets → `ValidationError`); `/health` → `200 {"status":"ok"}`.
- **Docker image build — BLOCKED (environment):** registry unreachable (see blockers). Dockerfile statically correct (multi-stage, non-root uid 10001, HEALTHCHECK, copies only `pyproject.toml`/`uv.lock`/`app`).
- **Supabase full stack — BLOCKED (environment):** `--version` OK (2.110.0); `config.toml` valid TOML; `start`/`db reset`/`db lint` not executable here (image pull blocked).

## Deferred validation

- `supabase db reset` + RLS/organization-isolation tests (needs Docker + registry access; no product tables/policies exist yet).
- Backend `docker build` end-to-end (needs registry access).
- Git remote + push (none configured).
- CI/CD pipeline (commands documented in README; not wired).

## Next planned work

1. **Architecture hardening** (implementation roadmap step 1) — confirm the reconciled foundation.
2. **Identity & multi-tenancy**, then organizations/memberships/branches/permissions, then **RLS + tenant-isolation tests**.
3. **05C — B2B Sales operating workflow** (design roadmap first), starting with the first authenticated tenant table migration + its RLS + isolation tests.

**Not yet authorized to start product implementation** — awaiting explicit direction.

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
