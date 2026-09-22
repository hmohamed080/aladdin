# Password authentication preview

**Revision 3** (auth architecture hardening pass). Revision 1 established the
isolated preview; revision 2 changed the password policy to 10 characters +
weak-password rejection, rebuilt Forgot Password into four separate screens,
added a first pass at recovery-session security, the existing-user migration
flow, the authenticated Change Password flow, and Playwright E2E coverage.
**Revision 3 replaces revision 2's `user_metadata`-based password-state flag
with an authoritative, server-only `app_metadata` write, and replaces
revision 2's cookie-marker recovery gate with full session isolation** — see
the two sections below for what changed and why. **Still an isolated preview.
Nothing here has been pushed, merged, or deployed, and production `/auth/*`
remains byte-for-byte unchanged.**

## Purpose and current decision

An isolated preview of a **password-based** registration/sign-in journey lives
at `/preview/auth-password/*`, reviewed here before any integration into the
canonical `/auth/*` routes.

This preview does **not** decide the product direction. See
*Documentation conflict — must be resolved before promotion* below.

## Documentation conflict — must be resolved before promotion

Unchanged from revision 1: this repository's canonical, binding project-memory
files (`CLAUDE.md`, `PRODUCT_DIRECTION_GUIDE.md`, `ARCHITECTURE_GUIDE.md`,
`UI_UX_SYSTEM_GUIDE.md`) currently mandate **passwordless-only** authentication
as a hard guardrail, and shipped production code actively suppresses password
UI (`b2b/settings/page.tsx:258`). No ADR has ever evaluated password login.
**Before promotion**, the product owner's decision must be recorded in
`PRODUCT_DIRECTION_GUIDE.md` with a Change History entry, reconciled across
`ARCHITECTURE_GUIDE.md`/`UI_UX_SYSTEM_GUIDE.md`, and the ~20 supporting docs /
in-code "passwordless" assertions (full list in the revision-1 review report)
updated. This file does not make that change.

## Registration architecture — re-investigated in revision 3 (kept OTP-first, with a recorded reason to revisit)

**Revision 2's investigation** flipped `enable_confirmations=true` (required
for `signUp()` to withhold a session until confirmed) and found it changes
which GoTrue email template the EXISTING production passwordless Sign Up uses
for `shouldCreateUser:true` — from `magic_link` (customized locally to show
the 6-digit `{{.Token}}`) to `confirmation` (link-only, no code, **by
default**). Revision 2 treated that as a blocker and stopped there.

**Revision 3 re-opened this** with the specific fix the blocker implied:
customize the `confirmation` template too (`supabase/templates/confirmation.html`,
`[auth.email.template.confirmation]` in `config.toml` — present in the repo,
inert while `enable_confirmations` stays `false`), then re-run BOTH
architectures against real local Supabase + Mailpit with a throwaway script
(`signup-first-experiment{,-2}.mjs`, run once, not committed — see the
findings below, reproducible by flipping `enable_confirmations=true` and
re-running local Supabase). Findings:

- **The OTP-UX blocker is resolved.** With `confirmation.html` customized
  identically to `magic_link.html`, the existing passwordless
  `signInWithOtp({shouldCreateUser:true})` flow's re-routed email STILL shows
  the 6-digit code — the "silently breaks the OTP-code UI" objection no
  longer holds once both templates carry `{{.Token}}`.
- **The blast radius is narrower than feared.** `enable_confirmations=true`
  only reroutes the template for NEW-USER creation
  (`signUp`/`shouldCreateUser:true`). A RETURNING, already-confirmed
  passwordless user's ordinary sign-in (`signInWithOtp` with no
  `shouldCreateUser`) empirically still uses the `magic_link` template,
  confirmed unaffected — verified directly (subject line, code presence, and
  a successful `verifyOtp` + session) in the experiment.
- **Architecture B (`signUp()`-first) is atomicity-superior.** `signUp({email,
  password})` sets the password as part of THAT call — before any
  confirmation email is even sent, before any session exists. Confirmed:
  `verifyOtp({type:"signup"})` alone produces a session AND a fully usable
  password — a fresh client's `signInWithPassword` succeeds immediately after
  verification with no separate `updateUser({password})` call at all. This
  means Architecture B has **no equivalent of Architecture A's
  interrupted-state window** (confirmed-but-no-password) — the entire
  `app_metadata` flag / `resumePasswordSignUpEmail` / `finishPasswordSignUp`
  machinery exists SPECIFICALLY to cover a gap that Architecture B would not
  have, because the password can never be "confirmed but not yet attached."
- **Architecture B's enumeration behavior — fully reconciled, pre-push
  verification pass.** The original finding (`signUp()` on an existing email
  returns a distinguishing `user_already_exists`/422, not Supabase's
  documented "obfuscated" response) looked like it might contradict
  Supabase's own docs. Re-tested with the SAME local GoTrue
  (`public.ecr.aws/supabase/gotrue:v2.197.0`, the version the Supabase CLI
  currently bundles) split into the two sub-cases the original test
  conflated:
  - **`signUp()` on an email with an existing but still-UNCONFIRMED account**
    (never completed OTP verification): genuinely obfuscated. Returns success
    (no error), the SAME `user.id`/identity as the original signup, and
    re-sends the SAME confirmation email — indistinguishable from a fresh
    signup, exactly matching Supabase's documented behavior.
  - **`signUp()` on an email with an existing, CONFIRMED account** (the
    original test's exact scenario): reproducibly returns
    `user_already_exists`/422 — a real, distinguishing error, NOT obfuscated.

  **This is not a local-vs-hosted or version discrepancy** — it's two
  genuinely different GoTrue behaviors for two different account states,
  and the original framing ("docs say obfuscated, local said otherwise")
  compared the wrong pair: Supabase's "obfuscated" behavior is real, but it
  applies specifically to the *unconfirmed* re-signup case, not the
  *confirmed* one, which is the case that actually matters here — a
  registration form is trying to distinguish "genuinely new" from "already
  has a working account," and for THAT question `signUp()` does leak
  existence via a real 422. **One caveat that could not be closed this
  session**: hosted `aladdin-staging` was not reachable (see the live
  staging-audit section) to confirm it runs the identical GoTrue version:
  Supabase Cloud does not necessarily track the CLI's bundled version
  exactly, so a hosted-vs-local version skew, however unlikely to change
  this specific confirmed/unconfirmed distinction, is not independently
  ruled out.

  **Practical consequence, unchanged**: using `signUp()` directly as the
  registration entry point would leak existence for already-confirmed
  accounts unless the calling code explicitly catches `user_already_exists`
  and maps it to the SAME generic response used for a genuine new signup —
  extra application-level work Architecture A does not need (the existing
  `signInWithOtp` path is already documented as leak-free, verified by an
  existing unit test: *"never leaks whether the account already existed"*).
- **Session-creation timing** also favors B: Architecture A creates a session
  at the `verifyOtp({type:"email"})` step, BEFORE the password is attached —
  a real signed-in-but-incomplete window exists (mitigated, not eliminated,
  by the `app_metadata` flag). Architecture B creates no session until AFTER
  the password is already set, so a Architecture-B session is never
  "incomplete" the way an Architecture-A one transiently is.
- **Migration impact is roughly neutral.** The existing-passwordless-user
  migration flow (`/preview/auth-password/migrate`) operates on an ALREADY
  signed-in, ALREADY-confirmed session (`reauthenticate()` + `updateUser`) —
  neither architecture choice for NEW registrations changes that flow.
- **Complexity**: promoting Architecture B would let a good chunk of THIS
  preview's own code be deleted (the interrupted-state resume screens and
  the `app_metadata` password-set flag become unnecessary for the signup path
  specifically — though the flag would still be needed for the MIGRATION
  path, which has its own, separate interruption window). Against that:
  `enable_confirmations` is a single project-wide GoTrue setting — promoting
  B means auditing every `signUp()`/`signInWithOtp({shouldCreateUser:true})`
  call site in the ENTIRE app, not just this preview, and re-running the full
  existing passwordless suite, which is real cross-cutting risk outside an
  isolated preview's remit.
