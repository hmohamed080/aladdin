---
description: Scoped agent instructions for the Aladdin specialized FastAPI AI/document service.
alwaysApply: true
---

# Backend — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `backend/`.

## Scope (read this before adding anything)

FastAPI here is a **specialized service**, not the product's CRUD backend. It exists for: AI orchestration, OCR orchestration, document processing, chunking, embeddings, RAG, AI evaluations, NLP, large-Excel processing, background workers, and future computer-vision tasks.

**Do not recreate application CRUD routes in FastAPI.** Standard product CRUD lives in the Next.js app against Supabase. If a feature can be a Server Action / Route Handler against Supabase, it does not belong here.

## Stack (locked — see ADR-0001)

Python 3.12+ · FastAPI · Uvicorn · Pydantic v2 · pydantic-settings · **`supabase-py`** (data access) · OpenAI SDK · httpx · structlog · pytest. Dependency + venv management: **`uv` only** (no pip `requirements*.txt`, no Poetry). **SQLAlchemy is deferred** (not a dependency) — see ADR-0005.

## Database boundary (critical — see ADR-0002)

- **Supabase SQL migrations are the only schema source of truth.** Python data access is via **`supabase-py`** (ADR-0005): user-facing operations preserve the caller's JWT so **RLS applies**; service-role access is limited to trusted workers and explicitly authorized operations. Complex operations use PostgreSQL functions/RPC.
- No Python component may **own or modify** the shared schema. **No `Base.metadata.create_all()` in Staging/Production.** No Alembic. **SQLAlchemy is deferred** until an evidenced need (ADR-0005); if reintroduced it would be Core, read-only, mapping migration-owned tables — never creating them.

## Organization

```
app/
  main.py          # app factory + router wiring, health, middleware
  config.py        # THE settings module (pydantic-settings) — see below
  api/v1/          # versioned specialized endpoints
  auth/            # Supabase JWT verification, dependency injection of the caller
  ai/  retrieval/  documents/  ocr/  ingestion/  embeddings/   # capability modules
  workers/         # background/queue job handlers
  database/  schemas/  security/  observability/
tests/
```

## Configuration

- `app/config.py` is the **only** settings source (Pydantic Settings). **Never** call `os.getenv` or `load_dotenv` in application modules.
- Fail fast when required variables are missing. **No silent defaults for security-sensitive config.**

## Async & workloads

- Use async I/O for HTTP, database, storage, OpenAI, and OCR providers.
- **Never run blocking AI, OCR, or document parsing directly in the request event loop.** Long-running work goes through the approved queue/worker path (Supabase Queues + Python workers; no worker is implemented yet and its host is undecided — see `../docs/decisions/ADR-0009-vercel-services-deployment.md`). Request handlers stay fast.
- **This service is deployed as the `backend` Vercel Service** (root `vercel.json`, entrypoint `app/main.py`), reachable same-origin at **`/api/backend`**. New routes are addressed under that prefix, and the service is still called **only from the server side of the web app, never the browser**.

## Security (extends root baseline)

- **Every request authenticates the Supabase JWT.** Reject unauthenticated calls.
- **Never trust `user_id` / `organization_id` from the request body** — derive identity from the verified token and check permissions.
- **AI retrieval applies authorization filters before returning content**; vector search must never leak documents across organizations.
- Service-role credentials live only in this trusted server, never in client code.

## Testing

pytest with: unit tests, API tests (httpx client), retrieval tests, OCR-parsing tests, **authorization tests**, and AI structured-output validation. Provide at minimum a health/config test. No placeholder tests.

## Commands

```bash
uv sync                     # install/lock deps
uv run uvicorn app.main:app --reload
uv run pytest
uv run ruff check .
```
