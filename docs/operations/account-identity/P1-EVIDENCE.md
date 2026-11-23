# P1 evidence index (counts and test results only)

**Purpose.** One place that records what has actually been proven for Phase 1, where, and by what, so checklist items in the master plan can point at evidence. **Current decision.** Local and CI evidence only; there is no hosted evidence because nothing has run on Acceptance or Production. **Rationale.** The master plan ticks a box only with linked evidence, and local tests must never be conflated with hosted evidence. **Scope.** PR #171 (M1) CI, the local M1 and audit-log proofs, and the permission-gate investigation. **Deferred.** Acceptance and Production reports (`P1-ACCEPTANCE-REPORT.md`, `P1-PRODUCTION-REPORT.md`). **Consequences.** Reviewer sign-off is still required before any box is treated as accepted. **Related files.** [Master plan](../../architecture/ACCOUNT_IDENTITY_LIFECYCLE_MASTER_PLAN.md), [P1-COMPAT-MATRIX.md](P1-COMPAT-MATRIX.md), [P1-AUDIT-LOG-REDACTION-DESIGN.md](P1-AUDIT-LOG-REDACTION-DESIGN.md), [P1-AUTH-METADATA-SCRUB.md](P1-AUTH-METADATA-SCRUB.md).

## 1. PR #171 (M1 compatibility migration) CI, head `b30ad71d`

| Check | Result | Run |
|---|---|---|
| backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy | pass | run `42848064633` |
| supabase-rls | pass (12m50s) | run `42848064753`, job `129940833340` |

Inside `supabase-rls` (from `gh run view 42848064753 --log`, 2026-11-10):

- Supabase CLI: the repo pin, `pnpm install` printed `+ supabase 2.110.0` and every CLI banner reads `currently installed v2.110.0`; the database image pulled was `supabase/postgres:17.6.1.143`.
- Step "Verify fresh effective function permissions": `PASS 753 exact function permission contracts`; the same line again in "Prove repeatability (second clean reset + tests)".
- Step "Run pgTAP tenant-isolation / RLS tests": `Files=158, Tests=7350 ... Result: PASS`, repeated after the second clean reset (includes `125_registration_stop_username_dob_compat_test.sql`).
- Concurrency proofs (installer phone change, admin staff invitation) passed in the same job.

## 2. Local M1 proof (not hosted)

Local stack: Supabase CLI 3.0.0, image 17.11.0.011, GoTrue v2.197.0, all migrations of `main` `1b00ff4` applied, then M1 applied inside one transaction.

| Run | Result |
|---|---|
| pgTAP 125 against the database **before** M1 | 56 planned; 8 fail, exactly the intended changes: `username_pending` still returned (test 28), the function body still reads `public.profiles` (35), `username` still listed as missing (36), denominators and percents (37, 39, 41, 42), username search still finds the account (43) |
| pgTAP 125 against the database **after** M1 | 56 of 56 pass (`aladdin-p1w2-t125-post` output, held outside the repository) |

## 3. Local audit_log redaction proof (not hosted)

`drafts/run-audit-redaction-proof.sh` on the same local stack: **39 of 39 assertions pass (25 migration proof, 14 narrow-guard proof), 0 fail**; token empty after COMMIT and in a new session; the original guard (`md5 74f342a5...`) present after a rolled-back run and after the draft was committed twice (second run `redacted=0`, checksum match). Condensed output:

```
== 1. migration proof          1..25   ok 1..25   NOTICE: rows=25 redacted=5 remaining=0 checksum_match=true
                                                  NOTICE (re-run): rows=25 redacted=0 remaining=0 checksum_match=true
== 2. narrow guard while installed   1..14   ok 1..14
== 3. in-tx token: set; same session after commit: []; new session: [NULL]
== 3b. rolled back: guard md5 74f342a538358489bf193ae0be832890; token NULL
== 3c. committed twice: rows=18 redacted=0 remaining=0 checksum_match=true (x2); guard md5 unchanged; token NULL
== 3d. after commit, token + redaction-shaped UPDATE: ERROR audit_log is append-only (UPDATE forbidden)
```

Detail and limits: [P1-AUDIT-LOG-REDACTION-DESIGN.md section 3](P1-AUDIT-LOG-REDACTION-DESIGN.md).

## 4. Auth metadata experiments (local, throwaway users, deleted)

