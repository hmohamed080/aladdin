# Consolidated database baseline and Production migration plan (2026-10-22)

Scope: the migration set that main plus the media/verification PR stack (#88, #89, #91, #92, #94, #97) produces together, how it was verified, and how it reaches the hosted databases without losing data.

## The baseline

- 180 migration files. The count is a result, not a target: it is 163 RC2 files (frozen by `supabase/permissions/baseline.json`), main's `20261017134139_account_entry_allowed` and `20261020090001_registration_data_sync`, and the 15 migrations that exist only on the PR stack.
- Manifest: `cd supabase/migrations && shasum -a 256 *.sql | shasum -a 256` = `5a26a710d5f54cb0a4eeed5435c93bf873a44517a202afd8af214b1036277e37`.
- Main's `20261020090001` is byte-identical to main. It may already be applied somewhere, so it is never edited.

### Why the 15 PR-only migrations moved

Main's `20261020090001` patches `admin_users_list` in place and expects the text main has. The PR stack's `admin_users_account_type` rewrote that function first, so on a fresh replay main's migration failed (`expected 1 match(es) of u\.primary_account_type = p_account_type, found 0`). On an environment that already has main (the likely Production state), `db push` applies the PR migrations after it. That order is the only one that works in both places, so the 15 files moved to `20261021090001`..`15` in their original order:

| Old version | New version | Name |
|---|---|---|
| 20261017160000 | 20261021090001 | business_verification_type |
| 20261017160001 | 20261021090002 | business_verification |
| 20261018090000 | 20261021090003 | admin_users_account_type |
| 20261018090001 | 20261021090004 | secondary_phone_reservations |
| 20261018100000 | 20261021090005 | rc2_verified_media_storage |
| 20261018100001 | 20261021090006 | reconcile_rc2_media_function_permissions |
| 20261018100002 | 20261021090007 | restrict_rc2_function_creator_defaults |
| 20261018100003 | 20261021090008 | rc2_private_media_application_delivery |
| 20261019100000 | 20261021090009 | media_edge_authorization |
| 20261019100001 | 20261021090010 | organization_media_resolve_volatile |
| 20261019120000 | 20261021090011 | historical_media_purge |
| 20261019130000 | 20261021090012 | rls_platform_check_initplan |
| 20261019140000 | 20261021090013 | data_api_session_revocation |
| 20261019163000 | 20261021090014 | storage_realtime_session_revocation |
| 20261019170000 | 20261021090015 | media_videos |

`20261021090003_admin_users_account_type` also keeps main's `registered_account` key in `admin_users_directory` and `admin_user_detail`; without it main's tests 82 and 87 fail. None of the old versions has run on a hosted project (staging was audited at 164 migrations, max `20261017134139`), so the rename changes no recorded history. Permission contracts and every code/doc reference were renamed with the files.

Other changes: exact permission contracts for main's three new functions (`supabase/permissions/20261020090001.json`, carried into every later contract); the permission gate now treats `BEGIN`/`END` as transaction control only at the start of a statement, because main's backfill uses `CASE ... END`.

## Local verification (simulation, not a hosted result)

| Check | Result |
|---|---|
| Fresh `db reset` (180 migrations + seed), then `supabase test db` | 130 files, 5,791 tests, PASS; repeated after a second reset |
| Upgrade path: exact RC2 163 baseline + seed, then each later migration atomically with the permission gate | all 17 PASS, 635 exact function contracts |
| Fresh and upgrade schemas | identical fingerprint (`scripts/hosted-db/schema-fingerprint.sql`) |
| `db lint --schema public,app` | warnings only, no errors (main's two new functions add "never read variable") |
| Business-phone parity | 9,058 cases, 245 countries, 0 mismatches |
| Concurrency: last owner, account approval, lead transition | all PASS |
| Gate and media-storage node tests | 4/4, 15/15 |
| Backup then restore into an empty stack | identical fingerprint and row counts for all 145 tables; pgTAP 5,791 PASS on the restored copy |
| Production rehearsal on a Production-like copy (main's 165 + seed) | restore exact; 15 pending applied; schema equals the baseline; only expected rows added |

pgTAP needs the demo seed, which holds demo accounts and passwords, so it never runs on a hosted project. On a hosted project the schema fingerprint is the evidence that it carries the tested schema.

## Backups: what `supabase db dump` misses

A restore from `db dump` alone (roles, schema, data) was tested and is **not** faithful:

- every `storage.objects` policy is missing, so media authorization is gone;
- the `auth.users` trigger `on_auth_user_created` is missing;
- the `media_edge` to `postgres` membership is missing;
- anon and authenticated end up with TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on public tables, from the platform's default privileges;
- the data dump includes Storage tables owned by `supabase_storage_admin` (vector and iceberg tables), so the restore fails unless they are excluded.

`scripts/hosted-db/security-tail.sql` is a read-only query that emits the statements for exactly those objects: table, column and function privileges in the source ACL order, auth/storage policies and triggers, and role memberships. The restore applies it last, in the same transaction. The dump also drops whole-line `--` comments inside function bodies. That has no effect on behaviour, and the fingerprint ignores it.

## Hosted Acceptance (`nxossqhdfltcqdwvbewi`)

Status: untouched, still 105 migrations, including four pre-RC2 media versions that the baseline does not carry. The rebuild was chosen on 2026-10-20 and still needs the owner's approval before it runs.

1. `bash scripts/hosted-db/rebuild-acceptance.sh` takes a backup only: roles, schema, data, security tail, fingerprint, row counts, history and checksums, into `~/aladdin-acceptance-backup-<time>`. Nothing changes.
2. After approval, `--rebuild` runs `db reset --linked --no-seed` and compares the hosted fingerprint with `local-noseed-fingerprint.txt`.
3. If needed, `restore-acceptance.sh <backup>` empties the project, restores it and verifies the fingerprint and row counts.
4. Then, through the Supabase connection: advisors, the `media_edge_worker` role, and real API/auth/RLS/media tests.

## Production (`kkpkgjrweysgvhvkhzun`): data-preserving plan

Never reset, rebuild or overwrite Production. The only write is an incremental `supabase db push` of the pending versions, after a backup and a rehearsal, and with the owner's approval.

1. **Rehearse (read-only on Production).** Run `bash scripts/hosted-db/production-rehearsal.sh` on the owner's machine. It:
   - backs Production up (same kit as Acceptance) to `~/aladdin-production-rehearsal-<time>/backup`, readable only by the owner;
   - lists the pending versions;
   - stops if Production has a version the baseline lacks, or if a pending version sorts before Production's latest;
   - unlinks Production;
   - restores the backup into a throwaway local stack and proves the restore is exact;
   - applies the pending migrations with `migration up`, the same mechanism `db push` uses;
   - writes `REPORT.txt`: counts and hashes only, no row data.

   Expected for main's state: 15 pending, or 16 if `20261020090001` has not been pushed yet; schema equals the baseline. Rows are only added, and only in `admin_permissions` (+2), `admin_role_permissions` (one per role that receives the new permissions; +3 on the seeded copy), `storage.buckets` (+1) and the migration history. Any other row change, a constraint failure or a fingerprint difference is a NO-GO.
2. **Data-dependent steps the rehearsal covers.**
   - `20261020090001` backfills `organization_contacts`.
   - `20261021090002` re-adds `ck_verifications_type_matches_subject` and validates `ck_audit_action_known` against existing rows.
   - `20261021090005` replaces the `storage.objects` media policies. Existing objects keep the legacy Supabase provider: no row is rewritten and no object moves.
   - `20261021090011` only creates the purge machinery. It deletes nothing until a worker is run with the owner's approval.
3. **Push.** From the same pinned commit: `supabase db push --linked --dry-run`. It must list exactly `pending.txt`. Then `supabase db push --linked`.
4. **Verify.** Hosted fingerprint against the baseline, row counts against the backup (only the expected inserts), advisors, and the permission check on the inventory.
5. **Rollback.** The migrations are forward-only. Recovery is `restore-acceptance.sh`'s procedure against Production with the rehearsal backup. That is destructive and needs separate approval, and it loses writes made after the backup, so the push is scheduled in a quiet window.

Merge order matters: these renames live at the top of the PR stack, so the stack merges together. Merging an older PR branch alone would bring back the old versions.
