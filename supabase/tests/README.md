# Supabase Tests

Database tests run with **pgTAP** via `supabase test db` (or `supabase db test`).

## What must be tested (see `docs/security/rls-strategy.md`)

- **RLS policies** — every policy on a tenant/user/verification/sales/project/file/AI table.
- **Organization isolation** — org A cannot read or write org B's rows (and branch isolation where applicable).
- **Storage policies** — private buckets deny cross-tenant/object access.
- **Migration validation** — migrations apply cleanly from scratch (`supabase db reset`).

## Convention

- One `*.sql` pgTAP file per table/policy area, named after the object under test.
- A test that sets a JWT claim context (org/user/role) and asserts allowed vs denied access is required whenever a migration adds a tenant table.

## Foundation status

No product tables exist yet, so there are no policy tests to write. This structure exists so the **first** table migration ships with its isolation tests here — a migration adding a tenant table without an RLS policy + isolation test fails review.
