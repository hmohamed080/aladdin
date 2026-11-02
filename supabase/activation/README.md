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

## `legacy-media-reset.sql` / `…-rollback.sql` / `verify-legacy-media-reset.sql`

The database side of the owner-approved clean-media reset (legacy Supabase application media is removed, never
migrated). It installs service-role-only functions: object-level manifest readers (keyset-paginated, with expected
counts so a truncated read fails closed), `media_reset_retire` (locks the row, clears every avatar/cover/logo/portfolio
project pointer, tombstones the row, journals it; refuses submitted verification evidence, row-less verification
objects, R2-located keys and any object whose storage id/eTag differs from the approved manifest, all-or-nothing),
`media_reset_storage_removed`, `media_reset_finalize`, `media_reset_drop_locations` and `media_reset_verify`
(`ok` only when no broken pointer, legacy row, legacy object or legacy location remains). It deletes nothing by
itself: `scripts/media-reset-execute.mjs` drives it behind its own gates, and the Storage object removal happens
there. The rollback drops the functions and keeps the journal (audit evidence).

Preconditions: the Acceptance seven-flow R2 E2E has passed, a fresh verified backup/restore exists, and the owner
approved the refreshed object-level manifest (its sha256) for that exact project. Never combine it with the first
R2 activation. CI proves it in a transaction that is rolled back (`supabase-rls.yml`).
