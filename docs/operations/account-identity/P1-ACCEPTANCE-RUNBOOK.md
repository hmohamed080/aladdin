# P1 Acceptance runbook (M1, with the pending media migration)

Status: **prepared 2026-11-11, nothing in it has been executed against a hosted project.** Every hosted write step below needs
its own explicit owner GO. Counts and hashes only; never record personal data. Authority: master plan v1.5 (sections 3.10, 3.11).
Target project: Acceptance `nxossqhdfltcqdwvbewi` ONLY. Production `kkpkgjrweysgvhvkhzun` is out of scope (a separate request).

## 0. Facts this runbook is pinned to (read-only reads, 2026-11-11)

| Fact | Value | Evidence |
|---|---|---|
| Acceptance history | **207 applied, latest `20261107090006`, no gaps** | Supabase MCP `list_migrations` 2026-11-11T10:14Z, compared with `supabase/migrations` of `origin/main` `2aa365a5` (208 files) |
| Pending on Acceptance (repo minus applied) | **exactly one: `20261110090001_media_migration_ids_only_keys.sql`** (on `main`); M1 `20261110090002` is on #171 only, so it is pending once #171 merges | set difference, computed with `comm` |
| Production history | 207 applied, latest `20261107090006` (same list, compared by eye; not machine-diffed) | `list_migrations` 2026-11-11 |
| Acceptance schema equals a clean replay of the 207 repo migrations | **PASS**: all 12 catalog-fingerprint sections (functions, function grants/owner, columns, relations/RLS/ACLs, views, indexes, constraints, triggers, policies, column grants, types, counts) have identical md5 on hosted Acceptance and on a local replay of the 207 migrations | `scripts/hosted-db/catalog-fingerprint.sql`, SELECT only, 10:3xZ |
| Function permissions | **PASS**: 753 functions, aggregate md5 `da4d2dd7d95a27ce3e8292d351b6f983` identical to the local replay, which passes `verify-permissions-readonly.mjs ... 20261107090006` (753/753) | read-only `execute_sql`, 10:32Z |
| Counts (aggregates only) | auth users 23, public users 23, `media_storage_locations` 18, `storage.objects` 1, `app.backup_settings` 1 | `execute_sql` 10:35Z |
| Admin backups console | **initialized 2026-11-11 12:29:19Z** (`app.backup_environment` 1 row, `environment=acceptance`; audit action `backup.environment_initialized`); `app.backup_runs` 0, `app.backup_run_events` 0, `app.backup_settings` 1. Schedules still off (`ACCEPTANCE_BACKUP_SCHEDULE=off`, `PRODUCTION_BACKUP_ENABLED=false`). An earlier version of this runbook said "0 rows": obsolete | `execute_sql` counts 2026-11-11 ~13:00Z |
| Newest restore-verified Acceptance snapshot | **`aladdin-acceptance-20261108T094450Z`**: backup run `42468447400` PASS (2026-11-08 09:44-09:49Z), restore run `42469078723` PASS (09:53-09:56Z); 167 tables, 2584 rows, 203 migrations, 9 R2 media files, sha256 `ea38cefd...d67d` (matches manifest and metadata), RESULT: PASS | `gh run view` / job logs, 2026-11-11 |
| Snapshot still exists (read-only) | `db/acceptance/daily/2026/11/08/aladdin-acceptance-20261108T094450Z.tar.age` 6,063,850 bytes (equals the backup log) plus `.json`, `.r2media.json`, `.r2media.tsv.age`, and a weekly copy under `db/acceptance/weekly/2026/`, in bucket `aladdin-acceptance-backups-weur` (52 objects under `db/acceptance/`). Bucket lock rules: **none configured** (`/lock` returns `rules: []`), so the objects are present but not protected by a bucket-level retention rule | Cloudflare API `GET .../r2/buckets/.../objects` and `/lock`, 2026-11-11. Existence and size only; the object bytes were not downloaded or re-decrypted (the 2026-11-08 restore did) |
| Supabase branching | none (`list_branches` returns `[]`) | MCP |
| Cloudflare Workers Builds git triggers | none on `aladdin-frontend-production`, `-preview`, `aladdin-backend-production`, `aladdin-whatsapp-otp-production` (read-only API) | MCP, 2026-11-11 |
| Vercel | team `aladdin8` has 0 projects | MCP |

