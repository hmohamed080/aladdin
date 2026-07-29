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

Python 3.12+ · FastAPI · Uvicorn · Pydantic v2 · pydantic-settings · SQLAlchemy (typed read/query access) · OpenAI SDK · httpx · structlog · pytest. Dependency + venv management: **`uv` only** (no pip `requirements*.txt`, no Poetry).

## Database boundary (critical — see ADR-0002)

- **Supabase SQL migrations are the only schema source of truth.** SQLAlchemy may **map and query** tables created by those migrations.
- SQLAlchemy must **never** own or modify the shared schema. **No `Base.metadata.create_all()` in Staging/Production.** No Alembic.

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
- **Never run blocking AI, OCR, or document parsing directly in the request event loop.** Long-running work goes through the approved queue/worker path (Supabase Queues + Railway workers). Request handlers stay fast.

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
