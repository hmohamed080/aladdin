# Aladdin

**AI-first operating system for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector.** B2B-first, with a connected B2C consultation/discovery/project layer. Consultation-first — **not** an add-to-cart / price-war marketplace.

Value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.** Three surfaces: B2C, B2B (Sales is the key daily-active user), Admin.

## Private Pilot MVP goal

Ship the core value journey with **Sales-first sequencing** (05C → 05A → 05B → 05D → 05E). Full scope and ordering: [`docs/product/mvp-scope.md`](docs/product/mvp-scope.md).

> **Status:** Architecture foundation established. **No product features are implemented yet.** Authentication, catalog, sales, RFQ, quotations, projects, and AI features are scaffolded as boundaries only. See [Current status](#current-status).

## Approved stack

| Layer | Choice |
|---|---|
| Web app | Next.js (App Router), React, TypeScript strict, Tailwind, Radix/shadcn, RHF+Zod, next-intl |
| Data platform | Supabase — Postgres, Auth, Storage, RLS, Realtime, Queues, FTS, pg_trgm, pgvector, PostGIS |
| Schema source of truth | Supabase SQL migrations (`supabase/migrations/*.sql`) — **no Alembic** |
| Specialized service | Python 3.12+ / FastAPI — AI, OCR, RAG, documents, embeddings, workers (**not** the CRUD backend) |
| Hosting | Vercel (web) · Railway (FastAPI + workers, Docker) · Supabase (data) · OpenAI · Sentry |

Rationale is recorded in ADRs: [ADR-0001](docs/decisions/ADR-0001-approved-architecture.md) · [ADR-0002](docs/decisions/ADR-0002-database-migrations.md) · [ADR-0003](docs/decisions/ADR-0003-agent-instruction-hierarchy.md) · [ADR-0004](docs/decisions/ADR-0004-deployment-platforms.md).

## Architecture overview

A **modular monolith**: one Next.js web app, one Supabase data platform, one specialized FastAPI service, background workers where needed. Full picture: [`docs/architecture/overview.md`](docs/architecture/overview.md).

## Repository structure

```
aladdin/
├── AGENTS.md              # universal agent/coding rules (+ scoped AGENTS.md per area)
├── frontend/             # Next.js App Router web app (pnpm)
├── backend/              # specialized FastAPI AI/document service (uv)
├── supabase/             # migrations (schema source of truth), seed, tests, config
├── assets/brand/         # canonical brand source assets
├── data/                 # local dev data (templates/seed/samples/imports)
├── docs/                 # architecture, product, decisions (ADRs), database, security, operations, guides
├── agents/               # reusable agent personas (source material, not authoritative)
├── scripts/              # repo scripts
└── UI-UX/                # Pencil design files (gitignored; design.pen is canonical)
```

## Prerequisites

- Node.js ≥ 20 and **pnpm ≥ 9**
- Python ≥ 3.12 and **uv**
- Docker (Supabase local stack + backend container)

## Local setup

```bash
# 1. Install Node deps (pnpm workspace) + the Supabase CLI
pnpm install

# 2. Start the Supabase local stack (Docker)
pnpm supabase start
pnpm supabase db reset            # apply migrations + seed

# 3. Backend (specialized FastAPI service)
cd backend && uv sync && cp .env.example .env && cd ..

# 4. Frontend env
cp frontend/.env.example frontend/.env.local
# put the local Supabase URL + anon key (from `pnpm supabase status`) into both env files
```

Detailed guides: [frontend](docs/guides/frontend-setup.md) · [backend](docs/guides/backend-setup.md) · [supabase](docs/guides/supabase-setup.md). Environment rules: [`docs/security/secrets-and-environments.md`](docs/security/secrets-and-environments.md).

## Running

```bash
pnpm --filter frontend dev                        # web app → http://localhost:3000
cd backend && uv run uvicorn app.main:app --reload # API → http://localhost:8000/health
```

## Tests

```bash
pnpm --filter frontend typecheck && pnpm --filter frontend lint && pnpm --filter frontend test
cd backend && uv run pytest && uv run ruff check .
pnpm supabase db lint                              # migration lint (RLS/isolation tests once tables exist)
```

## Migration workflow

Supabase SQL migrations are the **only** schema source of truth (ADR-0002).

```bash
pnpm supabase migration new <descriptive_name>   # new supabase/migrations/*.sql
pnpm supabase db reset                            # re-apply all migrations + seed locally
```

Never edit Production schema by hand; never use Alembic or `Base.metadata.create_all()` in Staging/Production. Details: [`docs/database/migration-strategy.md`](docs/database/migration-strategy.md).

## Agent-instruction reading order

1. Root [`AGENTS.md`](AGENTS.md) → 2. nearest scoped `AGENTS.md` → 3. relevant [ADRs](docs/decisions/) → 4. relevant [product spec](docs/product/) → 5. existing tests/conventions → 6. run validation before reporting done.

> Before touching any file, read the root `AGENTS.md` and every applicable scoped `AGENTS.md` between the repo root and the target file.

## Security rules (must-read)

- RLS is mandatory on tenant/user/verification/sales/project/file/AI data; every policy needs tests.
- Service-role and other server secrets never reach the browser; only validated `NEXT_PUBLIC_*` vars do.
- FastAPI verifies the Supabase JWT and derives identity from the token, never the request body.
- AI retrieval applies authorization filters before returning content (no cross-org leakage).

Full model: [`docs/security/security-model.md`](docs/security/security-model.md).

## Deployment overview

Vercel (web) · Railway (FastAPI + workers, Docker) · Supabase (data) · Sentry (errors). Staging before Production; backward-compatible migrations. Details: [`docs/operations/deployment-overview.md`](docs/operations/deployment-overview.md).

## Current status

**Implemented:** repository architecture foundation — AGENTS hierarchy, ADRs, docs, Next.js scaffold (typecheck/lint/tests green), FastAPI scaffold (health + config tests), Supabase migrations/seed/test structure, env examples, CI-ready validation commands.

**Not implemented yet:** Authentication, Onboarding/Profiles, Catalog, Inventory, Sales workflow, RFQ, Quotations, Projects, Notifications, Advertisements, Analytics, Admin, and AI product features. Production connections and the CI/CD pipeline are also deferred.

## Design files

`UI-UX/design.pen` is the canonical Pencil design (gitignored, private IP). Coding tasks must never edit `.pen` files. See [`UI-UX/AGENTS.md`](UI-UX/AGENTS.md).
