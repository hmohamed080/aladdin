# 02 — Coding Standards & Naming Conventions

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering |
| **Last Updated** | 2026-08-01 |
| **Depends On** | Root [`AGENTS.md`](../../AGENTS.md) (Code style), [`../database/naming-conventions.md`](../database/naming-conventions.md) |
| **Related** | [`01_project_structure.md`](01_project_structure.md), [`03_api_standards.md`](03_api_standards.md) |

Covers **Coding Standards (3)** and **Naming Conventions (4)**. The universal rules live in root [`AGENTS.md`](../../AGENTS.md) "Code style (universal)"; this doc adds the language/stack specifics and the naming table.

## 1. Universal principles (from root AGENTS.md — do not re-litigate)

Small obvious functions over abstractions; no premature abstraction (extract on the 3rd real caller); no error handling for cases that can't happen (validate only at boundaries); no backwards-compat shims or speculative feature flags; comments explain **why**, not **what**; keep files focused.

## 2. TypeScript / React (web app)

- **TypeScript strict**; no `any` (use `unknown` + narrowing); no non-null `!` to silence the compiler — model the type.
- **Server Components by default**; add `"use client"` only when interactivity genuinely requires it ([`frontend/AGENTS.md`](../../frontend/AGENTS.md)).
- **Server Actions** for mutations; **Route Handlers** for webhooks/BFF only.
- Types derive from **Zod** schemas (`z.infer`) so validation and types can't drift.
- Never read `process.env` in components — use `lib/env`.
- No raw hex/px in UI — design-system **semantic tokens** only.
- Prefer pure functions + explicit inputs; keep components presentational, push data/logic to actions/queries/services.
- ESLint + TypeScript must be clean before "done".

## 3. Python / FastAPI (specialized service)

- **Python 3.12+**, type hints everywhere; **Pydantic v2** models at boundaries.
- **`ruff`** clean; small functions; async I/O for HTTP/DB/OpenAI/OCR.
- Never run blocking AI/OCR/parsing in the request loop — **enqueue** ([`09_background_jobs`](../technical/09_background_jobs.md)).
- Config via `app/config.py` only; never `os.getenv`/`load_dotenv`.
- Data access via `supabase-py`, preserving the caller JWT (RLS); `service_role` only for explicitly-authorized worker ops.

## 4. SQL / migrations

Follow [`../database/naming-conventions.md`](../database/naming-conventions.md) and [`08_database_migration_workflow.md`](08_database_migration_workflow.md). Plain SQL migrations; explicit `on delete`; every index intentional and justified.

## 5. Naming conventions (single reference)

| Thing | Convention | Example |
|---|---|---|
| TS variable/function | `camelCase` | `getPipeline`, `rfqItems` |
| TS type/interface/component | `PascalCase` | `QuoteDecision`, `PipelineBoard` |
| TS constant (true const) | `UPPER_SNAKE` | `MAX_PAGE_SIZE` |
| React component file | `PascalCase.tsx` | `QuoteComparisonCard.tsx` |
| Server Action | `camelCase` verb | `submitQuote`, `decideQuote` |
| Query function | `get*/list*/search*` | `getOrg`, `listMembers` |
| Zod schema | `<Thing>Schema` | `CreateProductSchema` |
| Feature folder | `kebab`/single word (domain) | `quotations`, `rfq` |
| Capability key | `dot.namespaced` | `catalog.publish`, `quote.decide` |
| DB table | `snake_case` plural | `rfq_requests`, `quote_items` |
| DB column | `snake_case` | `organization_id`, `created_at` |
| DB enum type | `<domain>_<thing>` | `verification_status` |
| Index / FK / unique | `ix_ / fk_ / uq_` | `ix_products_org`, `fk_quotes_rfq` |
| RLS policy | `<table>_<action>_<audience>` | `products_select_public` |
| Python module/func | `snake_case` | `verify_jwt`, `ocr_provider` |
| Python class | `PascalCase` | `OcrProvider` |
| Event | `PascalCase` past-tense | `QuoteAccepted` |
| Domain event/job payload key | `camelCase` | `organizationId` |
| Branch / commit type | `feat/fix/db/…` | see [`git-workflow`](../development/git-workflow.md) |
| Realtime channel | `<scope>:{id}` | `pipeline:{orgId}` |

**Prohibited names:** `Button2`, `NewX`, `UpdatedX`, `FinalX`, `XCopy`, `utils2`, version-suffixed identifiers ([`../../design/GOVERNANCE.md`](../../design/GOVERNANCE.md) new-component governance).

## 6. Copy / UX text

Never surface technical/implementation terms in user-facing UI ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", schema/stack jargon). Errors name the problem + recovery; strings are localizable (AR/EN).
