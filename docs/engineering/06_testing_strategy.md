# 06 — Testing Strategy

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../security/rls-strategy.md`](../security/rls-strategy.md), [`../../frontend/AGENTS.md`](../../frontend/AGENTS.md), [`../../backend/AGENTS.md`](../../backend/AGENTS.md), [`../../supabase/AGENTS.md`](../../supabase/AGENTS.md) |
| **Related** | [`07_feature_workflow.md`](07_feature_workflow.md), [`10_environment_and_cicd.md`](10_environment_and_cicd.md) |

Covers **Testing Strategy (9)**. Tests are part of Done ([`07_feature_workflow.md`](07_feature_workflow.md)); RLS/isolation tests are **mandatory and blocking** for any tenant table.

## 1. Test pyramid (by layer)

| Level | Web (Vitest) | FastAPI (pytest) | Database (Supabase) |
|---|---|---|---|
| **Unit** | pure logic: validation (Zod), mappers, permissions | pure logic, schema validation, prompt/parse helpers | — |
| **Integration** | Server Actions/queries against a test Supabase (RLS on) | endpoints via httpx, JWT verification, provider adapters (faked) | RLS policies, functions/RPC |
| **Authorization / isolation** | capability gating in actions | authorization tests (JWT-derived identity) | **organization-isolation tests (mandatory)** |
| **E2E (later)** | Playwright critical journeys | — | — |
| **A11y / responsive** | axe + breakpoint checks (UI) | — | — |

## 2. Mandatory tests (blocking)

- **Every RLS policy** ships with tests in `supabase/tests/`, including **organization-isolation** (org A cannot SELECT/INSERT/UPDATE/DELETE org B — all four verbs), **capability** (member without capability is denied writes), **public-view** (only published+verified rows are visible unauthenticated), **storage-policy** (private objects not readable cross-tenant), and **no-self-approval** for verification decisions ([`06_rls_strategy`](../technical/06_rls_strategy.md) §7). A tenant-table migration without these fails review.
- **Validation** unit tests for each Zod/Pydantic schema (happy path + boundary + reject).
- **State machines**: legal transitions pass; illegal transitions return `CONFLICT` ([`11_state_machines`](../technical/11_state_machines.md)).
- **Worker handlers**: idempotency (run twice → one effect) + retry/dead-letter behavior.

## 3. Principles

- **Test behavior, not internals.** No tests of private state; test inputs → outputs and observable effects.
- **No meaningless placeholder tests** (root [`AGENTS.md`](../../AGENTS.md)); every test asserts something real.
- **Deterministic:** no real network/time randomness — fake provider adapters ([`13_integrations`](../technical/13_integrations.md)), freeze time, seed data.
- **Tenant fixtures:** helpers create two orgs + users with JWTs to exercise isolation quickly.
- **Fast feedback:** unit + integration run in CI on every PR; E2E/full RLS suite on the migration/feature paths.

## 4. Commands (current)

```bash
# Frontend
pnpm --filter frontend typecheck && pnpm --filter frontend lint && pnpm --filter frontend test
# Backend
cd backend && uv run ruff check . && uv run pytest
# Database (needs Docker)
pnpm exec supabase db reset && pnpm exec supabase test db   # RLS/isolation tests
```

## 5. Coverage expectation

No blanket coverage %. **Required-path coverage:** validation, permissions/RLS, state transitions, mappers, and any money/quantity math must be tested. UI logic (loading/empty/error states) is tested where non-trivial; pure presentation is not.

## 6. Green-before-done

A change is not "done" until the relevant `typecheck`/`lint`/`test` (+ RLS/isolation tests for DB changes) pass. See [`07_feature_workflow.md`](07_feature_workflow.md) Definition of Done and the [CI matrix](10_environment_and_cicd.md).