## 1. OWNER DECISION D1: how the media migration is handled

`supabase db push` applies **every** pending file in order. So the standard push of M1 would also apply
`20261110090001` unless it is already applied. The two migrations touch different objects (the media one changes four
`media_*` functions, M1 changes three registration/admin functions; both are function-only, no table, column, index or grant
change; proven by the catalog diff in 4.3). Options:

| Option | Plan name (`acceptance-gate.mjs`) | What happens | Notes |
|---|---|---|---|
| **A (recommended): media first, its own GO** | `media`, then later `m1` | 207 -> 208 now (from `main`, M1 is not there yet), then 208 -> 209 after #171 merges | The media migration is Track C step A-ACC (`docs/operations/r2/TRACK_C_PRODUCTION_R2_LEGACY_MEDIA_PREP_20261110.md`): it is intended for Acceptance **before** Production and is followed by an owner-run copy rehearsal there, which is its own GO. Keeps each change reversible and attributable |
| B: both in one push | `media+m1` | 207 -> 209, one plain push, one GO, the two files in order | Acceptable only if #171 is merged first. Couples the Track C media change to P1. The gate pins exactly these two files and the post-contract `20261110090002` (754 functions) |

Anything else pending (a third file, a missing file, an older file needing `--include-all`) is refused by the gate. If the owner
does not decide, do nothing: both are safe to wait on.

## 2. Pre-flight (read-only; the hosted reads need the owner's DB password or the MCP session)