- **Plaintext-password handling cost (Architecture A), found in the pre-push
  verification pass**: Architecture A's OTP-first design structurally
  requires the plaintext password to **survive the OTP screen in the
  browser**. Concretely, in `sign-up-form.tsx`, the password the caller typed
  on Screen 1 is held in React state and re-submitted as a hidden
  `<input type="hidden" name="password" value={password} />` field on the
  Screen-2 verify form (and again on its resend form) — because
  `verifyPasswordSignUp`'s `updateUser({password})` call needs it, and the
  OTP screen is a SEPARATE server round trip from the one that collected the
  password. The plaintext password therefore sits in the page's live DOM and
  client-side React state for the duration of the OTP step — never sent
  anywhere insecurely (same-origin HTTPS POST, never logged, never in a URL),
  but a real, structural increase in how long and how widely the plaintext
  value is held in the browser compared to the alternative. **Architecture B
  has no equivalent**: the password is submitted exactly once, to
  `signUp()`, and never needs to be re-collected, re-held, or re-submitted
  for the confirmation step — the OTP screen that follows only ever handles
  the 6-digit code, never the password.
- **Password-changed notification during initial registration — tested,
  Architecture A vs B**: confirmed Architecture A triggers Supabase's
  `password_changed` security-notification email during ordinary, first-time
  registration, because `verifyPasswordSignUp` attaches the password via
  `auth.updateUser({password})` — indistinguishable, from GoTrue's point of
  view, from an existing user changing their password. A brand-new user
  therefore receives a "your account password was changed" email seconds
  after creating the account for the first time, which is accurate but
  reads as a false-positive security alert for what is actually just
  registration completing. **Tested directly**: registered a fresh account
  through Architecture B's `signUp()` → `verifyOtp({type:"signup"})` flow and
  watched Mailpit for any new mail after verification — **none arrived**;
  Architecture B's password is set as part of `signUp()` itself, a call
  GoTrue does not treat as a "password change" event at all, so the
  notification never fires during initial registration. (Both architectures
  still correctly fire it for a genuine LATER password change — Forgot
  Password, the authenticated Change Password flow, and migration — this
  finding is specific to the FIRST-registration moment only.)

**Final recommendation: Architecture B, for the eventual canonical
implementation — not kept as A merely because A already exists in this
preview.** Weighing the full set of findings from both passes:
- **B wins on**: atomicity (no interrupted "confirmed but no password"
  state, so the `app_metadata` flag / resume-screen machinery shrinks to
  just the migration path), session-creation timing (no
  signed-in-but-incomplete window), plaintext-password handling (submitted
  once, never re-held across a screen transition), the initial-registration
  notification false-positive (avoided entirely), and net code complexity
  once promoted.
- **A wins on**: nothing structural remains once B's enumeration gap is
  closed — A's only structural advantage (native anti-enumeration via
  `signInWithOtp`) is fully matched by B once the SAME catch-and-generalize
  handling is added for `signUp()`'s `user_already_exists` error, which is a
  small, well-scoped, already-understood piece of application code (not a
  GoTrue limitation to work around).
- **What A was actually protecting against** (the original blocker) —
  breaking the passwordless flow's OTP-code UX and needing an
  `enable_confirmations` change — is **resolved**, not merely mitigated: the
  custom `confirmation.html` template keeps the code-based UX intact, and
  the blast radius of `enable_confirmations=true` is now known precisely
  (new-account creation only, confirmed via direct testing, not assumed).

**Still NOT promoted by this pass** — this is a recommendation for a FUTURE
pass, conditioned explicitly on: (1) implementing the `user_already_exists`
→ generic-response mapping before any real registration traffic hits
`signUp()`, (2) auditing and re-testing every OTHER
`enable_confirmations`-sensitive call site project-wide (this preview is not
the only caller of the passwordless OTP endpoints), and (3) re-running the
full existing passwordless E2E suite against `enable_confirmations=true`
before it is ever proposed for staging or production. Architecture A stays
the implementation in this preview for now; the recommendation above is the
answer to "which one for the real, eventual canonical implementation,"
which is a decision for product/engineering ownership to act on, not
something this pass changes.

