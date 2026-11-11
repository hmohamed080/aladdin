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
| Backup readiness | **FAIL / action needed:** the only restore-verified Acceptance snapshot (`aladdin-acceptance-20261108T060819Z`, runs `42461215127`, `42469078723`) predates the 2026-11-07 migrations; schedules off; `app.backup_environment` 0 rows; the `aladdin-backups` "success" runs are plan-only | `gh run view`, `execute_sql` counts |

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

