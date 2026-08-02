# Database Naming Conventions

**Status:** Living document · 2026-07-29

## Purpose

Keep the schema predictable so migrations, RLS policies, and `supabase-py` / RPC access read consistently.

## Current decision

- **Tables:** `snake_case`, plural (`organizations`, `rfq_requests`, `quotation_items`).
- **Columns:** `snake_case`. Primary key `id` (`uuid`, default `gen_random_uuid()` from `pgcrypto`). Foreign keys `<referenced_singular>_id` (`organization_id`, `project_id`).
- **Tenancy columns:** `organization_id` on tenant-owned tables; `branch_id` on branch-scoped tables.
- **Audit columns:** `created_at timestamptz not null default now()`, `updated_at timestamptz` (maintained by trigger), and `created_by` where ownership attribution matters.
- **Booleans:** positive phrasing (`is_active`, `is_verified`).
- **Enums:** Postgres `enum` types named `<domain>_<thing>` (e.g. `verification_status`), values `snake_case`.
- **Indexes:** `ix_<table>_<cols>`; unique `uq_<table>_<cols>`; GIN for FTS/`pg_trgm`; `ivfflat`/`hnsw` for `pgvector` columns. Every index is intentional and justified in the migration.
- **Foreign keys:** named `fk_<table>_<column>`; specify `on delete` behavior deliberately.
- **RLS policies:** `<table>_<action>_<audience>` (e.g. `projects_select_same_org`).
- **Functions/triggers:** `snake_case`, verb-first (`set_updated_at`).
- **Migrations:** timestamp-prefixed, descriptive (`20260729_0000_extensions.sql`).

## Rationale

Consistency makes RLS policies auditable at a glance and keeps `supabase-py` queries and PostgreSQL RPC definitions mechanical.

## Scope

All database objects.

## What is deferred

Domain-specific table designs (created with approved specs).

## Consequences

Migrations violating these conventions are revised in review.

## Related files

`migration-strategy.md` · `../security/rls-strategy.md` · `supabase/AGENTS.md`
