---
description: Scoped agent instructions for the Aladdin Supabase data platform (schema source of truth).
alwaysApply: true
---

# Supabase — Agent Instructions

Extends the root `AGENTS.md`. Read that first. This file governs `supabase/`.

## The single most important rule

**Supabase SQL migrations (`supabase/migrations/*.sql`) are the ONLY source of truth for the shared Aladdin database schema.** Every schema change is a new migration file. See `docs/database/migration-strategy.md` and ADR-0002.

- No Alembic. No ORM-driven schema creation (`Base.metadata.create_all()`) in Staging/Production.
- **Production schema changes are never performed manually** through the dashboard. The dashboard is read/inspect only once the migration workflow is established.
- Trusted Python workers (in `backend/`) query these tables via **`supabase-py`** (ADR-0005), never owning or altering the schema. SQLAlchemy is deferred; Alembic is excluded.

## Security & tenancy (mandatory)

- **RLS is mandatory** on all user, organization, verification, sales, project, file, and AI data. A table without an RLS policy is a bug.
- Every **tenant-owned** business table includes organization ownership (e.g. `organization_id`) where applicable; **branch-scoped** data includes branch ownership where applicable.
- **Service-role credentials never enter browser/client code.** Client access goes through `anon`/`authenticated` roles constrained by RLS.
- **Storage policies get the same security review as database policies.** Buckets holding verification documents / uploads are private by default.
- **AI retrieval must not leak documents across organizations.** Vector search (pgvector) must apply authorization filters *before* returning content.

## Conventions

- Foreign keys and indexes are **intentional** — declare them deliberately, name them, and justify non-obvious indexes. See `docs/database/naming-conventions.md`.
- Migrations are additive and, where possible, backward-compatible (expand → migrate/backfill → contract across deploys).
- Extensions are enabled via migration, not ad-hoc. The initial extensions migration enables `pgcrypto`, `pg_trgm`, `vector` (pgvector), and `postgis` (guarded).

## Testing

- **Every RLS policy requires tests.** Include organization-isolation tests (User/org A cannot read/write org B) and storage-policy tests.
- Migration validation runs in CI before merge. Tests live in `supabase/tests/`.

## Foundation-task scope

This foundation established **conventions, the initial extensions migration, seed conventions, and the test structure only**. **Do not invent production tables without an approved database specification** in `docs/product/` / `docs/database/`.

## Commands

```bash
pnpm supabase start           # local stack (Docker)
pnpm supabase db lint         # lint migrations
pnpm supabase migration new <name>
pnpm supabase db reset        # re-apply all migrations + seed locally
pnpm supabase db diff         # inspect drift (local dev only)
```
