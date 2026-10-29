# R1 — alias-creation guard and unified phone-verification authority: implementation report

**Branch** `feat/phone-signup-authority-r1-20261030`, stacked on PR #122 → #121 → #120 → #119. **Draft. Not merged, not deployed, nothing applied to any hosted environment.** Local isolated Supabase stacks only; no real message was sent (GoTrue phone provider, Send-SMS hook and Phone MFA are off on every test stack; the "WhatsApp message" is a file in a temp directory); no secret, real number or raw OTP is in any evidence file.
PR #113 and #116 are untouched. The one change prepared for #113 is a separate branch/PR (§7).

## 1. What was built

| Piece | Where | State when merged |
|---|---|---|
| **Deferred alias-creation guard** (constraint trigger on `auth.users`, alias-domain e-mails only, single-use grant) | `supabase/migrations/20261030090002_phone_signup_authority.sql` | installed, **inert** (`alias_guard_mode = 'off'`) |
| **Unified authority**: B1's challenge table extended in place with `signup_proof` (subject = registration) next to `primary_proof` (subject = user); `phone_signup_start / verify / attach / invalidate`; grants; observations; config log | same migration | **disabled** (`enabled = false`, `signup_enabled = false`) |
| Shared with B1 (not duplicated) | HMAC keyring + key ids, MAC format, attempts, TTL, cooldown, per-IP buckets, purge, audit vocabulary | – |
| Server half | `frontend/src/server/phone-verification/{signup-service,delivery,outbox-reader,otp,runtime}.ts`, `lib/env/phone-verification.ts` | flags default OFF |
| One delivery interface; `off` (default) / local `outbox` / Worker adapter (**not wired**) | `delivery.ts`, `transport.ts` | real delivery unreachable |
| Tests | pgTAP `120` (103), vitest (82 unit + 16 real-DB), `sec/signup_authority` matrix, `sec/signup_concurrency_stress`, CI-parity and local verification scripts | – |
| Hosted read-only inspection (ready, **not run**) | `scripts/hosted-db/inspect-auth-security.mjs` (+12 self-tests) | needs authorisation, §9 |
| Docs | this report, `…_MIGRATION_AND_ACTIVATION_PLAN.md`, `…_REGISTRATION_INTEGRATION.md`, updated `PHONE_VERIFICATION_UNIFIED_CONTRACT.md` | – |

Three switches and one invariant keep the order safe: `enabled`, `signup_enabled`, `alias_guard_mode` all ship off; the database refuses `signup_enabled = true` while the guard is `off` (`ck_config_signup_needs_guard`); every change to a switch is logged.

## 2. Results (all real runs; nothing counted as PASS that is not executable)

### 2.1 Security matrix — posture × e-mail-confirmation mode × toolchain
`SEC_POSTURE`: `shipped` = migration defaults · `observe` = guard records, never blocks · `enforce` = guard refuses. Each cell is ~48 checks against real GoTrue + PostgREST + Postgres.

| Toolchain (CLI / Postgres / GoTrue) | Mode | shipped | observe | enforce |
|---|---|---|---|---|
| **local** 2.122.0 / 17.11.0.006 / v2.197.0 | confirm-on | 23 PASS · 16 XFAIL | 40 PASS · 4 XFAIL | **44 PASS · 0 XFAIL** |
| | confirm-off | 23 PASS · 18 XFAIL | 40 PASS · 6 XFAIL | **45 PASS · 0 XFAIL** |
| **CI** 2.110.0 / 17.6.1.143 / v2.193.0 | confirm-on | 23 · 16 | 40 · 4 | **44 · 0** |
| | confirm-off | 23 · 18 | 40 · 6 | **45 · 0** |

0 FAIL and 0 XPASS in all 12 cells. (XFAIL = a desired protection that the posture does not provide: still open in `shipped`, partly in `observe`; it is never counted as a pass.)

