# Supabase Setup

Supabase is the data platform and the **only** schema source of truth (ADR-0002). See `supabase/AGENTS.md`.

## Prerequisites

- Docker (the local stack runs in containers)
- Supabase CLI — available via the pnpm workspace: `pnpm supabase <cmd>` (declared as a root devDependency)

## Start the local stack

```bash
pnpm install                 # ensures the supabase CLI is available
pnpm supabase start          # boots Postgres, Auth, Storage, Studio, etc.
```

`pnpm supabase status` prints the local URLs and keys. Put the API URL + anon key into `frontend/.env.local` and `backend/.env`.

## Migrations

```bash
pnpm supabase migration new <descriptive_name>   # new supabase/migrations/*.sql
pnpm supabase db reset                            # re-apply all migrations + seed.sql
pnpm supabase db lint                             # lint migrations
```

The foundation ships `supabase/migrations/*_extensions.sql` (pgcrypto, pg_trgm, vector, postgis) only — **no product tables** without an approved spec.

## Rules (must-read)

- RLS is mandatory on tenant/user/verification/sales/project/file/AI tables; every policy needs tests in `supabase/tests/`.
- `service_role` key is server-only — never in browser code.
- Never modify Production schema by hand — only via migrations.

## Seed

Local, synthetic seed data goes in `supabase/seed.sql` (applied by `db reset`). Do not seed real/PII data.