Ten experiments (E1-E10), results in [P1-AUTH-METADATA-SCRUB.md section 1](P1-AUTH-METADATA-SCRUB.md): `updateUserById` with `birth_date: null` removes the key from `raw_user_meta_data` and preserves the rest; it does **not** change `auth.identities.identity_data`, and no supported interface found does. The copy is created by public email `signUp` with `options.data`.

## 5. The 13 local permission-gate deviations: a local CLI/image artifact, not an M1 defect

**Observation.** `node scripts/migration-permission-gate.mjs <container> postgres check` against a local stack started by Supabase CLI 3.0.0 (image 17.11.0.011) reports 13 functions with an extra `service_role` EXECUTE grant (26 findings: `grants` and `effective` for each).

**Reproduction and result (2026-11-10, all local).**

| Stack | Code under test | Result |
|---|---|---|
| CLI 3.0.0, image `postgres:17.11.0.011` | `main` `1b00ff4` (before M1, main's contract `20261107090006`) | **13 functions deviate** |
| CLI 3.0.0, image `postgres:17.11.0.011` | PR #171 (M1 applied, contract `20261110090002`) | the **same 13 functions** (identical set); nothing new from M1 |
| **CLI 2.110.0 (the repo pin), image `postgres:17.6.1.143`** | PR #171, fresh `supabase start` with all 208 migrations | **`PASS 753 exact function permission contracts`** |
| CI, CLI 2.110.0, image 17.6.1.143 | PR #171 | `PASS 753 exact function permission contracts` (twice) |

The 13 functions are `account_entry_allowed(text)`, `account_password_confirm(text,text,text)`, `admin_phone_cooldown_override(text,text)`, `admin_phone_cooldown_status(text)`, `admin_users_directory(...)`, `branch_location_set(uuid,text,text,text)`, `my_secondary_phone()`, `organization_legal_name_set(uuid,text)`, `secondary_phone_cancel()`, `secondary_phone_change(text,uuid)`, `secondary_phone_make_primary(uuid,text,text)`, `secondary_phone_renew()`, `secondary_phone_reserve(text,uuid)`. Each was created by a migration that does `revoke ... from public, anon` and `grant execute ... to authenticated` and relies on the creator's default privileges for the rest. On the older image the new function ends with ACL `{postgres=X, authenticated=X}`; on the newer image it also carries `service_role=X`. This is a property of the image bundled with the CLI, present on `main` before M1, so it says nothing about PR #171.

**Conclusion.** The deviations are a local-CLI-version artifact. The gate is only authoritative with the repo-pinned CLI (`package.json`: `supabase 2.110.0`, the version `supabase-rls.yml` uses via `pnpm exec supabase`), and there it passes locally and in CI. Follow-ups (not done here): run local gate checks with `pnpm exec supabase`, and decide separately whether the migrations that leave `service_role` EXECUTE to image defaults on those 13 functions should revoke it explicitly (a hardening for newer CLI images; a security observation, not an exposure: `service_role` is server-only and these functions are `authenticated`-intended).

Method note: the pinned stack ran from a scratch directory outside the repository (own project id and ports), with a scratch copy of the gate script whose container-name allowlist was widened for that one container; no repository file was modified and no other stack was touched.

## 6. Not evidence

Nothing in this file is hosted evidence. Acceptance and Production remain untouched (read-only audit counts of 2026-11-10 are in the master plan 3.2).

## 7. PR stack heads and CI (final read 2026-11-11, after `main` `66a0f0ab`)

Heads read with `gh pr view N --json headRefOid,mergeable` and checks with `gh pr checks N` / `gh run view`. All four PRs target `main`; #171, #172, #173 and #170 were MERGEABLE (#171 reported UNKNOWN once while GitHub recomputed, then MERGEABLE/CLEAN). If a head moved after this read, this table is stale; re-read. Green CI is not release approval; no hosted environment was touched and nothing is merged.

| PR | Branch | Head SHA (full) | CI per check on that exact SHA |
|---|---|---|---|
| #171 M1 `20261110090002` | `feat/p1-username-dob-db-compat-20261110` | `b8c06ccfcc740f7000d9578a5c9e177bdd5a44c2` | backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy, supabase-rls: all pass |
| #172 PR-2 auth | `feat/p1-username-dob-auth-20261110` | `5cd0cbc65ae07d1e2dcbd53e6c7f09321d918b8a` | backend, backup-kit, docs, frontend, frontend-cloudflare, gotrue-direct (fail), gotrue-direct (spent), migration-policy, supabase-rls: pass; **auth-captcha-e2e: FAIL** (run 42988297027). Stacking artifact, confirmed from the job logs by the owner: the old sign-up specs/UI are incompatible with server-side `ageConfirmed`; the fix is in #173. **#172 is superseded by #173 and must not merge on its own.** |
| #173 PR-3 combined (contains #171 + #172) | `feat/p1-username-dob-frontend-admin-20261110` | `42d5218d3da43d326f03ed959487f02cc1c56b46` (a one-file revert of an unintended `frontend/next-env.d.ts` dev-artifact change) | see the per-check table below: all 11 pass |
| #170 docs | `docs/p1-username-dob-plan-20261110` | the head of this PR (a file cannot contain its own SHA; read it from the PR) | the `docs` job and the others, see the PR |

**#173 per-check results on `42d5218d`** (runs started 2026-11-11 09:30 UTC; these supersede the earlier all-pass result on the previous head `ccdd3a46`, which is no longer the head):

| Check | Result | Run / job |
|---|---|---|
| backend | pass (49s) | CI run `42995730718` |
| backup-kit | pass (7m36s) | CI run `42995730718` |
| docs | pass (15s) | CI run `42995730718` |
| frontend | pass (6m20s) | CI run `42995730718` |
| frontend-cloudflare | pass (2m14s) | CI run `42995730718` |
| migration-policy | pass (31s) | CI run `42995730718` |
| auth-captcha-e2e | pass (7m34s) | run `42995730710` |
| gotrue-direct (fail) | pass (1m57s) | run `42995730710` |
| gotrue-direct (spent) | pass (1m57s) | run `42995730710` |
| supabase-rls | pass (13m35s) | run `42995730943`; log shows `PASS atomic migration 20261110090002_registration_stop_username_dob_compat.sql` (permission gate `upgrade` mode) and `PASS 754 exact function permission contracts` twice |
| showroom-rc2-e2e | **pass on rerun** (attempt 2, 9m32s); attempt 1 failed | run `42995730871`. Attempt 1: 37 passed, 2 skipped, 1 failed in the first suite, `showroom-mvp.spec.ts:419 the language control flips the workspace to RTL` (expected `dir="rtl"`, received `ltr` after 10 s). This is the same known flake that passed on rerun earlier (an unrelated test: it toggles the language control; the PR changes nothing in it). It was re-run once (failed jobs only) and passed; no other check was re-run. |

**Mergeability against `main` `66a0f0ab`:** `git merge-tree --write-tree` of the #171, #172 and #173 heads each reports a clean merge (exit 0, no conflict list). **Containment:** `git rev-list` shows 0 commits of #171 and 0 of #172 missing from #173. **Diff of #173 against `main`:** 109 files, +28983 / -2013 (`git diff --numstat`); +27279 of the additions are `supabase/permissions/20261110090002.json`; the only migration is `supabase/migrations/20261110090002_registration_stop_username_dob_compat.sql`.

Reading: #172 alone is red; #173 is green on every check for its exact head (one flaky unrelated test passed on a single rerun). Release strategy and order: master plan 3.10 and 3.11.

## 8. Acceptance preflight evidence (2026-11-11; read-only hosted reads and local runs; counts and hashes only)

| Item | Result | Evidence |
|---|---|---|
| Acceptance history | PASS (read): 207 applied, latest `20261107090006`, no gaps; pending vs `main` `2aa365a5` = `20261110090001` only | Supabase MCP `list_migrations` 10:14Z; `comm` of the version lists |
| Production history | 207, latest `20261107090006` (same list, compared by eye) | `list_migrations` |
| Hosted catalog equals clean replay | PASS: 12 of 12 fingerprint sections identical (`scripts/hosted-db/catalog-fingerprint.sql`) | read-only `execute_sql` |
| Hosted function permissions | PASS: 753 functions, aggregate md5 `da4d2dd7d95a27ce3e8292d351b6f983` = local replay, which passes contract `20261107090006` 753/753 | read-only `execute_sql` 10:32Z |
| M1-only dry run (local, CLI 2.110.0) | PASS: history 208, exactly 3 functions changed, no other catalog change, grants unchanged; file sha256 `83bde264...c290f1` (#171 head `b8c06ccf`) | `catalog-diff.mjs --expect-changed` |
| pgTAP 125 + modified tests 11, 21, 22, 25, 58, 59, 60, 117 | PASS: 9 files, 439 tests, with demo seeds loaded (without seeds 4 of 9 files fail on missing fixtures: environment artifact) | `supabase test db --local` on the isolated stack |
| Media migration `20261110090001` | exactly 4 functions (3 changed, 1 added); with M1, `PASS 754 functions` vs contract `20261110090002` | local |
| M1 DDL scan | 3 create or replace function, 2 comment, 3 revoke, 2 grant; no table DDL, no top-level DML | grep of line-start verbs |
| Forward-fix SQL | PASS: M1 + restore = pre-M1 fingerprint exactly; permissions PASS 753 vs `20261107090006` | `drafts/P1-M1-FORWARD-FIX-RESTORE-PREVIOUS.sql` |
| Offline script tests | PASS: `node --test scripts/hosted-db/*.test.mjs` 151/151 (PR #179) | local |
| CI upgrade-mode permission gate | PASS on #173 `42d5218d`: run `42995730943` (`PASS atomic migration 20261110090002...`, `PASS 754 exact function permission contracts`) | `gh run view` |
| Supabase security advisors (baseline) | 5 lint groups: `rls_enabled_no_policy`, `function_search_path_mutable`, `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`, `auth_leaked_password_protection` | `get_advisors` |
| Auto-deploy: workflows | PASS: none applies migrations; `ci.yml` on `main` only `wrangler deploy --dry-run`; `cloudflare-production.yml` dispatch-only | repo |
| Auto-deploy: dashboards | Supabase branches none (PASS); Workers Builds git triggers none on 4 Workers (PASS); Vercel team 0 projects (PASS); Supabase GitHub integration and Cloudflare Pages Git: **UNVERIFIED** (owner dashboard check) | MCP reads |
| Backup readiness | **Corrected 2026-11-11 (see 8.2):** newest restore-verified snapshot is `aladdin-acceptance-20261108T094450Z` (backup run `42468447400` PASS, restore run `42469078723` PASS; 167 tables, 2584 rows, 203 migrations, 9 R2 files), present in the bucket; a historical reference, not a current recovery point; sufficient for function-only M1 with the tested forward-fix; fresh backup mandatory before M2/M3/Auth cleanup/audit redaction. `app.backup_environment` has 1 row (initialized 2026-11-11 12:29Z); schedules off | `gh run view`, job logs, Cloudflare R2 objects API, `execute_sql` |

### 8.1 PR heads and CI per exact SHA (final read 2026-11-11 about 11:00 UTC, stable over three polls; `gh pr view` / `gh pr checks`)

The #171 branch and the #173 branch were pushed by another agent during this preflight (both merged `main` `2aa365a5`). **M1 is unchanged: still `20261110090002_registration_stop_username_dob_compat.sql`, sha256 `83bde2643a371fd5...` on both heads, same version number.**

| PR | Head SHA (full) | Mergeable | CI per check on that SHA |
|---|---|---|---|
| #171 M1 | `82accd9cce031e3a516f10f8e2b8c89152e313a7` | MERGEABLE / CLEAN | backend pass, backup-kit pass, docs pass, frontend pass, frontend-cloudflare pass, migration-policy pass, supabase-rls pass (run `43004326729`) |
| #173 combined PR-2 + PR-3 | `1f1c111f9951bbadce6c70ae9faab345b0512c02` | MERGEABLE | auth-captcha-e2e pass, backend pass, backup-kit pass, docs pass, frontend pass, frontend-cloudflare pass, gotrue-direct (fail) pass, gotrue-direct (spent) pass, migration-policy pass, supabase-rls pass (run `43004489649`), **showroom-rc2-e2e FAIL** (run `43004489722`: 37 passed, 2 skipped, 1 failed: `showroom-mvp.spec.ts:419 the language control flips the workspace to RTL`, the same unrelated flaky test that failed once and passed on rerun on the previous head `42d5218d`; not re-run here because a rerun is a CI action outside this preflight) |
| #172 | `5cd0cbc65ae07d1e2dcbd53e6c7f09321d918b8a` (unchanged, superseded by #173; never merge alone) | MERGEABLE | auth-captcha-e2e FAIL as before (stacking artifact) |
| #170 docs | read from the PR (a file cannot contain its own SHA) | MERGEABLE | see the PR |
| #179 scripts (draft) | `952e595de626e7a0b352345e32467e84d44e25b5` | MERGEABLE | backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy, supabase-rls: all pass |

Reading: M1's #171 is green on its exact head; #173 needs the flaky RTL test to pass on a rerun before merge.


### 8.2 Backup evidence reconciliation (2026-11-11, read-only)

This supersedes the "FAIL / action needed" backup row and the earlier GO-1 recommendation. The earlier docs named `aladdin-acceptance-20261108T060819Z` as the newest snapshot and attached restore run `42469078723` to it; both were wrong.

| Item | Result | Evidence |
|---|---|---|
| Newest snapshot | `aladdin-acceptance-20261108T094450Z`: backup run `42468447400` PASS (job `backup (acceptance)`, 2026-11-08 09:44:36Z to 09:49:46Z); log: 167 tables, 2584 rows, 203 migrations, sha256 `ea38cefd53f67b2bdd1e18027173e3e3faccdff37cd4812c0a7797172583d67d`, 9 R2 originals backed up, 0 missing | `gh api repos/hmohamed080/aladdin-backups/actions/jobs/128693356245/logs` |
| Restore | run `42469078723` PASS (job `restore`, 09:53:42Z to 09:56:05Z): sha256 matches manifest and stored metadata, decryption and part checksums ok, Auth/Storage schema identical, row counts exact (167 tables, 2584 rows), R2 inventory exact (9 files, retired originals excluded), 9 of 9 sampled files restored with recorded sha256 and size, RESULT: PASS | job `128695391281` log |
| Superseded snapshot | `...T060819Z` (2548 rows): restore run `42461215127` PASS; older, kept only for history | job `128670734388` log |
| Still present | `db/acceptance/daily/2026/11/08/` `.tar.age` 6,063,850 bytes (equals the backup log), `.json`, `.r2media.json`, `.r2media.tsv.age`, and the same four under `db/acceptance/weekly/2026/`; bucket `aladdin-acceptance-backups-weur`, 52 objects under `db/acceptance/`. Existence and size only; bytes not re-downloaded | Cloudflare API `GET /accounts/{id}/r2/buckets/aladdin-acceptance-backups-weur/objects` |
| Bucket lock | none: `GET .../lock` returns `rules: []` (objects are deletable; do not describe them as locked) | Cloudflare API |
| Not covered | writes after 2026-11-08 09:44:50Z (audit log: 6 `profile.phone_set`, 4 `onboarding.completed`, 4 `profile.username_set`, 3 `profile.avatar_set`, product/organization image and verification-document edits, up to 2026-11-10 14:13Z; latest sign-in 2026-11-10 15:59Z); the four 2026-11-07 migrations (Acceptance 207 vs snapshot 203); the 2026-11-11 12:29Z backup-console initialization. Restore into the 207-migration schema was never tested | `execute_sql` aggregates, `list_migrations` |
| `app.backup_environment` | 1 row: `environment=acceptance`, `initialized_at=2026-11-11 12:29:19Z`, audit action `backup.environment_initialized`; `app.backup_runs` 0, `app.backup_run_events` 0, `app.backup_settings` 1. The earlier "0 rows / not initialized" claim is obsolete | `execute_sql` counts |
| Schedules | `ACCEPTANCE_BACKUP_SCHEDULE=off`, `PRODUCTION_BACKUP_ENABLED=false`; the green scheduled "Daily backup" runs skip the `backup` job (plan only) | `gh api repos/.../actions/variables`, run jobs |
| Sufficiency for M1 and media | Both migrations are function-only (`CREATE [OR REPLACE] FUNCTION`, `COMMENT`, `REVOKE`, `GRANT`; no table DDL, no top-level DML): they rewrite no stored row, **but they change runtime behaviour** (correction: earlier wording implied otherwise). Recovery = a locally tested forward-fix per migration, pinned by sha256 in `acceptance-gate.mjs` (M1 `5fe0da1eb5f08143b52ff90c41294d7e0e45ed7b7017926b6296898acfd28045`, media `4f0f4ce33ed49ca85555756ff7186a33da6d3b6cca17f391da9bc4daf735f270`, see 8.4). No backup is required for either; the historical snapshot is an optional reference only | scripts/hosted-db (PR #179), runbook section 3 |
| Mandatory fresh backup | before M2, M3, Auth metadata / `identity_data` cleanup, audit-log redaction, any Production step | runbook section 3 |
| Script tests | `node --test scripts/hosted-db/*.test.mjs` 159/159 (8 new recovery-gate tests) on #179 head `9ba06a57` | local |

### 8.3 Final PR heads and CI per exact SHA (read 2026-11-11 ~15:15 UTC; `gh pr view N --json headRefOid,mergeable,mergeStateStatus`, `gh pr checks N`)

| PR | Head SHA (full) | Mergeable | CI per check on that SHA |
|---|---|---|---|
| #171 M1 | `82accd9cce031e3a516f10f8e2b8c89152e313a7` | MERGEABLE / CLEAN, draft | backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy, supabase-rls: all pass |
| #173 combined Auth + Frontend/Admin | `6f6076571abb73b9be4326ab0e3939dc98a4f5dc` | MERGEABLE / CLEAN, draft | auth-captcha-e2e, backend, backup-kit, docs, frontend, frontend-cloudflare, gotrue-direct (fail), gotrue-direct (spent), migration-policy, showroom-rc2-e2e, supabase-rls: all pass |
| #179 re-pinned Acceptance scripts, media forward-fix, CI dependency pinning | `27f6c38c7e44227e3bda04100325c85d6aa1efca` | MERGEABLE / CLEAN, draft | backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy (run `43048225374`), supabase-rls (run `43048225379`, includes pgTAP `126_media_forward_fix_test.sql` ok): all pass |
| #170 documentation | moves with each docs commit; read it live | MERGEABLE, draft | expected 7 of 7; see the final handoff for the value read after the last push |

Reading: green CI is not release approval. No hosted environment was written; nothing merged, deployed or backed up in this reconciliation.

### 8.4 Media migration `20261110090001`: forward-fix design and local proof (2026-11-12)

What the migration changes (read from the file): replaces trigger function `app.media_storage_key_assign()` (the key may change only inside the two migration functions, via the transaction-local flag `app.media_migration`), replaces `public.media_migration_switch` (records an ids-only `storage_key` instead of NULL, keeps an existing r2 key) and `public.media_migration_rollback` (clears the key when flipping to supabase), and adds `public.media_migration_target_key` (service_role only). No table, constraint, index, RLS policy or row changes at apply time.

Forward-fix: `scripts/hosted-db/forward-fix/media-restore-previous.sql` (sha256 `4f0f4ce33ed49ca85555756ff7186a33da6d3b6cca17f391da9bc4daf735f270`; identical copy in `supabase/tests/helpers/media_forward_fix.inc`, pinned by a node test). Definitions extracted with `pg_get_functiondef` from a clean 207-migration replay. **Guard:** raises `55000` before changing anything if an open ledger row's object holds an r2 `storage_key` (the previous rollback would violate `media_storage_locations_storage_key_check` on such a row and the previous switch would not recompute it). Valid only before the Track C copy rehearsal switches objects under the new semantics.

| Check | Result | Evidence |
|---|---|---|
| Environment | isolated stack `aladdin_p1media` (own containers and ports 525xx), pinned CLI 2.110.0, 207 repo migrations + demo seeds; no other stack touched; no hosted system touched | local |
| Fixtures (synthetic; the seeds hold no media rows) | one legacy r2 flat-key record with an open ledger row, one application-reserved r2 record with an ids-only key, one supabase-provider record | `fixtures.sql` (scratch) |
| Rows rewritten by the media migration | **none**: digest of `media_storage_locations` (3 rows) and `media_migration_ledger` (1 row) identical before and after | md5 of `to_jsonb(row)` ordered |
| Catalog diff, media vs 207 | exactly the four media functions (3 changed, 1 added); nothing else | `catalog-diff.mjs --expect-changed` "exactly 4 object(s) changed" |
| Grants after media | `PASS 754 functions match contract 20261110090001` | `verify-permissions-readonly.mjs` |
| Forward-fix applied (media applied first) | **`no catalog differences`** vs the pre-media fingerprint (all 12 sections: functions, grants, columns, relations/RLS, views, indexes, constraints, triggers, policies, column grants, types, counts) | `catalog-diff.mjs` |
| Grants after forward-fix | `PASS 753 functions match contract 20261107090006` | `verify-permissions-readonly.mjs` |
| Rows after forward-fix | digest identical to before: **no media row changed** | md5 |
| Definitions restored | md5 of the three functions equals the pre-media values `d38d4ff772c7e19bff62117d0338145f` (trigger fn), `9b0391bf8c827424990d2fa9aa586a96` (switch), `0205a8a0f76326de36901bf743c0d164` (rollback) | `pg_get_functiondef` |
| Hosted Acceptance today (read-only, 2026-11-12) | the same three md5 values (so the forward-fix restores exactly the live definitions); `media_migration_target_key` absent; 18 `media_storage_locations` rows (all provider r2: 11 flat-key verified, 5 ids-only verified, 2 ids-only unverified), `media_migration_ledger` 0 rows, 0 open ledger rows with a key (the guard would pass today) | `execute_sql` aggregates, hashes only |
| pgTAP `126_media_forward_fix_test.sql` | 31 assertions PASS via `supabase test db --local`: new switch/rollback/target-key semantics and determinism, guard refusal (`55000`), no row changed, three definitions restored, target key dropped, execute grants unchanged (service_role only), RLS policy count and enabled flag unchanged, key immutable again, old switch writes NULL key, old rollback works | local |
| Offline tests | `node --test scripts/hosted-db/*.test.mjs`: 167 PASS (forward-fix hashes pinned, helper copy identical, guard block in the pgTAP test equals the file, structure: guard first, no BEGIN/COMMIT, no top-level DML, drops only `media_migration_target_key`) | local |

Not proven (stated, not assumed): behaviour against live hosted media rows beyond the structural argument (the migration and forward-fix touch no row; hosted counts above are aggregates); the CLI `db push` path for the forward-fix as a migration (the file is atomic by design and was applied with `psql -1`); concurrency with live traffic (`CREATE OR REPLACE FUNCTION` and `DROP FUNCTION` take short catalog locks); any state after `media_migration_switch` has run under the new semantics (the guard refuses; recovery then needs a different design and a fresh backup).

### 8.5 Auto-deploy and migration triggers of merging #170 and #179

See runbook section 11. Verified from the workflow files: only `ci.yml` runs on a push to `main` (dry-run only); no workflow runs `supabase db push`; #170 (docs) and #179 (`scripts/hosted-db`, `supabase/tests`) match no deploy path filter and add no migration. **Open (owner):** Supabase GitHub integration and Cloudflare Pages Git, not verifiable here.

### 8.6 CI infrastructure failures on #179 and the dependency-pinning fix (2026-11-11)

Root cause: `apt` could not resolve `azure.archive.ubuntu.com` on hosted runners (about 14:35-15:00 UTC), failing the `frontend` (`playwright install --with-deps`) and `backup-kit` (`apt install age`) jobs across reruns (run `43033314827`, attempt 3) while every code check passed; no assertion failed. Fix (no test skipped or weakened, no `continue-on-error`; see `docs/operations/CI_DEPENDENCY_PINNING.md` on #179): runner `ubuntu-24.04`; frontend in the official Playwright image pinned by digest with a version guard; ffmpeg from a digest-pinned static image with a hard encoder check (the transcode tests skip silently without ffmpeg); `age` v1.1.1 via `go install` verified by the Go checksum database.

| Check on `27f6c38c7e44227e3bda04100325c85d6aa1efca` | Result |
|---|---|
| Six `CI` jobs and `supabase-rls` | all pass |
| Backend | ffmpeg 7.1.1 and ffprobe 7.1.1 present, `118 passed`, no skips (transcode tests run) |
| Frontend | job container digest `sha256:dcc5531e...7580e`; guard `Version 1.62.1`, Chromium 1234 present; access-routing `10 passed`; vitest `4825 passed, 40 skipped`, identical to the last green run before the change (Redis tests still run: `redis.test.ts` 25 tests) |
| Backup-kit | `age` and `age-keygen` `v1.1.1` installed without apt |
| pgTAP | `126_media_forward_fix_test.sql ok` in CI; suite `Files=158, Tests=7325, Result: PASS` |
| Other workflows | still use `playwright install --with-deps` (`auth-captcha-e2e`, `showroom-rc2-e2e`, `hosted-acceptance-e2e`, `phone-signup-security`): same risk, follow-up |
