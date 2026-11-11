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
| Counts (aggregates only) | auth users 23, public users 23, `media_storage_locations` 18, `storage.objects` 1, `app.backup_environment` 0, `app.backup_settings` 1, `app.backup_runs` 0 | `execute_sql` 10:35Z |
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

## 3. Backup and restore verification (OWNER GO REQUIRED: this is the first hosted action)

State today: the only restore-verified Acceptance snapshot is `aladdin-acceptance-20261108T060819Z` (restore PASS, `aladdin-backups`
runs `42461215127` and `42469078723`, 2026-11-08). It was taken at 203 migrations, **before the four 2026-11-07 migrations were applied**, so it is
**stale and does not count** for M1. Backup schedules are OFF (`ACCEPTANCE_BACKUP_SCHEDULE=off`, `PRODUCTION_BACKUP_ENABLED=false`); the
"success" runs in `aladdin-backups` are plan-only no-ops (the data job is skipped). The Admin console path is not available:
`app.backup_environment` has 0 rows (not initialized), so use the manual workflows.

1. **Fresh snapshot (owner GO: a backup run writes locked objects to the backup bucket, read-only on the database).**
   `gh workflow run "Daily backup" --repo hmohamed080/aladdin-backups -f label=acceptance -f request_id=p1-pre-<media|m1>`
   Success: the `backup` job (not just `plan`) concludes `success`; note the snapshot name `aladdin-acceptance-YYYYMMDDTHHMMSSZ`.
2. **Restore test of that exact snapshot (owner GO).**
   `gh workflow run "Monthly restore test" --repo hmohamed080/aladdin-backups -f label=acceptance -f backup_key=<db/acceptance/.../snapshot.tar.age>`
   Success: the `restore` job concludes `success` and reports RESULT PASS (schema exact, row counts, media inventory exact). A green `plan` with a skipped `restore` job is NOT a pass.
3. Freshness rule: no migration, user-visible write or deploy to Acceptance between the snapshot and the apply except the planned ones; if one happens, repeat 1-2.
4. Record the snapshot label; `acceptance-apply.sh` requires it as `--backup-label`.

Who authorizes: the owner (each workflow dispatch). Nothing here is done by this preparation.

## 4. Apply

### 4.1 Plan A (recommended): `media`, then `m1`

Step M-1 (OWNER GO; hosted migration). From a clean checkout equal to `origin/main` (any SHA that contains `20261110090001` and not M1):
`bash scripts/hosted-db/acceptance-apply.sh --plan media --sha <40-char origin/main sha> --backup-label <label from section 3>`.
The script: checkout gates, hidden password prompt, link, pre checks (history 207, dry run lists exactly `20261110090001`, permissions vs `20261107090006`,
counts, structure, catalog fingerprint), the typed confirmation `APPLY media TO ACCEPTANCE`, `supabase db push --linked` (no `--include-all`, no repair),
post checks (history 208, permissions vs `20261110090001`, counts, catalog diff limited to `app.media_storage_key_assign`,
`public.media_migration_target_key` (new), `public.media_migration_switch`, `public.media_migration_rollback`). It prints PASS only when all hold.
After it: the Track C copy rehearsal (A-ACC) is a **separate GO** in the r2 runbook, not part of this one.

Step M-2 (after #171 merged, OWNER GO; repeat sections 2 and 3 first): same script with `--plan m1` and the new `main` SHA.
Expected: history 208 -> 209, pending before = exactly `20261110090002`, permissions vs `20261110090001` before and `20261110090002` after (754 functions), catalog diff limited to
`public.my_registration_state`, `app.profile_completion`, `public.admin_users_directory`.

### 4.2 Plan B: `media+m1`

Only after #171 is merged: `acceptance-apply.sh --plan media+m1 ...`, typed `APPLY media+m1 TO ACCEPTANCE`. 207 -> 209; pre contract `20261107090006`, post contract `20261110090002`.

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
- Media migration: forward-fix by a new migration; the in-database rollback semantics of the media functions are described in the migration header. R2 objects are never deleted.
- A failed push: each file is its own transaction; history stops at the first failing file; do not retry blindly: read `migration list`, decide forward-fix or restore of the section 3 snapshot (owner decision, `scripts/hosted-db/restore-acceptance.sh` only with owner approval and a backup in its layout).

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
- Production: untouched; a separate request (`production-recovery-snapshot.sh`, `production-rehearsal.sh`, its own GO).

## 10. The first hosted action that needs the owner's authorization

**GO-1: the fresh Acceptance backup run (`gh workflow run "Daily backup" ... -f label=acceptance`) followed by its restore test.** Everything before it
(sections 0 and 2 read-only checks through the MCP or with the DB password) is read-only. The first hosted **migration** is step M-1 (or 4.2), which additionally needs decision D1, a restore-verified snapshot from section 3, and its own GO.
