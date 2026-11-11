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

## 7. PR stack heads and CI (final read 2026-11-11 09:00 UTC)

Heads were stable from 08:42 to 09:00 UTC (the integrator pushed #171 at 08:34, #172 at 08:36 and #173 at 08:42 UTC; no later push observed). All three PRs target `main` and were MERGEABLE at the read. CI statuses come from `gh pr checks` at that time. The earlier CI on `b30ad71d` ran with the old M1 label and is superseded. If a head moved after 09:00 UTC this table is stale; re-read with `gh pr view N --json headRefOid`.

| PR | Branch | Head SHA (full) | CI per check at 09:00 UTC |
|---|---|---|---|
| #171 M1 `20261110090002` | `feat/p1-username-dob-db-compat-20261110` | `b8c06ccfcc740f7000d9578a5c9e177bdd5a44c2` | backend, backup-kit, docs, frontend, frontend-cloudflare, migration-policy, supabase-rls: all pass |
| #172 PR-2 auth | `feat/p1-username-dob-auth-20261110` | `5cd0cbc65ae07d1e2dcbd53e6c7f09321d918b8a` | backend, backup-kit, docs, frontend, frontend-cloudflare, gotrue-direct (fail), gotrue-direct (spent), migration-policy, supabase-rls: pass; **auth-captcha-e2e: FAIL** (run 42988297027, finished after the 09:00 read; the e2e fixes of #172 and #173 depend on each other, and #173 passes the same check, so the stack is only proven green with both merged; the cause of the #172 failure was not investigated by the docs agent) |
| #173 PR-3 frontend/admin | `feat/p1-username-dob-frontend-admin-20261110` | `ccdd3a4609c1459fbc6bdaf07acd5701d9047331` | auth-captcha-e2e, backend, backup-kit, docs, frontend, frontend-cloudflare, gotrue-direct (fail), gotrue-direct (spent), migration-policy, showroom-rc2-e2e, supabase-rls: all pass |
| #170 docs | `docs/p1-username-dob-plan-20261110` | see the PR (this file cannot contain its own head SHA) | see the PR |

Reading: green CI is not release approval; no hosted environment was touched for any row, and nothing is merged. #172 alone is red on auth-captcha-e2e; it is not proven green on its own.
