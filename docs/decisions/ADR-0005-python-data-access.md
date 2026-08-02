# ADR-0005 — Python Data Access: `supabase-py` for the MVP; SQLAlchemy Deferred

**Status:** Accepted · 2026-07-30 · Refines ADR-0002 (data-access mechanism only; the "Supabase SQL migrations are the only schema source of truth" decision is unchanged)

## Purpose

Decide how the specialized FastAPI service and trusted Python workers read and write the shared Supabase database for the Private Pilot MVP — and resolve the inherited scaffold assumption that SQLAlchemy is a required dependency.

## Context

- The foundation scaffold listed **SQLAlchemy** as a backend dependency and described `backend/app/database/` as "SQLAlchemy engine/session; read-side access."
- Audit result (2026-07-30): **SQLAlchemy is not used by any functioning code.** Its only footprints were a module docstring in `backend/app/database/__init__.py`, the `pyproject.toml` dependency, and comments in `backend/.env.example`. There is no engine, session, model, or query in the codebase.
- The web app already uses `supabase-js` against Supabase with the authenticated user's JWT so **RLS is the enforcement layer**. The Python side needs a symmetric, RLS-respecting client — not a second, schema-aware ORM layer that risks drifting from the migration-owned schema.

## Decision

- **Next.js uses `supabase-js`. FastAPI and trusted Python workers use `supabase-py`.**
- **Supabase SQL migrations remain the only source of truth** for the shared schema (ADR-0002). No Python component owns or alters schema.
- **Complex database operations use PostgreSQL functions / RPC** where appropriate, called through `supabase-py`.
- **User-facing operations preserve the authenticated user JWT and RLS context** — the Python client acts with the caller's token so row-level security applies exactly as it does for the web app.
- **Service-role access is restricted to trusted internal workers and explicitly authorized operations.** Service-role bypasses RLS and must never be used to serve a user request without an explicit, reviewed authorization check.
- **SQLAlchemy is deferred** and is not a current dependency. **Alembic remains excluded** for the shared Supabase database.

## Why `supabase-py` is sufficient for the MVP

- The backend's job is specialized AI/OCR/RAG/document/worker processing, **not** general CRUD (ADR-0001). Its database interactions are targeted reads/writes of migration-owned tables plus RPC calls — well within `supabase-py`'s remit.
- Using the same Supabase client model on both sides keeps **RLS as the single, uniform enforcement layer** and avoids two divergent schema representations (an ORM's model vs. the actual migrations) — the most common drift/incident source in mixed stacks.
- Fewer moving parts for a six-week MVP: no engine/session lifecycle, no model-vs-migration reconciliation, no connection-pool tuning to get wrong.

## RLS and user-JWT behavior

- For **user-facing** operations the client is initialized with the caller's verified JWT; every query runs under `authenticated` with RLS applied. Identity is derived from the token, never from the request body.
- For **background/worker** operations that legitimately need elevated access, the service-role key is used **only** inside the trusted worker and **only** for explicitly authorized, reviewed operations — with authorization filters applied before returning content (no cross-organization leakage).

## PostgreSQL RPC usage

- Multi-statement or set-based logic that would be awkward or chatty over the client is implemented as a **PostgreSQL function** (defined in a migration) and invoked via `rpc(...)`.
- RPC functions carry their own `security invoker`/`security definer` decision, reviewed like any other policy; `security definer` functions must set a safe `search_path` and enforce authorization internally.

## When SQLAlchemy Core may be reconsidered

Reconsider **SQLAlchemy Core** (query building / typed composition / pooling — **not** the ORM, and **never** Alembic) via a **new ADR** only when there is evidenced need, e.g.:

- Complex dynamic query composition that RPC + the client cannot express cleanly.
- Measured connection-management or performance requirements the Supabase client cannot meet.
- A genuine need for typed, testable SQL construction beyond hand-written SQL and RPC.

Until then, deferring it removes an unused dependency and a drift risk.

## Why Alembic remains excluded

Alembic manages schema migrations. Schema is owned exclusively by `supabase/migrations/*.sql` (ADR-0002); a second migration tool would create two competing sources of truth. Alembic stays out regardless of any future SQLAlchemy Core reconsideration.

## Consequences

- `sqlalchemy` is removed from `backend/pyproject.toml`; **`supabase>=2` (`supabase-py`) is added** as the sanctioned Python data-access client. `uv.lock` is regenerated.
- `backend/app/database/__init__.py`, `backend/.env.example`, `backend/AGENTS.md`, `supabase/AGENTS.md`, the root `AGENTS.md` dependency policy, and the architecture docs are updated to describe `supabase-py` access.
- ADR-0002's "SQLAlchemy may map and query" clause is **refined by this ADR**: Python data access is via `supabase-py`; SQLAlchemy is deferred.
- No functional code changes (the scaffold had no data-access code); backend tests (health + config) are unaffected.

## Migration path if requirements change

1. Record the evidenced need in a new ADR that supersedes the relevant part of this one.
2. Add `sqlalchemy` (Core) via `uv`; introduce a read-only engine/session in `backend/app/database/` that maps migration-owned tables (never creates them).
3. Keep `Base.metadata.create_all()` forbidden in Staging/Production and Alembic excluded — migrations stay the only schema source of truth.

## Related files

`docs/decisions/ADR-0001-approved-architecture.md` · `docs/decisions/ADR-0002-database-migrations.md` · `docs/architecture/ARCHITECTURE_GUIDE.md` · `backend/AGENTS.md` · `supabase/AGENTS.md` · `backend/app/database/__init__.py`
