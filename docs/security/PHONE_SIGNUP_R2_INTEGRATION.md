# R2 — unified registration on the single phone verification authority

**Status:** Draft PR, local evidence only. Nothing merged, deployed, applied to Acceptance/Production, enabled, or sent. No real WhatsApp/SMS/e-mail was used; every account was synthetic and local.
**Base:** `claude/registration-resume` (#116, which sits on #113) **merged with** the phone-authority stack `#119 → #120 → #121 → #122 → #125` and the Windows E2E helper `#124`. The two stacks touch **disjoint files** (checked: no path overlap; the merge had no conflicts).
**Decision records for the two GO/NO-GO calls are in §10. They are deliberately separate.**

## 1. What changed (and what did not)

| Area | Before (#113 alone) | R2 |
|---|---|---|
| Who generates, hashes, stores, sends and checks the WhatsApp code | the sign-up server itself (`phone-sign-up.ts` + `whatsapp-otp.ts` + `public.phone_verification_challenges`) | **only the authority** (`server/phone-verification`, migrations `20261030090001/2`). `phone-sign-up.ts` holds no code, no hash, no table access |
| Order for a new phone account | check code → create Auth user (no proof attached) → sign in → init | **start** (authority opens a challenge for a random registration id) → **verify** (single-use *grant*) → Admin-create the Auth user *with the grant in `app_metadata`* (`signupCreateUserPayload`) → sign in → existing init RPCs → **attach** (`profiles.phone_verified_at` for the exact proven number). A refused attach rolls the new user back |
| Phone-number existence | answered at step 1 (`phoneExists`) — an oracle | **not asked**. A registered number sees the same screens and gets no message (the authority suppresses delivery). Only after a *valid* code can `phoneExists` appear (a race), which requires possession |
| Direct Meta sender in Next.js | `whatsapp-otp.ts`, `WHATSAPP_*` env readers, wrangler vars | **removed**. One delivery interface (`transport.ts`, `PHONE_OTP_DELIVERY`, default `off`) |
| No-grant phone-alias creators | `createCraftsmanPasswordUser`, `createShowroomPasswordUser`, grant-less `createPhoneSignUpUser` | **removed** from the app (they had no live callers: the Installer/Showroom pages are redirects since #113). `createPhoneSignUpUser` now *requires* a grant. `alias_guard_mode='enforce'` refuses anything else at the database |
| Legacy phone/password **sign-in**, existing accounts | — | untouched (`resolveSignInEmail`, `deleteCraftsmanPasswordUser` kept; no account, role, membership, consent or point is written by R2) |
| Email + password (Email OTP), recovery, #116 continuation and username lease, Google, Facebook | — | untouched; WhatsApp proof is **not** required for them |
| Legacy table | `public.phone_verification_challenges` created by `20261028090001` | dropped by the **new** forward-only migration `20261031090001` (see §4) |

Files removed: `server/auth/whatsapp-otp.ts` (+ test). Env removed from the web app: `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE` (`lib/env`, `.env.example`, `wrangler.jsonc`). Added to `.env.example` (all OFF): `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED`, `PHONE_OTP_HMAC_KEYS`, `PHONE_OTP_DELIVERY`, `PHONE_OTP_OUTBOX_DIR`.

## 2. Authentication architecture after R2

```
Browser ── /auth/sign-up ─┬─ email + password ───────────► supabase.auth.signUp()  ─► Email OTP (Resend SMTP) ─► verify ─► init RPCs      [unchanged]
                          ├─ Google / Facebook ──────────► Supabase OAuth (callback, link-or-create)                                      [unchanged]
                          └─ mobile number + password ───► Server Action (phone-sign-up.ts)
                                 1 start   ─ getPhoneSignupService().start(rid, e164, ip, locale) ─► phone_signup_start (MAC stored, never the code)
                                              reply FIRST; delivery runs in after() → transport (off | outbox | worker[not wired])
                                 2 verify  ─ service.verify(rid, cid, code, ip) ─► phone_signup_verify ─► one single-use GRANT (alias + phone + rid bound)
                                 3 create  ─ Admin API createUser(payload with app_metadata.phone_signup_grant / _registration)
                                              └ DB: deferred trigger phone_alias_guard (mode off|observe|enforce) consumes the grant at COMMIT
                                 4 sign in ─ GoTrue password grant (second Turnstile token)
                                 5 init    ─ record_consent · onboarding_select_account_type · profile_set_phone · profile_set_username · profile_set_display_name · birth date
                                 6 attach  ─ phone_signup_attach(user, grant) ─► profiles.phone_verified_at (exact number, once)
                                 any failure ⇒ sign out + delete the new Auth user (quarantine if delete fails)

Sign-in (one field: number | username | email) ─► resolveSignInEmail ─► password grant        [unchanged; legacy alias accounts keep working]
```

Invariants: the code exists in one place (the authority); the keyring is a server secret the database never sees; the sealed cookie has its own key domain (`phone-sign-up-cookie`), no longer sharing a secret with a code MAC; the sign-up reply never depends on delivery or on whether a number is registered.

## 3. Switches (all ship OFF)

| Layer | Switch | Default |
|---|---|---|
| App | `PHONE_VERIFICATION_ENABLED`, `PHONE_SIGNUP_VERIFICATION_ENABLED` | off (anything but literal `true`) |
| App | `PHONE_OTP_DELIVERY` | `off`; `outbox` is refused when `NODE_ENV=production`; `worker` is **not wired** (`WORKER_WIRED=false`) |
| DB | `app.phone_verification_config.enabled`, `.signup_enabled`, `.alias_guard_mode` | `false`, `false`, `off` |

With the defaults the phone sign-up screen answers "unavailable" and **no mobile-number account can be created through the app**. Email and OAuth registration continue. This is a visible change relative to `main`, whose Installer/Showroom pages still create phone accounts without proof — see §10 (merge conditions).

## 4. Migration compatibility report

* **History checked:** `supabase/migrations` of the combined tree: #113/#116 (`20261028090001`, `…090003`, `20261029090001/2`) < R1 (`20261030090001/2`) < R2 (`20261031090001`). Strictly increasing, no duplicate versions, nothing renumbered, and no existing migration file modified or deleted: `git diff --name-status origin/claude/registration-resume...HEAD -- supabase/migrations` lists only **added** files (R1's `…30090001/2`, already in its own PRs, and R2's `…31090001`).
* **Why a forward-only migration instead of editing `20261028090001`:** R1's integration notes call #113's migration "unmerged, so editable". That is not provable from here: the repository records it as not applied to Acceptance/Production (`RUNTIME_STATE.md`), but later #113/#116 migrations *are* recorded as applied to TEST/Acceptance and migrations apply in order, so `…090001` may be present. The new migration is a plain `DROP TABLE IF EXISTS public.phone_verification_challenges` (no `CASCADE`): safe whether or not the old one ran, and it fails loudly if anything unexpected depends on the table. `users.birth_date` (also from `…090001`) is kept.
* **Rollout order (expand → contract):** deploy the application that no longer touches the table, **then** apply `20261031090001`. Rows are ≤30-minute one-time hashes; dropping them only ends a code already in flight.
* **Permission contract:** the new migration adds/changes no function, so `supabase/permissions/20261030090002.json` remains the latest reviewed contract and the gate carries it forward (`migration-permission-gate.mjs` loads a contract only when a file exists for that version). Verified on the combined tree: see §6.
* **Table vs authority separation:** `public.phone_verification_challenges` (legacy, dropped) ≠ `app.phone_verification_challenges` (R1/B1 authority, kept). pgTAP 116 now asserts the first is gone and the second is unreachable by every client role including `service_role`.
* **Generated types:** the legacy table entry was removed from `database.types.ts` (hand edit of a generated file; regenerate on the CI toolchain after merge).
* **Hosted history is unknown to this checkout.** The extended read-only inspection reports exactly which repo migrations are applied or missing and whether `20261028090001` exists (§8) — that answer decides nothing about safety (the drop is idempotent) but must be recorded before the hosted apply.

## 5. Delivery and runtime (Mission 3)

* One interface (`PhoneOtpTransport`). The Next.js app contains **no** Meta call any more (`grep -r graph.facebook.com frontend/src` → none).
* **`after()` on Cloudflare — verified from source, not assumed.** `@opennextjs/cloudflare 1.20.13` / `@opennextjs/aws 4.1.12`: the Worker `fetch` runs the `cloudflare-node` wrapper, which calls `ctx.waitUntil(handler(event, { waitUntil: ctx.waitUntil.bind(ctx), … }))`; `runWithOpenNextRequestContext` publishes `Symbol.for("@next/request-context")` whose `waitUntil` is that same function; Next 16's `after()` registers its callback there, and at request end the pending runner is passed to `waitUntil` once more. So the delivery task is registered on the real `ctx.waitUntil` and runs after the response is sent. Limits that remain: Workers cancel `waitUntil` work ~30 s after the response (the send is a single short `fetch`), and **a task that is not registered is cancelled with the response**. R1's `defer` fell back to a bare `void task` when `after()` threw; that now logs `phone verification: post-response hook unavailable; delivery runs unprotected` (no number, no code) so the failure is visible. **Not verifiable locally:** the Worker bundle itself (`pnpm --filter frontend cf:build` is Linux-only here); it is a required CI check (§7).
* **Timing/existence:** the authority returns the identical `sent` shape for free and registered numbers; the only difference is `deliver:false`, acted on *inside* the deferred task. `signup-service.test.ts` proves the reply does not wait for delivery; the E2E proves a registered number gets the same screen and **no outbox file**. Wrong-code behaviour is uniform (`invalid` + the same IP bump) for open, suppressed, exhausted and expired challenges, so a registered number cannot be told apart by guessing either.
* **Logs:** no code, number or secret is written by any R2 path (`logStepFailure` carries a step name and an error code only; the outbox writes files, never the console). A unit test asserts the Admin payload keeps the grant out of `user_metadata`.
* `PHONE_OTP_DELIVERY=off` stays the default; the Cloudflare Worker (#114) is not activated and `WORKER_WIRED` is untouched.

## 6. Regression and security evidence (local, isolated stacks, nothing sent)

Machine: Windows 11, Docker, Node 24. Stacks are scratch Supabase projects outside the repo (`supabase/tests/r2/stack.sh`: project `aladdin_r2int`, ports 536xx; other projects/worktrees untouched). Toolchains: Supabase CLI 2.110.0 (CI pin; GoTrue v2.193.0) and 2.122.0 (GoTrue v2.197.0).

| Gate | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | clean |
| ESLint | 0 errors (63 pre-existing warnings, none in R2 files) |
| Unit (vitest, whole frontend) | 4409 passed, 5 failed, 54 skipped. The 5: `redis-guards` ×2 (Windows `\` vs `/` in a path comparison) and 3 image-processing timing tests — **none in R2's diff; the image tests pass when run alone (21/21)**; not re-run on the pre-R2 head, so "pre-existing" is inferred from the diff, not measured |
| R2-touched unit files | `phone-sign-up` 22 (grant order, wrong grant/phone/alias/registration, rollback when attach is refused, no existence check, resend keeps the registration), `admin-phone-user` (grant in `app_metadata` only, retired exports gone), `i18n` 60 |
| Full pgTAP on the combined tree (`supabase test db`, confirmations ON) | **148 files, 6651 tests, PASS** (includes 116 rewritten, 119/120 authority and guard, 104/108/98 identity invariants) |
| Permission contract | **711 exact function contracts PASS** (`20261031090001.json`). Reconciliation: the latest committed contract (R1, 705) lacked the 6 functions #113/#116 add (`app.account_specialty_kind`, `app.lock_username`, `app.username_lease_interval`, `app.username_leased_by_other`, `public.account_basics_set`, `public.my_account_basics`); the 6 are byte-identical to #116's reviewed entries, no R1 entry changed, #116's 697 are all contained, public RPC allow-list unchanged (9) |
| R1 security matrix on the combined tree (CI toolchain, both confirmation modes × shipped / observe / enforce) | 6 cells: **0 FAIL, 0 XPASS**; `enforce` → 44 / 45 PASS and **0 XFAIL** in both modes; identical cell-by-cell to R1's own committed `ci110` results (`docs/security/r2-evidence/`). Covers anonymous alias sign-up, squatting, grant forgery / replay / expiry, concurrent creation, wrong phone / account, duplicate identities, attach, rollback, Installer/Showroom identity invariance, direct API/RLS bypass |
| Interim hook probe | 4 cells (GoTrue v2.193.0 / v2.197.0 × confirmations ON / OFF): **31 PASS, 0 FAIL, 8 observations each** (`PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md`) |
| Hosted inspection tool | 23 offline tests pass; **not run against any hosted project** |
| E2E, mobile-number sign-up (outbox, guard `enforce`, `next dev`), desktop **and** mobile (Pixel 5) | `one-field-auth`: each of its 7 tests passes on each project (run in two batches): redirects; form structure; **sign-up with code read from the outbox → `phone_verified_at` set, exactly one attached grant, exactly one Auth user for the alias, sign-in by number and by username**; wrong code creates nothing and the right code still works; **registered number → same screen, no outbox message within 4 s, any code fails, no second account**; **legacy alias account made before enforcement still signs in by number, and a new grant-less alias is refused**; unknown identifier → generic error |
| E2E, e-mail + password with Email OTP, sign-in, forgot-password journey, resend, interruption/resume, recovery replay, profile completion — production build, **shipped switches (phone OFF)**, desktop + mobile, Turnstile stubbed, 0 retries | **58 passed, 2 failed.** The 2 (same test, both projects): `profile-completion` "display name, phone and avatar…" fails at the **avatar photo upload** ("Save photo" → `avatar-current`), after the name and phone steps passed — media storage is not configured on this local stack; unrelated to registration |
| E2E, Showroom RC2 desktop set, 0 retries | `showroom-mvp` + `sales` + `orders-projects`: 27 passed, 1 failed; `account-workspace-model`: 10 passed, 1 failed. Re-run alone: the Arabic-RTL workspace-selector test **passes** (flaky); `sales` "branch-limited salesperson… direct URL" **fails again for an environment reason** — it hard-codes the default stack `127.0.0.1:54321` (`ECONNREFUSED`), my isolated stack is on 53621. Neither involves sign-up |
| Known failing, not caused by R2 | `installer-profile-completion.spec.ts` (both projects): sign-up and proof succeed, then `completeAccountBasics` in `e2e/helpers/auth.ts` fails on the specialty step — the helper bug R1's notes assign to a separate PR (#123). Not patched here |
| Not run / not possible locally | real Turnstile widget and Supabase Auth CAPTCHA (CI workflow), real Google / Facebook round-trips, `cf:build` Worker bundle, GitHub Actions, hosted anything |

Test coverage vs the mission list: anonymous alias bypass ✔ (R1 SEC-A, hook probe A) · alias squatting ✔ · grant forgery / replay / expiry ✔ (SEC-D, pgTAP 120 F) · concurrent creation ✔ (SEC-D5) · wrong phone / account ✔ (unit + SEC) · duplicate Auth identities ✔ (E2E count = 1, SEC) · completion + `phone_verified_at` ✔ (E2E) · rollback after failed initialisation ✔ (unit; SEC) — **not** exercised end-to-end through the UI (username race) · Installer / Showroom invariance ✔ (SEC-E, pgTAP 104/108) · direct API / RLS ✔ (SEC) · confirmations ON/OFF ✔ · guard observe/enforce ✔.

## 7. GitHub Actions plan for the stacked branch and the final merge candidate

All existing workflows trigger on `pull_request → main` only (plus `workflow_dispatch` on `ci.yml` and `supabase-rls.yml`). A Draft PR whose base is `claude/registration-resume` therefore starts **nothing** by itself. Plan:

| # | When | Run | Why / what it adds over the local run |
|---|---|---|---|
| 1 | now, on `integration/unified-registration-r2-20261031` | **CI** (`workflow_dispatch`) | `typecheck`, `lint`, `test`, `build`, and the **`frontend-cloudflare` job** (`cf:build` + Worker dry-run bundle): the only place the Workers bundle containing the `after()`/`waitUntil` path and the edited `wrangler.jsonc` is built (Linux-only here) |
| 2 | same | **supabase-rls** (`workflow_dispatch`) | clean replay of every migration, `db lint`, permission gate (`check` against `supabase/permissions/20261030090002.json`), full pgTAP, concurrency scripts, **and the upgrade path from the RC2 baseline** |
| 3 | same | **Auth CAPTCHA E2E** and **Showroom RC2 E2E** (`workflow_dispatch`; the CAPTCHA one also has a branch trigger list) | real Turnstile widget + real Siteverify + Supabase Auth CAPTCHA ON (cannot be reproduced offline). **Add** `e2e/one-field-auth.spec.ts` + `e2e/installer-profile-completion.spec.ts` with `E2E_NEXT_MODE=dev PHONE_OTP_DELIVERY=outbox` (+ the `PHONE_*` env from `supabase/tests/r2/e2e-env.sh`) as a new step: the phone specs skip themselves otherwise |
| 4 | same | a **new manual workflow `phone-signup-security`** that runs `supabase/tests/sec/run_r1.sh` (R1 matrix, both confirmation modes × shipped/observe/enforce) and `supabase/tests/r2/run_hook_probe.sh` on the CI toolchain | the security evidence must be reproducible by someone other than this machine; R1 already documents a `ci110` toolchain for it |
| 5 | when #113, #116, #119–#122, #125, #124 have merged (in §9 order) | **retarget this PR to `main`**; the five `pull_request` workflows start automatically | the diff then shrinks to R2's own commits; regenerate `supabase/permissions/*.json` once on the merged tree (`node supabase/tests/b1/permission_contract.mjs <container> generate`) |
| 6 | final merge candidate | re-run 1–4 on the retargeted head; attach the hosted inspection output (§8) | merge gate |

Notes: (a) `hosted-acceptance-e2e` is **not** part of this plan — it needs the Acceptance project and the owner. (b) The phone specs must run on `next dev` because the outbox is refused under `NODE_ENV=production`; the production build is covered by suites that do not read the outbox. (c) Required-check names to protect on `main` stay `frontend`, `frontend-cloudflare`, `supabase-rls`; the two E2E workflows are informational today.

## 8. Hosted inspection (read-only) — checklist and status

**Status: the audit the owner reported covers Production and Acceptance Auth settings and the 13 disputed functions; this branch did not run it and holds no hosted credential** (no `SUPABASE_ACCESS_TOKEN`, no project refs, no Supabase CLI token, no Cloudflare token in this environment — checked by presence only). Nothing in this document claims hosted safety beyond what the owner reported.

The tool (`scripts/hosted-db/inspect-auth-security.mjs`, 23 offline tests) was extended so the **remaining** questions can be answered by one authorised run without writing anything. Its only network calls are `GET /config/auth`, `POST /database/query/read-only` (single SELECT/WITH, checked in code), `GET …/workers/scripts/<name>/secrets` (names) and `GET …/settings` (binding names; values only for five allow-listed non-secret switches). It prints no token.

| Question | Where it is answered | Known today |
|---|---|---|
| E-mail confirmation, CAPTCHA, phone provider, Send-SMS hook, Phone MFA, anonymous sign-ins | `auth_interpretation` | **Owner reports:** confirmations + Turnstile ON, phone provider / Send-SMS hook / Phone MFA OFF (both envs) |
| Leaked-password protection | `auth_interpretation.leaked_password_protection_on` | **Owner reports: OFF** (both) |
| Redirect allow-list: stale Vercel, local, insecure, broad entries | `auth_interpretation.redirect_allowlist` | **Owner reports** potentially stale Vercel entries in Production (list not supplied) |
| Permission differences | `permission_diff` (full inventory vs the reviewed contract at the hosted version) and `disputed_functions_summary` | **Owner reports** the 13 disputed functions match the contract in both. The full-inventory diff is *new* and not yet run |
| Migration history | `migration_diff` (`applied_not_in_repo`, `repo_not_applied`, `r2_markers`) | **unknown** — in particular whether `20261028090001` is applied |
| R1 authority / guard installed + switches | `database.authority_objects`, `authority_switches` | **Owner reports** the R1 alias guard is not installed or enforced in either env |
| Legacy challenge table (what `20261031090001` would drop) | `database.legacy_challenge_table` | unknown |
| Alias census (possible squats) and 570 existing phone accounts | `database.alias_census` | **Owner reports** 570 confirmed phone-alias accounts in Production (preserve as is) |
| Worker secrets (names) and `PHONE_*` switch values | `whatsapp_delivery_secrets`, `worker_settings` | **Unverified** (needs `CLOUDFLARE_API_TOKEN` read scope, `CF_ACCOUNT_ID`, worker names) |

**Dependency to record:** hosted security clearance is a mandatory precondition for any merge or activation. The items above marked *unknown/unverified* are open. How to run it without pasting a secret: export the variables in your own shell from your secret store, or run `! node scripts/hosted-db/inspect-auth-security.mjs --env both > report.json` yourself; the output is booleans, enums, counts, URLs and function signatures.

## 9. Dependencies and the safe merge order

R2 contains, by merge, everything below it; once those are in `main`, this PR retargets `main` and shrinks to R2's own commits.

| Order | PR | Note |
|---|---|---|
| 0 | — | **Hosted security clearance recorded by the owner (§8). Mandatory before any merge.** |
| 1 | #113 registration | its own open review findings and owner decisions come first; R2 does not fix them |
| 2 | #124 Windows-safe E2E helper | targets #113's branch; merge with or right after it |
| 3 | #116 continuation + username lease | retarget to `main` after #113; regenerate its permission contract on the merged tree |
| 4 | #119 → #120 → #121 | B1 is blocked on the base-permission-drift decision (`PHONE_VERIFICATION_B1_BASE_PERMISSION_DRIFT.md`); the owner reports the 13 functions already match the contract on both hosted databases, which supports reading the drift as a local-replay artefact — record that decision |
| 5 | #122 → #125 | security tests, then R1 authority + guard (dormant: `enabled=false`, `signup_enabled=false`, `alias_guard_mode='off'`) |
| 6 | **this PR (R2)** | retarget to `main`; regenerate `supabase/permissions/*.json` once on the merged tree |
| — | #114 Cloudflare WhatsApp transport | **not required** for R2 and stays disabled; it needs its own reconciliation (route, language, country list, template name, duplicate ADR number) before it can ever be wired |

**Applying to a hosted project (separate approval each, Acceptance first):** (a) dormant migrations `20261030090001/2`; (b) deploy the application with every `PHONE_*` flag OFF; (c) only then `20261031090001` (drops the legacy table). Any order of (a) and (b) is safe because the app makes no authority call while the flags are off; (c) must come last because an older build still reads the legacy table. Activation (R1 plan stages 4–7: observe → provision → enable → enforce) is a different decision, §10.
**Independent of all of the above:** the interim hook (`PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md`) needs one function and one Auth setting, no deploy, and does not depend on any PR in this table.

## 10. Owner decisions

1. **Taken number at sign-up (UX vs enumeration).** R2 chooses *no existence oracle*: a registered number sees the code screen and receives nothing; the screen now says "If this number can be used to sign up, a 6-digit code is on its way…" (en/ar; reversible, one i18n line each). The alternative (keep `phoneExists` at step 1) restores a number-existence oracle behind Turnstile and the limiter. A neutral hint under the code field ("Already have an account? Sign in") is the usual mitigation and is a design task, not done here.
2. **Phone sign-up is unavailable between merge and activation.** `main` today lets Installer/Showroom users create phone accounts *without any proof* (this is the squatting exposure). #113 already redirects those pages to `/auth/*`; with R2 the phone path answers "unavailable" until activation. Email and Google/Facebook keep working. Accept that window, or schedule deploy and activation together.
3. **Interim hook** — approve or not (`PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md`).
4. **Leaked-password protection** and **redirect allow-list cleanup** — approve, and supply the real allow-list (`PHONE_SIGNUP_R2_AUTH_HARDENING_RECOMMENDATIONS.md`).
5. **Sealed cookie** still carries the password for ≤10 minutes (AES-GCM, httpOnly, `/auth`, own key domain). A server-side pending-registration store would remove that; out of scope here.


## 11. GO / NO-GO — two separate decisions

### A. Merging the dormant code (this PR and its stack) — **NO-GO today; technically ready for CI**
Why technically ready: everything ships OFF; the full local gate set is green (§6); no existing migration was edited; the permission contract is reconciled; rollback is a revert (code) and, for the DB, nothing to undo because all switches are off and `20261031090001` is applied last.
Why NO-GO right now (all are conditions, not code defects):
1. **Hosted security clearance is not recorded as complete** — a mandatory precondition you set. Open: Cloudflare Worker secret presence unverified; leaked-password protection OFF and redirect allow-list cleanup undecided (§8 and `PHONE_SIGNUP_R2_AUTH_HARDENING_RECOMMENDATIONS.md`); the migration-history question (`20261028090001` applied?) unanswered.
2. **GitHub Actions has not run on this stack** (§7). The Worker bundle (`frontend-cloudflare`) and the real-Turnstile E2E are the two things this machine cannot prove.
3. **#113's own open findings and owner decisions come first** (§9), and B1 (#121) is waiting on the base-permission-drift decision.
4. **Product decision:** between merge+deploy and activation, mobile-number sign-up answers "unavailable" (§10.2).
Becomes **GO** when 1–4 are cleared and the §7 runs are green on the final candidate.

### B. Enabling registration / WhatsApp delivery — **NO-GO**
Nothing here authorises any of it. Required first (R1 plan stages 1–7): hosted inspection archived; dormant migrations applied on Acceptance by the owner; app deployed with flags OFF; `observe` window clean (every observation attributable to a retired path, no `phone_whatsapp_sign_up` with `had_grant=false`); HMAC keyring provisioned; edge rate limiting on the start/verify actions; **an approved delivery adapter** — `worker` mode is deliberately not wired (`WORKER_WIRED=false`), PR #114 needs its own reconciliation, and the Meta template/country list/language decisions are open; a rehearsal on Acceptance with an allow-listed number; the §10 decisions; then `enforce` only after the no-grant creators are confirmed retired in the deployed build.

### C. Independent of A and B — the interim hook
Recommended as a stop-gap **on Acceptance first** if A/B will take long (`PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md` §6–7). It needs its own owner approval; it does not enable registration or delivery.
