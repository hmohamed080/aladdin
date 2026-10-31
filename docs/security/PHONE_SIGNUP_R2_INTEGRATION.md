# R2 — unified registration on the single phone verification authority

**Status:** Draft PR, local evidence only. Nothing merged, deployed, applied to Acceptance/Production, enabled, or sent. No real WhatsApp/SMS/e-mail was used; every account was synthetic and local.
**Base:** `claude/registration-resume` (#116, which sits on #113) **merged with** the phone-authority stack `#119 → #120 → #121 → #122 → #125` and the Windows E2E helper `#124`. The two stacks touch **disjoint files** (checked: no path overlap; the merge had no conflicts).
**Updated 2026-10-31 after the owner's review: merge, deployment and hosted activation are NOT approved. The phased, backward-compatible release plan is `PHONE_SIGNUP_R2_RELEASE_PLAN.md`; the separate GO/NO-GO decisions are in §11.**

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
| Legacy table | `public.phone_verification_challenges` created by `20261028090001` | **kept for now**; unused by the R2 build. Its DROP is a *contract-step proposal*, deliberately **not** in `supabase/migrations` (§4) |

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

## 4. Migration compatibility report (revised: R2 adds no migration)

* **History:** the combined tree's migrations are strictly increasing and unique: #113/#116 (`20261028090001`, `…090003`, `20261029090001/2`) < R1 (`20261030090001/2`, last). No existing migration was modified, renamed or deleted (`git diff --name-status` over `supabase/migrations` shows only R1's two additions relative to #116). **R2 itself adds no migration.**
* **Legacy table (expand/contract).** `public.phone_verification_challenges` (from `20261028090001`) stays. The R2 build never touches it; leaving it costs nothing (RLS on, `service_role` only, rows live ≤30 minutes). Dropping it is the *contract* step and must not run ahead of the compatible application. A file in `supabase/migrations` is applied by the next `supabase db push --linked` to whichever project is pushed, in order, with no knowledge of the deployed build, so the DROP **cannot** safely live there until the application has moved. It is therefore a proposal: `supabase/proposals/contract_20261031090001_retire_registration_phone_challenges.sql`, with (a) a runtime guard that refuses while codes were issued in the last hour (tested on three paths: table absent → no-op, recent row → refuses, idle table → drops), (b) no `CASCADE`, and (c) three written promotion conditions — R2 live on every target environment, no earlier build reachable by rollback, owner approval plus a fresh read-only migration-history check. `scripts/hosted-db/inspect-auth-security.test.mjs` fails if it ever appears in `supabase/migrations` prematurely. (An earlier revision of this PR *did* put the DROP in `supabase/migrations`; the owner's requirement that migrations cannot run ahead of the compatible app made that wrong, and it was moved out together with the pgTAP-116 and generated-types changes.)
* **Permission contracts — a real inconsistency found and fixed.** R1's contract files `20261030090001.json` (B1) and `20261030090002.json` were generated on a tree without #113/#116, so both lacked six functions those PRs add (`app.account_specialty_kind`, `app.lock_username`, `app.username_lease_interval`, `app.username_leased_by_other`, `public.account_basics_set`, `public.my_account_basics`). My first local check validated only the latest contract and missed B1's; **GitHub's `supabase-rls` caught it** ("unreviewed signature" at the B1 step of the upgrade path). Both files now contain the six, byte-identical to the entries #116 reviewed in `20261029090002.json`; no R1 entry changed; #116's 697 functions are all contained; the public RPC allow-list is unchanged (9). After the fix `supabase-rls` passes (clean replay, lint, gate, full pgTAP, RC2 upgrade path).
* **Dormant migrations ahead of the app are safe:** the application makes no authority call while its flags are off, and the guard is inert (`off`).
* **Hosted history is unknown to this checkout.** Before any hosted migration: `node scripts/hosted-db/inspect-auth-security.mjs --env <env> --only migrations` (one read-only SELECT of the applied versions, diffed against this checkout; reports `applied_not_in_repo`, `repo_not_applied` and whether `20261028090001` is applied). Needs only the read token.

## 5. Delivery and runtime (Mission 3)

* One interface (`PhoneOtpTransport`). The Next.js app contains **no** Meta call any more (`grep -r graph.facebook.com frontend/src` → none).
* **`after()` on Cloudflare — verified from source, not assumed.** `@opennextjs/cloudflare 1.20.13` / `@opennextjs/aws 4.1.12`: the Worker `fetch` runs the `cloudflare-node` wrapper, which calls `ctx.waitUntil(handler(event, { waitUntil: ctx.waitUntil.bind(ctx), … }))`; `runWithOpenNextRequestContext` publishes `Symbol.for("@next/request-context")` whose `waitUntil` is that same function; Next 16's `after()` registers its callback there, and at request end the pending runner is passed to `waitUntil` once more. So the delivery task is registered on the real `ctx.waitUntil` and runs after the response is sent. Limits that remain: Workers cancel `waitUntil` work ~30 s after the response (the send is a single short `fetch`), and **a task that is not registered is cancelled with the response**. R1's `defer` fell back to a bare `void task` when `after()` threw; that now logs `phone verification: post-response hook unavailable; delivery runs unprotected` (no number, no code) so the failure is visible. **Not verifiable locally:** the Worker bundle itself (`pnpm --filter frontend cf:build` is Linux-only here); it is a required CI check (§7).
* **Timing/existence:** the authority returns the identical `sent` shape for free and registered numbers; the only difference is `deliver:false`, acted on *inside* the deferred task. `signup-service.test.ts` proves the reply does not wait for delivery; the E2E proves a registered number gets the same screen and **no outbox file**. Wrong-code behaviour is uniform (`invalid` + the same IP bump) for open, suppressed, exhausted and expired challenges, so a registered number cannot be told apart by guessing either.
* **Logs:** no code, number or secret is written by any R2 path (`logStepFailure` carries a step name and an error code only; the outbox writes files, never the console). A unit test asserts the Admin payload keeps the grant out of `user_metadata`.
* `PHONE_OTP_DELIVERY=off` stays the default; the Cloudflare Worker (#114) is not activated and `WORKER_WIRED` is untouched.

## 6. Regression and security evidence

Local = Windows 11, Docker, Node 24, isolated scratch Supabase stacks outside the repo (`supabase/tests/r2/stack.sh`; other worktrees' stacks untouched), CLI 2.110.0 (GoTrue v2.193.0) and 2.122.0 (v2.197.0). GitHub = runners on the pushed branch. Nothing was sent anywhere.

| Gate | Local | GitHub (final head `9a0b1430`) |
|---|---|---|
| TypeScript / ESLint | clean / 0 errors (63 pre-existing warnings; none in R2 files) | `CI › frontend` ✓ |
| Unit (vitest, whole frontend) | **354 files, 4419 tests, 0 failures** (resolved: see §6.1) | `CI › frontend` ✓ |
| Production build, Cloudflare Worker bundle (dry run, no upload) | not buildable here (Linux-only) | `CI › frontend-cloudflare` ✓ — the first place the `after()`/`waitUntil` path and the edited `wrangler.jsonc` were bundled |
| Full pgTAP, clean replay, db lint, permission gate, concurrency scripts, **RC2 upgrade path** | 148 files / 6651 tests pass (before the contract-step move) | `supabase-rls` `supabase-rls` ✓ (a236a45b after the contract fix, and again on the final head `9a0b1430`) |
| R1 security matrix (both confirmation modes × shipped/observe/enforce) | 6 cells, 0 FAIL / 0 XPASS, `enforce` 0 XFAIL, identical to R1's own run | `Phone sign-up security (R2) › r1-security-matrix` ✓ (push and PR runs) |
| Mobile-number sign-up E2E (outbox, guard `enforce`, `next dev`), desktop **and** mobile | `one-field-auth` 7 tests + `installer-profile-completion` pass | `Phone sign-up security (R2) › phone-e2e` ✓ (push and PR runs) |
| Interim hook probe (GoTrue v2.193.0 / v2.197.0 × confirmations on/off) | 4 cells × (31 PASS, 0 FAIL) | `› hook-probe` ✓ (CI toolchain) |
| Hook rollback drill | 13/13 | — (local only) |
| Auth CAPTCHA E2E (real Turnstile widget, Supabase Auth CAPTCHA ON) incl. e-mail + Email OTP sign-up, sign-in, forgot-password, resend, interruption/resume, recovery replay, profile completion, GoTrue-direct | stubbed-widget runs: 58 / 60 (see §6.1) | `Auth CAPTCHA E2E` ✓ and both `gotrue-direct` jobs (fail / spent) ✓ |
| Showroom RC2 E2E | desktop set: see §6.1 | `Showroom RC2 E2E` ✓ |
| Inspection tool (offline) | 29 tests | — |

Coverage vs the mission list: anonymous alias bypass ✔ · alias squatting ✔ · grant forgery / replay / expiry ✔ · concurrent creation ✔ · wrong phone / account ✔ · duplicate Auth identities ✔ (E2E: one Auth user for the alias) · completion + `phone_verified_at` ✔ (E2E asserts the attached grant) · rollback after failed initialisation ✔ (unit, SEC; not driven through the UI) · Installer/Showroom invariance ✔ · direct API / RLS bypass ✔ · confirmations ON/OFF ✔ · guard observe/enforce ✔ · email + Email OTP / sign-in / recovery / resume / Google / Facebook ✔ unchanged (Google/Facebook: unchanged code + the exercised user-object shapes; no real provider round-trip is possible on a local stack).

### 6.1 Failure disposition (every failure seen, none left unexplained)

| Failure | Root cause | Disposition |
|---|---|---|
| 5 unit tests (`redis-guards` ×2, 3 image-processing timing) | `redis-guards` compared `app\api\…` with `app/api/…` on Windows; the image tests exceeded 5 s on a loaded machine. **Proven not R2:** a worktree of #116's head (shared `node_modules`) fails the Redis pair **identically** and passes the image files | Redis test made path-separator neutral (2 lines); image tests pass alone (21/21) and in the final full run. **Resolved** |
| `installer-profile-completion` (desktop + mobile) — the failure R1's notes attributed to a closed PR #123 | investigated against the latest code, **three independent causes**: (1) `next dev` compiles the post-save route on first hit ("Saving…" + "Rendering…" in the screenshot) and the helper waited 10 s; (2) the spec asserted a brand-new installer has *not* done "activities", but the ADR-0026 sign-up step (which this spec's own helper completes) collects specialties and location, so a fresh account starts above 50%; (3) not a product defect. Not the old specialty-selector bug | helper wait raised to 60 s; spec updated for ADR-0026 (the figure-agreement purpose is kept); passes locally (desktop) and on GitHub (desktop + mobile). **Resolved in this PR — not relying on #123** |
| `profile-completion` avatar upload (prod build, once) | did not recur: passes in the re-run, in the dev-mode installer spec, and on GitHub | transient local environment; not R2 |
| `sales` branch-limited scope | first: `ECONNREFUSED 127.0.0.1:54321` — the test reads `SUPABASE_URL`, my isolated stack is not on the default port (**fixed in the env script**); second: it failed after I ran `account-workspace-model` in the same invocation, which revokes Karim's membership by design (the workflow documents the order) | passes in the correct order locally; `Showroom RC2 E2E` ✓ on GitHub |
| `account-workspace-model` Arabic-RTL render | flaky: passes on re-run and on GitHub | not R2 |
| `profile-completion` "username lost during the OTP window" (mobile, desktop once), "neutral unavailable" (once ×2), `sales` mobile bottom navigation | the Turnstile stub did not hand out a token within 30 s / a 60 s navigation timeout on a machine running several Docker stacks and GitHub traffic; they pass on other runs of the same build (the same tests passed on both projects in my earlier full run) and on GitHub with the **real** widget | load-sensitive locally; GitHub is the reference (`Auth CAPTCHA E2E` ✓ on the final head). Not R2: none touches sign-up code |

## 7. GitHub Actions: what ran, what is left

Existing workflows react only to pull requests that target `main`, so for this stacked branch they were dispatched by hand on the branch (`CI`, `supabase-rls`, `Auth CAPTCHA E2E`, `Showroom RC2 E2E`) and a new workflow, `.github/workflows/phone-signup-security.yml`, runs on every push to this branch and on PRs into the registration branch: the outbox-driven phone E2E (desktop + mobile, `next dev`), the R1 security matrix and the hook probe on the CI toolchain. Cloudflare **deploy** workflows were not run (`cloudflare-production` is manual; its default stage only builds and bundles, and `CI › frontend-cloudflare` already does that without any Cloudflare credential). **Left:** when #113/#116/the dormant stack are in `main`, retarget this PR to `main` so the five `pull_request` workflows start by themselves, regenerate nothing else (contracts are already reconciled), and re-run all of the above on that final candidate before any merge.

## 8. Hosted audit and the R2 checklist

The owner's completed read-only audit is reconciled item by item in `PHONE_SIGNUP_R2_RELEASE_PLAN.md` §6 (13 disputed permissions **closed**, not reopened; 570 alias accounts preserved; guard not installed; squatting open → hook; leaked-password and redirects open → prepared only; Worker secret presence → an **activation** dependency, not a blocker for merging entirely dormant code). The inspection tool can now (a) confirm the exact hosted migration history with the narrowest access (`--only migrations`), (b) diff the full function inventory against the reviewed contract, (c) compare the redirect allow-list **exactly** against an owner-confirmed file (`--expected docs/security/hosted/redirect-allowlist.expected.json`, currently unconfirmed), and (d) read Worker binding names and five allow-listed non-secret switches. **It has not been run against any hosted project**; this environment holds no hosted credential.

## 9. Dependencies and merge order

The initial order is accepted by the owner, with the rule that **nothing merges until the final combined candidate passes every mandatory check**. It is executed in two blocks (dormant stack first; route-changing #113 + #116 + R2 last) — see `PHONE_SIGNUP_R2_RELEASE_PLAN.md` §3. Order: #119 → #120 → #121 → #122 → #125 · #124 with #113 · #113 → #116 → **R2 (#126)**; #114 is not required and stays disabled. B1 (#121) still waits for the base-permission-drift decision; the owner's audit (13 functions match the contract on both hosted databases) supports reading the drift as a local-replay artefact — record that decision on #121.

## 10. Owner decisions

Decided: (1) neutral code-screen message kept (en/ar) and "Already have an account? Sign in" added on the code step (the link was already there; its English copy now reads exactly that, pinned by an E2E assertion); no number-existence information is exposed. (2) No unplanned period without phone registration → the phased plan. (3) Hook: prepare and test only. (4) Leaked-password / redirects: prepare only. (5) Merge order accepted, merge gated on the final candidate.
Still open: the real redirect allow-list values; plan support for Auth Hooks and leaked-password protection; the delivery adapter design (Phase 3 / activation); whether to replace the cookie-held password (§12 option).

## 11. GO / NO-GO — separate decisions (details: release plan §5)

| Decision | Verdict | Why / when it changes |
|---|---|---|
| **Merge dormant code** | **NO-GO today — technically ready** | final head green on every mandatory check (GitHub results above) and the owner records the hosted clearance. Worker secret presence is **not** required for this |
| **Acceptance rollout** | **NO-GO** | exact Acceptance migration history confirmed read-only; owner approval in their own words; for the Phase 3 rehearsal also the delivery adapter + secrets |
| **Production rollout** | **NO-GO** | Acceptance clean; exact Production history confirmed; Phase 3 prerequisites; a planned window; rollback rehearsed. Until then Production stays on its current build and phone registration is unchanged |
| **WhatsApp activation** | **NO-GO** | an approved delivery adapter implemented and wired (`WORKER_WIRED=false` today), Worker secrets verified, Meta template approved, allow-listed rehearsal, the owner's explicit go |
| *Independent:* interim hook | prepared + tested + rollback drilled; **not applied** | owner approval per environment |

## 12. Sealed sign-up cookie — password retention and key isolation (review)

**What it holds** (cookie `psu`): registration id, latest challenge id, name, phone, username, account type, **birth date**, **password**, locale, expiry — for at most 10 minutes between the two form steps, because nothing exists in Auth yet. It is the only place the app keeps the password; it is never written to the database or a log (a unit test asserts it is absent from the sealed value).
**Protection:** AES-256-GCM, random 96-bit IV per cookie, **AEAD associated data binds the ciphertext to this cookie's purpose** (`aladdin/phone-sign-up/psu/v1`); `httpOnly`, `secure`, `sameSite=lax`, `path=/auth`, `maxAge` 10 min, and the expiry is also inside the sealed value and enforced on the server. **Key isolation (changed in this round):** previously derived from `AUTH_PASSWORD_PREVIEW_GRANT_SECRET`, shared with other auth features; now a **dedicated `PHONE_SIGNUP_COOKIE_SECRET`** (≥32 chars, server secret store only), independent of the code keyring and of every other secret, **required whenever phone sign-up is on** — the action refuses to request a code without it (fail closed *before* a message could be sent). Wrong secret and a single flipped byte are both refused (unit tests).
**Lifecycle:** cleared on success and on every terminal failure; kept on a rejected captcha (so Resend can retry without retyping) and refreshed on resend.
**Remaining risks (documented, accepted for review):**
1. **Server-secret compromise** exposes the password of any in-flight sign-up (≤10 min window) — mitigated by the dedicated secret and the short life; rotation invalidates in-flight sign-ups only.
2. **A copied cookie cannot be read** but can be replayed within 10 minutes; completing a sign-up still needs the one-time code (single use, attempt-capped in the authority), so replay alone achieves nothing.
3. **No server-side revocation** of a sealed cookie before it expires (the authority's single-use challenge is the real control).
4. **No client binding (IP/user-agent):** deliberate — mobile networks change IPs mid-flow.
5. The password also crosses the wire once in the form POST (TLS), as in any sign-up.
6. **Option that would remove the retention:** ask for the password again on the code step and keep nothing but ids in the cookie (a UX cost; not done without a product decision).