**Interrupted-state hardening** (the explicit fallback the brief asked for):
`verifyPasswordSignUp` calls `updateUser({password})`, then makes a SEPARATE,
server-only call — `markPasswordAttachedAuthoritatively(userId)`
(`lib/supabase/admin-server.ts`) — to stamp the authoritative
`app_metadata.aladdin_pw_preview_password_set: true` flag (see *Authoritative
password-state tracking* below; this is a revision-3 change from revision 2,
which stamped the same-named flag into `user_metadata` inside the `updateUser`
call itself). `resumePasswordSignUpEmail()` (called from the sign-up page)
detects a signed-in, email-confirmed session missing that flag — proof a
prior visit either never called `updateUser`, or called it but never reached
the authoritative stamp — and routes straight to the password-only completion
step (`finishPasswordSignUp`), never re-sending or re-verifying a code.
Because the stamp is now a second, separate call, the interruption window is
narrower but not zero (password attached, flag not yet stamped is now itself
a possible interrupted state) — `finishPasswordSignUp` covers it: it always
re-stamps the flag via the same admin path, whether or not the password call
in front of it actually changed anything, so re-entering the resume path is
always safe and idempotent. Tested:
`src/server/actions/auth-password-preview.test.ts` ("registration
interruption" describe block).

## Authoritative password-state tracking (revision 3 — replaces `user_metadata`)

**Problem with revision 2**: `user_metadata` is **user-editable** — any
signed-in caller can call `supabase.auth.updateUser({data: {...}})` and set
arbitrary keys on their own `user_metadata`, including
`aladdin_pw_preview_password_set: true`. Revision 2's password-set/migration
flag lived there, which means a passwordless-only account could have forged
the flag to make `resumePasswordSignUpEmail()` /
`migrationEligibility()` believe it already had a password attached, when it
never did — a security-relevant decision resting on attacker-controlled data.

**Fix**: the flag now lives in **`app_metadata`**, which Supabase's GoTrue
only allows the **service-role** (admin) API to write — never the user's own
session, regardless of what `updateUser({data})` they call.
`lib/supabase/admin-server.ts` exports:
- `PASSWORD_SET_FLAG` — the single shared key name (`aladdin_pw_preview_password_set`).
- `markPasswordAttachedAuthoritatively(userId)` — creates a short-lived,
  `persistSession:false` service-role client (`SUPABASE_SERVICE_ROLE_KEY`,
  server-only, never exposed to the browser — enforced by the existing
  `lib/env` server/public split), reads the user's current `app_metadata` via
  `auth.admin.getUserById`, and writes it back merged with the flag via
  `auth.admin.updateUserById` — a read-merge-write specifically so this call
  can never clobber Supabase's own `provider`/`providers` bookkeeping that
  already lives in the same `app_metadata` object.

Every place that sets the flag now calls this — `verifyPasswordSignUp`,
`finishPasswordSignUp`, `completeMigration`, `resetPasswordAndSignOut` — and
every place that reads it (`resumePasswordSignUpEmail`,
`migrationEligibility`) reads `user.app_metadata?.[PASSWORD_SET_FLAG]`, never
`user_metadata`. `user_metadata` is still used elsewhere in this preview
purely for non-security presentation data (none currently), matching the
brief's explicit allowance.

**Tested** (`auth-password-preview.test.ts`): the flag is read from and
written to `app_metadata` throughout; a dedicated test seeds a user whose
`user_metadata` carries a forged flag with an empty `app_metadata` and
confirms both `resumePasswordSignUpEmail()` and `migrationEligibility()`
still report "no password set" — proving the forged value is ignored.

**Local testing note**: this admin path requires `SUPABASE_SERVICE_ROLE_KEY`
in `.env.local`. **Treat this value as a secret regardless of environment** —
never logged, never committed, never pasted into chat/tooling output, the
same handling discipline as any service-role key. (The LOCAL default
Supabase CLI issues happens to be a fixed, publicly documented value
identical across every local install — a fact about that specific local
default, not a license to handle service-role keys casually in general; a
developer who points `.env.local` at a linked/hosted project must put a real
credential there, and this file's handling code and docs make no distinction
between the two.) `.env.example` documents this as the one approved exception
to the "no service-role in the canonical app" rule (ADR-0007), scoped to this
preview only, with only a placeholder — never a usable credential — committed
there.

## Password policy (10 characters + weak-password rejection)

- **Minimum 10 characters, maximum 72 bytes** (bcrypt hard cap, confirmed via
  Supabase's own docs/GitHub discussion — not 72 characters; multi-byte
  Arabic/emoji can hit the byte cap well under 72 characters). Spaces
  allowed. **No composition rule** (no mandatory upper/lower/digit/symbol).
- **Weak-password rejection** (`frontend/src/features/auth-password-preview/password-strength.ts`):
  hard-rejects a password that is (a) in a curated common-password list
  (normalized, trailing-digit-stripped — "password123" and "aladdin2024"
  both caught), (b) a 4+ run of identical/sequential/keyboard-row characters,
  or (c) trivially derived from the account's own email local-part. This is a
  **preview-grade, self-written heuristic**, not a substitute for a real
  breach-corpus check.
- **Leaked-password-protection audit**: Supabase's native "Leaked password
  protection" (HaveIBeenPwned k-anonymity) requires **Pro plan or above**.
  `aladdin-staging` is confirmed on the **Free plan**
  (`docs/operations/AGENT_WORK_LOG.md:303`) — **unavailable today**.
  **Recommended fallback, NOT implemented pending approval**: either (a)
  upgrade to Supabase Pro for the native check, or (b) integrate directly
  with the HaveIBeenPwned Pwned-Passwords k-anonymity API server-side (sends
  only the first 5 chars of the password's SHA-1 hash, never the password) as
  a new, explicitly-approved external dependency.
- **Strength meter UI** (`password-strength-meter.tsx`): a 4-segment bar
  (weak/acceptable/strong) plus three live pass/fail requirement rows (min
  length, not common/guessable, not account-related) and one purely
  informational "longer is encouraged" tip row. Composition variety
  (upper/lower/digit/symbol) only ever nudges the score upward — never a
  requirement.
- Byte/max length, spaces, Unicode, paste, and password-manager autocomplete
  (`new-password`/`current-password`) are all preserved; `PasswordInput`
  never intercepts paste or blocks IME/Unicode input.
- Never logged, never sent to analytics, never in `localStorage`/
  `sessionStorage`; passed between registration steps only via a hidden
  `type="password"`-adjacent form field re-submitted over the same HTTPS
  request, matching how the existing codebase already resubmits non-secret
  fields across steps.
- `supabase/config.toml`: `minimum_password_length = 10` (**local only**).

## Forgot Password — rebuilt into 4 separate screens/routes

- **Screen 1** `/preview/auth-password/forgot-password` — title, explanation,
  email, Send Code, Back to Sign In. Nothing else.
- **Screen 2** `/preview/auth-password/forgot-password/verify` — masked
  destination email (`lib/ui/mask-email.ts`, reused), 6 OTP boxes, Verify,
  60s resend cooldown + Resend Code, Change Email. **No password field.**
- **Screen 3** `/preview/auth-password/forgot-password/reset` — New
  Password, Confirm, strength meter, Reset Password. **No email/OTP field
  shown again.**
- **Screen 4** `/preview/auth-password/forgot-password/success` — "Password
  changed successfully", one primary action (Sign In). **No auto-redirect
  into the app.**

Routing state between screens travels only via httpOnly, `sameSite:"lax"`
cookies scoped to the recovery flow path (`pwr_email`, `pwr_verified`,
`pwr_success`) — **never** the OTP or password, and never the URL/query
string. Direct navigation to Screen 2 without a Screen-1 request, or to
Screen 3 without a genuine verified recovery, redirects back to Screen 1
(tested, both in unit tests and Playwright).

**Two real bugs found and fixed during this rebuild** (both confirmed via
live browser reproduction, not just reasoning):
1. Chaining `redirect()` inside `verifyRecoveryCode` immediately after a
   fresh `verifyOtp` raced Screen 3's own session read — the freshly-set
   session cookie hadn't round-tripped through the browser before the
   redirect target rendered, so Screen 3 always bounced back to Screen 1.
   Fixed by having `verifyRecoveryCode` return `{ok:true}` and the CLIENT
   navigate (`router.push`) instead of a server-triggered redirect.
2. `AuthCard` calls the `useI18n()` hook without its own `"use client"`
   marker — it only works when rendered from an already-client module graph.
   Every OTHER screen gets this for free (their forms are client
   components); the two states rendered directly from a Server Component
   (`RecoverySuccess`, the "already migrated" state) crashed at runtime.
   Fixed by making both dedicated Client Components.

## Recovery-session security (revision 3 — full session isolation, not a middleware patch)

**Revision 2's design flaw** (already found and corrected once): originally
planned to gate Screen 3 on the session's `amr` (Authentication Methods
Reference) JWT claim being `"recovery"`. **Empirically verified wrong** —
decoded a real local Supabase access token after `verifyOtp({type:"recovery"})`:
`amr` records the generic `method:"otp"`, identical to a normal email-OTP
sign-in. GoTrue does not expose the OTP sub-type via `amr`. Revision 2's
actual mechanism was instead a plain `pwr_verified` boolean cookie checked
alongside a live, cookie-backed Supabase session (`getServerSupabase()`) —
but that session was still a **normal, fully-privileged Supabase session**
the whole time, sitting in the same `sb-*-auth-token` cookies
`middleware.ts` and every normal RLS-authorized query read. Revision 2's own
doc explicitly flagged this as an unfixed gap: nothing stopped a caller who
completed Screen 2 from manually navigating to `/b2b` instead of continuing
to Screen 3.

**Revision 3's fix is architectural, not a `middleware.ts` patch** (per the
explicit instruction not to solve this by teaching middleware about a new
session flavor): the recovery flow **never creates a normal application
session at all**. `verifyOtp({type:"recovery"})` still returns a
fully-privileged Supabase session internally — that has not changed and
cannot be changed, it's GoTrue's behavior — but that session is captured
**only in memory**, on an **isolated, non-cookie-backed, non-persisting**
Supabase client (`createIsolatedAuthClient()`,
`lib/supabase/recovery-grant.ts`: `persistSession:false`,
`autoRefreshToken:false`), and is **never** written into the cookies
`@supabase/ssr`'s `getServerSupabase()` manages. Concretely:

