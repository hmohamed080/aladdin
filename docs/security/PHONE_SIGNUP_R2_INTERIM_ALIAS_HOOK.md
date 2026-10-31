# Interim mitigation for public phone-alias squatting: a narrowly scoped `before_user_created` hook

**Status: PROPOSAL. Tested locally only. Not deployed, not enabled, not a migration.** No hosted Auth setting, database, or account was touched. Enabling it needs separate owner approval (§6).
**Files:** `supabase/proposals/before_user_created_alias_gate.sql` (the function, outside `supabase/migrations` on purpose) · `supabase/tests/r2/hook_probe.test.mjs` + `run_hook_probe.sh` (the evidence, reproducible) · `docs/security/hook-probe/` (raw logs of the four runs).

## 1. The exposure this addresses (owner-verified hosted facts)

Production and Acceptance have e-mail confirmations and Turnstile ON; the phone provider, Send-SMS hook and Phone MFA are OFF; the R1 alias guard is **not installed**. So an anonymous caller can still call Supabase Auth `/signup` (or `/otp`) with the internal alias of someone else's phone number (`p<digits>@craftsman-login.aladdin.invalid`). With confirmations ON this creates an **unconfirmed** user that squats the alias: the real owner's later account creation then fails (`email_exists`) or, worse, the squatter holds the identity the real person's phone number maps to. Turnstile is not a barrier to a targeted attacker (a human can solve the widget); it only limits automation. I reproduced it locally in an exploration run before any hook was active (GoTrue v2.193.0, confirmations ON: public `/signup` and `/otp` both returned 200 and created the alias user); PR #122's security suite (`supabase/tests/sec`) documents the same measurement as its anonymous-bypass finding and is re-run on this tree in the R1 matrix (`PHONE_SIGNUP_R2_INTEGRATION.md` §6).

## 2. What the hook does

GoTrue calls a Postgres function **before it creates a user through a public path**. The function refuses (HTTP 403, `{"error":{"http_code":403,"message":"This sign-up method is not available."}}`) any e-mail on the alias domain `@craftsman-login.aladdin.invalid`, unless `app_metadata.registration_source` is one of the three trusted server-side values. It returns `{}` (allow) for everything else, including an empty, null or missing e-mail (Facebook without an e-mail) and any event it does not understand. It reads nothing, writes nothing, calls nothing: one string comparison, no table access, `EXECUTE` only for `supabase_auth_admin`.

`.invalid` is a reserved TLD, so no real mailbox, Google account or Facebook account can ever carry such an address: blocking the whole domain removes no legitimate sign-up.

## 3. Evidence (local, real GoTrue, nothing sent)

`bash supabase/tests/r2/run_hook_probe.sh` — GoTrue **v2.193.0** (CI toolchain, Supabase CLI 2.110.0) and **v2.197.0** (installed CLI 2.122.0), each with e-mail confirmations **ON and OFF**:

| Cell | PASS | FAIL | Observations |
|---|---|---|---|
| v2.193.0 / confirmations ON | 31 | 0 | 8 |
| v2.193.0 / confirmations OFF | 31 | 0 | 8 |
| v2.197.0 / confirmations ON | 31 | 0 | 8 |
| v2.197.0 / confirmations OFF | 31 | 0 | 8 |

| Property | Result (all four cells) |
|---|---|
| Anonymous `/signup` on an alias | **403**, generic message, **no Auth user** |
| Upper-case variant of the alias | refused |
| `/otp` with `create_user` on an alias; `/magiclink` on an alias | refused, no user created |
| A public caller sending `registration_source` in `data` and top-level `app_metadata` to pass the allow-list | refused (`app_metadata` of a public request is ignored) |
| Admin API creation, legacy Installer source / Showroom source / R2 phone source | **works**, confirmed, signs in |
| **Admin API creation with no `registration_source` at all** | **works — the hook is not consulted for Admin creation** on both versions. The allow-list is therefore defence in depth for a future GoTrue that does consult it, not what keeps trusted creation working |
| Admin deletion of an alias user (compensating rollback) | works |
| E-mail + password sign-up; e-mail OTP sign-up; password recovery | unaffected |
| Google / Facebook user objects, Facebook with empty or missing e-mail, a look-alike domain, an empty or null event | allowed (`{}`), no exception |
| `EXECUTE` | `supabase_auth_admin` only (not `anon`, `authenticated`, `service_role`) |
| Existing alias user signs in | works |

**Not testable locally:** a real Google/Facebook round-trip (no provider is configured on the stack). The hook only sees the user object GoTrue builds, so the shapes above are the exercised evidence; run one real OAuth sign-up on Acceptance before Production.

## 4. Failure behaviour — the blast radius (measured, identical on both versions)

The hook is consulted for **every public user creation**, not just aliases. How GoTrue behaves when the hook is unhealthy:

