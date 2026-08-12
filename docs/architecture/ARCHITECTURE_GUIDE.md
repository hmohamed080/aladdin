# Architecture Guide

<!-- CANONICAL PROJECT MEMORY — the currently active architecture. Read before any code or infra change. -->

| | |
|---|---|
| **Status** | Living document (canonical project memory) |
| **Version** | Living (canonical) · rev 2026-08-01 |
| **Owner** | Architecture |
| **Last updated** | 2026-07-30 |
| **Scope** | The **currently active** architecture of Aladdin — what is decided and in effect right now. |
| **Authority** | Authoritative for the current architecture state. It **does not replace ADRs**: [ADRs](../decisions/) explain *why* a decision was made and are append-only; this guide explains *what is active now* and is updated continuously. On conflict, the newest **Accepted** ADR wins and this guide must be reconciled to it. |
| **Update triggers** | Any change to module boundaries, data ownership, the multi-tenancy/identity/authorization model, migration ownership, the data-access approach, deployment targets, or the non-goals list. Every such change also updates an ADR, `RUNTIME_STATE.md`, and `AGENT_WORK_LOG.md`. |

This is **core architecture**, not optional documentation.

## Current Architecture Summary
Aladdin is a **modular monolith** built from four cooperating parts (ADR-0001):

1. **Web application** — Next.js (App Router) · React · TypeScript strict · Tailwind. The primary product surface and the primary CRUD path against Supabase.
2. **Data platform** — Supabase: PostgreSQL, Auth, Storage, RLS, Realtime, Queues, FTS, `pg_trgm`, `pgvector`, PostGIS.
3. **Specialized service** — Python 3.12+ / FastAPI for AI, OCR, RAG, documents, chunking, embeddings, evaluations, NLP, large-Excel, and workers. **Not** the CRUD backend.
4. **Background workers** — only where asynchronous processing is genuinely required.

As of 2026-07-30 the foundation is **scaffolded**: services build and pass their checks; **no product features, tables, or production connections exist yet.**

