# Production legacy media: finish the move to R2, then retire Supabase Storage - 2026-11-23

Status: PLAN, with the read-only plan result below. Nothing in this document was executed. Read-only SQL against Production (`kkpkgjrweysgvhvkhzun`) on 2026-11-23 produced every number below (aggregates only, no names or owners).

## Why this exists
The Production backup of 2026-11-23 failed at the legacy media step and the kit refuses to call a database-only Production snapshot complete while Supabase Storage still holds files (`require_media_not_needed` in `ops/backups/lib.sh`). `LEGACY_MEDIA_BACKUP=1` cannot succeed either: the backup job holds no service-role key (`ops/backups/final-acceptance-preflight.py`). The way out is to finish the R2 move and retire the legacy files, not to change the kit. This blocks the restore-verified snapshot that [`PRODUCTION_CATCHUP_PLAN_20261123.md`](PRODUCTION_CATCHUP_PLAN_20261123.md) needs.

## Current state (read-only, 2026-11-23)
- Production is already R2-only for new uploads: `frontend/wrangler.jsonc` has `R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`, `MEDIA_LEGACY_STORAGE_WRITES=false` (owner-approved 2026-11-11). Nothing needs enabling.
- `public.media_storage_locations`: 1,377 rows on `r2` (latest 2026-11-21) and 167 rows still on `supabase` (latest 2026-11-12).

| Namespace | Rows still on Supabase | Bytes | Without verified size / sha256 |
|---|---|---|---|
| avatar | 92 | about 6.6 MB | 2 |
| portfolio | 75 | about 7.4 MB | 30 |
| total | 167 | about 14 MB | 32 |

- `storage.objects` holds 1,086 files (portfolio 844, avatars 228, product images 9, certificates 3, organization images 2; about 215 MB), created 2026-10-25 to 2026-11-12. Most are retained sources of rows already switched to R2 (the migration tool never deletes them). Exactly how many have an R2 copy is NOT established: the match by key was approximate. The tool's own `plan` and `rehash` give the authoritative answer.
- The 3 certificate objects are 0 bytes.
- Reads of the 167 rows still go through the Supabase proxy, so deleting their files breaks those images.

## Plan result (read-only replica of `media-storage.mjs plan`, 2026-11-23)
`media_migration_inventory` (the function `plan` reads) was replicated set-based over the five media tables with `state = 'ready'`, joined to `media_storage_locations` and `storage.objects` exactly as the function does. Aggregates only.

| Namespace | On R2 (source object still in Supabase) | On R2 (source already gone) | Supabase provider, source present | Supabase provider, source MISSING |
|---|---|---|---|---|
| avatar | 205 | 55 | 0 | 148 |
| portfolio | 837 | 205 | 0 | 164 |
| product | 8 | 0 | 0 | 1 |
| organization | 2 | 1 | 0 | 0 |
| certificate | 0 | 0 | 0 | 4 |

- **Bytes to copy: 0.** No ready media item has a Supabase provider AND a source object, so `migrate` would have nothing to copy. The 167 `supabase` rows in `media_storage_locations` (and the 150 ready items that have no location row and default to `supabase`) point at objects that are not in Supabase Storage. They are already unservable from Supabase; whether they exist on R2 under the same key is NOT established here and needs the owner-run `plan` / `rehash`.
- The 1,086 Supabase Storage files split into 1,052 retained sources of items already switched to R2 (837 + 205 + 8 + 2) and 34 files no ready item references (7 portfolio, 23 avatars, 1 product, 3 certificates).
- Consequence: deleting the Supabase files does not remove the file behind any item that is served from Supabase today; the risk is only the retained rollback copies and the 317 already-missing references.
- Not verified here: that every R2-side object exists (needs R2 access, `rehash`), and what the app shows for the 317 items with no file.

## Steps (each its own owner GO; I never hold the service-role key, so the owner runs every `--execute`)
1. **Plan (read-only).** `node scripts/media-storage.mjs plan --project kkpkgjrweysgvhvkhzun --namespace avatar,portfolio --json`. Expect 0 to copy (see the plan result above) and the missing sources listed, not 167; the 32 rows were flagged "without readable metadata". Decide what to do with those 32 (re-read the Supabase object to learn size/sha256, or confirm the file is gone and retire the row) BEFORE migrating.
2. **Approval and egress.** The tool refuses Production `--execute` unless `MEDIA_MIGRATION_APPROVED_PROJECT=kkpkgjrweysgvhvkhzun` is set in the owner's environment, and needs `--remaining-egress-bytes` read from the Supabase Usage page. 14 MB is small against any quota.
3. **Migrate.** `migrate --namespace avatar,portfolio --max-bytes 20MB --journal <file> --remaining-egress-bytes <N> --execute`, repeated until nothing is left. It copies, verifies sha256 and size, then switches the row. Keep the journal file.
4. **Verify.** `rehash` (R2 reads only) clean, `delta` reports `cutoverReady: true`, and `select provider, count(*) from media_storage_locations group by 1` shows zero `supabase`. Spot-check an avatar and a portfolio image on the live site.
5. **Retire the Supabase files (owner decision, permanent).** The tool deliberately has no delete for Supabase sources, and SQL cannot delete from `storage.objects` (Supabase requires the Storage API). `docs/operations/media-monitoring.md` asks for at least 30 days of retention and a clean `rehash` first; the owner may shorten that knowingly. Use `scripts/media-legacy-purge.mjs` (owner's own key): `node scripts/media-legacy-purge.mjs --project kkpkgjrweysgvhvkhzun` is a dry-run that prints counts only; `--execute --confirm "DELETE LEGACY MEDIA kkpkgjrweysgvhvkhzun"` (and `MEDIA_MIGRATION_APPROVED_PROJECT` set) deletes. It deletes only retained sources with a verified R2 row and orphans, aborts the whole run if any object is the only copy of a ready item or has an unverified R2 row, and never touches buckets other than the five. Deletion is permanent. The 3 certificate objects (0 bytes) and 5 buckets are listed above. `business-verification-documents` is a separate bucket that stays (ADR-0018).
6. **Backups.** With `storage.objects` empty, remove `LEGACY_MEDIA_BACKUP` from the `backup-production` environment; the legacy step then passes and the Production snapshot can be complete. Re-run Backup then Restore test; pin the label (catch-up plan step 2).

## Interim (until step 5)
- The repository variable `PRODUCTION_BACKUP_ENABLED` is `true`. Scheduled Production backups will fail the same way every night until step 6; set it back to `false` (owner variable) if that noise is unwanted.
- Production catch-up must not start without a complete restore-verified snapshot. The files at risk are the 167 live rows, so finishing step 3 first is cheap (about 14 MB).

## Not decided here
- Whether to keep the 30-day retention of the Supabase sources or delete earlier.
- The 32 rows without verified size.
