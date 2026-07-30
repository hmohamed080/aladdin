# Agent Work Log

Append-only log of substantive agent/contributor sessions. **Newest entry first.** Each entry is a point-in-time record — it is not edited after the session it describes (later corrections go in a new entry). For durable decisions, see the [ADRs](../decisions/).

---

## Session — Core Project-Memory Consolidation
**Date/time:** 2026-07-30 (single session)
**Agent/tool:** Claude Code (Opus 4.8)
**Branch:** `chore/repository-architecture-foundation` (off baseline `main` @ `643eb61`)

### Objective
Establish four canonical persistent project-memory files + a live runtime-state file, reconcile all documentation/ADRs with them, defer the unused SQLAlchemy dependency, and add session-hygiene rules — **without** implementing any product feature, editing any `.pen` file, merging, or pushing.

### Starting state
10 commits ahead of `main`, working tree clean, HEAD `6f63867`. Existing memory docs: `product-direction.md`, `agent-work-log.md`. Contradictions present: profile-switching model in 6 files; WCAG 2.1; hardcoded component count; SQLAlchemy listed as a dependency but unused.

### Files moved (history preserved via `git mv`)
- `docs/product/product-direction.md` → `docs/product/PRODUCT_DIRECTION_GUIDE.md`
- `docs/operations/agent-work-log.md` → `docs/operations/AGENT_WORK_LOG.md`

### Files created
- `docs/architecture/ARCHITECTURE_GUIDE.md` (core memory — current-state architecture)
- `UI-UX/UI_UX_SYSTEM_GUIDE.md` (core memory — design system moved out of `UI-UX/AGENTS.md`)
- `docs/operations/RUNTIME_STATE.md` (core memory — mutable live snapshot)
- `docs/README.md` (documentation index)
- `docs/decisions/ADR-0005-python-data-access.md`

### Files modified
- Rewritten: `docs/product/PRODUCT_DIRECTION_GUIDE.md` (metadata, dual roadmap, decision process, change history, account-model correction); `UI-UX/AGENTS.md` (slimmed to operational).
- Reconciled: root `AGENTS.md` (reading order + persistent-memory policy + dependency policy), `CLAUDE.md`, `README.md`, `docs/AGENTS.md` (layout + end-of-session checklist), `docs/architecture/system-context.md`, `docs/product/mvp-scope.md`, `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/decisions/ADR-0002` (cross-ref) and `ADR-0003` (reading order).
- Backend (SQLAlchemy defer): `backend/pyproject.toml`, `backend/uv.lock`, `backend/app/database/__init__.py`, `backend/.env.example`.

### Decisions made
- **Account/navigation model corrected** from "active-profile switching" to canonical **one current primary account type / no Profile Switcher / derived navigation** across all product, architecture, and UI docs. This is a wording/consistency correction of the identity model, **not** a product-strategy change.
- **ADR-0005:** Python data access uses **`supabase-py`**; **SQLAlchemy deferred** (was an unused scaffold dependency), **Alembic** stays excluded, complex ops via **PostgreSQL RPC**, user-facing ops preserve the caller JWT so **RLS applies**, service-role limited to trusted workers.
- **Accessibility target** raised WCAG 2.1 AA → **WCAG 2.2 AA**; removed the hardcoded "~127 components" count (design.pen is the source of truth).
- **Reading order** now mandates the four core-memory files + `RUNTIME_STATE.md` before scoped AGENTS/ADRs.

### Tests & validation
- `uv sync --python 3.12` → `sqlalchemy` removed, `supabase` 2.31.0 added, `uv.lock` regenerated. ✅
- `uv run ruff check .` → All checks passed. ✅
- `uv run pytest` → 3 passed, 1 benign warning. ✅
- Residual `sqlalchemy` in source: only the intentional "deferred" note in `app/database/__init__.py`. ✅
- Documentation-link validation and `.pen` hash re-check: run at session end (see final report). 
- Frontend suite **not** re-run — no frontend source changed (Markdown docs only).

### Commits
- `cf1e0cc` docs: establish canonical project-memory files
- `d4a52dc` docs: reconcile product, architecture, and UI guidance with core memory
- `da6c69a` refactor: defer unused SQLAlchemy; adopt supabase-py for Python data access
- (this entry) docs: add runtime state and session hygiene

### Unfinished work
- Supabase local stack + `db reset` + RLS/organization-isolation tests (needs Docker) — still pending.
- Git remote + push — none configured (branch is local-only; not pushed per task).
- CI/CD pipeline — deferred.
- design.pen → Tailwind token bridge — deferred to first UI feature.

### Blockers
None for documentation/memory work. Docker required for the full Supabase RLS test pass.

### Known warnings (benign)
Frontend pnpm peer-dep warning (`unrs-resolver`/`@emnapi`); backend `StarletteDeprecationWarning` under pytest. No functional impact.

### Rollback notes
All changes are on `chore/repository-architecture-foundation`; baseline `main` @ `643eb61` is untouched. Revert a slice with `git revert <sha>` (commits are focused: memory files / reconciliation / SQLAlchemy / runtime+hygiene). `git mv` renames are reversible via `git mv` back. No `.pen` file was modified. No live DB/migration was applied.

### Next recommended action
Await explicit authorization to begin the implementation roadmap: **architecture hardening → identity & multi-tenancy → organizations/memberships/branches/permissions → RLS + tenant-isolation tests → 05C B2B Sales**. Do not start product implementation autonomously.

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
