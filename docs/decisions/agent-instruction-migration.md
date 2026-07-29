# Agent-Instruction Migration

**Status:** Complete (foundation task) · **Date:** 2026-07-29

## Purpose

The repository's `agents/` directory was seeded (partly from the `document-copilot` reference repo) with generic AI-agent role definitions and command playbooks. This document records how each instruction was classified and where its authoritative version now lives, so that **no active rule remains available only inside `agents/`**.

The original `agents/` files are **retained** as source material (see `agents/README.md`); this table is the map from source → destination.

## Migration map

| Source file | Category | Final destination | Disposition | Reason |
|---|---|---|---|---|
| `agents/architect.md` | Agent persona (system design) | `agents/architect.md` (kept as persona) | **Kept** | Reusable, stack-agnostic behavior. No Aladdin decision embedded. Not a repository rule. |
| `agents/code-reviewer.md` | Agent persona (review) | kept as persona | **Kept** | Same — generic review checklist. |
| `agents/debugger.md` | Agent persona (debugging) | kept as persona | **Kept** | Same. |
| `agents/devops.md` | Agent persona (devops) | kept; hosting specifics → `docs/operations/deployment-overview.md` | **Kept + distilled** | Persona is generic; Aladdin's concrete platforms are documented in ops. |
| `agents/researcher.md` | Agent persona (research) | kept as persona | **Kept** | Same. |
| `agents/security-auditor.md` | Agent persona (security) | kept; Aladdin rules → `docs/security/` + `supabase/AGENTS.md` | **Kept + distilled** | Persona is generic; RLS/JWT/tenant-isolation rules are now first-class. |
| `agents/test-runner.md` | Agent persona (testing) | kept; strategy → `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md` | **Kept + distilled** | Persona is generic; per-stack testing expectations are now scoped. |
| `agents/commands/git-discipline.md` | **Universal repo rule** | **root `AGENTS.md` → "Git discipline"** | **Migrated (rewritten)** | Commit WHAT+WHY, type vocabulary. Belongs in the always-read root file. |
| `agents/commands/db-migrate.md` | Database rule | `supabase/AGENTS.md` + `docs/database/migration-strategy.md` | **Superseded** | Listed Prisma/**Alembic**/Knex/Django. Conflicts with approved Supabase-only migrations (ADR-0002). Rewritten to the Supabase workflow. |
| `agents/commands/deploy.md` | Deployment rule | `docs/operations/deployment-overview.md` | **Superseded** | Generic multi-platform (Netlify/rsync/etc.). Replaced by Vercel + Railway + Supabase (ADR-0004). Useful discipline (staging-before-prod, tag releases) preserved. |
| `agents/commands/test.md` | Testing rule | scoped `AGENTS.md` testing sections + `docs/operations/monitoring-and-observability.md` | **Distilled** | Generic runner reference. Concrete commands now live per-service. |
| Root `AGENTS.md` (as-found) | Universal | root `AGENTS.md` (rewritten) | **Kept + rewritten** | Good dependency/config/code-style sections preserved; empty Stack section filled; stale "Vite" replaced with Next.js (ADR-0001). |
| `CLAUDE.md` (as-found) | Claude Code guidance | `CLAUDE.md` (stack section updated) | **Kept + corrected** | Design-file guidance retained; "React + Vite" stack corrected to approved architecture. |
| `backend/.env.example` (as-found) | Config template | `backend/.env.example` (rewritten) | **Superseded** | Referenced Alembic + Vite port 5173. Rewritten for the specialized FastAPI service. |
| `backend/pyproject.toml`, `uv.lock` | Backend manifest | rewritten | **Superseded** | Named `document-copilot-backend`. Renamed `aladdin-backend`. |
| `data/README.md` (as-found) | Data docs | `data/README.md` (rewritten) | **Superseded** | Described SEC EDGAR corpus. Rewritten for Aladdin data conventions. |

## Conflicts resolved

1. **Migration tooling** — `db-migrate.md`/`.env.example` assumed **Alembic**/Prisma; approved architecture mandates **Supabase SQL migrations only**. → Alembic references removed; Supabase workflow documented (ADR-0002).
2. **Frontend framework** — root `AGENTS.md`, `CLAUDE.md`, and `.env.example` (`ALLOWED_ORIGINS=…:5173`) assumed a **Vite SPA**; approved architecture is **Next.js App Router**. → All corrected to Next.js; CORS default aligned to `http://localhost:3000` (ADR-0001).
3. **Project identity** — backend manifests named `document-copilot-backend`; data docs described SEC filings. → Renamed and rewritten to Aladdin's domain.
4. **Deploy platforms** — `deploy.md` listed Netlify/Fly/rsync; approved platforms are **Vercel + Railway + Supabase**. → Documented in ADR-0004 / ops overview; generic platforms dropped.

## Consequences

- The always-read root `AGENTS.md` now carries the one universal command rule (git discipline) that agents previously had to discover inside `agents/commands/`.
- `agents/` is now **reference/source material only** — see its README. Agents must not treat it as the authoritative source of current rules.

## Related files

`agents/README.md` · root `AGENTS.md` · `docs/decisions/ADR-0001-approved-architecture.md` · `ADR-0002-database-migrations.md` · `ADR-0003-agent-instruction-hierarchy.md` · `ADR-0004-deployment-platforms.md`
