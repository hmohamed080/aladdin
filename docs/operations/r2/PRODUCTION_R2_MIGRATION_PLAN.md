# Production Supabase-to-R2 media migration plan

Status: **prepared, nothing executed.** Superseded in part on 2026-11-08 by [`R2_ONLY_ROLLOUT_RUNBOOK.md`](R2_ONLY_ROLLOUT_RUNBOOK.md) (copy, verify and reconcile first; deletion only by a separate approved manifest). No bucket, migration, copy, switch, deployment or deletion has been done.
Read-only measurements below were taken on 2026-11-07 against Production (`kkpkgjrweysgvhvkhzun`).

## 1. Inventory (read-only)

`storage.objects` by bucket, 2026-11-07 (about 14:55 Cairo):

| Bucket | Objects | Bytes | Created since Nov 5 |
|---|---:|---:|---:|
| avatars | 201 | 12,828,364 | 27 |
| professional-portfolio | 683 | 179,794,808 | 107 |
| product-images | 3 | 568,117 | 0 |
| professional-certificates | 3 | 0 | 0 |
| purchase-request-images | 0 | 0 | 0 |
| business-verification-documents | 0 | 0 | 0 |
| **Total** | **890** | **~193 MB** | **134** |

The task brief recorded 860 objects and 104 recent ones. Production moved by 30 objects in the hours since, so
**a one-time snapshot is not enough: the delta step below is mandatory.**

Record-level classification (`media_storage_locations` plus canonical tables, 1,317 rows) is in
[`../PRODUCTION_MEDIA_INVENTORY_20261107.json`](../PRODUCTION_MEDIA_INVENTORY_20261107.json): active, deleted, missing
(record without a file), orphaned (file without a live record) and pending are counted per namespace. Rows and storage objects
are not 1:1, which is expected. Orphaned and missing items are reported, never migrated or deleted automatically.

**Protected files:** Production holds **0** request photos and **0** business verification documents (both tables and both
buckets are empty). There is currently nothing to adopt under retention rules. The namespaces are still in the tool and in the
backup coverage so the first submitted document is protected from day one.

## 2. Tooling (all in `scripts/media-storage.mjs`)

| Command | Effect |
|---|---|
| `plan` | Metadata-only counts, bytes, batches and estimated Supabase egress |
| `migrate` | Resumable and idempotent copy: sha256 + size verified by read-back, ownership kept, source re-checked immediately before the reference switch. Never overwrites R2, never deletes Supabase |
| `delta` | **Read-only.** New uploads not yet copied, and sources replaced after their copy. Replaced sources are listed for a reviewed re-adoption; the R2 copy is never overwritten. `cutoverReady` is true only when nothing is waiting and nothing changed |
| `rehash` | Re-reads R2 copies and confirms them against the journal |
| `rollback` | Points references back at the retained Supabase originals |
| `cleanup` | Deletes only retired R2 objects. Legacy Supabase objects are never removed |

Production execution is refused unless `MEDIA_MIGRATION_APPROVED_PROJECT` names that exact project. The previous allowlist wrongly
treated the Production reference as the staging project; Acceptance is now the only built-in execution target.

## 3. Sequence

1. Provision Production R2 buckets and environment guards (separate approval; see section 5).
2. `plan`, then `migrate` per namespace with a hard `--max-bytes` budget, smallest namespaces first. Rerun to resume.
3. `rehash` the journal. Back up and restore-test **before** any cutover.
4. Repeat `migrate` and `delta` until `cutoverReady` is true. Run `delta` once more inside the cutover window.
5. Cutover: R2-only writes, no fallback to Supabase Storage, fail-closed when R2 is unavailable.
6. Legacy cleanup is a separate, later approval after at least 30 days of retained originals.

Originals are never deleted before: verified adoption, a restore-tested backup, and explicit written approval.

## 4. Merge and migration dependency

Migration versions on this candidate: `20261107090004` (ids-only storage keys), `20261107090005` (request and verification media),
`20261107090006` (Admin backup control). The earlier R2 versions `20261103090001` and `20261103090002` are retired from this
line: `20261103090001` is the already-applied OTP version and is never reused.

Order: OTP and Admin invitations (#136, #137) and the stacked account-basics line first, then this integration PR. New
migrations apply forward only, in order, after the owner approves; history is never repaired.

## 5. Individual GO requirements

Each is a separate owner decision. None is implied by this document.

- GO-1 Apply `20261107090004`-`005` to Acceptance (forward only).
- GO-2 Seven-flow Acceptance E2E on that Acceptance state, with evidence.
- GO-3 Create Production R2 private and site buckets, tokens and environment guards.
- GO-4 Production backup activation: bind environment, schedule, first restore test.
- GO-5 Production `migrate` runs (per namespace) and `rehash`.
- GO-6 Cutover window: `delta` clean, R2-only writes enabled.
- GO-7 Legacy Supabase cleanup, at least 30 days later.
