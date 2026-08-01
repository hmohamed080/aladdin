# 01 — Project Structure, Layers & Dependency Injection

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../architecture/module-boundaries.md`](../architecture/module-boundaries.md), [`../../frontend/AGENTS.md`](../../frontend/AGENTS.md), [`../../backend/AGENTS.md`](../../backend/AGENTS.md) |
| **Related** | [`02_coding_standards.md`](02_coding_standards.md), [`03_api_standards.md`](03_api_standards.md) |

Covers **Feature Folder Structure (1)**, **Layer Responsibilities (2)**, and **Dependency-Injection Strategy (21)**. Extends [`module-boundaries.md`](../architecture/module-boundaries.md) — does not restate it.

## 1. Feature folder structure (web app)

Organize **by product domain, not file type** ([`frontend/AGENTS.md`](../../frontend/AGENTS.md)). Each feature module is self-contained:

```
frontend/src/features/<domain>/
  components/     # UI (server + "use client" islands) for this domain
  actions/        # Server Actions (mutations) — the write API
  queries/        # typed read functions (RSC data loading)
  schemas/        # Zod schemas (shared client+server validation)
  types.ts        # domain types (derived from schemas where possible)
  mappers/        # DB row <-> domain/DTO mapping
  constants.ts
  __tests__/      # unit/component tests for this domain
```

`<domain>` ∈ `auth · accounts · organizations · verification · catalog · inventory · sales · rfq · quotations · projects · notifications · advertisements · analytics · admin · ai` (+ cross-cutting `conversations`, `subscriptions`).

**Shared layers** (`frontend/src/lib/*`, `frontend/src/server/*`) hold cross-cutting concerns only: `env`, `supabase`, `auth`, `i18n`, `permissions`, `validation`, `observability`; `server/{actions,queries,authorization,integrations}`. **Code moves to shared only after a genuine second consumer** — never preemptively.

**`app/`** holds routes only: compose screens, load route data, route-level authz. Page/layout files stay thin.

Rules:
- Features **do not import each other's internals**; they collaborate through shared `server/` services or the database.
- No global `components/`, `hooks/`, `utils/`, `services/` junk-drawers.
- UI consumes design-system **semantic tokens** ([`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md)); never raw values.

## 2. Backend capability structure (FastAPI service)

Bounded by **capability, not feature** ([`backend/AGENTS.md`](../../backend/AGENTS.md)):

```
backend/app/
  main.py         # app factory, router wiring, health, middleware
  config.py       # the settings module (pydantic-settings)
  api/v1/         # versioned specialized endpoints
  auth/           # Supabase JWT verification + caller dependency
  ai/ retrieval/ documents/ ocr/ ingestion/ embeddings/   # capabilities
  workers/        # queue/background handlers
  database/ schemas/ security/ observability/
tests/
```

The FastAPI service is **specialized only** (AI/OCR/RAG/documents/large-Excel/workers) — it **never** recreates product CRUD (that is the web app against Supabase).

## 3. Layer responsibilities

| Layer | Owns | Must not |
|---|---|---|
| **Route (`app/`)** | compose screen, load route data, route-level authz | hold business logic |
| **Component** | rendering, local UI state, accessibility, RTL/theme | data access, business rules |
| **Server Action** | validate input (Zod) → authorize (capability) → mutate via service/`supabase-js` → emit event → return typed result | run heavy AI/OCR inline (enqueue instead) |
| **Query** | typed reads via `supabase-js` (RLS enforced), pagination | mutate |
| **Schema (Zod)** | the single validation contract (client+server) | — |
| **Mapper** | DB row ↔ domain/DTO translation | business rules |
| **Shared `server/` service** | cross-feature logic reused by ≥2 features | feature-specific rules |
| **DB (migrations + RLS)** | schema + the authorization guarantee | — |
| **FastAPI capability** | specialized compute; verify JWT; write derived artifacts via `supabase-py` | product CRUD |
| **Worker** | idempotent async jobs off the request path | run in the web request loop |

Data-flow for a mutation: **Component → Server Action → (authorize) → shared service/DB → event → Realtime/worker**. Reads: **RSC → query → DB (RLS)**.

## 4. Dependency-injection strategy

Aladdin uses **lightweight, explicit DI** — no heavy DI framework (dependency policy: prefer functions over frameworks).

- **Web app:** dependencies are **passed explicitly** or resolved through the validated singletons in `lib/*` (e.g. the Supabase client factory in `lib/supabase`, config in `lib/env`). Server Actions/services receive the request-scoped Supabase client (carrying the user JWT) rather than importing a global. No hidden globals; no service-role clients in feature code.
- **FastAPI:** use **FastAPI's built-in `Depends`** for request-scoped dependencies — the authenticated caller (from JWT verification), the Supabase client, config, and provider **adapters** ([`13_integrations.md`](../technical/13_integrations.md) adapter map: `LlmProvider`, `OcrProvider`, `EmailProvider`, `WhatsAppProvider`, `StorageProvider`). Endpoints/handlers depend on the **adapter interface**, never a concrete vendor — this is what keeps "candidate/OPEN" providers swappable.
- **Config** is injected from the single settings module per service; never read `process.env`/`os.getenv` in app code.
- **Testing:** dependencies are overridable (FastAPI `dependency_overrides`; explicit params in the web app) so tests inject fakes without patching globals.

**Rule:** depend on **interfaces and injected clients**, not module-level singletons or vendors. New shared abstractions require a real second consumer.
