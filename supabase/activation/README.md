# Held activation SQL (NOT migrations)

Files here are **never applied by `supabase db push`/`db reset`**. Each needs a separate, explicit owner approval for the
exact environment, after its preconditions (below) are verified. They are tested in CI against a clean local stack.

## `r2-only-storage-write-closure.sql` / `…-rollback.sql`

Closes direct writes (INSERT/UPDATE) to the seven application Storage buckets for browser/user JWT clients, so no new
application file bytes can enter Supabase Storage. Reads and deletes of legacy objects stay open (existing files keep
working until a separately approved retirement/migration). `service_role` (server) is unaffected.

Preconditions (all must be true before running it on an environment):

1. The R2 upload paths for **every** namespace are live and verified on that environment: avatar, portfolio,
   certificate, product, organization, purchase-request photos, business-verification documents.
2. `R2_STORAGE_ENABLED=true` (or `MEDIA_LEGACY_STORAGE_WRITES=false`) is deployed there, so the application already
   refuses Supabase writes; this SQL is the database-level backstop, not the first line.
3. No Supabase-reserved pending upload is in flight (`select count(*) from media_storage_locations l join … state='pending' and provider='supabase'`), or a maintenance pause is approved.
4. A fresh database backup exists.

Run in the Supabase SQL editor (it is one transaction). The rollback recreates the exact policies it saved.
