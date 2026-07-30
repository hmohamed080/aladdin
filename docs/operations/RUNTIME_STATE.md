# Runtime State

<!-- CANONICAL PROJECT MEMORY — mutable current-state snapshot. Refresh at the end of every substantive session. -->

This is a **mutable snapshot** of the current live repository state — not an append-only history (that is [`AGENT_WORK_LOG.md`](./AGENT_WORK_LOG.md)). Overwrite it each session with verified values.

| | |
|---|---|
| **Last updated** | 2026-07-30 |
| **Updated by** | Claude Code (Opus 4.8) — memory-consolidation session |
| **Current focus** | Core project-memory consolidation & documentation reconciliation. **No product feature in progress.** |

## Git & branch

- **Branch:** `chore/repository-architecture-foundation`
- **Commits ahead of `main`:** 14 (this snapshot's commit included; was 13 before it)
- **Baseline:** `main` @ `643eb61` (repo as-found)
- **Remote:** none — **local-only**, not pushed
- **Working tree:** clean at session end (verify with `git status`)

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

- **None blocking documentation work.**
- To run the full Supabase stack / RLS tests: Docker image pull required (deferred).

## Known warnings (benign)

- Frontend: pnpm peer-dep warning (`unrs-resolver` / `@emnapi`).
- Backend: `StarletteDeprecationWarning` from `fastapi.testclient` under pytest. No functional impact.

## Active files (this session)

Core-memory files created/promoted: `PRODUCT_DIRECTION_GUIDE.md`, `ARCHITECTURE_GUIDE.md`, `UI-UX/UI_UX_SYSTEM_GUIDE.md`, `AGENT_WORK_LOG.md`, this `RUNTIME_STATE.md`; plus `docs/README.md`, `ADR-0005`, and reconciled AGENTS/README/CLAUDE.

## Deferred validation

- `supabase db reset` + RLS/organization-isolation tests (needs Docker).
- Frontend full validation was **not** re-run this session (no frontend source changed — only Markdown docs); last known green from the foundation session.
- Git remote + push (none configured).
- CI/CD pipeline.

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