| Hook state | Public e-mail sign-up | Admin alias creation | Existing sign-in |
|---|---|---|---|
| function raises | **HTTP 500, no user** | works | works |
| function missing (dropped while the hook is still enabled) | **HTTP 500, no user** | works | works |
| `supabase_auth_admin` lacks `EXECUTE` | **HTTP 500, no user** | works | works |
| slower than the default hook timeout (8 s sleep) | succeeds after ~8.2 s — no effective timeout was observed | works | works |
| malformed error answer (`{"error":"…"}` instead of `{"error":{http_code,message}}`) | **succeeds** — a malformed reply is ignored | works | works |

Consequences:
1. **A broken hook switches public sign-up OFF for everyone** (e-mail, OTP, and new OAuth users) until the hook setting is disabled. It cannot stop trusted Admin creation or anyone's login. The function is written so it cannot raise (nested exception block: an alias stays refused, everything else allowed) and does one comparison.
2. **A malformed refusal fails open.** The refusal must be exactly `{"error":{"http_code":403,"message":…}}`; the probe asserts `403` in every cell, so a regression in that shape is caught by the test, not in production.
3. **Never drop the function while the hook is enabled.** Rollback order is: disable the hook first.

## 5. What it does not do

* It is not R1: it proves no possession of a number, mints no grant and does not tie an alias to a verified user. It only closes the *public* creation door for alias addresses.
* **Existing squats are untouched.** Unconfirmed alias rows that already exist stay. Count them first with the read-only `alias_census` in the inspection (`unconfirmed_alias_users`, `unconfirmed_without_profile`); removing any is a separate owner decision (they may be real, abandoned legacy sign-ups) and nothing here deletes an account.
* **E-mail change** to an alias by an authenticated user is not a creation. Measured with confirmations OFF on both versions: the call returns 200 but the change stays *pending* (the alias is not an account e-mail afterwards) and cannot be confirmed because the mailbox cannot exist. A pending `email_change` value is left on that user's row. Not exploitable as a squat; R1's INSERT guard has the same blind spot.
* The 570 existing confirmed phone-alias accounts in Production are not read, modified or affected (existing users never pass through a before-user-created hook).

## 6. Implementation plan (nothing below is done; each step needs the owner's go)

