# Database Migration Strategy

**Status:** Living document · 2026-07-29

## Purpose

Define the one workflow for changing the shared database schema (supersedes the generic `agents/commands/db-migrate.md`).

## Current decision

**Supabase SQL migrations are the only source of truth** (ADR-0002). Workflow:

1. **Create** a migration: `pnpm supabase migration new <descriptive_name>` → new file in `supabase/migrations/` (timestamp-prefixed, ordered).
2. **Write** plain SQL: DDL, plus RLS `enable`/`policy`, storage policies, grants, indexes, and extensions as needed. Keep changes additive and backward-compatible where possible (**expand → backfill → contract** across separate deploys).
3. **Apply locally**: `pnpm supabase db reset` (re-applies all migrations + `seed.sql`) or `db push` to a local stack.
4. **Test**: RLS/organization-isolation/storage tests in `supabase/tests/` must pass; CI lints migrations.
5. **Review**: every migration is security-reviewed for policies, grants, and indexes.
6. **Promote**: apply to Staging, verify, then Production via the migration workflow — **never** by editing tables in the dashboard.

**Forbidden:** Alembic; `Base.metadata.create_all()` in Staging/Production; manual production schema edits; ORM-owned schema.

Python data access in `backend/` reads/writes these tables via **`supabase-py`** (ADR-0005), preserving the caller's JWT/RLS context; complex operations use PostgreSQL functions/RPC. SQLAlchemy is deferred and does not own the schema.

## Rationale

One ordered, reviewable SQL history eliminates ORM-vs-DB drift and gives security a concrete artifact per change.

## Scope

All schema, policy, extension, and function changes.

## What is deferred

Product tables. The foundation ships only `0000_extensions.sql` (extensions) + conventions; **no product tables without an approved spec**.

## Consequences

Backend data access reads migration-owned tables via `supabase-py`, never defining schema. CI gates on migration lint + RLS tests.

## Related files

`naming-conventions.md` · `../security/rls-strategy.md` · `supabase/AGENTS.md` · ADR-0002
