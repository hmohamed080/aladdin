# Production migrations gate: 4 pending migrations (2026-11-08)

Preparation only. Nothing in this file was run against a hosted database. Every hosted step needs its own owner approval. Output contains counts, versions and names only: never paste passwords, tokens or keys anywhere.

Supersedes nothing; it adds the review, the ordering proof, the owner commands and the stop points on top of `MIGRATION_DRYRUN_RUNBOOK_20261108.md` (merged via #148) and `scripts/hosted-db/production-p2-push.sh`.

## 1. Pending set (verified)

Source: read-only Supabase `list_migrations` on Production `kkpkgjrweysgvhvkhzun`, 2026-11-08, compared with `supabase/migrations` on main `7d965394` (207 files; `supabase/` is identical to the release candidate `fc62c4b5`, and the pending set is unchanged since `a0aa2296`; re-read after #153 merged: the four are still absent, latest applied `20261107090003`, no remote-only version). The release-candidate SHA rule (runtime-path diff against `fc62c4b5` must be empty) lives in `WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md` (PR #145); this gate does not redefine it.

- Production: 203 applied, latest `20261107090003`, no remote-only version.
- Pending, exactly four, in apply order: `20261105090001_admin_staff_invitations`, `20261107090004_media_id_storage_keys`, `20261107090005_request_and_verification_media`, `20261107090006_admin_backup_control`.
- `20261105090001` is older than the latest applied version, so a plain `db push` refuses it: `--include-all` is required. The file carries a reviewed `migration-policy: out-of-order-reviewed` header with a sha256 pin in `supabase/migration-policy-reviewed.json`.
- Re-read the list immediately before applying: any difference from the above is a STOP.

## 2. Review of #148 (merged 2026-11-08T08:18Z)

Verdict: correct and safe to rely on, with three items to fix in a follow-up (none blocks the gate).

1. Frontend rollback target was wrong or ambiguous (corrected in `MIGRATION_DRYRUN_RUNBOOK_20261108.md` in this PR). #148 says the Production frontend rollback target is `39bdf3a2`. But the LIVE version is `a3b08a22` (100%, per the P-4 record). `39bdf3a2` is the version before it. After the release candidate (RC) is promoted, the instant rollback target is `a3b08a22`; `39bdf3a2` only applies if `a3b08a22` itself must be abandoned. Use `a3b08a22` in this runbook.
2. `WHATSAPP_OTP_PRODUCTION_ROLLOUT_CHECKLIST.md` still shows the old 195 applied / 8 pending numbers (#148 says so itself). Two documents give different counts; treat this file and #148's runbook as current.
3. `production-post-migration-check.sh` still expects 191 versions / `20261024090011`. It is stale and must NOT be used for post-apply verification here (it would fail on a correct database). Use section 6 instead.
4. Small: the restore text in #148 section C says Production has no scripted restore; correct, and consistent with section 7 below. Its "all four are additive" claim is true for schema, with the caveats in section 3 (constraint replacement, function redefinition).

No contradiction with main was found in the gate constants (203, `20261107090003`, the four versions). The gate unit tests are in `scripts/hosted-db/p2-gate.test.mjs`.

## 3. Static risk review per migration

All four were read in full. Common facts: each file is one transaction in `db push`; no `drop table`, `truncate`, `delete`, column type change or table rewrite; no data backfill beyond seed rows; no `lock table`, no cron or scheduler is created; every new function is `security definer` with `search_path=''` and explicit revokes.

| Migration | Changes | Locks and size | Permission change | Idempotent | Risk |
|---|---|---|---|---|---|
| `20261105090001_admin_staff_invitations` | New closed table `app.admin_staff_invitations` (RLS on, all client grants revoked), 6 functions (3 staff, 3 token holder: 2 granted to `anon`, masked), replaces `app.admin_prepare_platform_account` wrapper. Rewrites `ck_audit_action_known` by append (drop constraint, add NOT VALID, VALIDATE). | Brief ACCESS EXCLUSIVE on `audit_log` for drop and add (metadata only); VALIDATE takes SHARE UPDATE EXCLUSIVE and scans `audit_log`, which is the only size-dependent step. Guard raises if the constraint shape is unexpected. | Adds `anon` execute on `staff_invitation_lookup` and `staff_invitation_registration_check` (by design, masked, token-bound). | Constraint step is re-runnable (adds only missing actions); `create table` is not (single apply is expected). | Low to medium. Out-of-order. Constraint is dropped and re-added: a failure in the transaction rolls it back. Known reviewed difference: array element order of `ck_audit_action_known`, same set. |
| `20261107090004_media_id_storage_keys` | Adds nullable column `storage_key` with CHECK and a partial unique index on `media_storage_locations`; 2 new helper functions, BEFORE INSERT/UPDATE trigger, redefines `app.media_edge_grant`, new `public.media_storage_object` (service_role only). | Add nullable column without default is metadata only. Index build on a small table (11 rows on Acceptance; count Production first, section 5). Trigger fires on every insert/update of that table. | New execute grant to `service_role` only. | No (`create function`, `create trigger`, `add column` fail on rerun). | Low. Existing rows keep `storage_key` NULL and legacy keys; edge grant and lookup `coalesce` to the legacy key, so behavior is unchanged for old data and old code. |
| `20261107090005_request_and_verification_media` | Replaces the namespace CHECK (adds `request`, `verification`) and the storage_key CHECK (drops by definition lookup, re-adds wider); `create or replace` of 9 media functions, same signatures. | Constraint drop and add validates existing rows (small table). | None by signature; grants preserved by `create or replace`. | Mostly (create or replace), constraint adds not. | Low to medium. Depends on 090004 (the storage_key CHECK it replaces and `app.media_storage_key_for`); must run after it. The CHECKs only widen. |
| `20261107090006_admin_backup_control` | Inserts 4 `backup.*` permissions and role grants (super admin, administrator view), 4 closed tables under `app`, one singleton settings row, audit vocabulary via `app.audit_actions_add`, 12 functions, redefines `app.reauth_target_normalize` (superset of the 20261024090002 version: every old operation kept, three `backup.*` added). | New tables only; `on conflict do nothing` seeds. | New admin permissions (not auto-granted below Administrator view). Mutations are `service_role` only; browser reaches only `admin_backup_status`. | Seeds yes, tables and functions no. | Low. Dispatches nothing and schedules nothing; environment is empty so every action fails closed until an operator initializes it (a separate, later step). |

Dependencies: `090005` requires `090004`. `090006` is independent of the other three except it uses audit and reauth helpers that already exist in Production. `20261105090001` is independent (audit and admin RBAC only). Apply order is the filename order, and `--include-all` keeps it.

### Backward compatibility with the CURRENT live frontend `a3b08a22`

Verdict: compatible. Everything is additive or a widening, with no signature, grant or behavior change on any object the live frontend uses:
- Media: the live frontend does not set `storage_key`; the trigger only assigns keys to fresh R2 reservations that are unverified, and the live Worker is still on the Supabase media provider (R2 routing is off). The two new namespaces are unused by it. `media_edge_grant` returns the same object name for NULL keys.
- Admin: new RPCs and tables are not referenced by `a3b08a22`; `reauth_target_normalize` keeps every operation the live build uses.
- `ck_audit_action_known` only gains values.
- Not verified here: a live end-to-end run of `a3b08a22` against a migrated Production database (this review is static). The Acceptance apply and the post-apply smoke in section 6 are the evidence; Acceptance is the rehearsal, but note it is NOT yet at the same schema: Acceptance is at 203 / `20261107090002` and its own pending set is `20261107090003` to `090006` (it already has `20261105090001`), while Production's pending set is `20261105090001`, `090004`, `090005`, `090006`. Both end at 207, but the apply paths differ (Acceptance: `acceptance-apply.sh`, no `--include-all`; Production: `production-p2-push.sh`, `--include-all`). Acceptance proves `090004` to `090006` and the RC build, and does not exercise `20261105090001`'s out-of-order apply on a database that lacks it.

Does the RC frontend require them? Yes. Code in the RC calls `admin_staff_invite` and `staff_invitation_accept`, `admin_backup_status`, and `media_storage_object`. Promoting the RC before the four are applied breaks those routes. Hence: migrations first, promotion after.

### Safe ordering

Explicit statement: these migrations are forward-only. There is no down migration and the push is not reversible by `migration repair` or `db reset --linked`. The 0% frontend upload does NOT require them (an undeployed version serves no traffic and does not touch the database). Any promotion above 0% of the release candidate DOES require them, and must not start before post-apply verification passes.

1. Apply the four migrations (this gate).
2. Verify (section 6).
3. Only then upload and promote the frontend. A 0% frontend upload (version created, not deployed) is inert before or after the migrations: it serves no traffic and does not touch the database, so it may be done at any time; the gradual or 100% promotion must wait for step 2.
4. Frontend rollback to `a3b08a22` is instant and safe after step 1, because the schema is a superset.

## 4. Preconditions (all must hold)

- Acceptance has `090003` to `090006` applied and verified (207 applied; apply and post-check commands, gates and plan are owned by #153: `scripts/hosted-db/acceptance-apply.sh`, `acceptance-postcheck.mjs`, and the "Acceptance apply" section of `MIGRATION_DRYRUN_RUNBOOK_20261108.md`; not repeated here), `supabase-rls` green on the exact main SHA, and the Acceptance restore test reported PASS. The migration-permission contract is local-only (`scripts/migration-permission-gate.mjs` against the CI Docker stack); it cannot read a hosted database.
- Test files exist for all four: `supabase/tests/122_admin_staff_invitations_test.sql`, `104_media_id_storage_keys_test.sql`, `105_request_and_verification_media_test.sql`, `124_admin_backup_control_test.sql`, plus `admin_staff_invitation_concurrency_test.sh`. They run in CI (pgTAP on a local database), never on Production.
- Production has had no schema change since the 203 snapshot (history re-read shows 203 / `20261107090003`).
- Checkout clean and equal to `origin/main`.
- A named person is present who can run the snapshot and verify the backup (the owner), and a second person or the owner re-reads the dry-run output.

## 5. Backup gate

Production on Supabase has no hosted backup or PITR configured per `showroom-rc1-release-runbook.md` (`backups: []`). Confirm the current state in the Supabase dashboard (Database, Backups) and record it: if PITR or a daily backup exists, note the latest restore point's time, but do not rely on it alone. A fresh logical backup is required:

```bash
cd /d/projects/aladdin
bash scripts/hosted-db/production-recovery-snapshot.sh          # read-only dump; hidden password prompt
bash scripts/hosted-db/encrypt-backup.sh ~/aladdin-production-snapshot-<stamp>
```

Pass criteria, checked by the owner: snapshot reports history 203 / `20261107090003`, row counts validated, `.verified` file present from the encrypt step's decrypt-and-compare. The snapshot must be at most 60 minutes old when the push starts. The 2026-11-07 backup does not count. Record `select count(*) from public.media_storage_locations` and the `audit_log` row count from the snapshot's rowcounts file as the pre-apply baseline.

## 6. Owner-run commands (Git Bash, repo root)

One source of truth: the scripts from #148 own every command that touches Production. Do not retype `supabase link`, `migration list` or `db push` by hand; the scripts do them with the project-ref guard (`kkpkgjrweysgvhvkhzun`), the hidden password prompt and the `supabase/.temp` cleanup. Required order, no step skipped or reordered:

1. Fresh logical backup (read-only on Production; section 5): `production-recovery-snapshot.sh`, then `encrypt-backup.sh`. Stop point B.
2. Dry run plus every gate, no push: `bash scripts/hosted-db/production-p2-push.sh ~/aladdin-production-snapshot-<stamp> --check-only`. It checks clean checkout equal to `origin/main`, snapshot (project, 203 / `20261107090003`, row counts, at most 60 minutes old, checksums, encrypted copy and recovery proof), linked project is Production, exactly 203 applied and none remote-only, exactly the four pending, and `db push --dry-run --include-all` would push exactly those four in order. It cannot push. Review its output (stop point C).
3. Push, only with a separate GO: `bash scripts/hosted-db/production-p2-push.sh ~/aladdin-production-snapshot-<stamp>` (same script, no flag). It re-runs all gates, requires the typed phrase `PUSH 4 MIGRATIONS TO PRODUCTION` (stop point D), re-checks the snapshot age after the prompt, runs `db push --linked --include-all`, then requires 207 applied and none pending.
4. Post-apply verification below (read-only), then stop point E before any promotion.

The 60-minute snapshot limit covers steps 1 to 3 together: if review of step 2 runs long, take a new snapshot. Optional extra, read-only, run before step 2 if wanted: `node scripts/migration-history-guard.mjs list.json --expect plan` on a `migration list --linked --output-format json` file (the script already runs the equivalent `p2-gate.mjs pending` check).

Do not run `db push` by hand, `migration repair`, SQL Editor DDL or `db reset --linked`. Do NOT run `scripts/hosted-db/production-post-migration-check.sh`: it still expects 191 versions / `20261024090011` and would report a correct database as failed. Its fingerprint baseline is also the 191-migration one.

Environment guards in the scripts, as reviewed: wrong project is refused (`project-ref` must equal Production); snapshot of another project is refused; dirty tree or HEAD different from `origin/main` is refused; every `--linked` call happens after the guard; `trap` removes `supabase/.temp` on exit, so a later read-only check must link again and re-verify the ref first. The scripts do not check that Acceptance is done or that the live frontend is `a3b08a22`; those are manual preconditions (section 4).

### Post-apply verification (read-only)

The script's cleanup unlinks the project. To query again: `pnpm exec supabase link --project-ref kkpkgjrweysgvhvkhzun` (hidden password), `cat supabase/.temp/project-ref` must print that ref, run the SELECT-only file with `pnpm exec supabase db query --linked -f <file>`, then `rm -rf supabase/.temp; unset SUPABASE_DB_PASSWORD`. The dashboard SQL editor with SELECT only is equivalent. Never put anything but SELECT in these files.

```sql
-- history: 207, none missing, latest 20261107090006
select count(*), max(version) from supabase_migrations.schema_migrations;
select version from supabase_migrations.schema_migrations
 where version in ('20261105090001','20261107090004','20261107090005','20261107090006') order by 1;  -- 4 rows

-- 090004 / 090005
select count(*) as rows_total, count(storage_key) as with_key from public.media_storage_locations;   -- rows_total = baseline, with_key = 0
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.media_storage_locations'::regclass and contype = 'c';   -- namespace check lists request and verification

-- 090001
select count(*) from app.admin_staff_invitations;                                  -- 0
select convalidated from pg_constraint where conname = 'ck_audit_action_known';    -- true
select pg_get_constraintdef(oid) like '%admin_staff.invited%' from pg_constraint where conname = 'ck_audit_action_known';  -- true

-- 090006
select key from public.admin_permissions where key like 'backup.%' order by 1;     -- 4 rows
select count(*) from app.backup_environment;                                      -- 0 (not initialized: correct)
select count(*) from app.backup_runs;                                             -- 0

-- no API role can mutate backups
select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as authed, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('admin_backup_request','admin_backup_activate','admin_backup_initialize','backup_report_run');  -- all false
```

Also run the Supabase security and performance advisors (read-only) and compare with the pre-apply set; any new ERROR is a STOP. Then a live smoke of the CURRENT frontend `a3b08a22` (sign-in, a showroom page, one media image load, an admin page) before any promotion.

## 7. Rollback gates and decision tree

What can be rolled back:
- Frontend: instant. Reactivate `a3b08a22` (the live version today). Safe at any point after the migrations, because the schema is a superset. This is the first and cheapest response to any frontend symptom.
- Migrations: forward-only. There are no down migrations for these four, and none is documented. Do not hand-write destructive reverse SQL.

Decision tree if something is wrong after the push:
1. The push script stopped mid-way: each file is its own transaction, history stops at the failing version. Read-only `migration list`. Fix forward with a new migration and re-run the same gated push after a new dry run. No repair.
2. Schema applied but a frontend route misbehaves: roll the frontend back to `a3b08a22`. Leave the schema in place.
3. A migration object is wrong (function, constraint): write a compensating forward migration, review it like any other, apply through the same gate. The new media column and tables are inert; leaving them is the default.
4. Data corruption or loss (not expected: no data is rewritten, deleted or backfilled): stop all writes, do not improvise. Restore is from the section 5 logical snapshot into a NEW project or a rebuilt database; there is no scripted Production restore and writes since the snapshot are lost. This needs its own owner-approved plan.

Abort criteria (do not start, or stop): history is not exactly 203 / `20261107090003` before apply; dry run lists anything other than the four versions or a different order; snapshot older than 60 minutes, not verified, or counts invalid; Acceptance not at 207 or its restore test not PASS; `supabase-rls` not green on the main SHA; checkout not clean; any advisor ERROR after apply; any verification query differing from expected.

Exact stop points, each needing a fresh explicit owner GO: (A) after Acceptance verified; (B) after the Production snapshot and encrypted verify; (C) after dry-run and `--check-only` output is reviewed; (D) typed push phrase; (E) after post-apply verification and before any frontend promotion; (F) after the frontend smoke and before WhatsApp activation, which is separate and not part of this gate.
