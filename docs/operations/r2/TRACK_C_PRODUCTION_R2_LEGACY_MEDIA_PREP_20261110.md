# Track C: Production R2 provisioning and legacy-media migration preparation

Date: 2026-11-10 (revision 2, after the owner planning decisions of 15:12Z; these are design choices, not hosted-write approval). Read-only work only. No hosted write, deploy, migration, copy, deletion or configuration change was made.
Builds on `R2_ONLY_ROLLOUT_RUNBOOK.md` (PR #149, owned by Track B; not edited here).
No seven-night trial, soak period or passive-monitoring gate is introduced: every gate below is a concrete check.

## 1. Live Production facts (read-only SQL, 2026-11-10, project `kkpkgjrweysgvhvkhzun`)

Ready media records versus what Supabase Storage actually holds (the same rule `media_migration_inventory` uses):

| Namespace | Ready rows | Object exists (copyable) | Bytes | Ready row, **no object** |
|---|---|---|---|---|
| avatar | 353 | 205 | 13.5 MB | 148 |
| portfolio | 995 | 831 | 206.8 MB | 164 |
| product | 9 | 8 | 2.1 MB | 1 |
| organization | 2 | 2 | 38 KB | 0 |
| certificate | 4 | 0 | 0 | 4 |
| request, verification | not in the inventory function; no Production rows expected (R2-only namespaces) | | | |
| **Total** | | **1,046** | **about 222 MB** | **317** |

- All 1,046 copyable rows are still `provider = supabase`; nothing is on R2 in Production.
- Storage buckets hold 1,080 objects (avatars 228, portfolio 838, product 9, organization 2, certificates 3 with 0 bytes). The 34 objects beyond the 1,046 are pending, deleted or orphaned (see the 2026-11-07 inventory in `PRODUCTION_MEDIA_INVENTORY_20261107.json`); they are reported, never copied or removed.
- Legacy object keys are flat: `<uuid>.<ext>` (avatar, portfolio), `<uuid>/<uuid>.<ext>` (organization), `<uuid>/<uuid>/<uuid>.<ext>` (product). Ids only, no names.
- Egress: about 222 MB against the Free plan allowance; the tool still requires `--remaining-egress-bytes`.
- Numbers drift (about 134 uploads in three days); re-run at each gate.

## 2. Planning decisions applied (proposed by the owner, not hosted authorization)
- Production buckets: private `aladdin-media-private`, site `aladdin-site-media`.
- Option A: migrated copies go to owner-scoped ids-only keys (`u/<user>/...`, `o/<org>/...`), via a new forward-only migration.
- All 317 ready rows with no stored file stay **unchanged**: no retirement, no deletion, no backfill.
- Real Supabase egress allowance is verified (read-only) before copying about 222 MB.
- Obsolete gate C-1 removed: Production is already at **207 migrations, latest `20261107090006`** (read-only check 2026-11-10).

## 3. Read-only findings
1. **The 317 baseline** (2026-11-10): avatar 148, portfolio 164, product 1, certificate 4 ready rows with no object. Planning rule: the copy tool reports them as `missing` and skips them. Reconcile and the delta are judged against this frozen baseline: a defect is **new** only if its record is not in the baseline list. The baseline list (record fingerprints only, no keys or owners) is produced once by the operator before any copy (step S-0) and stored with the evidence; any increase, any size mismatch, any orphan from a copy, or any record that was copyable and is now missing is a blocker.
2. **The 3 zero-byte certificate objects** (inspected read-only): all three are `application/octet-stream`, size 0, created 2026-10-25 (same day), and **no certificate row refers to them**. The 4 certificate rows are `ready`, `image/jpeg`, created 2026-09-30 to 2026-10-06, and have no object and no R2 record. So the empty objects are not damaged copies of those rows; they look like abandoned upload reservations. Nothing can be recovered for the 4 rows from Supabase. Left untouched; not copied (zero bytes, no record).
3. **Option A is not supported by the current migration tool.** `media_migration_switch` writes `storage_key` NULL and the tool writes the object at `<namespace>/<object_key>`. Needed (specified here, not yet written, because it must be proven on a local database before it is offered):
   - New migration (next free version after `20261107090006`): replace `media_migration_switch` so it inserts `storage_key = app.media_storage_key_for(namespace, key, owner, organization)` (the rule new uploads already use; legacy keys `<uuid>.<ext>`, `<uuid>/<uuid>.<ext>`, `<uuid>/<uuid>/<uuid>.<ext>` all match it); add service-role-only `media_migration_target_key(namespace, key)` returning that key so the tool never re-implements the rule.
   - `media_migration_rollback` currently sets `provider='supabase'`; the `storage_key` check requires `provider='r2'`, so rollback must also be changed (it must keep `storage_key` null-safe: set provider back and clear the key only through the function that owns the immutability rule, or keep the row on r2 and flip the pointer table instead). This is the real design risk and needs a local pgTAP proof.
   - Tool: `key(row)` becomes the target key; the tool refuses to write if the RPC returns nothing; journal, `rehash`, `delta`, `rollback` and `r2-reconcile.mjs` (which already reads `storage_key`) use the same value. Existing node tests extend with an in-memory target-key map; a permission contract JSON is regenerated from replay (gate reads the newest).
   - The migration applies to Production **after** Acceptance and before the copy. It is a new hosted migration, so it is its own GO (step C-1b below).
4. **Egress allowance:** not readable through the available tools (SQL cannot see it; the Supabase usage API is not exposed here). Owner read-only step E-1: in the Supabase dashboard open Project `kkpkgjrweysgvhvkhzun` > Settings > Usage (organization usage page), read Egress used and the plan limit for the current cycle, and give the remaining bytes. The tool refuses without `--remaining-egress-bytes` and applies its safety fraction; the plan prints FITS or DOES NOT FIT. The copy is about 222 MB (about 0.2 GB).
5. Production manifest is still null (`environment-manifest.ts`); pin account id `a4c2b7ac45e58a81691b9165492ce6a2` and both bucket names only after the buckets exist.
6. Request and verification namespaces are R2-only (migration 090005); the inventory function has no rows for them. Pass an explicit namespace list.

## 4. Gates without circular dependencies

Order is strictly: source preservation, then copy, then R2 backup. Neither backup waits on the other.

| Step | Owner GO? | What | Depends on |
|---|---|---|---|
| S-0 (read-only, no GO) | no | Operator (needs service-role + read keys in the shell only): `media-reset.mjs inventory`, `media-storage.mjs plan`; freeze the 317 baseline fingerprints and 1,046 copyable count | none |
| E-1 | owner read-only | read remaining Supabase egress | none |
| L-1 (local, no GO) | no | write and prove the Option A migration and tool change on a local database; open a draft PR | S-0 decisions already given |
| A-ACC | GO (Acceptance only) | push the new migration to Acceptance and run the copy tool there against its Acceptance media with the new key rule; reconcile | L-1 |
| **B-SRC** | **GO** | **one verified encrypted source-preservation backup**: database plus a copy of all Supabase Storage objects (1,046 copyable plus pending and orphans, about 222 MB, read-only against Production) with restore proof; stored in a backup bucket, never an application bucket | S-0 |
| C-1b | GO | apply the Option A migration to Production (plain forward push) | A-ACC green; B-SRC done |
| C-2 | GO | create `aladdin-media-private` and `aladdin-site-media`: `node scripts/r2-provision-plan.mjs --env production`, its `write` steps, then its `read` steps; 1-day R2 admin token | none technically; run after B-SRC |
| C-3 | code PR | pin manifest and `wrangler.jsonc` (account id, both buckets), update guard tests | C-2 |
| C-4 | GO | app R2 credential and Worker secrets/variables on `aladdin-frontend-production` as an undeployed version; `R2_STORAGE_ENABLED` and `R2_PRODUCTION_WRITES_APPROVED` stay false | C-3 |
| C-6 | GO | verified copy of the 1,046 objects: `plan`, `migrate --execute` per namespace (organization, product, avatar, portfolio), `rehash`, `r2-reconcile` judged against the 317 baseline, `delta` cutoverReady | B-SRC, C-1b, C-4, E-1 |
| **B-R2** | **GO** | **ongoing R2 media backup** plus one restore test (Track D) | C-6 (it backs up what now lives on R2) |
| C-7 | GO | cutover: promote the Worker version with R2 flags true; one test upload per namespace; `snapshot` before and after | C-6 clean and B-R2 passing |
| C-8 | GO | close Supabase Storage writes: `r2-only-storage-write-closure.sql` | C-7 verified |
| C-9 | not proposed | legacy deletion: manifest, tested path, final backup, written approval | n/a |

Credential isolation is not weakened: S-0 and the copy use read-only Production access in the operator shell; the app credential is scoped to the two Production buckets; backup credentials are separate and never valid for application buckets (the reconcile tool already refuses a bucket named `*backup*`). Rollback: before C-7 nothing user-visible changes; C-7 is a Worker version rollback (`39bdf3a2`); C-8 has an exact rollback script; sources and copies are both kept.

## 5. Done and next
- Done: live inventory, baseline definition, certificate inspection, migration-count check, circular-dependency-free gate order.
- Next local (no GO): L-1, the Option A migration and tool change with local proof, as a draft PR separate from #149.
- Blocked: A-ACC and later wait on L-1 and on Track B's Acceptance state; B-SRC wait on Track D's backup design.

## 6. Reconciliation with the owner execution board (2026-11-10 15:13Z)
- Matches: bucket names, Option A, 317 rows untouched, no C-1, source backup before copy, R2 backup after copy, C-9 closed.
- Board wording adopted: B-SRC must cover **all 1,080** physically present Supabase objects (1,046 copyable plus 34 pending/deleted/orphan and the 3 zero-byte certificate objects), with the 317 pointer defects logged in its manifest. The old Track C "C-5 before copy" wording is superseded.
- Zero-byte certificates: metadata level done (size 0, `application/octet-stream`, 2026-10-25, no record refers to them). **Bytes level not done**: it needs a read of the objects from the operator shell (HEAD/GET, count bytes, sha256 of the empty body); to be run inside S-0. Records and files are preserved.
- Option A migration and tool change: **not written yet.** The local Docker daemon is not running in this session, so I cannot prove the SQL (including the rollback and `storage_key` check interaction). It is the next local task (L-1) and will be a new version, never an edit of an applied migration; it must be rehearsed on Acceptance before any Production GO.
- Authorization stays database-decided: the prefix only locates bytes.
