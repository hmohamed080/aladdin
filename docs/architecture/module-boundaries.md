# Module Boundaries

**Status:** Living document · 2026-07-29

## Purpose

Define the internal seams of the modular monolith so features stay decoupled and a service could be extracted later without a rewrite.

## Current decision

**Frontend feature modules** (`frontend/src/features/<domain>/`) are the primary unit of decomposition — organized by **product domain, not technical file type**. Each owns its components, schemas, types, server actions, queries, tests, constants, and mappers:

`auth · accounts · organizations · verification · catalog · inventory · sales · rfq · quotations · projects · notifications · advertisements · analytics · admin · ai`

**Shared layers** (`frontend/src/lib/*`, `frontend/src/server/*`) hold cross-cutting concerns: env, supabase client, auth, i18n, permissions, validation, observability; server actions/queries/authorization/integrations. Code moves here only after a **genuine second consumer**.

**Backend capability modules** (`backend/app/`) are bounded by capability, not feature: `ai · retrieval · documents · ocr · ingestion · embeddings · workers`, plus `auth · database · schemas · security · observability`.

**Boundary rules:**
- Features do not import each other's internals; they communicate through shared `server/` services or the database.
- The FastAPI service is reached only via authenticated server-side calls, never directly from the browser.
- The database schema is owned by Supabase migrations; no module creates schema.

## Rationale

Domain-oriented modules keep related logic together and make ownership obvious, which is what lets a monolith scale organizationally and lets a domain later become its own service.

## Scope

Internal structure of the web app and FastAPI service.

## What is deferred

Any actual service extraction (documented as an option in `scaling-strategy.md`).

## Consequences

Reviewers reject cross-feature imports and "junk-drawer" global folders. New shared code requires a second real consumer.

## Related files

`overview.md` · `data-flow.md` · `frontend/AGENTS.md` · `backend/AGENTS.md`
