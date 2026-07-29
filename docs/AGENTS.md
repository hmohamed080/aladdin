---
description: Scoped agent instructions for Aladdin documentation and decision records.
alwaysApply: true
---

# Docs — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `docs/`.

## Layout

```
docs/
  architecture/   # overview, system-context, module-boundaries, data-flow,
                  # realtime-and-background-jobs, scaling-strategy
  product/        # mvp-scope, client-brief, design-idea
  decisions/      # ADRs (immutable once accepted) + agent-instruction-migration
  database/       # migration-strategy, naming-conventions
  security/       # security-model, secrets-and-environments, rls-strategy
  api/            # API/contract docs (added as endpoints stabilize)
  operations/     # deployment-overview, monitoring-and-observability
  guides/         # setup guides (frontend, backend, supabase)
```

## Rules

- **Decisions live here, not only in chat.** If a product or architecture decision is made, record it in an ADR (`decisions/`) or the relevant doc before acting on it at scale.
- **ADRs are append-only.** To change an accepted decision, add a new ADR that supersedes the old one (link both ways); do not silently rewrite history.
- Every substantive document contains: **Purpose · Current decision · Rationale · Scope · What is deferred · Consequences · Related files.**
- No vague placeholder documentation. If a topic isn't decided yet, say so explicitly and state what would unblock it.
- **Keep internal links relative and valid.** When you move a file, update every link that points to it.
- Do not claim unfinished features are complete.

## ADR numbering

`ADR-000N-title.md`, zero-padded, monotonically increasing. Each ADR states **Status** (Proposed / Accepted / Superseded by ADR-XXXX).