| # | Step | Command / action | Authorizes | Success criteria | Stop if |
|---|---|---|---|---|---|
| P0 | Dashboard integrations off | Owner checks the Supabase dashboard (Integrations -> GitHub; Branching off) and the Cloudflare dashboard for Pages Git integration | owner | none enabled for this repository | any enabled: do not merge #171/#173 |
| P1 | Heads and CI per exact SHA | `gh pr view 171 --json headRefOid,mergeable`, `gh pr checks 171` (same for #173) | none | head green on every check, MERGEABLE | any red or conflicting |
| P2 | Re-read history | `supabase migration list --linked --output-format json` (or MCP `list_migrations`) | owner (DB password) | 207 applied, latest `20261107090006` (or 208 / `20261110090001` after A) | any other count or a remote-only row |
| P3 | Scripted preflight | `bash scripts/hosted-db/acceptance-preflight.sh <plan>` from a clean checkout equal to `origin/main` (never pushes; hidden password prompt) | owner (DB password) | `Acceptance gate: ok (plan ...)` and history guard ok | gate REFUSED |
| P4 | Permission baseline | `bash scripts/hosted-db/verify-permissions-readonly.sh acceptance 20261107090006` (SELECT only; the script refuses non-SELECT SQL) before `media`; `... 20261110090001` before `m1` | owner (DB password) | `PASS 753 functions match contract 20261107090006` (or 754 / `20261110090001`) | any difference |
| P5 | Advisor baseline | Supabase `get_advisors` security and performance; save the lint names and counts | none | recorded (2026-11-11: security has 5 lint groups: `rls_enabled_no_policy`, `function_search_path_mutable`, `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`, `auth_leaked_password_protection`) | n/a (baseline) |
| P6 | Row-count baseline | `scripts/hosted-db/table-counts.sql` and `acceptance-structure.sql` (counts only); the apply script does this itself | owner | recorded | n/a |

The CI side of "permission-gate upgrade compatibility": `supabase-rls.yml` runs `migration-permission-gate.mjs ... upgrade` on the
PR head (on #173 `42d5218d`: run `42995730943`, `PASS atomic migration 20261110090002_...` and `PASS 754 exact function permission contracts`).
The gate itself cannot read a hosted database; the hosted counterpart is P4/post-check with `verify-permissions-readonly.sh`.

## 3. Backup and recovery evidence (corrected 2026-11-11; supersedes the earlier "fresh backup is GO-1" assessment)

**What exists.** Snapshot `aladdin-acceptance-20261108T094450Z` (backup run `42468447400` PASS, restore run `42469078723` PASS: sha256 matches, decryption and part checksums ok, Auth/Storage schema identical, row counts exact 167 tables / 2584 rows, 203 migrations, media inventory exact 9 files, 9 of 9 sampled files restored). The object is still present and the size matches (section 0). The older `...T060819Z` (restore run `42461215127`) was wrongly named in earlier versions as the newest and wrongly credited with run `42469078723`; it is superseded.

**What it is NOT.** It is a **historical recovery reference, not a current full recovery point.** It is a data-only dump (`public`, `app`, `auth`, `storage`, `supabase_migrations`) taken at 203 migrations. It does not contain: the four 2026-11-07 migrations' schema (Acceptance is at 207), the writes after 2026-11-08 09:44:50Z (audit log shows phone sets, onboardings, username sets, avatar, product and organization-image edits until 2026-11-10 14:13Z; the latest sign-in is 2026-11-10 15:59Z), or the Admin console initialization of 2026-11-11 12:29Z. Restoring it would lose that data and was never tested against the 207-migration schema. The bucket has no lock rule. Backup schedules are off; the green scheduled "Daily backup" runs in `aladdin-backups` are plan-only (the `backup` job is skipped).

**What "function-only" does and does not mean (corrected 2026-11-12).** Both pending migrations contain only `CREATE [OR REPLACE] FUNCTION`, `COMMENT ON FUNCTION`, `REVOKE` and `GRANT`: no table, column, index, constraint or trigger DDL and no top-level DML, so applying them **rewrites no stored row** (proven for the media migration by row digests, P1-EVIDENCE 8.4). That is NOT "no behaviour change": M1 changes the runtime behaviour of `my_registration_state`, `app.profile_completion` and `admin_users_directory` (by design), and the media migration changes the **trigger function** `app.media_storage_key_assign()` (the key is no longer immutable for the two migration functions), the semantics of `media_migration_switch` (it now records an ids-only `storage_key`) and `media_migration_rollback` (it now clears the key), and adds `media_migration_target_key`. Earlier text implying function-only migrations cannot change behaviour was wrong. The recovery for such a change is not a data restore but a **locally tested forward-fix** (a new migration), pinned by sha256 in `acceptance-gate.mjs` and checked before the password prompt:
- **M1:** `scripts/hosted-db/forward-fix/m1-restore-previous.sql` (PR #179; same bytes as [drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql](drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql)), sha256 `5fe0da1eb5f08143b52ff90c41294d7e0e45ed7b7017926b6296898acfd28045`. Tested: after M1 plus the script the catalog fingerprint equals the pre-M1 fingerprint.
- **Media:** `scripts/hosted-db/forward-fix/media-restore-previous.sql` (PR #179), sha256 `4f0f4ce33ed49ca85555756ff7186a33da6d3b6cca17f391da9bc4daf735f270`. It restores the three pre-media definitions (md5-identical to hosted Acceptance today) and drops `media_migration_target_key`. It carries a **data-safety guard**: it REFUSES to run while a switched object (open ledger row) holds an ids-only `storage_key`, because the previous rollback function cannot undo such a row (it would violate `media_storage_locations_storage_key_check`) and the previous switch would no longer recompute the key. So it is valid **only before the Track C copy rehearsal** calls `media_migration_switch` under the new semantics. After that, rows have to be rolled back with the current rollback first, or a different forward-fix designed. Tested on an isolated stack at 207 migrations (P1-EVIDENCE 8.4): fingerprint back to the pre-media state exactly, grants 753/753, no media row changed, pgTAP 126 (31 assertions).
- It never touches stored media or R2 objects; it is not applied anywhere.

`acceptance-apply.sh` therefore needs **no backup label for any plan**; an optional `--backup-label` is accepted only for the pinned restore-verified snapshot and is recorded as a historical reference, never as a current recovery point.
- All plans keep the history guard, exact dry run, permissions vs contract, row-count, structure, catalog-fingerprint and catalog-diff gates.

**A fresh, restore-tested backup remains MANDATORY (owner GO each time) before any of:** M2 `20261111090001`, M3 `20261111090002`, the Auth metadata / `identity_data` cleanup, the audit-log username redaction, any Production step, or any other change that writes or deletes data. Procedure for those (owner GO: a backup run writes objects to the backup bucket, read-only on the database):
1. `gh workflow run "Daily backup" --repo hmohamed080/aladdin-backups -f label=acceptance -f request_id=p1-pre-<step>`; success = the `backup` job (not just `plan`) is `success`; note the label `aladdin-acceptance-YYYYMMDDTHHMMSSZ`.
2. `gh workflow run "Monthly restore test" --repo hmohamed080/aladdin-backups -f label=acceptance -f backup_key=<db/acceptance/.../snapshot.tar.age>`; success = the `restore` job is `success` with RESULT: PASS. A green `plan` with a skipped `restore` job is NOT a pass.
3. Freshness: repeat 1-2 if any migration, user-visible write or deploy to Acceptance happened between the snapshot and the step.
4. Pin the new label in `RESTORE_VERIFIED_SNAPSHOTS` (`acceptance-gate.mjs`) only after the restore reports PASS. Also consider turning the Admin console schedule on (owner decision) and a bucket lock rule (none today).

## 4. Apply

### 4.1 Plan A (recommended): `media`, then `m1`

Step M-1 (OWNER GO; hosted migration). From a clean checkout equal to `origin/main` (any SHA that contains `20261110090001` and not M1):
`bash scripts/hosted-db/acceptance-apply.sh --plan media --sha <40-char origin/main sha>` (no backup label; the pinned media forward-fix is checked first).
The script: checkout gates, hidden password prompt, link, pre checks (history 207, dry run lists exactly `20261110090001`, permissions vs `20261107090006`,
counts, structure, catalog fingerprint), the typed confirmation `APPLY media TO ACCEPTANCE`, `supabase db push --linked` (no `--include-all`, no repair),
post checks (history 208, permissions vs `20261110090001`, counts, catalog diff limited to `app.media_storage_key_assign`,
`public.media_migration_target_key` (new), `public.media_migration_switch`, `public.media_migration_rollback`). It prints PASS only when all hold.
After it: the Track C copy rehearsal (A-ACC) is a **separate GO** in the r2 runbook, not part of this one.

Step M-2 (after #171 merged, OWNER GO; repeat section 2 first): same script with `--plan m1` and the new `main` SHA, **no `--backup-label`** (the pinned forward-fix is checked instead).
Expected: history 208 -> 209, pending before = exactly `20261110090002`, permissions vs `20261110090001` before and `20261110090002` after (754 functions), catalog diff limited to
`public.my_registration_state`, `app.profile_completion`, `public.admin_users_directory`.

### 4.2 Plan B: `media+m1`

Not recommended (one GO covers two behaviour changes that are better verified separately). Only after #171 is merged: `acceptance-apply.sh --plan media+m1 ...` (no backup label; both pinned forward-fixes are checked), typed `APPLY media+m1 TO ACCEPTANCE`. 207 -> 209; pre contract `20261107090006`, post contract `20261110090002`.

### 4.3 What was proven locally (pinned CLI 2.110.0, isolated stack `aladdin_p1pf` on ports 524xx, no docker prune, no other stack touched)

| Check | Result |
|---|---|
| Replay of the 207 repo migrations | `PASS 753 functions match contract 20261107090006` |
| M1 (`20261110090002`, sha256 `83bde2643a371fd51962a85bc9297ea6a76eb3f302ba7b08eafec5aa6dc290f1` of the file on #171 head `b8c06ccf`) as the **only** additional migration on top of 207 | history 208, latest `20261110090002`; catalog diff: **exactly 3 functions changed** (`public.my_registration_state()`, `app.profile_completion(uuid)`, `public.admin_users_directory(...)`) and nothing else (no change in function grants/owner/security, columns, indexes, constraints, triggers, policies, views, types, relations, column grants); permissions still equal contract `20261107090006` (753/753), i.e. M1 changes no grant |
| pgTAP on that database (with the demo seeds loaded, as CI does) | `125_registration_stop_username_dob_compat_test.sql` ok (56 tests) plus the eight tests M1 modified (11, 21, 22, 25, 58, 59, 60, 117): 9 files, 439 tests, `Result: PASS`. (Without the seeds some of these fail on missing fixtures: an environment artifact, not an M1 defect) |
| Media migration `20261110090001` on top | catalog diff: exactly the four media functions (3 changed, 1 added); with M1 also applied, `verify-permissions-readonly.mjs ... 20261110090002` = `PASS 754 functions` |
| DDL scan of the M1 file (line-start verbs) | 3 `create or replace function`, 2 `comment on function`, 3 `revoke execute`, 2 `grant execute`; no table/column/index/constraint DDL and no top-level DML |
| Forward-fix SQL ([drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql](drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql)) | after M1 + the script the catalog fingerprint equals the pre-M1 fingerprint exactly ("no catalog differences"), permissions PASS 753 vs `20261107090006` |

Not done: `supabase db diff` (the catalog-fingerprint comparison covers more than a schema diff does: function bodies, ACLs, policies, triggers).

## 5. Post-apply verification (read-only; aggregates and hashes, no personal values)

1. History: `supabase migration list --linked`: 208 (after `media`) or 209 (after `m1` / `media+m1`), none pending, none remote-only; `node scripts/migration-history-guard.mjs list.json --expect up-to-date`.
2. Permissions: `bash scripts/hosted-db/verify-permissions-readonly.sh acceptance 20261110090001` (after `media`) / `... 20261110090002` (after `m1`): PASS (753 -> 754 functions after media; 754 after M1).
3. Function fingerprints (SELECT): `select md5(pg_get_functiondef('public.my_registration_state()'::regprocedure))` etc. Expected md5 of `pg_get_functiondef` (local replay, identical on hosted at the baseline):

   | Function | before M1 | after M1 |
   |---|---|---|
   | `public.my_registration_state()` | `4d8a71277a29376c3fcfdc66ded7f0da` | `e1d3f175044abb9b567203951df19a98` |
   | `app.profile_completion(uuid)` | `88c9540261e6bcdf5f81471638463943` | `5c644073f4440c64ce03902f261658b5` |
   | `public.admin_users_directory(text,text,text,text,text,text,integer,integer)` | `d26bf058849f5240aaa37fac2472e8fe` | `a92de3a5e985d3505bae2c0c326eb029` |

4. Catalog: the apply script's `catalog-diff.mjs --expect-changed` result (or run `catalog-fingerprint.sql` through `supabase db query --linked -o json` before and after and diff). Any extra changed object: STOP.
5. `my_registration_state` safe probe (test accounts only, rolled back): `begin; select set_config('request.jwt.claims', '{"sub":"<TEST_ACCOUNT_UUID>","role":"authenticated"}', true); set local role authenticated; select public.my_registration_state(); select public.my_profile_completion(); rollback;`
   Expect: never `username_pending`; an account with all steps done and no username returns `access_ready`; `my_profile_completion()` shows no username criterion. Use only designated test accounts (the three `ACCEPTANCE_E2E_*` accounts).
6. Counts unchanged: `storage.objects` 1, `media_storage_locations` 18, auth users 23 (any informational difference must be explained by concurrent test activity).
7. Advisors: re-run `get_advisors`; the five security lint groups of the baseline must be the same set (the three M1 functions are SECURITY DEFINER/INVOKER as before; no new lint). A new lint: STOP and review.

## 6. Rollback / forward-fix (M1 and media are forward-fix only; there are no down migrations)

- Before the app ships, to undo M1: apply a **new migration** containing [drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql](drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql) (proven above). It restores `username_pending` for `my_registration_state`; roll the application back to the previous Worker version at the same time. Needs its own GO and the same gates.
- After the app ships, do **not** restore: the new app sends no username and would strand sign-ups. Fix forward instead.
- Media migration: forward-fix = `scripts/hosted-db/forward-fix/media-restore-previous.sql` as a new migration (owner decision; same gates), valid only while no switched object holds an ids-only key (its guard enforces that). Semantics of the functions are in the migration header. R2 objects are never deleted.
- A failed push: each file is its own transaction; history stops at the first failing file; do not retry blindly: read `migration list`, decide forward-fix (M1: the pinned script, as a new migration). A data restore of the historical snapshot is NOT the path for function-only changes: it would discard every write since 2026-11-08 09:44Z.

## 7. Application deployment (only after M1 is applied on Acceptance)

Order: **M1 first, always**. Then merge #173 (after M1, per master plan 3.10) and deploy the merged `main`:
`gh workflow run cloudflare-frontend-preview.yml --repo hmohamed080/aladdin --ref main` (environment `cloudflare-preview`; no inputs). It deploys the Acceptance preview Worker `aladdin-frontend-preview` (OWNER GO: a deploy). Record the Worker version id. Rollback target: the previous version of that Worker (keep its id before deploying).

## 8. Focused E2E and smoke

- `gh workflow run hosted-acceptance-e2e.yml --repo hmohamed080/aladdin --ref main` (no inputs; environment `acceptance-e2e`; needs `ACCEPTANCE_E2E_OWNER/MANAGER/REP_PASSWORD` and the Cloudflare Access service-token secrets, see `docs/operations/ACCEPTANCE_E2E_ACCESS_TOKEN.md`; read-only specs against `https://aladdin-frontend-preview.bstalent9.workers.dev`). Owner GO (workflow dispatch).
- Manual smoke list (test accounts, record pass/fail only): email sign-up + email OTP without username/birthday; phone-alias sign-in; Google/Facebook OAuth; admin staff invitation accept; admin users directory (search by display name and email works, username search no longer matches); profile completion shows no username item; the age-attestation line is shown (subject to gate a). The real-Turnstile run is `pnpm --filter frontend e2e:acceptance:headed`.

## 9. Still outstanding (NOT done and NOT approved by this runbook)

- Legal approval of the 18+ self-attestation (gate a); privacy copy must not claim erasure of historical data before M2 (gate b).
- `auth.identities.identity_data` `birth_date` copies (2 Production, 11 Acceptance): needs an owner decision (rehearsed surgical write or Supabase support); accepting them as a residual needs a documented owner decision with an expiry. Not accepted by default.
- `audit_log` username redaction: design approved, hosted execution not approved.
- M2 `20261111090001` and M3 `20261111090002`: not started; need their own backup, rehearsal, GO; the old app must be gone before M3.
- #128 / #129: HOLD (not merged, not modified).
- No permanent date-of-birth or username residual is approved.
- Track C media copy rehearsal (`media_migration_switch` calls): changes stored `media_storage_locations` rows and their keys; needs its own fresh restore-tested backup, its own gate and GO, and ends the validity of the media forward-fix guard unless every switched object is rolled back.
- Dashboard-side auto-deploy checks stay OPEN (owner): Supabase GitHub integration and Cloudflare Pages Git cannot be verified with the available tools (section 11).
- Production: untouched; a separate request (`production-recovery-snapshot.sh`, `production-rehearsal.sh`, its own GO).

## 10. Exact sequence and the first authorization needed (recommended; every row is its own owner approval)

The media migration and M1 stay separate gates. Order matters because the gate pins which files may be pending: `media` is only valid while `origin/main` does **not** yet contain M1, so the media apply happens **before** #171 is merged.

| Step | Action | Approval | Gate / expected result |
|---|---|---|---|
| 0 | Owner dashboard checks P0 (Supabase GitHub integration off, Cloudflare Pages Git off) | owner | none enabled |
| 1 | Merge #179 (re-pinned scripts) and #170 (docs) to `main`. Neither adds a migration; merging triggers only `ci.yml` | merge approval | `origin/main` has exactly `20261110090001` pending |
| 2 | Read-only preflight `bash scripts/hosted-db/acceptance-preflight.sh media` (hidden DB password) | hosted read | `Acceptance gate: ok (plan media: 207 applied ...)` |
| 3 | **GO-M: apply `media`** (`acceptance-apply.sh --plan media`, no backup label, typed `APPLY media TO ACCEPTANCE`) | hosted migration | 207 -> 208, permissions `20261110090001` (754), catalog diff = the four media functions; media forward-fix hash verified |
| 4 | Stop. Verify, record. The Track C copy rehearsal is a separate GO elsewhere | none | |
| 5 | Merge #171 (M1 only) | merge approval | `origin/main` has exactly `20261110090002` pending |
| 6 | Read-only preflight `acceptance-preflight.sh m1` | hosted read | gate ok (plan m1: 208 applied) |
| 7 | **GO-M1: apply `m1`** (`acceptance-apply.sh --plan m1`, no backup label, typed `APPLY m1 TO ACCEPTANCE`) | hosted migration | 208 -> 209, permissions `20261110090002` (754), catalog diff = exactly the three M1 functions, forward-fix hash verified |
| 8 | Post-M1 verification (section 5), then merge #173, deploy preview, smoke, E2E (sections 7, 8) | merge, deploy, workflow approvals | |

**The first action that needs the owner's authorization is step 1 (merge #179 and #170), not a backup.** The first **hosted** action is the step-2 read-only preflight (needs the owner's DB password) and the first hosted **write** is GO-M (step 3). The apply script requires `HEAD == origin/main`, so there is no safe way to run it from an unmerged branch; do not weaken that rule.

## 11. What merging #170 and #179 can and cannot trigger (verified 2026-11-12 from the repository; dashboards stay open)

Verified from `.github/workflows/*.yml` on `origin/main`: the only workflow with a push trigger on `main` is `ci.yml` (build, test and `wrangler deploy --dry-run`; no deploy, no migration). Every other push trigger names a specific `claude/*` or `integration/*` branch, never `main`; `cloudflare-production.yml` is `workflow_dispatch` only (environment-protected); no workflow contains `supabase db push`, `migration up` or `supabase link`. #170 changes only `docs/`; #179 changes only `scripts/hosted-db/` and `supabase/tests/` (no `frontend/`, `backend/` or `edge/` path), so no path-filtered deploy workflow matches either. #179 adds no migration file, so no migration is pending on a merge.

Still **open, owner dashboard checks** (not verifiable by repository or API tools used here): Supabase Dashboard -> Integrations -> GitHub (automatic migrations on merge) and branching; Cloudflare Pages Git integration for this repository. Workers Builds git triggers (none on four Workers), Supabase branches (none) and the Vercel team (0 projects) were checked read-only on 2026-11-11. Do not merge until the owner confirms the two dashboard items are off.
