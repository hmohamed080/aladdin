# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

This repo already has an established, richer memory system than the generic `CONTEXT.md` + `docs/adr/` convention — read that system instead:

## Before exploring, read these

- **The five persistent project-memory files** referenced in root [`CLAUDE.md`](../../CLAUDE.md) / [`AGENTS.md`](../../AGENTS.md):
  1. [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) — product direction & guardrails.
  2. [`docs/architecture/ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) — currently active architecture.
  3. [`UI-UX/UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md) — design system, tokens, UX rules.
  4. [`docs/operations/AGENT_WORK_LOG.md`](../operations/AGENT_WORK_LOG.md) — append-only session log & unfinished work.
  5. [`docs/operations/RUNTIME_STATE.md`](../operations/RUNTIME_STATE.md) — current live repository state.
- **`docs/decisions/`** — this repo's ADR location (not `docs/adr/`). Read ADRs that touch the area you're about to work in before proposing architectural changes.
- **The scoped `AGENTS.md` hierarchy** — root `AGENTS.md`, plus `frontend/AGENTS.md`, `backend/AGENTS.md`, `supabase/AGENTS.md`, `docs/AGENTS.md`, `data/AGENTS.md`, `UI-UX/AGENTS.md` — for coding conventions in the area you're touching.

There is no `CONTEXT.md` / `CONTEXT-MAP.md` in this repo yet, and none is needed — the persistent project-memory files above already serve that role. If a skill's workflow (e.g. `/domain-modeling`) wants to create a `CONTEXT.md` glossary later, that's additive, not a replacement for the files above.

## File structure (single-context)

```
/
├── CLAUDE.md, AGENTS.md            ← reading-order entry points
├── docs/
│   ├── decisions/                  ← ADRs
│   ├── product/PRODUCT_DIRECTION_GUIDE.md
│   ├── architecture/ARCHITECTURE_GUIDE.md
│   └── operations/{AGENT_WORK_LOG,RUNTIME_STATE}.md
├── UI-UX/UI_UX_SYSTEM_GUIDE.md
├── frontend/                       ← Next.js app
├── backend/                        ← FastAPI service (uv, not a pnpm package)
└── supabase/                       ← migrations, schema source of truth
```

This is a single Next.js frontend (`pnpm-workspace.yaml` lists only `frontend`) plus a separately-managed Python backend and Supabase project — not a multi-package pnpm monorepo. Treat it as single-context.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `PRODUCT_DIRECTION_GUIDE.md` and `ARCHITECTURE_GUIDE.md`. Don't drift to synonyms those docs explicitly avoid (e.g. `org_type` vs. `primary_account_type` — see `CLAUDE.md`'s account/organization model section).

## Flag ADR conflicts

If your output contradicts an existing ADR under `docs/decisions/`, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (database migrations), but worth reopening because…_
