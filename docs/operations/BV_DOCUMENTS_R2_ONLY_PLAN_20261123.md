# Business-verification documents on R2 only (no Supabase Storage exception) - 2026-11-23

Status: PLAN. Nothing here was applied or changed. Owner decision (2026-11-23): Production and Acceptance hold ALL media on R2 with the same architecture, including business-verification documents; no file is kept in Supabase Storage and no new write may enter it. This reverses the exception in [ADR-0018](../decisions/ADR-0018-r2-edge-media-delivery.md) ("Business-verification documents stay in Supabase Storage, unchanged") and the `purchase-request-images` exception of ADR-0017. Read-only facts below come from the repository and from SQL SELECTs on Production (`kkpkgjrweysgvhvkhzun`) and Acceptance (`nxossqhdfltcqdwvbewi`) on 2026-11-23. Companion: [`PRODUCTION_LEGACY_MEDIA_MIGRATION_PLAN_20261123.md`](PRODUCTION_LEGACY_MEDIA_MIGRATION_PLAN_20261123.md).

## What the code already does (the ADR text is stale)
- Migration `20261107090005_request_and_verification_media.sql` extends `media_storage_locations` and the central media functions to the namespaces `request` and `verification`. `frontend/src/app/api/media/[namespace]/route.ts` accepts `verification` (key shape `<orgId>/<uuid>.<ext>`), and `frontend/src/app/business-verification/file/[orgId]/[fileName]/route.ts` serves through `deliverMedia(..., "verification", key)`; its comment says "R2 for new documents, Supabase Storage for legacy ones". No front-end file calls `storage.from(BV_BUCKET)` directly.
- So new verification documents go to R2 whenever `R2_STORAGE_ENABLED=true` (Production: true, owner-approved 2026-11-11, `MEDIA_LEGACY_STORAGE_WRITES=false`). The gate is unchanged: `organization_media_resolve` -> `app.can_read_bv_object` (org.manage on the organization, or a READY document and review authority), checked before and after the fetch; any refusal is the same 404; evidence is kept byte-for-byte (no re-encoding, `media-policy.ts`); nothing public, nothing cached.
- `ops/backups/production-media-inventory.sql` already lists `verification` and `business-verification-documents`, so backup coverage counts these documents too.

## Data to move (read-only counts)
| | Production | Acceptance |
|---|---|---|
| `business_verification_documents` rows | 0 | 2 |
| `business_verification_submissions` rows | 0 | not read |
| objects in bucket `business-verification-documents` | 0 | 0 |
| objects in `purchase-request-images` | 0 | not read |

Production has nothing to migrate: the move is configuration, tests and closing the bucket. Acceptance has 2 metadata rows with no object in Supabase Storage; where their bytes are (R2 or nowhere) is not established here and must be read before the bucket is closed there (`media_storage_locations` provider for those two keys).

## Security requirements on R2 (must hold before relying on it)
1. Same private bucket and delivery as the other namespaces (`aladdin-media-private` on Production); no public bucket, no public CDN URL, no long-lived cache. Evidence is served only through the application route (and the edge Worker, if enabled), each byte authorized by Postgres at request time.
2. Keys are ids only (ADR-0027); the object key contains no file name or organization name beyond the UUID shape.
3. Upload goes through the server reservation (`authorizeMediaUpload`: reserves the key, checks `org.manage`, MIME and 10 MB limit, signs a short-lived R2 PUT). No browser-held R2 credential.
4. Encryption at rest: R2 encrypts all objects; backups are age-encrypted. Evidence documents must NOT be re-encoded or stripped (kept as uploaded); response header `content-security-policy: sandbox` is skipped for this namespace so PDFs render: review that choice (frame-ancestors / nosniff still apply) in the security review below.
5. Access logging: every read must be attributable (the route resolves through the database; confirm an audit row or log line per reviewer read, add one if missing).
6. Retention: documents attached to a submission are evidence and are never deleted by the media cleanup; draft attachments follow the existing delete rule.

## Steps (each its own owner GO)
1. **Verify on Acceptance with real flows** (owner session): upload a PDF and a JPEG as an organization owner; confirm the objects land in the R2 private bucket (not Supabase), a reviewer can open them, another organization gets 404, a revoked/rejected state still 404s, nothing cacheable (the delivery sends `cache-control: no-store, no-cache, must-revalidate, private`). Check the 2 existing metadata rows.
2. **Verify on Production, read-only**: `R2_STORAGE_ENABLED=true` in the live Worker version and `verification` present in the deployed route (the catch-up and frontend deploy come after the migrations; do not deploy the frontend before them, per the Production catch-up plan).
3. **Security review** of points 1-6 above (Codex review on the PR that changes the ADR).
4. **Amend the ADRs** in a PR: ADR-0018 (remove the exception), ADR-0017 (`purchase-request-images`), `docs/operations/showroom-admin-handoff/r2-delivery-architecture.md`, and the stale line in `RUNTIME_STATE.md` that says R2 is off on Production.
5. **Close Supabase writes (already prepared, held):** `supabase/activation/r2-only-storage-write-closure.sql` (with `-rollback.sql` and `verify-closure.sql`) saves and drops every INSERT/UPDATE/ALL policy that targets the seven application buckets, including `bv_documents_insert_authorized` and the `request_images_insert_authorized` policy. Both projects still have all seven INSERT policies and no closure table (read 2026-11-23): not applied anywhere. Its preconditions: every namespace's R2 upload live and verified (steps 1-2), `R2_STORAGE_ENABLED=true` deployed, no pending Supabase upload, a fresh backup. `service_role` bypasses RLS, so the SQL stops browser/user clients; the server is stopped by `MEDIA_LEGACY_STORAGE_WRITES=false`, plus the closure keeps a database-level backstop.
6. **Purge** the legacy files with `scripts/media-legacy-purge.mjs` (five migrated buckets). `purchase-request-images` and `business-verification-documents` are excluded by the script today: after step 1-2 extend its bucket list (they hold 0 objects on Production, so the purge is a no-op there) or leave them empty by construction.
7. **Retire the buckets** only after the closure is in place and they are empty: empty buckets can be dropped through the Storage API (a separate approval; the database-side `storage.buckets` rows cannot be deleted by SQL while objects exist).

## Not decided here
- Whether to keep a 30-day Supabase retention of the old files (`media-monitoring.md`), or purge earlier.
- Whether the two Acceptance metadata rows are kept or marked deleted.
- The `content-security-policy` choice for evidence PDFs (point 4).
