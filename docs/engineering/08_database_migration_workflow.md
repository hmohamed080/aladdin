# 08 — Database Migration Workflow

| | |
|---|---|
| **Status** | Living document (canonical engineering reference) |
| **Version** | 1.0.0 |
| **Owner** | Engineering / Data |
| **Last Updated** | 2026-08-01 |
| **Depends On** | [`../database/migration-strategy.md`](../database/migration-strategy.md), [`../decisions/ADR-0002-database-migrations.md`](../decisions/ADR-0002-database-migrations.md), [`../../supabase/AGENTS.md`](../../supabase/AGENTS.md) |
| **Related** | [`../technical/03_database_design.md`](../technical/03_database_design.md), [`../technical/06_rls_strategy.md`](../technical/06_rls_strategy.md), [`06_testing_strategy.md`](06_testing_strategy.md) |

Covers **Database Migration Workflow (11)**. The canonical policy is [`migration-strategy.md`](../database/migration-strategy.md) + ADR-0002; this doc is the step-by-step an engineer follows.

## Non-negotiables (ADR-0002)

- **`supabase/migrations/*.sql` is the only schema source of truth.** No ORM-owned schema; **no Alembic**; **no `Base.metadata.create_all()`** in staging/prod; no manual dashboard edits in staging/prod.
- **A tenant table without an RLS policy + isolation test is a bug / release blocker.**
- Python reads/writes these tables via `supabase-py` (ADR-0005); it never defines schema.

## Workflow

1. **Create:** `pnpm exec supabase migration new <descriptive_name>` → a timestamp-prefixed file in `supabase/migrations/`.
2. **Write plain SQL**, following [`naming-conventions.md`](../database/naming-conventions.md) and the target schema in [`03_database_design.md`](../technical/03_database_design.md):
   - DDL (tables/columns/types/enums), with `id uuid default gen_random_uuid()`, tenancy columns (`organization_id`/`branch_id`), audit columns, and **explicit `on delete`** ([`04_relationships`](../technical/04_relationships.md)).
   - **`alter table ... enable row level security;`** + **explicit policies** (`<table>_<action>_<audience>`) per [`06_rls_strategy`](../technical/06_rls_strategy.md).
   - Storage policies (if the table references bucket objects), grants, and **intentional, justified** indexes (FTS/`pg_trgm`/`pgvector`/PostGIS/`ix_`/`uq_`).
   - `set_updated_at` trigger where `updated_at` exists.
3. **Backward-compatible & additive** where possible — **expand → backfill → contract** across separate deploys; never a destructive change in one step against live data.
4. **Apply locally:** `pnpm exec supabase db reset` (re-applies all migrations + `seed.sql`); iterate until clean.
5. **Test (blocking):** add tests in `supabase/tests/` — org-isolation (all four verbs), capability, public-view, storage-policy, no-self-approval as applicable ([`06_testing_strategy.md`](06_testing_strategy.md)); `db reset` + tests green.
6. **Lint:** `pnpm exec supabase db lint` (findings inside bundled `extensions.*` functions are third-party and ignored; **our schema must be clean**).
7. **Repeatability:** a second `db reset` produces identical state, no drift, seed repeatable.
8. **Review:** every migration is security-reviewed for policies/grants/indexes ([`09_pull_request_and_review.md`](09_pull_request_and_review.md)).
9. **Promote:** apply to **Staging**, verify, then **Production** via the migration workflow — never by editing tables in the dashboard.

## Seed data

`supabase/seed.sql` is **local dev only**: synthetic, non-sensitive, Egyptian conventions (localities, EGP), invented entities. Seed rows for a table land with the migration that creates it. No real customers/PII (the repo is public-capable).

## Soft-delete, audit, search (recap — full spec in [`03_database_design.md`](../technical/03_database_design.md))

- **Soft delete:** `deleted_at` on operational tables; RLS/queries filter `deleted_at is null`; trust/audit tables are never deleted. A retention purge job hard-deletes past window (⚑ windows OPEN).
- **Audit:** column-level `created_at/updated_at/created_by` + the immutable `audit_log` for security/state-changing actions (written server-side, `service_role` for the audit insert only).
- **Search:** FTS (`tsvector` + GIN), fuzzy (`pg_trgm`), semantic (`pgvector`, **org filter before returning rows**), geo (PostGIS). All server-side paginated.

## Checklist (per migration)

- [ ] Follows naming conventions; explicit `on delete`
- [ ] RLS enabled + explicit policies for every access path
- [ ] Isolation/capability/public-view/storage tests added and green
- [ ] Indexes intentional and justified in the migration
- [ ] `db reset` ×2 clean, no drift; `db lint` clean (our schema)
- [ ] Backward-compatible / expand-migrate-contract for live changes
- [ ] Reviewed for security (policies/grants/indexes)
