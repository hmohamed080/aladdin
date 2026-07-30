# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

---

## Session — Repository Architecture Foundation
**Date:** 2026-07-29 → 2026-07-30
**Agent:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish the repository architecture foundation only — audit the repo, consolidate agent instructions, build the AGENTS hierarchy + ADRs + docs, and scaffold the approved stack (Next.js + Supabase + specialized FastAPI) — **without** implementing product features, connecting production services, or touching any `.pen` file. Two follow-on requests were completed in the same session: the UI-UX design-system guidelines and the product-direction guide.

### Changes Made
- **Git:** initialized the repo (`git init -b main`), committed the as-found baseline, branched. 10 commits, WHAT/WHY messages. Working tree clean.
- **Ignore/config:** authored `.gitignore` (secrets, `.claude/`, `*.pen`, node/python/supabase artifacts), `.gitattributes` (`*.pen binary`, LF normalization), `.editorconfig`.
- **Agent instructions:** rewrote root `AGENTS.md` (filled empty Stack section, added reading-order + composition rules, migrated the git-discipline rule in); added scoped `AGENTS.md` for `frontend`, `backend`, `supabase`, `docs`, `data`, `UI-UX`; added `agents/README.md` marking `agents/` as non-authoritative source material; recorded the source→destination map in `docs/decisions/agent-instruction-migration.md`.
- **Docs/ADRs:** ADR-0001..0004; architecture (×6), security (×3), database (×2), operations (×2), product (mvp-scope + moved design-idea/client-brief); rewrote the 3 setup guides. Later added `product-direction.md`.
- **Frontend:** Next.js 15 App Router scaffold (strict TS, Tailwind, ESLint flat config, Zod env module, Supabase browser factory, EN/AR i18n constants, `/api/health`, domain-oriented `features/lib/server` structure, one vitest test).
- **Backend:** specialized FastAPI scaffold (`aladdin-backend`) — app factory, Pydantic-Settings config (fail-fast in staging/prod), `/health`, capability-module boundaries, Dockerfile (non-root + healthcheck), health/config tests; removed stale Alembic/Vite-referencing artifacts.
- **Supabase:** kept `config.toml` (`project_id=aladdin`); added extensions migration (pgcrypto/pg_trgm/vector/postgis), `seed.sql`, functions/tests conventions.
- **Cleanup:** rewrote root `README.md`, `data/README.md`, `assets/brand/README.md` (canonical-source vs runtime-export rule); corrected `CLAUDE.md` stack (React+Vite → Next.js).
- **UI-UX:** appended a 24-section Design System & UX guideline to `UI-UX/AGENTS.md` (token-driven; consultation-first, passwordless, RTL, light/dark, anti-patterns).
- **Product:** added `docs/product/product-direction.md` (vision, positioning, philosophy, priority rules, "agents must never" guardrails).

### Files Modified
124 files changed vs baseline (`git diff --stat main..HEAD` → +8439 / −62). By area:
- Root: `AGENTS.md`, `CLAUDE.md`, `README.md`, `.gitignore`, `.gitattributes`, `.editorconfig`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `agents/README.md` (+ existing personas/commands retained)
- `frontend/**` (~49 files: configs, `src/app`, `src/lib`, `src/features/*`, `.env.example`)
- `backend/**` (~26 files: `app/*`, `tests/*`, `pyproject.toml`, `uv.lock`, `Dockerfile`, `.env.example`)
- `supabase/**` (migrations, seed, functions, tests, `AGENTS.md`)
- `docs/**` (~26 files: AGENTS, ADRs, architecture, security, database, operations, product, guides) — incl. this file
- `assets/brand/README.md`, `data/**`, `UI-UX/AGENTS.md`
- Moved (history preserved): `docs/architecture.md`→`architecture/overview.md`; `docs/design_idea.txt`→`product/design-idea.md`; `docs/client-brief.md`→`product/client-brief.md`

### Architectural Decisions
- **ADR-0001** Approved architecture: modular monolith — Next.js App Router (no Vite/SPA) + Supabase + specialized FastAPI + workers.
- **ADR-0002** Supabase SQL migrations are the only schema source of truth; no Alembic; no `create_all()` in staging/prod; SQLAlchemy read-side only.
- **ADR-0003** Agent-instruction hierarchy + mandatory reading order.
- **ADR-0004** Deployment: Vercel (web) · Railway (FastAPI/workers, Docker) · Supabase (data) · Sentry.

### Remaining Work
- Stand up the local Supabase Docker stack; run `supabase db reset` + first RLS/organization-isolation tests (pending — needs Docker image pull).
- Add a git **remote** and push (currently local-only).
- Build CI/CD pipeline (deferred).
- Extract `design.pen` design tokens into `frontend/src/styles` + Tailwind theme (token bridge).
- Optional: `docs/README.md` index; persist a `runtime-state.md`.
- **Next feature phase:** 05C — B2B Sales operating workflow (start with the first authenticated tenant table migration + its RLS + isolation tests).

### Risks / Warnings
- **Toolchain:** `uv` installed via pip (at `…/pythoncore-3.14-64/Scripts/uv`; add to PATH). System Python is **3.14**; backend deliberately uses a uv-managed **3.12** (`uv sync --python 3.12`) to avoid missing 3.14 wheels.
- **No remote/push** yet; if this becomes a public repo, verify ignore rules still hold before first push (`.claude/`, `.env*`, `*.pen` are covered).
- **`.pen` files are gitignored** — ensure they are versioned in **private** storage (they are not in git).
- Benign only: pnpm peer-dep warning (`unrs-resolver`/`@emnapi`), pytest `StarletteDeprecationWarning`. No functional bugs.

### Testing Status
- Frontend: `tsc --noEmit` ✅ · `eslint .` ✅ · `vitest run` ✅ (3 passed)
- Backend: `uv run pytest` ✅ (3 passed) · `uv run ruff check .` ✅
- Supabase: `supabase --version` ✅ (2.110.0) · `config.toml` valid TOML ✅ (full `db reset`/RLS tests pending Docker)
- Repo: internal markdown links ✅ (0 broken) · secret scan ✅ (clean) · `.pen` sha256 ✅ (all 5 identical to baseline; none tracked)

### Rollback Notes
- All foundation work is on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is the repo **as-found**.
- Revert everything: `git checkout main` (or delete the branch). Revert a slice: `git revert <sha>` — commits are logically grouped (baseline / AGENTS / docs+ADRs / frontend / supabase / backend / cleanup / UI-UX / product).
- No `.pen` file was modified, so there is nothing to restore there; backups remain on disk.
- Deleting the whole scaffold is safe (nothing external was connected; no migrations were applied to any live DB).

---
