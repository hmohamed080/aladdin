# ADR-0032 — A failed upload holds nothing; upload limits are admin settings with exemptions

- Status: Accepted (owner decisions, 2026-11-26). Code and local tests; **nothing applied to a hosted environment**.
- Builds on: ADR-0017 (private media integration), ADR-0030 (site-wide media upload policy).

## Context

Every upload reserves a database row before the browser sends the bytes. When the upload failed, was refused, or was
abandoned, that row kept consuming one of three things: an item slot (for example 3 photos per product), the 1 GB storage
quota (an unfinished file counted as 10 MB), or the hourly allowance. The automatic cleanup is a manual script, so some
places never recovered: six failed return photos blocked an order.

## The rule (binding for every upload, present and future)

1. **Failed, rejected or deleted uploads free their slot and storage at once.**
2. **An abandoned upload stops counting after one hour, decided inside the database.** No limit may depend on a cleanup job
   or a scheduler to release it. The cleanup only deletes bytes.
3. **Two hourly numbers.** The allowance (default **50**) counts successful and in-progress uploads; the ceiling
   (default **150**) counts every attempt, so uploading and deleting in a loop is still bounded. Per-feature hourly caps
   follow the same shape (their allowance, and three times it as the ceiling).
4. **The Super Admin controls them** (`/admin/media-limits`: allowance, ceiling, storage quota, with a mandatory reason and
   history) and **may exempt a chosen user or organization** from the hourly, unfinished-upload and storage limits.
   Exemptions do not lift file-size limits or per-item counts (photos per product, per return, per project).

Videos keep their resumable upload (24 hours idle, 6 days in total); an expired one is released by the next upload request.
A failed or rejected video leaves a product's slots when a new one needs the place.

## Checklist for a new upload place (required)

- [ ] The pending row is a state the central system knows: add it to `app.media_metadata`, the `media_limits` places,
      `public.media_upload_abandon` and `public.media_cleanup_candidates`.
- [ ] Reserve through `public.media_storage_reserve` (never a private quota of its own).
- [ ] The server issues grants only through `authorizeMediaUpload` and confirms only through `verifyPendingMedia`
      (both release the reservation when they refuse).
- [ ] The browser sends bytes only through `uploadWithGrant(grant, file, { namespace, key })`.
- [ ] A per-item count ignores rows that failed, were removed, or are unfinished for more than `app.upload_abandon_after()`.
- [ ] A per-feature rate limit counts successful and in-progress rows, has an attempts ceiling, and skips
      `app.upload_exempt(user, organization)` accounts.
- [ ] pgTAP proves: a failed upload releases the place, and an abandoned one expires without a job.

Guards: pgTAP `410_upload_limits_release_and_exemptions_test.sql` (G1, G2: every upload place can release) and
`frontend/src/lib/storage/upload-guard.test.ts` (only the reviewed senders upload from the browser).

## Consequences

- Orphaned bytes of released uploads wait for `scripts/media-storage.mjs cleanup`. Scheduling it needs a separate owner
  approval (a Worker deploy); it affects storage cost only, no longer anyone's limits.
- An upload confirmed after more than an hour is checked against the storage quota again.
