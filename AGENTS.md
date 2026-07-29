---
description: Universal source of truth for any AI coding agent working in the Aladdin repository.
alwaysApply: true
---

# Aladdin — Agent Instructions (root)

This file is the **universal source of truth** for any coding agent (Claude Code, Cursor, Codex, etc.) working in this repository. It is intentionally version-controlled documentation, not a scratchpad.

> **Before touching any file, read the root `AGENTS.md` and every applicable scoped `AGENTS.md` between the repository root and the target file.**

## Reading order (follow every time)

1. Read this root `AGENTS.md`.
2. Read the nearest scoped `AGENTS.md` for the files you are changing (`frontend/`, `backend/`, `supabase/`, `docs/`, `data/`, `UI-UX/`).
3. Read the relevant Architecture Decision Records in `docs/decisions/`.
4. Read the relevant product or feature specification in `docs/product/`.
5. Inspect existing tests and code conventions in the area you are touching.
6. Run validation (typecheck / lint / tests) **before** reporting completion.

### How the hierarchy composes

- Nested `AGENTS.md` files **extend** these root instructions with scope-specific detail.
- They **do not silently override** security, data-ownership, or architecture rules defined here or in an ADR.
- A genuine conflict must be **reported and resolved explicitly** — update the ADR or the scoped file; do not quietly follow the narrower rule.
- **Product and architecture decisions live in `docs/` and `docs/decisions/` (ADRs), not only inside chat prompts or an agent's memory.** If a decision only exists in a conversation, write it down before acting on it.

## The product

Aladdin is an **AI-first operating system / digital infrastructure** for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector. It is **B2B-first**, with a connected B2C consultation/discovery/project layer. Three surfaces: **B2C**, **B2B** (Sales is the key daily-active user), and **Admin**.

Core value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.** It is a **consultation-first** platform, **not** an add-to-cart / price-war marketplace. See `docs/product/mvp-scope.md`.

## Approved stack (Private Pilot MVP)

Locked. Do not replace without a documented blocking reason recorded in an ADR. Full rationale: `docs/decisions/ADR-0001-approved-architecture.md`.

- **Web app:** Next.js (App Router) · React · TypeScript (strict) · Tailwind · Radix/shadcn primitives · React Hook Form + Zod · next-intl · TanStack Table. Server Components by default; Server Actions for mutations; Route Handlers for webhooks/BFF/integrations. **No Vite. No React SPA. No React Router.**
- **Data platform:** Supabase — PostgreSQL · Auth · Storage · RLS · Realtime · Queues · FTS · pg_trgm · pgvector · PostGIS (where geo is required).
- **Schema source of truth:** Supabase SQL migrations (`supabase/migrations/*.sql`). **No Alembic. No `Base.metadata.create_all()` in Staging/Production.** See `docs/decisions/ADR-0002-database-migrations.md`.
- **Specialized service:** Python 3.12+ / FastAPI for AI orchestration, OCR, document processing, chunking, embeddings, RAG, evaluations, NLP, large-Excel processing, and background workers. **FastAPI is NOT the primary CRUD backend for the MVP.**
- **Hosting:** Next.js → Vercel · FastAPI + workers → Railway (portable Docker) · Postgres/Auth/Storage/Realtime → Supabase · LLM/embeddings → OpenAI · OCR candidate → Azure Document Intelligence · errors → Sentry. See `docs/decisions/ADR-0004-deployment-platforms.md`.

## Architectural style

**Modular monolith**, not premature microservices: one Next.js web app, one shared Supabase data platform, one specialized FastAPI AI/document service, background workers only where async processing is genuinely required. Keep module boundaries clean enough to extract a service later.

Do **not** introduce Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch/OpenSearch, event sourcing, CQRS frameworks, a service mesh, an API gateway, or additional databases unless an existing approved requirement makes it unavoidable. Record future scaling options in `docs/architecture/scaling-strategy.md` instead of building speculative infrastructure.