### 2.2 The PR #122 expected failures, converted
| PR #122 row | Meaning | `shipped` | `observe` | **`enforce`** |
|---|---|---|---|---|
| SEC-A1 | anonymous GoTrue sign-up cannot create a phone-alias user | XFAIL | XFAIL | **PASS** |
| SEC-A2 *(confirm-off)* | no session without possession proof | XFAIL | XFAIL | **PASS** |
| SEC-A3b *(confirm-off)* | possession-less account cannot claim the number | XFAIL (attacker finishes registration on the victim's number) | XFAIL | **N/A: no account or session is created, so there is nothing to claim** (A1/A2 carry the proof) |
| SEC-A4 | an anonymous row does not block the real owner (squatting) | XFAIL | XFAIL | **PASS** |
| SEC-C2b | a completed sign-up sets `phone_verified_at` for the exact number | XFAIL | **PASS** | **PASS** |
| **SEC-D1** | verified challenge bound to the new Auth user; exact number verified | XFAIL | **PASS** | **PASS** |
| **SEC-D2** | replay refused (verify, attach, grant reuse) | XFAIL | **PASS** | **PASS** |
| **SEC-D3** | expired proof / expired grant refused | XFAIL | **PASS** | **PASS** |
| **SEC-D4** | wrong account / wrong number refused | XFAIL | **PASS** | **PASS** |
| **SEC-D5a/b/c** | concurrent creation / attach / verify: exactly one wins | XFAIL | **PASS** | **PASS** |
| **SEC-D6** | alias creation without proof refused at the database (GoTrue **and** Admin API) | XFAIL | XFAIL | **PASS** |
Extra executable rows added: D4b, D6b (creation alone verifies nothing), D7 (5 wrong codes lock the challenge), D8 (taken number: same reply, nothing delivered, never verifiable), A7b (forged markers), A12 (observation recording), C1–C4b, C5 (the old no-grant creation still works in `shipped`/`observe` and is refused in `enforce`).

### 2.3 Other suites
| Suite | Result |
|---|---|
| pgTAP `120_phone_signup_authority_test.sql` | **103 / 103** (surface, dormant state, happy path, replay/expiry/attempts, cross-purpose, limits, no existence oracle, guard off/observe/enforce, forged/foreign/expired/replayed/anonymous grants, attach binding, retention) |
| Full pgTAP, **CI toolchain**, clean replay of 195 migrations | **145 files / 6,551 tests PASS** (B1 had 144 / 6,448) |
| Full pgTAP, **local toolchain**, clean replay | **145 files / 6,551 tests PASS** |
| Frontend unit (phone verification + env) | 83 pass; `tsc --noEmit` and ESLint clean |
| Real-database integration (B1 service 10 + R1 signup service through the **outbox** 6) | **16 / 16** on a clean database |
| Concurrency + deadlock stress (24 parallel sign-ups; 6×5 creation/attach races; 6×6 verify races; 8 parallel starts for one number; 12 parallel guesses) | **9 / 9**; `pg_stat_database.deadlocks` 0 → 0; no user consumed two grants; no duplicate alias; no orphan |
| Existing committing concurrency script (`installer_phone_change_concurrency_test.sh`) | pass on both toolchains |
| `db lint` (plpgsql_check) public + app | no error; none in the new objects (18 warnings are in pre-existing functions) |
| Hosted-inspection self-tests (mock API) | **12 / 12** |

Honest notes on the evidence: the first local verification run recorded two harness failures (the two vitest integration files ran in parallel and each flips the shared posture switches; a stale-data assumption in B1's file). The runner now runs them one after another in script order; the log keeps the failed attempt and the passing re-run. The stress script was run on the local toolchain only; the CI toolchain ran the matrix, the full pgTAP and the concurrency script.

## 3. Identity and permission invariance (evidence)
* **Identity.** In every one of the 12 matrix cells the legacy Installer (alias), Showroom (alias + organization) and e-mail accounts are **byte-identical** before and after every attack, probe and legitimate sign-up: auth row, password digest, identities, MFA, public user, profile and verified flag, memberships, consents (SEC-E1), still sign in (E2), numbers stay unverified (E3), no duplicate alias exists anywhere (E4). The B1 service's own invariance suite (accounts, roles, memberships, capabilities, points, consents) still passes against the R1 migration (16/16 above; evidence `docs/security/phone-identity-b1/r1-b1-regression-evidence.json`).
* **Permissions.** On a clean replay under the CI toolchain, the contract generator reports **ADDED 7 · DIFFERENT 0 · REMOVED 0** against the previous reviewed contract; the strict check (no accepted drift) passes with 705 entries. On the local toolchain the check still shows **exactly the 13 pre-existing differences** and no new one. The 7 new functions: 4 `service_role`-only RPCs and 3 internal functions executable by nobody. `public.phone_verification_purge` is `CREATE OR REPLACE`d with its ACL unchanged. The 13 stay open; nothing was revoked, regenerated or allow-listed.
* **Other methods** (executable, every cell): e-mail + password sign-up (X1), Email OTP request (X2), recovery (X3), e-mail and legacy phone-alias sign-in (X4), Google-shaped, Facebook-without-e-mail and Facebook-unverified-e-mail users (X5). The guard's trigger `WHEN` clause means none of them can reach the guard function. Resend SMTP itself cannot be exercised locally (it would send real e-mail); the local stack's mail goes to Mailpit, and nothing in R1 touches the e-mail path.

## 4. Design as built (differences from the PR #122 proposal)
* **One table, two lifecycles.** `app.phone_verification_challenges.user_id` is nullable; `purpose in ('primary_proof','signup_proof')`; the subject check makes the lifecycles disjoint (`primary_proof` ⇒ user, no registration; `signup_proof` ⇒ registration, no user). One open signup challenge per **registration** (not per number), so nobody can kill a victim's code by starting their own for the same number; per-number hourly cap (5), per-registration cooldown and cap, per-IP bucket (an HMAC, the database never sees an address).
* **MAC context** `otp1|challenge|subject|purpose|code`: the purpose is in the MAC, so a primary code can never verify a signup challenge even with the same UUID in the subject slot (unit test).
* **No existence oracle at start.** A number that already belongs to an account gets a row that is born closed (`suppressed`) and `deliver:false`, with the same reply and the same limits; the server sends nothing. Verify then fails like any wrong code. **Same latency too:** an automated security review of the first commit pointed out that awaiting the network send only when a number is free would let response time reveal whether a number is registered. Delivery therefore runs *after* the reply (`defer`: Next `after()` / Workers `waitUntil` in production, a collected task in tests); a delivery failure is invisible in the reply and closes the challenge in the background (`delivery_failed`). Unit tests prove the reply returns while the send is still pending and that failure and success replies have the same shape; the real-database test proves the background invalidation.
* **Grant** = (alias, canonical phone, intent `phone_signup`, registration, challenge — unique, ≤30 min lifetime, default 10). The guard consumes it at COMMIT of the Auth transaction; `attach` requires that the **same Auth user** consumed it, that the Auth e-mail is the alias, that the profile holds the proven number, that the attach window (15 min) is open and that it was never attached, then sets `phone_verified_at` under the profile row lock with the same `WHERE phone = … AND phone_verified_at IS NULL` rule as B1. An existing identity guard (`guard_phone_password_identity`) already prevents an alias account's profile number from drifting; pgTAP asserts that protection stays and disables it only inside the test to prove `attach` re-checks on its own.
* **Lock order** (documented in the migration header, stress-verified): signup start/verify/invalidate: registration advisory lock → phone advisory lock (start) → challenge row → IP bucket; attach: per-user advisory lock → profile row → grant row; the guard touches only the grant row at COMMIT.
* **Why the guard is a *deferred constraint trigger*** (PR #122 evidence): GoTrue's Admin API applies `app_metadata` by a later UPDATE in the same transaction, so only a COMMIT-time re-read can see it, and a public body cannot set it.

## 5. Delivery design as built
One interface (`PhoneOtpTransport.send`, throws a message with no number or code on any failure). `PHONE_OTP_DELIVERY`: **`off` (default; anything unrecognised ⇒ off)**, `outbox` (local fake: one file per message under a git-ignored directory, number stored masked + digest, **refused when `NODE_ENV=production`**, console never written — asserted with spies), `worker` (the Cloudflare Worker adapter: signs `id.timestamp.body` exactly as PR #114's verifier expects, https-only, no detail in errors; **not wired** — `WORKER_WIRED = false`, so even `worker` resolves to the refusing transport). The switch never reads `NEXT_PUBLIC_APP_ENV`. Removing the existing plaintext logging belongs to #113 (`server/auth/whatsapp-otp.ts`, to be deleted; see the integration document). The real Worker and Meta stay disabled everywhere.

## 6. Migration, activation and rollback
`PHONE_SIGNUP_R1_MIGRATION_AND_ACTIVATION_PLAN.md`: 8 stages (inspect → apply dormant → deploy app OFF → observe → provision/approve delivery → enable signup → enforce), each with an evidence gate and a one-statement rollback; `enforce` is tied to retiring the old no-grant creators (SEC-C5), i.e. to #113; structural rollback script; observation attribution query.

## 7. #113 registration E2E workflows
One root cause, not two (this corrects PR #122's first draft, which said the auth spec never completes the basics step: it does, through the same helper). #113's commit `58b63e7e` replaced the specialty chips with `<select id="specialtyAdd">`; `completeAccountBasics()` still clicked the chips, nothing was picked, the real form answered "Pick at least one specialty", the page stayed on `/onboarding/basics` and every caller of `reachLanding()` timed out.

**What I did.** I read the source, reproduced the failure locally, fixed the helper through the real dropdown (and asserted the real form shows the chosen specialty, so the onboarding step is exercised, not bypassed), then ran both workflows' exact commands on an isolated stack with the repo-pinned CLI (2.110.0, Postgres 17.6.1.143, production `next build` + `next start`, real Turnstile widget and Siteverify for the CAPTCHA workflow). While I was doing so the #113 author pushed four commits including an equivalent fix, so I re-ran everything on the new head.

| Workflow | CI on #113 `58b63e7e` | local, `58b63e7e` + my fix | local, **current head `03f59733`** (author's own fix) + the SQL-helper PR |
|---|---|---|---|
| Showroom RC2 E2E | 49 failed | 38 + 11 passed, 2 skipped by design; 1 test hits a hard-coded `127.0.0.1:54321` (my stack is on another port) and **passed** through a port forward | 38 + 11 passed, 2 skipped; the same 1 test passed through the forward |
| Auth CAPTCHA E2E | 18 failed, 16 passed | 34 passed, 0 failed (first run 32 + 1 flaky + 1 Windows-only helper failure, see below) | **33 passed, 0 failed**, 1 flaky that passed on retry (`auth-password-preview.spec.ts:739`) |
| Before/after on one spec | – | `orders-projects.spec.ts`: 4/4 fail with the CI's `waitForURL` timeout without the fix, pass with it | – |

* **PR #124** (Draft, base = #113's branch, #113 untouched): `sqlValue()` in `e2e/helpers/phone-sign-up.ts` built `docker exec … -F '|'` as a shell string, which `cmd.exe` treats as a pipe: the phone sign-up spec failed on Windows only. `execFileSync` fixes it. My first PR (#123) carried the specialty fix too, conflicted with the author's equivalent commit, and was closed in favour of #124; no history was rewritten.
* The flaky tests differ from run to run and pass on retry; the machine ran about 60 containers while the real widget loaded, so timing noise is expected. **Not run:** `gotrue-direct` (green in CI), the mobile projects, and a GitHub-hosted run of either workflow.
* These suites test #113 *without* the R1 authority. After #113 is rebuilt on the authority (§8) its E2E must be re-run with the outbox transport and the switches from the integration document.

## 8. Required changes in #113, #116, #114, #121
`PHONE_SIGNUP_R1_REGISTRATION_INTEGRATION.md`. Headlines: #113 replaces its own challenge table, hashing and Meta call with the authority + transport, creates the Auth user with `signupCreateUserPayload`, calls `attach`, deletes `whatsapp-otp.ts`, and drops the no-grant creators; #116 only needs the retarget and a contract regeneration; #114 gets an application route and per-request language, stays disabled; #121 is the base and gains two allow-list entries (tests 104, 119).

## 9. Hosted security inspection — not run, exact requirement
The read-only tooling is built and self-tested. **Required to run it** (nothing was inferred from local configuration): `SUPABASE_ACCESS_TOKEN` with read access to both projects + `SUPABASE_REF_ACCEPTANCE` / `SUPABASE_REF_PRODUCTION`; optionally `CLOUDFLARE_API_TOKEN` (Workers Scripts: Read) + `CF_ACCOUNT_ID` + worker names for secret *presence*. No Supabase or Cloudflare connector is authenticated in this environment. It reports: e-mail confirmation requirement, sign-up availability, CAPTCHA protection and provider, phone provider, Send-SMS hook, before-user-created hook, Phone MFA, anonymous sign-ins, WhatsApp secret presence (names only), the 13 functions' effective rights for `service_role`/`anon`/`authenticated`, whether B1/R1 objects exist and their switches, default function privileges, and a count of unconfirmed alias users (possible squats). #113's own documents state hosted CAPTCHA protection has been ON since 2026-10-28: that is a claim, not a measurement.

## 10. Remaining risks
| Risk | State |
|---|---|
| **V1 stays open on hosted until the guard is enforced** (enforce is tied to #113 + delivery approval) | by design; severity depends on stage-1 measurements (§9); interim options in the activation plan §6 |
| **The guard depends on GoTrue writing the Admin API's `app_metadata` in the SAME transaction as the user INSERT** (measured on v2.193.0 and v2.197.0; SEC-B6c in the PR #122 probe). If a hosted GoTrue version split them, `enforce` would refuse legitimate creations (fail-closed) | hosted GoTrue version unknown: confirm it in stage 1, and let **`observe` prove it on the hosted version** before `enforce` (a legitimate creation with `had_grant = false` in the observation query is the symptom) |
| Guard refusal surfaces as GoTrue `500 unexpected_failure` | the registration code must map it to a neutral message (integration doc) |
| Phone-number existence oracle in GoTrue's own sign-up answer (200 obfuscated vs 422, varies by mode and run) | not fixable in the database; edge CAPTCHA/rate limits; recorded as evidence (SEC-A11), not gated |
| Delivery, HMAC key provisioning, purge scheduling, edge rate limiting on start/verify | not built/approved here; activation stage 5 |
| The 13 permission differences | open; reconciliation document unchanged; hosted state unverified |
| Sealed sign-up cookie keeps the password and shares its key with the old HMAC secret | flagged for #113 |
| `observe` records `user_id` only; attribution relies on `registration_source` | acceptable; stated in the plan |

## 11. GO / NO-GO
**GO** to review and to merge R1 *as dormant code* (default behaviour unchanged; proven by the `shipped` cells and the full pgTAP).
**NO-GO** to any hosted activation until: the hosted read-only inspection is done and archived; #113 is rebuilt on this authority (§8) with its E2E green; the old no-grant creators are retired; the permission contract is regenerated on the merged tree with a decision on the 13; delivery (Worker + Meta) is separately approved; HMAC keys, purge schedule and edge limits are provisioned; the activation stages 4 → 7 are executed in order with their gates.
**Do not merge #113 before** the guard + authority integration in §8 passes its own tests: this report only proves the database and server halves.

## 12. Reproduce (all local, isolated stacks; nothing is sent)
```
# stack: this worktree's UNCOMMITTED supabase/config.toml uses project_id aladdin_sec (ports 515xx)
bash supabase/tests/sec/verify_local_toolchain.sh                  # reset, contract, full pgTAP, unit, integration, stress, matrix, concurrency
R1_TOOLCHAIN=ci110 bash supabase/tests/sec/run_r1.sh               # matrix on the CI toolchain (npx supabase@2.110.0, scratch project outside the repo)
bash supabase/tests/sec/verify_ci_toolchain.sh                     # CI parity: reset, strict contract, lint, full pgTAP, concurrency (GEN=1 regenerates the contract)
SEC_MODE=confirm-off SEC_POSTURE=enforce DB_CONTAINER=supabase_db_aladdin_sec node supabase/tests/sec/signup_authority.test.mjs   # one cell
node --test scripts/hosted-db/inspect-auth-security.test.mjs       # hosted-inspection self-tests (no network)
```
The runners refuse any project other than the isolated ones, restore the local config on exit, and fail on any FAIL, XPASS, missing summary line or missing success marker.
