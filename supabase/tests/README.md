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

## Tests that `supabase test db` does not run

Two kinds of file here are **not** pgTAP and are invoked directly:

- `*_concurrency_test.sh` — two real sessions racing for a lock, which a single
  pgTAP transaction cannot express.
- `professional_asset_storage_api_test.mjs` — the Storage **HTTP API**, which a
  SQL test cannot reach at all.

```bash
node supabase/tests/professional_asset_storage_api_test.mjs
```

Needs a running local stack with the standard seeds. It mints its own local HS256
tokens for seeded fixtures rather than driving the OTP flow, creates only
deterministic temporary objects, and deletes every one of them in a `finally`
(it fails if any is left behind).

**Why it exists alongside `47_professional_asset_storage_test.sql`:** the rules
protecting a stored file live in two processes. RLS decides *who*, and pgTAP
proves that — including the absences (`there is no UPDATE policy`, `no policy
admits anon`) which no amount of HTTP probing could establish. But
`allowed_mime_types` and `file_size_limit` are enforced by the Storage service
from the bucket row **before Postgres is consulted**, so a suite that introspected
policies alone could show a green board while an oversized, mislabelled upload
sailed through. See [`docs/database/professional-asset-storage.md`](../../docs/database/professional-asset-storage.md) §10.
