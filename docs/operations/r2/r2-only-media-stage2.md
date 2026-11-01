# R2-only media: Stage 2 (core, isolation, no fallback)

Status: implemented and tested locally; nothing hosted changed. Builds on the ids-only key stack (ADR-0027).

## What is enforced in code

| Requirement | Where | Proof |
|---|---|---|
| New media bytes go only to R2 once routing is on | `server/storage/media.ts` `requireWritableProvider`, `lib/env/storage.ts` `legacyStorageWritesOpen` | `media.test.ts` "R2 is the only home of new media bytes" |
| No Supabase fallback when R2 is down or off | same; `MEDIA_LEGACY_STORAGE_WRITES=false` pauses uploads even with R2 off | provider error surfaces, `upload`/`sign` never called |
| Supabase writes pending at cutover fail closed | `authorizeMediaUpload` and `verifyPendingMedia` | users re-request an upload, which reserves R2 |
| Reads and deletes of legacy objects keep working | not gated | test "still deletes legacy Supabase objects" |
| Wrong environment, bucket or Supabase project | `lib/storage/environment-guard.ts`, called in `createR2Client` (images, video, backfills) | `environment-guard.test.ts`, `r2-environment.test.ts` |
| A backup bucket can never serve media | same guard | test |
| Site media separate from user media | `R2_SITE_BUCKET` (must differ), `lib/storage/site-media.ts` keys `site/shared/...`, `site/pages/<feature>/...` | `storage.test.ts`, `site-media.test.ts` |
| No second Supabase Storage write path appears unreviewed | `no-direct-supabase-writes.test.ts` allow-list | test |
| Ownership and permissions decided by the database | unchanged: `media_storage_resolve` / `organization_media_resolve` before any provider is created | cross-account test |

## Known remaining Supabase Storage users (decision needed)

- Business verification documents: compliance documents, kept by decision.
- Purchase-request photos (`server/actions/purchase-requests.ts`, `server/queries/purchase-requests.ts`): still write to Supabase Storage. Owner decision needed: move to R2 (follow-up) or keep as a documented exception. Listed in the allow-list as PENDING.

## Not built yet (dependencies)

- Admin UI and database records for site media (needs the site bucket and a table; the key builders and bucket guard are in place).
- Video stays off (`VIDEO_ENABLED`); it is never routed to Supabase Storage.
- Migration ordering and lifecycle fixes are Stage 3.

## Acceptance E2E activation requirements (owner steps, each its own GO)

1. Acceptance private bucket and credentials already exist; set `MEDIA_LEGACY_STORAGE_WRITES=false` on the Preview Worker.
2. Apply the ids-only migration to Acceptance (renumbered, Stage 3).
3. Run: upload avatar/portfolio/product/organization image as user A; verify bytes under `u/<A>/...` or `o/<org>/...` only; user B cannot read, replace or delete; replace and delete leave no object; set `R2_PRIVATE_BUCKET` to a bucket without "acceptance" in the name and confirm uploads are refused; point at the Production Supabase URL and confirm refusal; disable R2 credentials and confirm uploads pause with no Supabase object created.
4. Confirm `storage.objects` row count is unchanged after the run.
