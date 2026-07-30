# ADR-0002 — Database Migrations: Supabase SQL is the Only Schema Source of Truth

**Status:** Accepted · 2026-07-29

## Purpose

Decide, once, how the shared Aladdin database schema is defined and evolved — and rule out the conflicting approaches inherited from reference material.

## Current decision

- **`supabase/migrations/*.sql` is the single source of truth** for the shared schema. Every change is a new, ordered SQL migration.
- **Python data access is via `supabase-py`** and never owns or modifies the schema. *(The original "SQLAlchemy may map and query" clause is refined by [ADR-0005](./ADR-0005-python-data-access.md): SQLAlchemy is deferred; if ever reintroduced it would be Core, read-only, mapping migration-owned tables — never creating them.)*
- **No Alembic** is installed or configured.
- **`Base.metadata.create_all()` is forbidden** in Staging and Production.
- **Production schema changes are never performed manually** via the Supabase dashboard once the migration workflow is established.

## Rationale

- A single mechanism removes drift between an ORM's view of the schema and the actual database — the most common source of production incidents in mixed Python/JS stacks.
- Supabase RLS policies, storage policies, and extensions are themselves SQL and version naturally as migrations.
- Reviewable SQL migrations give the security review a concrete artifact (policies, grants, indexes) per change.

## Scope

All schema, RLS policy, storage policy, extension, and function changes to the shared database.

## What is deferred

Actual product tables. The foundation ships only the conventions, an initial **extensions** migration, seed conventions, and the test structure — **no product tables without an approved specification.**

## Consequences

- Backend models are hand-written to match migrations (or generated read-only), never authoritative.
- CI must lint/validate migrations and run RLS/isolation tests before merge.
- The `agents/commands/db-migrate.md` playbook (Prisma/Alembic/Knex/Django) is **superseded** — see `docs/database/migration-strategy.md`.

## Related files

`supabase/AGENTS.md` · `docs/database/migration-strategy.md` · `docs/database/naming-conventions.md` · `docs/security/rls-strategy.md`