## Dependency policy

**Default: write it yourself. Reach for a library only when the alternative would be non-trivial, error-prone, or reinvention of a standard.** Every dependency is a liability — bundle size, supply-chain risk, upgrade work.

OK to depend on:
- Things genuinely hard to get right (HTTP clients, ASGI servers, SQL drivers, parsers, LLM SDKs, ORM, migrations, auth SDKs).
- The declared stack (Next.js, React, Supabase clients, FastAPI, Pydantic, SQLAlchemy, OpenAI SDK, etc.).

Not OK:
- Helper libraries that wrap 5–20 lines of stdlib or platform APIs.
- Frameworks where a function would do.
- "Nicer API" layers on top of an already-present dependency.

Before adding a runtime dependency, answer in the commit message:
1. What exact problem does it solve that we can't write in <30 lines of clear code?
2. Why are platform APIs or an existing dependency insufficient?
3. How often will it be used?
4. Is it actively maintained?
5. What is its transitive-dependency footprint?
6. Is it appropriate for the six-week MVP?

**Package managers:** `pnpm` only for Node, `uv` only for Python. Do not create `package-lock.json`, `yarn.lock`, or pip `requirements*.txt` alongside `uv` without a documented compatibility reason. Per-stack specifics live in `frontend/AGENTS.md` and `backend/AGENTS.md`.

## Configuration discipline

A single settings module is the source of truth for environment per service: `frontend/src/lib/env/` (validated) and `backend/app/config.py` (Pydantic Settings). Do **not** call `os.getenv` / read `process.env` directly in application code. Do **not** call `load_dotenv` anywhere. If a third-party SDK reads env vars directly, mirror them in the settings module — don't sprinkle `setdefault` elsewhere.

Fail fast on startup if required config is missing. No silent fallbacks that hide real config errors, and **no defaults for security-sensitive values**. Every service ships a `.env.example` documenting each variable's purpose, exposure level (public/secret), and required/optional status. Real `.env` files are never committed.

## Security baseline (non-negotiable)

- **RLS is mandatory** for user, organization, verification, sales, project, file, and AI data.
- **Service-role credentials never enter browser/client code.** Only public, prefixed, validated variables reach the client.
- Every FastAPI request authenticates the Supabase JWT. Never trust a `user_id` / `organization_id` from a request body without validating it against the authenticated session and permissions.
- **AI retrieval must apply authorization filters before returning content** — vector search must never leak documents across organizations.
- No secrets, credentials, customer data, or private design files in Git history. See `docs/security/`.

## Code style (universal)

- **Small, obvious functions.** A 15-line function with clear names beats a three-class abstraction.
- **No premature abstraction.** Three similar lines beat a badly-named base class. Extract on the third real caller, not a hypothetical one.
- **No error handling for cases that can't happen.** Trust internal callers and framework guarantees. Validate only at boundaries: HTTP input, external APIs, DB writes, untrusted parsing.
- **No backwards-compat shims** unless explicitly asked for.
- **No feature flags** added speculatively.
- **Comments** explain *why* when non-obvious, never *what*. Remove stale TODOs.
- **Keep files focused.** Prefer small modules.

## Git discipline

After any meaningful change: stage the relevant files and commit immediately — do not batch unrelated changes. Every commit message answers **WHAT** changed and **WHY**:

```
<type>: <what changed — short, specific, imperative>

Why: <the reason or intent behind this change>
```

Types: `feat` · `fix` · `db` · `deploy` · `test` · `refactor` · `style` · `docs` · `chore`. Never commit with just `fix`/`update`/`changes`. Never commit broken code; use a `wip:` prefix with a note if work is genuinely incomplete. No meaningful change should remain uncommitted at the end of a session.

## Definition of done

Do not report a task complete until: the relevant typecheck/lint/tests pass, the change respects the security baseline, docs/ADRs are updated if a decision changed, and `git status` contains only intentional changes.