- **Screens 1–2** (`requestRecoveryCode`, `verifyRecoveryCode`,
  `resendRecoveryCode`) run entirely on `createIsolatedAuthClient()`. They
  never call `getServerSupabase()`.
- On a successful `verifyOtp`, the session's **access AND refresh tokens**
  are sealed into a **"recovery grant"**: an AES-256-GCM-encrypted (Node's
  built-in `crypto`, no new dependency), httpOnly, `sameSite:"lax"`,
  path-scoped, 5-minute-TTL cookie (`pwr_grant`) that only server code
  holding `AUTH_PASSWORD_PREVIEW_GRANT_SECRET` can decrypt
  (`encryptRecoveryGrant`/`decryptRecoveryGrant`). Both tokens travel, not
  just the access token — **found empirically**: the GoTrue SDK's own auth
  methods (`updateUser`, `signOut`) read the *calling client's own in-memory
  session* via `_useSession`/`__loadSession`, not a bare `Authorization`
  header, so a client that only sets `global.headers.Authorization` (the
  codebase's pre-existing `createServerSupabaseClient` helper, built for
  Postgrest/RLS-scoped data calls) fails `updateUser` with "Auth session
  missing" — caught by the E2E suite, not the unit tests, which is exactly
  why real Playwright coverage against the live SDK mattered here (see
  *Tests and Playwright results*). The browser carries an opaque blob it
  cannot read or forge (tamper detection is the AEAD tag, not a separate
  check); it is a **different cookie name** than anything `@supabase/ssr`
  looks for, so normal middleware/normal Supabase clients have **no code
  path that even looks at it**, let alone interprets it as a session.
- **Screen 3's page guard** (`requireRecoverySession`) does not check a
  session at all — decrypting the grant successfully **is** the
  authorization check. A normal signed-in caller with no grant gets `null`,
  identically to a signed-out one.
- **Screen 3's action** (`resetPasswordAndSignOut`) re-decrypts the grant
  independently (defense in depth against a page-guard bypass), then builds
  a **fresh** `createIsolatedAuthClient()` (never the cookie-backed one) and
  calls `client.auth.setSession({access_token, refresh_token})` from the
  grant to hydrate that client's in-memory session, THEN calls
  `updateUser({password})` and `signOut({scope:"global"})` on that same
  hydrated client. This is the only place the recovery session's authority
  is ever spent, and it never touches the app's normal cookies either — the
  hydrated session lives only in that one throwaway client instance for the
  duration of this one request.

**Explicitly tested** (`auth-password-preview.test.ts`, unit-level with a
mocked isolated/grant/admin layer; `e2e/auth-password-preview.spec.ts`,
live/E2E against the real local Supabase + real production `middleware.ts`):
- `requireRecoverySession()` returns `null` with no grant cookie, and does
  **not** call `getUser()` at all (no session check exists to bypass).
- `requireRecoverySession()` returns `null` for a normal signed-in session
  that holds no recovery grant — a normal login cannot browse Screen 3.
- `resetPasswordAndSignOut` refuses without a grant even with a normal valid
  signed-in session, and never calls the normal client's `updateUser`.
- A grant is single-purpose: after a successful reset deletes the cookie, a
  second attempt is refused (`recoveryStateMissing`), and the recovery
  client's `updateUser` is called exactly once.
- An expired grant (`exp` in the past) decrypts to `null`, independent of the
  cookie's own `maxAge`.
- **Live, end-to-end** (Playwright, real local Supabase): after a real
  Screen 1→2 round trip, the browser holds `pwr_grant` and genuinely **no**
  `sb-*-auth-token` cookie — confirmed directly by inspecting the cookie jar
  — then `/b2b`, `/admin`, and `/home` are each requested and all three
  redirect to `/auth/sign-in`, exactly like a fully signed-out caller,
  against the **real, unmodified, already-shipped `middleware.ts`** (no
  changes were made to it). The grant is then confirmed still valid and
  usable for its one legitimate purpose (Screen 3 still renders normally)
  after those denied detours, proving the denials were a route guard, not an
  accidental consumption of the grant.