0. **Read-only prerequisites.** (a) Hosted GoTrue version: the public `/auth/v1/health` of each project answers with it; compare with v2.193.0 / v2.197.0. (b) Confirm the plan supports Auth Hooks (Postgres-function hooks). (c) Run the extended inspection for the alias census and `hook_before_user_created_enabled` (the inspection already reports the latter). (d) Pick a low-traffic window for Production.
1. **Turn the proposal into a migration** (`supabase/migrations/<ts>_interim_alias_hook.sql`, the file's `CREATE OR REPLACE FUNCTION` + grants) so migration history stays truthful (ADR-0002); a function created by hand in the dashboard would be undetectable drift. Reviewed permission contract: one new function, `EXECUTE` for `supabase_auth_admin` only — regenerate `supabase/permissions/<ts>.json`.
2. **Acceptance first.** Apply the migration. Read-only check: `select public.hook_before_user_created('{"user":{"email":"p201000000000@craftsman-login.aladdin.invalid","app_metadata":{"provider":"email"}}}'::jsonb)` returns the 403 object; a Google-shaped event returns `{}`.
3. **Enable the hook** on Acceptance only (`hook_before_user_created_enabled = true`, `hook_before_user_created_uri = pg-functions://postgres/public/hook_before_user_created`). Verify with synthetic data: anonymous `/signup` of an unused alias → 403 and **no row** (if a row appears the hook is not active: delete it with the Admin API, then disable and investigate); a normal e-mail sign-up and a recovery work; one real Google and one real Facebook sign-up work; a legacy-style Admin-created alias account signs in. Watch Auth logs for 500s on `/signup` for the agreed period.
4. **Production** after Acceptance has been clean, in the agreed window, with the same sequence; keep the **disable-hook call** ready (dashboard toggle or the Management API setting). Production verification without creating anything: the read-only function check above, the Auth config showing the hook enabled, and — only if the owner agrees — one anonymous alias `/signup` that must answer 403.
5. **Monitor:** Auth logs (403 on `/signup`/`/otp` with the generic message = blocked squat attempts; any 500 on those routes = hook problem → disable first, investigate second). The function deliberately writes no log or table so it adds no failure mode.
6. **Retire** once R1 is applied and `alias_guard_mode = 'enforce'` has been stable (the guard also refuses a grant-less alias, deferred to COMMIT). The hook may stay as a second layer, but if it is removed: disable the hook, then drop the function.

**Rollback (all stages):** disable the hook setting — immediate, no deploy, no data to undo. Only after that, optionally drop the function.

## 7. Risks, open questions, alternatives

| Risk / question | Assessment |
|---|---|
| Hook outage disables public sign-up for everyone | real (§4); mitigated by a short, non-raising function, Acceptance-first, a window, log watch, one-switch rollback. This is the main reason it needs owner approval rather than being "just a config change" |
| Hosted GoTrue version differs from the two tested | unknown until step 0a; the Admin-bypass property (§3) is the one to re-verify first on Acceptance (an alias Admin creation with no `registration_source`) |
| Plan/feature availability of Auth Hooks | unverified here |
| Allow-list drift (a new trusted `registration_source`) | only matters if a GoTrue version consults the hook for Admin creation; the R2 source `phone_whatsapp_sign_up` is already in the list |
| It could mask the need for R1 | it must not: R1/R2 remain the real fix (possession proof) — this only closes the public door in the meantime |
| Alternatives considered | a trigger on `auth.users` (cannot tell Admin from public creation, measured in #122); enforcing the R1 guard now (breaks today's grant-less legacy creation until the app that mints grants is deployed); disabling public sign-up (breaks e-mail registration); Turnstile (already ON, not a barrier to a targeted attacker); an edge rule (Supabase's API host is not behind this project's Cloudflare zone) |

**Recommendation:** worth doing as a stop-gap **if** the merge → apply → deploy → activate path for R1/R2 will take more than a short time, because it is small, reversible with one switch, independent of every PR, and removes the public exposure that the hosted audit confirmed. **GO for implementing it on Acceptance after owner approval; Production only after a clean Acceptance period.** This is a separate decision from merging dormant code or enabling registration (`PHONE_SIGNUP_R2_INTEGRATION.md` §10).

## 8. Acceptance-first rollout: checklist, monitoring, rollback drill, approval request (prepared; nothing applied)

**Rollback drill (done locally, `bash supabase/tests/r2/hook_rollback_drill.sh`, 13/13):** with the hook on, an alias sign-up is refused and creates nothing → **rollback = disable the hook, keep the function** → e-mail sign-up and e-mail OTP sign-up work, the existing legacy alias account signs in, Admin creation works, and an alias sign-up is accepted again (the exposure is back — that is what "rolled back" means) → re-enabling refuses the alias again → **the wrong order** (drop the function while the hook is still enabled) makes *every* public sign-up fail with 500. The order is therefore part of the procedure, not a preference.

**Preconditions (all read-only, before the first change):** (1) hosted GoTrue version of Acceptance (public `/auth/v1/health`) compared with the two tested versions; (2) plan supports Auth Hooks; (3) `--only migrations` history confirmed (the function arrives as a normal migration, so the history must be known); (4) alias census (`database.alias_census`) recorded as the "before"; (5) owner names the window and the person who holds the disable switch.

**Acceptance steps (each only after the owner's approval in their own words):**
1. Apply the migration (function + grants only; the hook stays **off**). Check: `select public.hook_before_user_created(<alias event>)` returns the 403 object; a Google-shaped event, an empty and a null event return `{}`; `EXECUTE` is held by `supabase_auth_admin` only.
2. Enable the hook (`hook_before_user_created_enabled=true`, `hook_before_user_created_uri=pg-functions://postgres/public/hook_before_user_created`).
3. Verify with synthetic data within minutes: anonymous alias `/signup` → **403 and no row** (if a row appears the hook is not active: delete that one row through the Admin API, **disable**, investigate); normal e-mail sign-up works; password recovery works; one real Google and one real Facebook sign-up work; a legacy-style Admin-created alias account signs in.
4. Observe for the agreed period.

**Monitoring (what to watch, where):**

| Signal | Source | Meaning | Action |
|---|---|---|---|
| `POST /auth/v1/signup`, `/otp`, `/magiclink` answering **500** | Supabase Auth logs (dashboard Logs → Auth), or the Management API logs endpoint | hook unhealthy (function missing, raising, no `EXECUTE`) — **all** public sign-up is failing | **disable the hook first**, then investigate |
| same routes answering **403** with the generic message | Auth logs | blocked alias sign-ups (squat attempts); a few are expected | none; a sudden burst is worth a look |
| public sign-up success rate vs the previous week | Auth logs / `auth.users` created per hour (read-only count) | a drop that is not 403s means the hook is hurting real sign-ups | disable, investigate |
| `delivery`-unrelated: Admin creations (`registration_source`) continuing | read-only count of recent `auth.users` with the trusted sources | confirms trusted creation is untouched | none |
The function writes no log or table on purpose (a write would be one more way for it to fail); Auth logs are the monitor. A synthetic probe is *not* recommended on Production: its only safe form is an alias sign-up that must answer 403 (it creates nothing when the hook works and a squat row when it does not).

**Promotion to Production** only after Acceptance has run clean for the agreed period with: zero 500s attributable to the hook, at least one blocked attempt or a deliberate negative test, the real Google/Facebook checks done, and the same preconditions repeated for Production (version, plan, exact history, census, window, switch holder).

**Approval request (verbatim scope, nothing here is approved):** *(a)* apply a migration that adds one function `public.hook_before_user_created(jsonb)` with `EXECUTE` for `supabase_auth_admin` only, to **Acceptance**; *(b)* then set the two Auth hook settings on **Acceptance**; *(c)* the disable-first rollback above. **Not requested:** any Production change; any change to the R1 guard; any deletion of existing alias accounts.
