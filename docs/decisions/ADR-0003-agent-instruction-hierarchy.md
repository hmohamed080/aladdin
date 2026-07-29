# ADR-0003 — Agent-Instruction Hierarchy

**Status:** Accepted · 2026-07-29

## Purpose

Define where AI-agent coding instructions live and how they compose, so rules are discoverable and conflicts are resolved explicitly.

## Current decision

- A **root `AGENTS.md`** is the universal source of truth. **Scoped `AGENTS.md`** files exist where a directory needs its own rules: `frontend/`, `backend/`, `supabase/`, `docs/`, `data/`, `UI-UX/`. No AGENTS.md is created for tiny/empty folders.
- **Reading order:** root `AGENTS.md` → nearest scoped `AGENTS.md` → relevant ADRs → relevant product/feature spec → existing tests/conventions → run validation before reporting done.
- **Rule:** *Before touching any file, read the root `AGENTS.md` and every applicable scoped `AGENTS.md` between the repository root and the target file.*
- Nested files **extend** the root; they **do not silently override** security, data, or architecture rules. A conflict must be reported and resolved explicitly (update the ADR or scoped file).
- **Product/architecture decisions live in `docs/` and ADRs, not only in chat prompts.**
- The `agents/` directory is **reference/source material only** and is not authoritative (see `agents/README.md`).

## Rationale

- A predictable, layered instruction set lets any agent (Claude Code, Cursor, Codex) become productive without rediscovering conventions, while keeping scope-specific detail close to the code it governs.
- Making the root always-read guarantees universal rules (security baseline, git discipline, dependency policy) are never missed.

## Scope

All AI-agent and human contributor workflows in this repository.

## What is deferred

Nothing structural. New scoped `AGENTS.md` files may be added when a new top-level module gains rules of its own.

## Consequences

- Instructions previously discoverable only inside `agents/commands/` (e.g. git discipline) were migrated into the root file — see `docs/decisions/agent-instruction-migration.md`.

## Related files

Root `AGENTS.md` · all scoped `AGENTS.md` · `agents/README.md` · `docs/decisions/agent-instruction-migration.md`