**Session invalidation on reset**: after the recovery-authenticated
`updateUser` succeeds, `resetPasswordAndSignOut` calls
`recoveryClient.auth.signOut({scope:"global"})` — using the SAME recovery
bearer token, since Supabase's `signOut` API doesn't distinguish a
cookie-authenticated caller from a bearer-token-authenticated one — ending
every session this user holds (the recovery grant's own included), then
clears the routing/grant cookies and requires a fresh Email+Password sign-in
(never auto-continues into the app). Tested end-to-end via Playwright (full
reset → forced sign-out → sign-in with the NEW password required to
re-enter).

**Documented Supabase JWT limitation** (unchanged from revision 2):
`signOut()` revokes refresh tokens, but an already-issued **access token**
some other tab/device holds remains valid until it naturally expires
(`jwt_expiry`, 3600s locally) — global sign-out is not instant revocation of
a live access token. Shortening `jwt_expiry` is the only lever, and it's a
project-wide setting — see *Session/JWT recommendation* below for the actual
hosted value and a recommendation.

**Revision 2's "known, documented gap" about `middleware.ts` is resolved by
this design, not by touching `middleware.ts`** — there was never a
`middleware.ts` change to make; the fix was to stop the recovery flow from
ever creating the kind of session `middleware.ts` (correctly) treats as
authenticated.

### Recovery-grant one-time behavior — measured, not assumed (pre-push verification pass)

Deleting `pwr_grant` after a successful reset only proves same-browser reuse
fails; it says nothing about a copied/leaked raw cookie *value* replayed
somewhere else before it naturally expires (5-minute TTL). Tested explicitly:
obtained one real, valid `pwr_grant` from a live recovery session, copied the
exact encrypted value into a SECOND, fully isolated Playwright browser
context (`e2e/recovery-replay.spec.ts`), then submitted two DIFFERENT new
passwords from both contexts as close to simultaneously as Playwright
allows (`Promise.allSettled` on both submissions, not sequential).

**Result, across 3 separate trials**: **exactly one** of the two requests
ever ended up as the account's real password — never both. Confirmed by
actually signing in with each candidate password afterward (the real
security property — not just reading which page "looked" successful, since
the LOSING request's page shows no visible error at all, a minor UX gap
noted but not fixed this pass). **Which one won varied between trials** — a
genuine race, not a deterministic code-path bug always favoring one side.

**This is NOT a designed guarantee, and should not be treated as one going
forward.** Reasoned through and consistent with the empirical result: this
preview's own code has **no explicit single-use marker** for a grant at all
— `resetPasswordAndSignOut` never checks or records "has this JTI been
spent." The property observed here is an **emergent side effect** of
GoTrue's own behavior when two callers concurrently update the same user's
password using the same underlying session: whichever `updateUser` call
commits first appears to invalidate the session the other concurrent call
was relying on. That is Supabase/GoTrue implementation behavior this
codebase does not control, does not have a documented contract for, and
which could plausibly change across GoTrue versions. **Held 3/3 times
locally — treated as "no evidence of a live blocker," not as "proven safe
by design."**

**Proposed hardening — proposal only, no migration applied this pass** (per
explicit instruction not to create one without approval): a true one-time
grant via a random JTI and atomic server-side consumed-state, independent of
whatever GoTrue happens to do internally.

```sql
-- PROPOSAL ONLY — not applied. Would need review under supabase/AGENTS.md's
-- migration conventions (ADR-0002) before becoming a real migration.

create table if not exists app.password_reset_grant_consumption (
  jti uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now()
);

-- RLS enabled, zero policies -> no direct table access from any client role
-- at all (anon, authenticated, or otherwise) — only reachable through the
-- SECURITY DEFINER function below, matching the access pattern already
-- established for lib/supabase/admin-server.ts's app_metadata writes.
alter table app.password_reset_grant_consumption enable row level security;

create or replace function app.claim_recovery_grant(
  p_jti uuid,
  p_user_id uuid,
  p_expires_at timestamptz
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Best-effort prune of expired rows on every call — keeps the table small
  -- without a separate scheduled job; cheap, indexed range delete.
  delete from app.password_reset_grant_consumption where expires_at < now();

  insert into app.password_reset_grant_consumption (jti, user_id, expires_at)
  values (p_jti, p_user_id, p_expires_at)
  on conflict (jti) do nothing;

  return found; -- true = THIS call was the first (and only) successful claim
end;
$$;

revoke all on function app.claim_recovery_grant(uuid, uuid, timestamptz) from public;
grant execute on function app.claim_recovery_grant(uuid, uuid, timestamptz) to service_role;
```

**Why this shape**: the `insert ... on conflict (jti) do nothing` plus
`return found` is a single atomic statement — Postgres itself is the mutual-
exclusion primitive, not application code racing against itself. Application
wiring (not implemented this pass): `verifyRecoveryCode` generates a fresh
random JTI (`crypto.randomBytes(16)`) and includes it in the encrypted grant
payload alongside the existing `{email, accessToken, refreshToken, exp}`;
`resetPasswordAndSignOut` calls `claim_recovery_grant` via the EXISTING
service-role admin client (`lib/supabase/admin-server.ts` already has this
narrowly-scoped pattern) as the very first step, before even validating the
new password — a failed claim returns the same generic
`recoveryStateMissing` used for every other invalid-grant case, so a
replay attempt is indistinguishable from a expired/garbage cookie. Only a
successful claim proceeds to decrypt, hydrate the session, and call
`updateUser`. This removes any dependence on GoTrue's internal concurrent-
update behavior for the one-time property.

## Existing-passwordless-user migration

New flow at `/preview/auth-password/migrate`: an already-signed-in caller
(recognizes a session from the LIVE production passwordless flow — same
Supabase project, same cookie) with no password yet (authoritative
`app_metadata` flag unset — see *Authoritative password-state tracking*
above) is offered "Set a password". Step-up verification via Supabase's
`reauthenticate()` (a fresh nonce emailed to the account's own confirmed
address — purpose-built for exactly this "signed in, need fresh proof before
a sensitive change" case) rather than trusting the existing session alone;
the received code is passed as `nonce` to `updateUser({password, nonce})`,
and `markPasswordAttachedAuthoritatively(user.id)` stamps the flag in a
separate, service-role call immediately after. An account that already has a
password sees a neutral "already set" state instead. `migrationEligibility()`
(session + `app_metadata` flag check) is shared with the Change Password
entry point.

**Real E2E result (revision 3)**: verified end-to-end against a genuinely
passwordless account seeded through the CANONICAL, unmodified `/auth/sign-up`
flow (not a stand-in) — passwordless login → migrate → reauthentication code
→ set password → logout → Email+Password sign-in succeeds, and a separate
abandon-and-resume test confirms requesting a migration code and never
completing it leaves the account untouched and fully resumable on a later
attempt.

**Second finding while building that E2E**: `previewSignOut()`
(`server/actions/auth-password-preview.ts`) exists but is not wired to any
button anywhere in the preview UI — `/preview/auth-password/migrate`'s own
layout (`layout.tsx`) carries no sign-out control at all (only language/theme
switchers), unlike `/onboarding`'s production chrome, which is where every
OTHER test's "sign out" click actually happens. The E2E works around this
with `context.clearCookies()` rather than adding a button, per "don't
redesign the UI unless required" — flagged here as a real, minor gap rather
than silently worked around.

**UX finding, not fixed (kept per "don't redesign the UI unless required")**:
`MigrationForm`'s transient client-side "Password set — you can now sign in…"
confirmation can be overwritten before it is reliably visible. Next.js's App
Router automatically revalidates the current route's Server Component tree
after a Server Action resolves; since `/migrate/page.tsx` re-runs
`migrationEligibility()` on every render and that now (correctly) reports
`hasPassword:true`, the revalidation can swap the whole subtree from
`<MigrationForm>` (holding the transient "done" state) to
`<AlreadyHasPassword>` before the success message is dependably seen —
confirmed directly via a Playwright accessibility-tree snapshot captured at
the exact failure point, showing `<AlreadyHasPassword>`'s copy rendered
where the transient message was expected. The underlying migration itself is
correct and unaffected (proven by the real E2E above); only the one-time
confirmation copy is racy. Both new E2E tests accommodate this by accepting
either the transient message or the durable "already has a password" state.
**Recommended fix, not applied this pass** (would touch UI, not required by
a security change): route `completeMigration`'s success through a short-lived
signal that survives revalidation — e.g. the same query-string/cookie
"just completed" pattern the Forgot Password flow's Screen 4 already uses —
so the confirmation reliably displays for at least one paint before any
subsequent navigation shows the steady-state "already set" screen.

## Authenticated Change Password

New flow at `/preview/auth-password/change-password`, deliberately distinct
from Forgot Password. Current Password / New Password / Confirm New Password
/ strength meter / Apply Changes, matching the supplied reference. Requires
the **current password**, re-verified via `signInWithPassword` — an existing
session is never sufficient proof for this sensitive operation. Rejects a
new password identical to the current one. On success, signs out every
**other** session (`scope:"others"`) while keeping the current one (the
opposite policy from Forgot Password's `scope:"global"`, deliberately — the
caller here already proved the current credential).

## OTP security

- **Expiry**: Supabase's `otp_expiry` (`[auth.email]`, currently 3600s
  locally) is a **single project-wide value shared by every email OTP type**
  (signup, magiclink, recovery) — `config.toml` has no per-type override.
  Recovery cannot get an independently shorter (~10 min) expiry without also
  shortening the existing passwordless sign-in/signup OTP, a cross-cutting
  change not made here without approval. The recovery-flow's own routing
  cookies use a 600s (10 min) lifetime as an **application-level UX target**
  — not a security boundary; the code stays cryptographically valid per
  Supabase's real expiry regardless.
- **Resend cooldown**: 60s in this preview's recovery flow (`RESEND_COOLDOWN_SECONDS`
  in `features/auth-password-preview/constants.ts`), matching the brief.
  Registration's resend stays at the pre-existing 30s convention (unchanged,
  not asked to change). Both are client-facing UX pacing only — the REAL
  throttle is Supabase's own `auth.rate_limit.email_sent` (2/hour locally)
  and `auth.email.max_frequency`; no client-only limit is presented as a
  security control anywhere in this code.
