# Backend Setup

The specialized AI/document service is a Python 3.12+ / FastAPI app managed with **uv**. See `backend/AGENTS.md` for scope and rules.

## Prerequisites

- Python ≥ 3.12
- uv (install: `pipx install uv` or `pip install uv`, or the standalone installer)
- Docker (for the container build / local parity)

## Install

```bash
cd backend
uv sync            # creates .venv and installs locked deps
```

## Environment

```bash
cp backend/.env.example backend/.env
# fill in Supabase + OpenAI values; never commit backend/.env
```

Config is read only through `app/config.py` (Pydantic Settings). The app fails fast if a required variable is missing.

## Run

```bash
cd backend
uv run uvicorn app.main:app --reload    # http://localhost:8000
curl http://localhost:8000/health       # {"status":"ok", ...}
```

## Validate

```bash
cd backend
uv run pytest            # includes the health/config test
uv run ruff check .      # lint
```

## Container

```bash
docker build -t aladdin-backend ./backend
```

## Notes

- FastAPI is **not** the CRUD backend — it handles AI, OCR, RAG, documents, and workers only.
- No Alembic. SQLAlchemy maps/queries Supabase-migrated tables read-side; it never owns the schema (ADR-0002).
