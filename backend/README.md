# Aladdin Backend

Specialized Python/FastAPI service for AI, OCR, RAG, documents, embeddings, and workers. **Not** the product CRUD backend. Read `backend/AGENTS.md` first.

## Quick start

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn app.main:app --reload   # http://localhost:8000
curl http://localhost:8000/health
```

## Scripts

| Command | Purpose |
|---|---|
| `uv sync` | Create `.venv`, install locked deps |
| `uv run uvicorn app.main:app --reload` | Dev server |
| `uv run pytest` | Tests (health + config) |
| `uv run ruff check .` | Lint |
| `docker build -t aladdin-backend .` | Container build |

## Layout

- `app/main.py` — app factory + router wiring
- `app/config.py` — the only settings source (Pydantic Settings)
- `app/api/v1/` — versioned endpoints (`health.py` today)
- `app/{ai,retrieval,documents,ocr,ingestion,embeddings,workers}` — capability modules (interfaces only so far)
- `app/{auth,database,schemas,security,observability}` — cross-cutting
- `tests/` — pytest

See `backend/AGENTS.md` and `docs/architecture/`.
