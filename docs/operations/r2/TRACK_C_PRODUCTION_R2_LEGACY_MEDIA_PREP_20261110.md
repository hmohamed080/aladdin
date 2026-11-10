# Track C: Production R2 provisioning and legacy-media migration preparation

Date: 2026-11-10. Read-only work only. No hosted write, deploy, migration, copy, deletion or configuration change was made.
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

## 2. Findings that change the plan

1. **317 ready rows point at no stored file** (avatars 148, portfolio 164, product 1, certificates 4). They cannot be copied. They are not data the migration can fix. The owner must decide per namespace: keep as-is (users see broken or default images and re-upload), or retire the dead rows through the app's normal path. Certificates are the sensitive case: all 4 required certificates have no file (3 zero-byte objects exist in the bucket). Those four users must re-upload; nothing in R2 can substitute.
2. **Layout of migrated copies needs an owner decision.** `media-storage.mjs` writes copies to the legacy key `<namespace>/<object_key>` (for example `avatar/<uuid>.jpg`) and `media_migration_switch` leaves `storage_key` NULL, as migration 20261107090004 documents. New uploads use `u/<user>/...` and `o/<org>/...`. Result if nothing changes: two layouts in one bucket, and legacy objects are not under the owner's `u/` prefix. Options:
   - **A (recommended):** copy straight to the ids-only key and set `storage_key`. It needs a small tool change plus a new forward migration (`media_migration_switch` takes the key; the immutable-key trigger and check already allow a verified insert only if the key is supplied at insert). Cost is one more hosted migration on Acceptance then Production. One layout, prefix-scoped export and deletion, matches the 2026-10-29 and 2026-10-31 decisions.
   - **B:** keep legacy keys (no code change). Works today; the bucket keeps a second, flat layout permanently. The 2026-10-29 decision said old keys stay valid, so this is allowed.
   I did not start A: it adds a migration, so it needs your choice first.
3. **Key shape is not ownership proof.** Reconcile checks key against the record's own owner or organization; isolation evidence still comes from the Acceptance E2E (Track B).
4. **Production manifest is still null** (`environment-manifest.ts`): the app refuses Production R2 until a reviewed commit pins account id `a4c2b7ac45e58a81691b9165492ce6a2` and the bucket names. Pin only after the buckets exist. Confirmed names: site `aladdin-site-media`. Private bucket `aladdin-media-private` is the ADR-0018 proposal: **please confirm the name**.
5. Request and verification namespaces are R2-only (migration 090005) and absent from `media_migration_inventory`, so the copy tool's default namespace list includes two namespaces with nothing to copy. Harmless; pass an explicit list.

## 3. Exact hosted changes that need an OWNER GO (each separate, in this order)

| GO | Hosted change | Exact command or action | Precondition | Verification |
|---|---|---|---|---|
| C-0 | Decisions only | Answer the 4 questions in section 5 | none | n/a |
| C-1 | Apply `20261105090001` (`--include-all`), `090004`-`090006` to Production | per `MIGRATION_DRYRUN_RUNBOOK_20261108.md` (Track D/DB owns backup before) | fresh encrypted Production backup; Acceptance green | migration list 207; permission contracts |
| C-2 | Create Production R2 buckets | `node scripts/r2-provision-plan.mjs --env production` then its `write` steps (private `aladdin-media-private`, site `aladdin-site-media`, CORS, lifecycle); 1-day R2 admin token | C-1 | its `read` steps: WEUR, r2.dev off, no custom domain, rules equal files |
| C-3 | Pin manifest and `wrangler.jsonc` (code, reviewed PR) | account id, both bucket names; update guard tests | C-2 | CI guard tests |
| C-4 | R2 app credential and Worker secrets/variables for `aladdin-frontend-production` (undeployed version) | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID`, `R2_PRIVATE_BUCKET`, `R2_SITE_BUCKET`, `MEDIA_LEGACY_STORAGE_WRITES=false`; keep `R2_STORAGE_ENABLED` and `R2_PRODUCTION_WRITES_APPROVED` false until C-7 | C-3 | bindings read back |
| C-5 | Independent R2 media backup active plus one restore test | Track D | C-2 | restore test run |
| C-6 | Verified copy of the 1,046 objects | per namespace, smallest first: `media-storage.mjs plan`, then `migrate --execute --namespace organization,product,avatar,portfolio --max-bytes N --journal f --remaining-egress-bytes N`, `rehash`, `node scripts/r2-reconcile.mjs --project kkpkgjrweysgvhvkhzun`; reads Supabase, writes R2 and DB pointer, never deletes | C-5, fresh DB backup, decision on layout (A needs its migration first) | missing 0, sizeMismatch 0, `delta` cutoverReady |
| C-7 | Cutover: promote the Worker version with `R2_STORAGE_ENABLED=true`, `R2_PRODUCTION_WRITES_APPROVED=true`, no Supabase fallback; one upload per namespace with a test account | `media-reset.mjs snapshot` before and after | C-6 clean, rollback id `39bdf3a2` recorded | compare passes |
| C-8 | Close Supabase Storage writes | `supabase/activation/r2-only-storage-write-closure.sql` (rollback file exists) | C-7 verified | snapshot/compare |
| C-9 | Legacy deletion | **Not proposed.** Needs its own manifest hash, a tested deletion path (none exists), a final backup, and written approval | owner reversal of 2026-11-08 stays: nothing is deleted | n/a |

Rollback: before C-7 nothing user-visible changes; C-7 is a Worker version rollback; C-8 has an exact rollback script; copies and originals are both kept throughout.

## 4. Done locally in this track
- Live read-only inventory and the findings above.
- This plan. No code changed (the manifest pin and any layout change wait for decisions and bucket creation).

## 5. Owner questions (C-0)
1. Confirm Production private bucket name `aladdin-media-private`.
2. Layout of migrated copies: A (ids-only `u/`/`o/` keys, one extra migration) or B (legacy flat keys)? Recommendation: A.
3. The 317 ready rows with no file (including all 4 certificates): leave for users to re-upload, or retire the dead rows through the app?
4. Confirm the Production Free-plan egress budget for about 222 MB, or provide the remaining figure for `--remaining-egress-bytes`.

## Blocked
- C-1 onward waits on the Acceptance E2E (Track B, still needing genuine Acceptance Turnstile) and the Production backup (Track D).