## Modular-Monolith Decision
One well-structured monolith with clean module boundaries — not premature microservices (ADR-0001). Module boundaries are kept clean enough that a domain can be **extracted later** without a rewrite, but nothing is extracted speculatively. See [Scalability Stages](#scalability-stages--extraction-triggers).

## Web Application Responsibilities
- All standard product CRUD and user-facing flows: Server Components by default, Server Actions for mutations, Route Handlers for webhooks/BFF/integrations.
- Talks to Supabase via **`supabase-js`**, preserving the authenticated user's JWT so **RLS is the enforcement layer**.
- Owns i18n (AR-RTL / EN-LTR), theming (light/dark), and PWA/responsive behavior.
- Holds no service-role secret in client code — only validated `NEXT_PUBLIC_*` values reach the browser.

## Design System (frontend)

The Aladdin Design System — **"The Aperture"** — is part of the architecture, not incidental styling. It is **finalized and semantically versioned** (`1.0.0`, approved/hardened, pre-feature):

- **Authority chain:** [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) → root [`../../DESIGN.md`](../../DESIGN.md) → [`../../design/tokens/*.json`](../../design/tokens/) (canonical machine tokens) → [`../../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md) → `UI-UX/design.pen` → frontend CSS variables + Tailwind config.
- **Governance:** [`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md) (versioning, synchronization, component & AI-agent rules); changelog [`../../design/CHANGELOG.md`](../../design/CHANGELOG.md).
- **Implementation:** `frontend/src/styles/tokens.css` (CSS vars, light/dark), `frontend/tailwind.config.ts` (theme), `next/font` in `frontend/src/app/layout.tsx`. Frontend code consumes **semantic** tokens; it never invents values outside the canonical tokens.

Token/brand changes follow the design-system edit-order (token JSON first) and update the design-system memory files in the same change — analogous to the [Architecture-Change Process](#architecture-change-process) for architecture.

## FastAPI Service Responsibilities
- **Specialized workloads only:** AI orchestration, OCR, document processing/chunking, embeddings, RAG, AI evaluations, NLP, large-Excel processing, and background/queue handlers.
- **Does not recreate application CRUD.** If a feature can be a Server Action / Route Handler against Supabase, it belongs in the web app, not here.
- Talks to Supabase/Postgres via **`supabase-py`** (see [Python Data-Access Decision](#python-data-access-decision)).
- Verifies the Supabase JWT on every request and derives identity from the token.

## Supabase Platform Responsibilities
- **PostgreSQL** — the single shared database and the system of record.
- **Auth** — passwordless identity (WhatsApp OTP / Email OTP), JWT issuance.
- **Storage** — files/documents with storage policies.
- **RLS** — the tenant-isolation spine for all tenant/user/verification/sales/project/file/AI data.
- **Realtime** — live status streams (see [Realtime Responsibilities](#realtime-responsibilities)).
- **Queues** — background-job hand-off (see [Queue / Background-Job Responsibilities](#queue--background-job-responsibilities)).
- **Extensions** — FTS, `pg_trgm`, `pgvector`, PostGIS, `pgcrypto` (installed via the extensions migration).

## Module Boundaries
- The web app is organized by **feature/domain** modules; the FastAPI service is organized by **capability** modules (`ai`, `retrieval`, `documents`, `ocr`, `ingestion`, `embeddings`, `workers`, plus cross-cutting `auth`, `database`, `schemas`, `security`, `observability`).
- Cross-module access goes through explicit interfaces, not reach-ins. Shared truth is the database schema (owned by migrations), not shared in-process state.
- The web↔FastAPI boundary is an authenticated HTTP boundary; neither shares a process or an ORM with the other.

## Data Ownership
- **The database schema is owned exclusively by `supabase/migrations/*.sql`** (ADR-0002). No application component — JS or Python — creates or alters schema.
- The web app owns user-facing CRUD; the FastAPI service owns derived/AI artifacts (embeddings, extractions, evaluations) it writes back through the same RLS-governed tables.
- No second database. No per-service private schema unless a future ADR introduces one.

## Multi-Tenancy Model
- The **tenant unit is the organization**, with **branch** scoping where applicable.
- **RLS is the isolation spine** — cross-tenant data must never leak in UI, API, worker, or AI retrieval.
- Tenancy attaches to the canonical identity via organization membership + branch assignment; it does not fork the account. One user may hold **zero, one, or many** memberships on the same identity, and a personal (organization-less) account is fully valid.

## Identity & Authorization Model
- **One person = one user ID.** One canonical identity per person (passwordless; WhatsApp/Email OTP); creating or joining another business never creates a second auth user. A business is an **Organization**, never a second account. See the [Product Direction Guide](../product/PRODUCT_DIRECTION_GUIDE.md) *Canonical Identity Model*, *Personal Identity Is Not a Business*, and *Switching*.
- **One current primary account type** at a time — **no persona/profile switcher**. What a user can see/do is **derived** from primary account type, organization membership, branch assignment, permission capabilities, verification state, and subscription state.
- **Work context ≠ identity.** Switching the active work context between the personal surface (User+Profile) and an organization where the same user holds an **active membership** (Organization+Membership) is allowed and is *not* persona switching. Both workspaces are **derived** — there is no `workspaces` table.
- **No duplicated identity.** Personal identity lives in `users`/`profiles`, business identity in `organizations`, and the relationship in `memberships`; neither side is copied into the other as a second source of truth (onboarding drafts excepted, until commit).
- **Authorization is enforced server-side** (RLS + explicit permission checks). The UI never implies access it cannot grant. Identity is always derived from the verified JWT, never from a request body.

## RLS Strategy
- RLS is **mandatory** on every tenant/user/verification/sales/project/file/AI table; every policy ships with tests (pgTAP + isolation tests).
- Policies are SQL and version as migrations alongside the tables they protect.
- Service-role access **bypasses RLS** and is therefore restricted to trusted internal workers and explicitly authorized operations only. Detail: [`../security/rls-strategy.md`](../security/rls-strategy.md).

## Storage Security
- Supabase Storage buckets are governed by storage policies (also SQL migrations).
- Private design IP (`.pen`) and customer documents never enter Git; document access is authorized per-organization the same way row data is.

## Realtime Responsibilities
Supabase Realtime carries live status for: notifications, opportunity/pipeline status, task updates, verification status, project activity, inventory availability, and quotation status. Realtime is a delivery channel, not a source of truth — the database remains authoritative.

## Queue / Background-Job Responsibilities
- Heavy/slow/external work runs **off the request path** via Supabase Queues + Railway workers: OCR, embeddings, document chunking, Excel imports, PDF/document generation, email + operational WhatsApp delivery, and expensive analytics refreshes.
- Request handlers stay fast; the UI reflects progress via Realtime. Never run blocking AI/OCR/parsing in a request event loop.

## AI, OCR, RAG & Embedding Boundaries
- All of these live in the **FastAPI service**, not the web app.
- **Retrieval applies authorization filters before returning content** — vector/document search must never cross organizations.
- AI **drafts, explains, and ranks; it never auto-sends** or takes irreversible action without human review.
- Embeddings/extractions are persisted through RLS-governed tables owned by migrations.

## Database Migration Ownership
- **`supabase/migrations/*.sql` is the only schema source of truth** (ADR-0002). Every change is a new, ordered SQL migration reviewed as a concrete artifact (tables, policies, grants, indexes).
- **No Alembic. No `Base.metadata.create_all()` in Staging/Production.** Production schema is never changed by hand once the migration workflow is established.

## Python Data-Access Decision
Current decision (ADR-0005, refining ADR-0002 for the Private Pilot MVP):

- **Next.js uses `supabase-js`; FastAPI and trusted Python workers use `supabase-py`.**
- Complex database operations use **PostgreSQL functions / RPC** where appropriate.
- **User-facing operations preserve the authenticated user JWT and RLS context.** Service-role access is restricted to trusted internal workers and explicitly authorized operations.
- **SQLAlchemy is deferred** until an evidenced requirement exists; it is **not** a current dependency. **Alembic remains prohibited** for the shared Supabase database.
- If a future need for typed SQL composition / connection pooling is evidenced, **SQLAlchemy Core** (not the ORM, never Alembic) may be reconsidered via a new ADR. Migration path and triggers are in [ADR-0005](../decisions/ADR-0005-python-data-access.md).

## Environment / Configuration Model
- One validated settings module per service is the **only** config source: `frontend/src/lib/env/` (Zod-validated) and `backend/app/config.py` (Pydantic Settings).
- **Never** read `process.env` / `os.getenv` in application code; **never** call `load_dotenv`.
- **Fail fast** on missing required config; **no silent defaults for secrets**. Each service ships a `.env.example`. Real `.env` files are never committed. Detail: [`../security/secrets-and-environments.md`](../security/secrets-and-environments.md).

## Deployment Targets
- **Vercel** — Next.js web app.
- **Railway** — FastAPI service + workers (portable Docker).
- **Supabase** — Postgres/Auth/Storage/Realtime/Queues.
- **OpenAI** — LLM/embeddings. **Azure Document Intelligence** — OCR candidate. **Sentry** — error tracking.

Staging precedes Production; migrations are backward-compatible. Detail: [ADR-0004](../decisions/ADR-0004-deployment-platforms.md) · [`../operations/deployment-overview.md`](../operations/deployment-overview.md).

## Observability
Structured logging (`structlog` in FastAPI), Sentry for errors across web + service, and health endpoints (`/api/health` web, `/health` FastAPI). Detail: [`../operations/monitoring-and-observability.md`](../operations/monitoring-and-observability.md).

## Performance Strategy
- **Postgres-first** search/analytics (FTS / `pg_trgm` / `pgvector`); expensive aggregations refresh asynchronously.
- Server-side pagination/sort/filter for large sets; never fetch unbounded rows.
- Long/expensive work is queued, not run inline; the UI stays responsive with live status.

## Scalability Stages & Extraction Triggers
Ship the monolith; move to the next rung only against **measured** need:
1. **Now** — modular monolith on the approved stack.
2. **Vertical scaling + Postgres tuning** — indexes, read patterns, connection management.
3. **Worker scale-out** — more Railway workers behind Supabase Queues for AI/OCR/import load.
4. **Service extraction** — extract a domain **only** when a measured bottleneck or team-scaling need justifies it, using the clean module boundaries already in place.

Options are documented, not pre-built. Detail: [`scaling-strategy.md`](./scaling-strategy.md).

## Explicit Non-Goals
No Kubernetes, Kafka, RabbitMQ, Redis, Elasticsearch/OpenSearch, event sourcing, CQRS frameworks, service mesh, API gateway, or additional databases — unless an existing approved requirement makes it unavoidable and a new ADR records it. No Vite / React SPA / React Router. No Alembic. No second CRUD backend in FastAPI.

## ADR Index
- [ADR-0001 — Approved Architecture](../decisions/ADR-0001-approved-architecture.md)
- [ADR-0002 — Database Migrations (Supabase SQL is the only source of truth)](../decisions/ADR-0002-database-migrations.md)
- [ADR-0003 — Agent-Instruction Hierarchy](../decisions/ADR-0003-agent-instruction-hierarchy.md)
- [ADR-0004 — Deployment Platforms](../decisions/ADR-0004-deployment-platforms.md)
- [ADR-0005 — Python Data Access (supabase-py; SQLAlchemy deferred)](../decisions/ADR-0005-python-data-access.md)

## Architecture-Change Process
Every architecture change must, in the same session:
1. Be recorded in an **ADR** (new, or a new ADR that supersedes an old one — ADRs are append-only).
2. Update this **ARCHITECTURE_GUIDE.md**.
3. Update **`../operations/RUNTIME_STATE.md`**.
4. Be recorded in **`../operations/AGENT_WORK_LOG.md`**.
5. Update relevant **`AGENTS.md`** files and service documentation.
6. Include **validation results** (the commands run and their outcomes).

## Architecture Change History
Newest first.

### 2026-08-01 — Design System finalized & hardened (v1.0.0)
- **What:** Recorded the versioned Aladdin Design System ("The Aperture") as part of the architecture: added the *Design System (frontend)* section and the authority chain (`DESIGN.md` → `design/tokens/*.json` → `UI_UX_SYSTEM_GUIDE.md` → `design.pen` → frontend). Canonical machine tokens, governance, component inventory, and icon policy added under `design/`.
- **Why:** The token/brand system is durable architecture; agents must consume canonical tokens rather than invent values. **No product feature, table, or connection was added.**

### 2026-07-30 — Architecture guide created; Python data access reconciled
- **What:** Created this current-state architecture guide. Reconciled the Python data-access approach to **`supabase-py`** and **deferred SQLAlchemy** (new ADR-0005 refining ADR-0002); SQLAlchemy removed from the backend scaffold as an unused dependency.
- **Why:** Give agents a single current-state reference distinct from the ADRs, and align the backend with the Private Pilot MVP data-access decision.
- **Validation:** see `AGENT_WORK_LOG.md` entry for 2026-07-30.

### 2026-07-29 — Foundation architecture accepted
- **What:** ADR-0001…0004 accepted; modular-monolith foundation scaffolded (Next.js + Supabase + specialized FastAPI + workers).
- **Why:** Stop re-deciding the stack per task; establish the isolation and migration spine before features.

## Related files
[`../engineering/README.md`](../engineering/README.md) (engineering standards) · [`../development/git-workflow.md`](../development/git-workflow.md) · [`overview.md`](./overview.md) · [`system-context.md`](./system-context.md) · [`module-boundaries.md`](./module-boundaries.md) · [`data-flow.md`](./data-flow.md) · [`realtime-and-background-jobs.md`](./realtime-and-background-jobs.md) · [`scaling-strategy.md`](./scaling-strategy.md) · [`../product/PRODUCT_DIRECTION_GUIDE.md`](../product/PRODUCT_DIRECTION_GUIDE.md) · [`../../AGENTS.md`](../../AGENTS.md)