- **Rate limits found** (local `config.toml`, shared by every auth flow
  including this preview) — shipped defaults: `email_sent=2/hour` (per its
  own comment, requires `auth.email.smtp` to be enabled — inert with the
  local Mailpit mailer this repo actually uses), `sign_in_sign_ups=30/5min`,
  `token_verifications=30/5min`. Hosted values not independently verified in
  this session (dashboard access not available) — see the hosted-config
  comparison table in the chat report.
- **Revision 3 raised `sign_in_sign_ups` and `token_verifications` to
  200/5min, LOCAL-ONLY**: found empirically running this revision's own
  expanded Playwright suite (CAPTCHA-rejection tests + the real passwordless
  migration E2E, both new) — at the shipped `30/5min`, GoTrue's rate limiter
  started **silently accepting later sign-up/sign-in requests without
  actually queuing the email** (a deliberate anti-enumeration design: no
  distinguishing error is returned), so `readNewOtp` timed out waiting for
  mail that was never going to arrive. This is test-infrastructure config
  only — it changes nothing about the security POLICY this preview
  implements, only how much automated real-traffic the LOCAL dev stack can
  absorb before its own throttle kicks in — and never applies to hosted
  `aladdin-staging` or production, which keep GoTrue's real, unmodified
  defaults.

## CAPTCHA / abuse protection (implemented in revision 3)

Revision 2 found this unconfigured project-wide (confirmed absent in both
`config.toml` and code — pre-existing, already-tracked debt,
`docs/technical/TECHNICAL_DEBT.md:121`) and deliberately left it unimplemented.
**Revision 3 implements it**, per the explicit ask: **Cloudflare Turnstile**
(no other CAPTCHA provider exists anywhere in the repo, so Turnstile is the
default per the brief) wired to Supabase's own native `captchaToken`
verification — GoTrue verifies the token server-side against the secret
configured in `[auth.captcha]`; this app never sees or needs that secret.

- **Where, and a real finding that changed the plan**: Create Account
  (`requestPasswordSignUp`) and Forgot Password request (`requestRecoveryCode`)
  are the two intentionally-gated endpoints — also applied to sign-up's OWN
  resend (it reuses the identical `requestPasswordSignUp` action, so it
  inherits the same requirement, not a separate design choice). Forgot
  Password's resend (`resendRecoveryCode`) stays CAPTCHA-free, as planned.
  **Sign In could not be left untouched, though — found empirically, not
  chosen**: Supabase's `[auth.captcha]` is a single project-wide GoTrue
  toggle with **no per-endpoint scoping**. Confirmed directly against local
  GoTrue (`curl .../auth/v1/token?grant_type=password` with no
  `captcha_token`): `{"code":400,"error_code":"captcha_failed","msg":"captcha
  protection: request disallowed (no captcha_token found)"}` — enabling
  `[auth.captcha]` to protect signup/recovery ALSO makes GoTrue reject
  `signInWithPassword` outright with no token at all. There is no config
  short of leaving CAPTCHA disabled entirely that protects only two of the
  three. (`verify`/OTP-confirmation endpoints and `reauthenticate` were
  checked too and are NOT captcha-gated — only signup, recovery, and password
  grant sign-in are.)
  **Resolution**: Sign In gets an **invisible, non-interactive** Turnstile
  challenge (`variant="invisible"` on the same widget, Cloudflare's
  documented mode for exactly this "must pass a check but must stay
  frictionless" case) — no visible box, no extra click, satisfies GoTrue's
  mandatory requirement. A missing/rejected token on Sign In deliberately
  falls into the SAME generic `invalidCredentials` message as every other
  failure (never a distinct "captcha" message) — consistent with Sign In's
  existing anti-enumeration policy and its promise to stay visually
  frictionless either way.
- **Component**: `features/auth-password-preview/turnstile-widget.tsx` — loads
  Cloudflare's script explicitly (`render=explicit`), renders the widget,
  writes the solved token into a hidden `name="captchaToken"` input the
  surrounding `<form>` submits normally. Takes a `resetKey` prop the caller
  changes after every submission (the server action's own result object) —
  a Turnstile token is single-use, so without this, a submission rejected for
  an unrelated reason (e.g. a weak password) would leave a spent token behind
  that fails the captcha check on the very next, otherwise-valid attempt.
- **Server-side**: both actions now require a non-empty `captchaToken` form
  field before calling Supabase at all (`authPasswordPreview.error.captchaRequired`
  if missing), pass it through as `options.captchaToken` /
  `{redirectTo, captchaToken}`, and distinguish a GoTrue-rejected token
  (`code: "captcha_failed"` → `authPasswordPreview.error.captchaRejected`)
  from every other failure. For Forgot Password specifically, a rejected
  captcha is treated like the rate-limit case — a deliberate, visible
  divergence from the "always neutral" response, same as rate limiting,
  since neither leaks account existence.
- **Local config — a SECOND, more severe finding changed the final state**:
  `[auth.captcha]` was FIRST enabled locally (Cloudflare's published TEST
  secret `1x0000000000000000000000000000000AA`) to live-verify this preview's
  wiring against real GoTrue enforcement. Doing so **broke the CANONICAL,
  unmodified, already-shipped passwordless flows** — confirmed directly via
  curl against local GoTrue, each call returning
  `{"error_code":"captcha_failed","msg":"captcha protection: request
  disallowed (no captcha_token found)"}`:
  - `POST /auth/v1/otp {create_user:true}` — canonical `/auth/sign-up`.
  - `POST /auth/v1/otp {create_user:false}` — canonical `/auth/sign-in`.
  - `POST /auth/v1/recover` — canonical recovery.

  None of that production code passes a `captchaToken` (correctly — it must
  never be modified by this preview), so **all three failed outright** the
  moment the toggle was on, for every caller — not just this preview's own
  screens. This also silently broke every OTHER pre-existing Playwright spec
  in the repo that signs in via the canonical passwordless flow (surfaced
  only because the new real-passwordless-migration E2E, below, is the first
  test in this repo to exercise that flow with captcha enabled). Combined
  with the earlier Sign In finding, the full picture is: **`[auth.captcha]`
  has no scoping mechanism at all** — it is either on for signup + recovery +
  password-grant sign-in + passwordless OTP request, project-wide, for every
  caller canonical or preview, or off entirely.
  **Resolution: `[auth.captcha]` is left DISABLED in the committed
  `config.toml`**, commented out with the full finding recorded inline. All
  of this preview's own captcha CODE stays fully implemented and permanently
  active regardless — `requestPasswordSignUp`/`requestRecoveryCode` still
  require a non-empty `captchaToken` before calling Supabase at all, and the
  widgets still run a REAL Cloudflare round-trip and still populate a real
  token — only GoTrue's OWN server-side verification of that token is not
  live locally by default, since enabling it has this unacceptable, wider
  blast radius. It was verified live exactly once, in an isolated,
  throwaway run (uncommented locally, full suite run, then reverted) — see
  *Tested* below for what that run confirmed before being reverted.
- **Tested**: unit tests assert `authPasswordPreview.error.captchaRequired`
  when the token is absent (and that Supabase is never called), and
  `authPasswordPreview.error.captchaRejected` on GoTrue's `captcha_failed`,
  for both gated actions — these hold regardless of whether `[auth.captcha]`
  is enabled, since the check is this preview's OWN code, not GoTrue's. A
  separate test confirms Sign In passes through whatever token the invisible
  widget produced without ever hard-blocking on it, and that a
  `captcha_failed` from GoTrue there still falls into the existing generic
  `invalidCredentials` message.

  **A real UI bug was found and fixed while getting the live Playwright
  coverage green**: `sign-up-form.tsx` never actually rendered
  `captchaRequired`/`captchaRejected` anywhere — every field/section had its
  own narrow `sendState.code === "..."` check (email errors, password
  errors, consent errors), and none of them covered the two new captcha
  codes, so `requestPasswordSignUp` was correctly refusing an unauthenticated
  submission the entire time, but the UI showed nothing at all, silently.
  `forgot-password-form.tsx` never had this bug — its one field already used
  a catch-all `state.code ? t(state.code) : undefined`, which happened to
  cover the new codes for free; that asymmetry is exactly why one test passed
  immediately and the other did not, and is what led to finding the gap. Also
  found and fixed en route: the original "solve a real token, then clear the
  DOM value via `evaluate()` immediately before submitting" test design had a
  genuine race — Turnstile refreshes its token in the background
  periodically, and a refresh landing between the clear and the click could
  repopulate React's controlled input with a fresh, genuinely valid token
  before submit. Replaced with `page.route("https://challenges.cloudflare.com/**",
  route => route.abort())` before navigation, so no token is EVER produced —
  deterministic, not timing-dependent.

  With both fixes in place, live Playwright coverage
  (`e2e/auth-password-preview.spec.ts`, "CAPTCHA" describe block) proves THIS
  PREVIEW's own server-side check genuinely rejects a missing token
  end-to-end (this part needs no `[auth.captcha]` enforcement to be
  meaningful; it is this code's own gate) for both Create Account and Forgot
  Password request. Separately, with `[auth.captcha]` temporarily enabled for
  one isolated run, the SAME suite (registration, sign-in, forgot-password
  golden paths, all now waiting for a real solved token before submitting)
  passed with live GoTrue verification in the loop too — confirming the
  widget/token plumbing genuinely satisfies GoTrue's real check, not just
  this preview's own client-side one — before that config was reverted per
  the finding above.
- **Local rate limits also had to be raised for this suite to run reliably**
  (`sign_in_sign_ups`/`token_verifications`, both local-only, see *OTP
  security* above) — an unrelated but adjacent finding from the same
  expanded-suite testing pass.

## CAPTCHA architecture — corrected (a fourth pass found the "two widgets, one shared secret" plan was invalid)

The plan recorded immediately above this section (two Turnstile site keys —
one visible for Create Account/Forgot Password, one invisible for Sign In —
both verified against ONE Supabase-hosted secret) **does not work** and was
never actually exercised end-to-end against live GoTrue verification with
BOTH site keys in play. **Root cause**: a Cloudflare Turnstile site key and
its secret key are minted as a pair — each site key has its OWN, distinct
secret. Supabase's `[auth.captcha]` config has exactly **one** `secret`
field (confirmed by reading the config schema directly:
`enabled`/`provider`/`secret`, nothing else, nothing per-endpoint). Give
GoTrue a token produced under site key #2 while its configured secret only
matches site key #1, and Cloudflare's own siteverify call — which GoTrue
performs server-side — returns invalid, and GoTrue rejects the token. There
is no way to register two site keys against one Supabase project's captcha
config. This was a real design defect in the plan, not a hypothetical: the
"required before staging/production" bullet above, describing two real
Turnstile sites feeding one shared hosted secret, is **incorrect** and must
not be acted on as written.

**Current code status**: `turnstile-widget.tsx`'s `variant="invisible"` /
`variant="visible"` split (two different TEST site keys locally) is still
present but is now known to be built on a disproven premise. It happens to
be **inert right now** because `[auth.captcha]` stays disabled (previous
section) — with GoTrue-side verification off, nothing actually checks which
site key produced a token, so the mismatch never surfaces. It would **break**
the moment `[auth.captcha]` was enabled with a single secret matching only
one of the two site keys: whichever screens use the OTHER key would have
every token rejected by GoTrue as invalid, indistinguishable from a bot.
Not fixed this pass (would mean implementing one of the two options below,
which the brief explicitly holds off on) — flagged here so it is not mistaken
for a working design.

**Two real options going forward**, compared against the actual product
requirement (Create Account + Forgot Password protected, Sign In
CAPTCHA-free):

- **Option A — Supabase-native CAPTCHA (one shared site key)**: a single
  Turnstile site key/secret pair, configured once in `[auth.captcha]`,
  applied everywhere GoTrue enforces it. To avoid the two-secret problem,
  this means ONE key used for Create Account, Forgot Password, AND Sign In —
  which in turn means either (a) Sign In shows the same visible/managed
  widget as the other two (violates "Sign In stays CAPTCHA-free"), or (b) the
  one site key is created in Cloudflare's **Managed** mode, which adapts
  per-request (often invisible for low-risk traffic, a visible challenge for
  suspicious traffic) — closer to "usually frictionless" but **not a
  guarantee** of zero visible challenge on Sign In, since Managed mode's
  behavior is Cloudflare's own risk call, not something this app controls.
  Also unavoidable with Option A: the already-documented finding that
  enabling `[auth.captcha]` at all requires the canonical
  `server/actions/auth.ts` (`/auth/sign-up`, `/auth/sign-in`, recovery) to be
  updated to pass `captchaToken` in the SAME change — GoTrue enforces the
  toggle project-wide, not just for this preview.
- **Option B — application-scoped Turnstile (Supabase's toggle stays off)**:
  keep `[auth.captcha]` disabled permanently (not just "disabled for now"),
  verify Turnstile tokens ourselves, server-side, via a direct call to
  Cloudflare's `siteverify` endpoint inside `requestPasswordSignUp` and
  `requestRecoveryCode` — before ever calling Supabase. Enforced ONLY on
  those two actions; Sign In is **never** touched by CAPTCHA at all (no
  invisible widget, no token, nothing) and is **genuinely, unconditionally**
  frictionless, not "usually." The canonical passwordless flows are
  completely unaffected, since Supabase's own captcha toggle never turns on
  — no coordinated canonical-code change is ever required. Requires: the
  `CLOUDFLARE_TURNSTILE_SECRET_KEY` staying server-only (never in
  `NEXT_PUBLIC_*`), a real network call to Cloudflare from the Server Action
  (with a defined fail-closed behavior — if Cloudflare's endpoint is
  unreachable or errors, treat as captcha failed, never as passed), and
  never trusting "a token is present" as proof by itself — the token's
  `success`/`action`/`hostname` fields must be checked in Cloudflare's
  response, not just its presence.

**Recommendation: Option B.** It is the only one of the two that actually
delivers the stated product requirement exactly as specified (Create
Account + Forgot Password protected, Sign In unconditionally CAPTCHA-free)
without relying on Cloudflare's own adaptive risk heuristics to approximate
it, and it fully avoids forcing a coordinated change to canonical
passwordless auth as a precondition for shipping this preview's own CAPTCHA
protection. **Not implemented this pass, per explicit instruction** — this
is a recommendation only. If/when approved: remove the `variant="invisible"`
Sign In wiring entirely (Option B needs no token there at all), keep the
visible widget only on the two protected screens, add server-side
`siteverify` validation, and `[auth.captcha]` stays off in `config.toml`
permanently rather than as a "disabled for now" note.

**Corrected env/doc guidance**: `NEXT_PUBLIC_TURNSTILE_INVISIBLE_SITE_KEY`
and the "two real Turnstile sites, one shared hosted secret" requirement
above are **retracted** — do not provision hosted infrastructure against
that plan. If Option B is approved, the only new env var needed is a
server-only `TURNSTILE_SECRET_KEY` (added to `serverEnvSchema`, never
`NEXT_PUBLIC_*`) alongside the existing single `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

**Documentation conflict, still open**: the canonical passwordless auth model
(root `CLAUDE.md`) specifies **reCAPTCHA**, not Turnstile, for the real
production Create Account flow. This preview uses Turnstile per the original
revision-3 instruction ("Cloudflare Turnstile preferred unless the repo
already has a different approved provider" — nothing was found). Independent
of the Option A/B decision above, if/when this preview is promoted, the
product owner needs to either adopt Turnstile canonically or have this piece
re-done against reCAPTCHA — the same kind of documented, unresolved conflict
as the passwordless vs. password-first decision itself (see *Documentation
conflict* above).

## Password-change notification (revision 3 — root cause found and fixed; now confirmed firing locally)

Revision 2 enabled `[auth.email.notification.password_changed]` locally but
found **no notification email observed in Mailpit** despite valid-looking
config, and left it as an inconclusive "maybe a local/hosted parity gap."

**Root cause found in revision 3**: it was a genuine config bug, not a
GoTrue parity gap. `content_path` under `[auth.email.template.*]` (the
templates section) resolves relative to the REPO ROOT — but `content_path`
under `[auth.email.notification.password_changed]` (a different config key)
resolves relative to the `supabase/` directory itself. Revision 2's entry
used the templates-section convention (`./supabase/templates/...`) for the
notification key too, which `supabase status`'s own error output showed was
being doubled into `supabase/supabase/templates/password_changed.html` —
a path that never existed, so the notification silently failed to load.
Fixed by changing that one entry to `./templates/password_changed.html`
(confirmed via `supabase status` going from a hard config error to clean).

**Confirmed firing after the fix**: queried Mailpit directly
(`GET /api/v1/messages`) after the Playwright suite's registration,
forgot-password, and migration runs — **27 password-changed notification
emails** were found, matching every password-set/reset event in this
session (registration completion, forgot-password reset, and migration).
Fetched and read one in full:

- Subject: "تم تغيير كلمة مرور حسابك في علاء الدين" ("Your account password
  was changed").
- Body (bilingual): *"The password for the Aladdin account linked to this
  email address was just changed. ... If this wasn't you, contact support
  immediately. We will never ask for your password by email."*
- **Never contains the password itself** — confirmed by reading the actual
  message body, not just the template source.
- Appropriate security wording and support guidance both present.

**Still required before relying on this in staging/production**: this
confirms LOCAL GoTrue's behavior and this repo's own template/config, not
hosted `aladdin-staging`'s equivalent dashboard setting — see the live
staging-audit section below for what could and could not be independently
verified there this session.

## Session/JWT recommendation

**Local values** (`supabase/config.toml`): `jwt_expiry = 3600` (1 hour),
`enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10`
(seconds — a rotated-out refresh token stays briefly valid to absorb
network-retry races, not a security hole). **Hosted `aladdin-staging`'s
actual values were not independently verified this session** — see *Hosted
vs. local configuration* below for why, and the chat report for the request
to the user to confirm them directly.

**Recommendation** (independent of the exact hosted value, since the
underlying tradeoff is the same either way): keep `jwt_expiry` in the
**15–60 minute** range for this product, not shorter and not longer.
- **Why not much shorter**: every access-token expiry is a silent
  refresh-token round trip; a very short expiry (e.g. 5 min) multiplies
  refresh traffic for no real security gain here, since the actual
  session-kill lever is refresh-token revocation (`signOut`), not access-token
  expiry.
- **Why not longer, or unbounded**: this is the exact gap the recovery flow
  and the authenticated Change Password flow both already account for
  explicitly (§Recovery-session security, §Authenticated Change Password) —
  a password reset or change ends every refresh session, but an
  already-issued access token some OTHER device holds stays valid until it
  naturally expires. A 60-minute cap bounds that exposure window to
  something reviewable; a multi-day or non-expiring token would leave a
  stolen/compromised access token usable long after the legitimate owner
  reset their password specifically to invalidate it.
- **B2B UX consideration**: Sales is the daily-active user
  (`PRODUCT_DIRECTION_GUIDE.md`) and refresh-token rotation (already enabled)
  means the UX cost of a moderate `jwt_expiry` is just a transparent
  background refresh, not a re-login — so there is no real UX argument for
  going longer than ~60 minutes.
- **Admin access consideration**: platform admin sessions are the highest-
  value target for this exact "stolen access token survives a password
  reset" gap — if anything, admin-scoped sessions would benefit from an even
  shorter effective window, which is a role-scoped policy decision (Supabase
  has no native per-role JWT expiry), not something this pass can implement.

Not changed this pass (local or hosted) — a recommendation only, per the
brief's explicit "do not reduce it yet."

## Hosted vs. local configuration — see the chat report's comparison table

Not reproduced here to avoid duplication/drift; the structured decision on
gaps and required hosted values before promotion lives in the delivered
review report for this revision.

## What is reused, unmodified (still true in revision 3)

`getServerSupabase()`, `sanitizeNext()`, `resolveActiveLanding()`,
`my_registration_state`, `record_consent`, `AuthCard`, `AuthBrandPanel`,
`OtpInput`, `Input`/`LabeledField`/`SubmitButton`/`Checkbox`/`ResendButton`/
`Button`, `lib/ui/mask-email.ts`, the `/preview/*` route convention,
`createServerSupabaseClient` (still exported from `lib/supabase/server.ts` for
its original data-access use — this preview stopped using it for the
recovery flow specifically, see *Recovery-session security* above, but did
not remove or change it). **No production file was modified in this
revision** — including `/auth/sign-up`, which revision 3's real passwordless
migration E2E drives exactly as a real user would (via UI interaction), never
via a code change to it.

## Consequences / not yet done

Resolved in revision 3 (kept here struck through only in spirit — see the
dated sections above for the actual writeups): the `middleware.ts` recovery
gap (closed architecturally, not by touching `middleware.ts`), CAPTCHA wiring
(implemented, with the Sign In finding above), and the password-changed
notification's "inconclusive" status (root-caused and confirmed firing).

Still open:
- The emailed-link variant of password recovery (OTP code is the only wired
  path).
- Folding the duplicated post-session redirect helper back into one shared
  module with `server/actions/auth.ts`.
- HaveIBeenPwned/Pro-plan leaked-password integration (recommendation
  recorded, pending approval — unchanged from revision 2).
- Fixing `signUp()`'s account-enumeration leak (`user_already_exists`) —
  only relevant if Architecture B is promoted later (see *Registration
  architecture* above); not applicable to the kept Architecture A.
- Live hosted `aladdin-staging` Auth-config audit (see that section) —
  blocked this session on credential access; safe alternatives offered
  there.
- Updating the ~20 supporting docs / in-code "passwordless" assertions
  (unchanged list from revision 1).
