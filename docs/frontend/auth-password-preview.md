# Password authentication preview

**Revision 5** (Architecture B closure pass). Revision 1 established the
isolated preview; revision 2 changed the password policy to 10 characters +
weak-password rejection, rebuilt Forgot Password into four separate screens,
added a first pass at recovery-session security, the existing-user migration
flow, the authenticated Change Password flow, and Playwright E2E coverage;
revision 3 replaced revision 2's `user_metadata`-based password-state flag
with an authoritative, server-only `app_metadata` write, and replaced
revision 2's cookie-marker recovery gate with full session isolation;
revision 4 promoted registration internally from Architecture A (OTP-first)
to Architecture B (`signUp()`-first) — see *Registration architecture* below
for the implementation, the enumeration-normalization design, and the
`enable_confirmations` impact map. **Revision 5 closes Architecture B's two
remaining open items**: an application-level response-time floor now closes
the account-enumeration timing side-channel revision 4 found and left open
(measured before/after — see *Account enumeration* below), and the canonical
passwordless `/auth/sign-up` and `/auth/sign-in` flows have now been
independently re-tested live against `enable_confirmations=true` (found and
fixed one unrelated, pre-existing test bug along the way — see *Remaining
blockers* below). Recovery, migration, and change-password are all
**unchanged**. **Still an isolated preview. Nothing here has been pushed,
merged, or deployed, and production `/auth/*` remains byte-for-byte
unchanged.**

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

## Registration architecture — Architecture B, implemented (revision 4)

**Architecture B is now implemented in this preview**, replacing revisions
1-3's OTP-first Architecture A. The flow:

```
Email + Password + Confirm Password
  → supabase.auth.signUp({ email, password, options:{captchaToken} })   (requestPasswordSignUp)
  → NO application session before email confirmation
  → Confirm-Signup email contains a 6-digit {{ .Token }}
  → user enters the code
  → supabase.auth.verifyOtp({ email, token, type:"signup" })            (verifyPasswordSignUp)
  → authenticated session, password already usable
  → canonical postSessionRedirect() → registration-state resolver → onboarding
```

The password is submitted **exactly once**, to `signUp()`. It is never
placed in a hidden field for the OTP step, never in the URL/search params,
never in `localStorage`/`sessionStorage`, never in a cookie, never persisted
to `user_metadata`, and never re-submitted after the OTP step — see
`sign-up-form.tsx` (no password-type input exists anywhere on Step 2 at all)
and the server action module's doc comment
(`server/actions/auth-password-preview.ts`).

### Why B replaced A — history (revisions 2-3's investigation, condensed)

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

**Decision acted on in revision 4**: Architecture B, for the reasons above —
atomicity (no interrupted "confirmed but no password" window), session-
creation timing (no signed-in-but-incomplete session), plaintext-password
handling (submitted once, never re-held across a screen transition), the
initial-registration notification false-positive (avoided entirely,
re-confirmed below), and net code complexity. A's one structural advantage —
native anti-enumeration via `signInWithOtp` — is matched by adding the same
catch-and-generalize handling for `signUp()`'s `user_already_exists`, below.
**Still only implemented in this isolated preview** — the conditions the
revision-3 recommendation listed before this could ever move beyond it are
now partially addressed (enumeration normalization is implemented and
tested) but not all closed — see *Remaining blockers before hosted
promotion* at the end of this section.

### Confirmation type — verified against the installed SDK, not assumed

`verifyPasswordSignUp` calls `verifyOtp({email, token, type:"signup"})`.
`"signup"` is not a guess: the installed `@supabase/auth-js` (`2.111.0`,
resolved via `@supabase/supabase-js@^2.48.1`) defines
`EmailOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' |
'email_change' | 'email'` in its own shipped `.d.ts` — confirmed by reading
that file directly, not inferred from behavior alone. Empirically verified
end-to-end against real local GoTrue (`curl` against `/auth/v1/signup` then
`/auth/v1/verify`, `type:"signup"`): the call succeeds, returns a full
session (access + refresh tokens), and a subsequent
`POST /auth/v1/token?grant_type=password` with the SAME password the caller
typed at `signUp()` succeeds immediately — no separate `updateUser({password})`
step exists or is needed. Also directly confirmed no `password_changed`
notification email arrives after this sequence (see *Password-changed
notification* below) — only the one confirmation email.

**A wrong/never-issued code returns the SAME error as an actually-expired
one** — verified directly (`curl .../auth/v1/verify` with a garbage 6-digit
token against a real pending signup): GoTrue returns
`{"error_code":"otp_expired", ...}`, not a distinct "invalid"/"incorrect"
code. GoTrue does not distinguish "wrong" from "expired" for this endpoint.
The pre-existing `verifyFailureCode` mapping (shared shape with the
canonical `server/actions/auth.ts`) already surfaces this correctly as the
"expired" copy — there is no GoTrue signal available to show a more specific
"that code is wrong" message instead.

### Account enumeration — normalized (implemented, tested)

`signUp()`'s two sub-cases (revision 3's investigation, re-confirmed by
direct `curl` probing this revision, same local GoTrue image the CLI
bundles):
- An email with an existing but still-**UNCONFIRMED** account: GoTrue itself
  already obfuscates this — returns success, the SAME `user.id`, and
  re-sends the SAME confirmation email. No application code needed.
- An email with an existing, **CONFIRMED** account: GoTrue returns a real,
  distinguishing `user_already_exists`/422 (also handles the alternate
  `email_exists` code some GoTrue versions use for the same case).

`isAccountExistsError()` (`server/actions/auth-password-preview.ts`) catches
this ONE distinguishing case in both `requestPasswordSignUp` and
`resendPasswordSignUpCode`, and collapses it into the **exact same** success
response (`{ok:true, code:"authPasswordPreview.info.codeSent"}`) a genuine
new registration gets — same code path, same copy, same OTP screen. The
Step-2 UI copy was changed from an unconditional "Enter the code we sent to
{email}" to a hedged, neutral phrasing:

> EN: *"If this email can continue registration, we've sent the next step to
> {email}."*
> AR: *"إذا كان بالإمكان متابعة التسجيل بهذا البريد الإلكتروني، فقد أرسلنا
> الخطوة التالية إلى {email}."*

Never displays "User already exists" / "Email already registered" or any
equivalent, in either language, in any of: the visible message, the
`PasswordAuthState.ok`/`.code` result, the redirect target, or button
behavior — all four are identical between the two cases. Tested: unit tests
assert the existing-confirmed-account response is `.ok`/`.code`-identical to
a genuine new registration's; a live Playwright test registers a real
account, signs out, re-submits the SAME email through Create Account again,
and asserts the identical neutral screen (never "already exists" text)
renders, with the escape-hatch link (below) visible.

**Timing side-channel — closed (revision 5: application-level response-time
normalization).** Originally found and left open in revision 4: measured
directly against local GoTrue (5 samples each, `POST /auth/v1/signup`,
`Date.now()` around the raw `curl` call), the already-confirmed-account error
path averaged ~283ms vs a genuinely new registration's ~368ms — a consistent
~85ms gap. Revision 5 re-measured at the level that actually matters — the
**complete public Server Action**, click-to-UI-settled, not raw GoTrue (4
samples per state, real browser, local dev machine under normal load):

| State | min | median | max |
|---|---|---|---|
| Fresh signup | 255ms | 319ms | 371ms |
| Unconfirmed-existing (obfuscated by GoTrue) | 247ms | 262ms | 277ms |
| Confirmed-existing (`isAccountExistsError`-normalized) | 265ms | 273ms | 277ms |

A real, measurable gap at this level too (max-to-max: 371ms vs 277ms, ~94ms;
median-to-median: 319ms vs 273ms, ~46ms) — smaller than the raw-GoTrue figure
once browser/render overhead is mixed in, but not noise, and not something
this pass should claim was already safe.

**Fix**: `padToRegistrationFloor()` (`server/actions/auth-password-preview.ts`)
enforces a **500ms minimum wall-clock duration** from immediately before the
`signUp()`/`resend()` call to the response, applied to exactly the three
outcomes above (never to rate-limit/captcha-rejected responses, which are an
existing, intentional exception — they signal abuse, not account existence,
and are still allowed to differ). 500ms was chosen because it sits
comfortably above every sample observed in every state above (max observed:
371ms) — once every relevant outcome is padded up to the SAME floor, a
genuinely faster call is held to wait, so response time stops being a
function of which internal branch executed. It is deliberately not larger:
500ms is a one-time cost on a once-per-account action, not a hot path, and
stays within the range that reads as "the app is doing something" rather
than "the app is broken."

**Re-measured after the fix** (identical methodology, same 4-samples-per-state protocol):

| State | min | median | max |
|---|---|---|---|
| Fresh signup | 863ms | 866.5ms | 909ms |
| Unconfirmed-existing | 865ms | 875ms | 894ms |
| Confirmed-existing | 867ms | 893.5ms | 906ms |

The three states now overlap almost entirely (867-909ms band shared by all
three), with the remaining spread — max-to-max 3ms, median-to-median as low
as 7ms and as high as 27ms — consistent with ordinary scheduler/network
jitter rather than a deterministic branch signal. **Not claiming exact
equality** — the numbers above are the actual measurement, not a rounded
claim — but the previously consistent, reproducible 46-94ms gap is gone;
what remains is noise-scale and did not hold a consistent direction/magnitude
across the samples the way the pre-fix gap did.

Unit tests (`auth-password-preview.test.ts`) cover the padding's LOGIC
(never shortens a slower call, applies only to the two intended branches);
they do not re-assert the live timing numbers above — those depend on real
network/GoTrue conditions and are recorded here as a point-in-time
measurement, not a repeatable automated assertion (a hard-bounded timing
assertion in the permanent suite would itself be a source of flakes).

### Existing, already-confirmed account UX — no endless wait

Because a confirmed-existing-account attempt normalizes to the SAME OTP
screen but GoTrue genuinely sends no new mail for it, the Step-2 screen was
designed so it never strands the caller waiting indefinitely:
- The neutral copy above never promises a code was definitely sent.
- `AuthCard`'s footer keeps the "Sign in" link visible on every step,
  including Step 2 (unchanged from before this revision).
- A new, always-visible hint + "Forgot your password?" link sits directly
  under the OTP field: *"No code arriving? You may already have an
  account."* / *"لم يصلك رمز؟ قد يكون لديك حساب بالفعل."* — shown
  identically regardless of whether THIS attempt's email is new or existing,
  so it carries no distinguishing signal on its own; it only ever gives every
  caller the same generic, always-available way out.

Tested live: after the enumeration-normalization Playwright test lands on
the neutral Step-2 screen, it clicks that "Forgot your password?" link and
confirms it reaches Screen 1 of the real Forgot Password flow.

### Removed — Architecture-A-only machinery

Architecture B's `signUp()` sets the password atomically, so there is no
longer an interrupted "confirmed but no password" window to resume. Deleted
entirely (not deprecated, not left dead in the tree):
- `resumePasswordSignUpEmail()` and the sign-up page's call to it (the page
  now renders `<PasswordSignUpForm/>` directly, no server call first).
- `finishPasswordSignUp()` (the password-only completion/retry action).
- The `passwordStage` branch, `retryPassword`/`retryConfirm` state, and the
  hidden `<input type="hidden" name="password">` field on `sign-up-form.tsx`'s
  OTP step and its resend form.

**Kept, role narrowed, NOT removed**: `markPasswordAttachedAuthoritatively`
is still called after a successful `verifyPasswordSignUp` — no longer to
cover an interruption window (there isn't one for signup anymore), but
purely so `migrationEligibility()` — the SEPARATE, unrelated
existing-passwordless-user migration flow — correctly reports "already has a
password" if an Architecture-B-registered account later reaches
`/preview/auth-password/migrate`. See *Authoritative password-state
tracking* below, which is otherwise **completely unchanged** by this
revision: migration's own interruption window (abandon a migration
mid-flow, resume later) is untouched and re-verified by rerunning its E2E
this revision (see *Existing-passwordless-user migration* below).

### `enable_confirmations` impact map — every canonical call site sensitive to it

`enable_confirmations=true` was flipped **locally only**
(`supabase/config.toml`, same local-only convention as every other
`[auth.*]`/`[auth.rate_limit]` entry in this file) so Architecture B's
`signUp()` withholds a session until confirmed. Audited every repository
call site sensitive to it — **none were modified**:

| Call site | File | Sensitive how | Impact of `enable_confirmations=true` |
|---|---|---|---|
| `signInWithOtp({shouldCreateUser:false})` — canonical Sign In | `server/actions/auth.ts:85` | Not new-account creation | **None** — confirmed unaffected in revision 3's investigation (still uses `magic_link` template) and unchanged by this revision. |
| `signInWithOtp({shouldCreateUser:true})` — canonical Sign Up | `server/actions/auth.ts:~155` | New-account creation | Email template reroutes from `magic_link` to `confirmation` — **UX preserved**: `confirmation.html` (already present, previously inert) carries the same `{{.Token}}` code format. **Independently re-tested live in revision 5**: `e2e/account-registration.spec.ts`'s "sign up: consent gate → create → verify → resume at /onboarding" test — real `/auth/sign-up`, real Mailpit-delivered code, real `verifyOtp`, real `/onboarding/profile` landing — passes against this exact `enable_confirmations=true` local config. (Found and fixed one PRE-EXISTING, unrelated bug in that test while doing this: line 51 used `.fill(code)` on the per-digit OTP control, which only ever lands the first digit and never triggers the auto-advance keyboard contract — same class of issue `helpers/auth.ts`'s `signIn()` already documents and works around; fixed to `.pressSequentially(code)`, not a canonical-source change.) |
| `verifyOtp({type:"email"})` — canonical Sign Up/Sign In verification | `server/actions/auth.ts:111,182` | Reads whichever OTP GoTrue generated | GoTrue's `"email"` type is a generic alias that already covers signup/magiclink code-based OTPs regardless of `enable_confirmations` — confirmed working live by the same re-test above (Sign Up) and by `account-registration.spec.ts`'s "existing user sign in still reaches the workspace" test (canonical Sign In, `shouldCreateUser:false`), both passing. |
| `signUp({email,password})` — this preview's registration | `server/actions/auth-password-preview.ts` | New-account creation, password-based | This is the new, intentional caller — the entire point of this revision. |
| `resend({type:"signup"})` — this preview's registration resend | `server/actions/auth-password-preview.ts` | Resends a pending signup confirmation | New this revision; enumeration-normalized (see above). |

**Hosted setting that will separately need changing before any hosted
promotion**: `aladdin-staging`'s Supabase dashboard → Auth → Sign In / Providers
→ Email → "Confirm email" toggle. This file's `config.toml` change is
**local only** and has no effect on any hosted project.

### Remaining blockers before this leaves the isolated preview

Revision 4's two open items are now addressed:
1. ~~Re-run the full existing passwordless E2E suite against
   `enable_confirmations=true`.~~ **Narrowed and closed for the two exact
   scenarios this matters for** (revision 5): the canonical NEW-user
   `/auth/sign-up` flow and the canonical RETURNING-user passwordless
   `/auth/sign-in` flow both re-tested live against this local config and
   pass (`e2e/account-registration.spec.ts`). **Not exhaustively re-run**:
   every OTHER e2e spec file in the repo that happens to call the shared
   `signIn()` helper (dozens of files) was not individually re-executed this
   pass — since the underlying canonical Sign In path itself is now
   confirmed working under this config, those are LOW risk but not
   individually confirmed. A genuinely full `pnpm e2e` sweep remains
   recommended before any hosted promotion.
2. ~~The timing side-channel.~~ **Closed** — see *Account enumeration* above
   for the fix and the measured before/after numbers.
3. Everything already listed under *CAPTCHA architecture — corrected* (the
   Option A/B decision), the recovery-grant JTI proposal, and the live
   hosted `aladdin-staging` Auth-config audit — all **unrelated to this
   registration-architecture change** and untouched by it.
4. **New, revision 5, unrelated observation**: while re-testing the
   canonical flow, `e2e/account-registration.spec.ts`'s "a valid invitation
   is accepted by the matching account" test failed — NOT an OTP/email
   issue (the sign-in inside it succeeded); the signed-in Cairo rep landed
   at `/home` instead of the expected `/b2b`. That test is explicitly
   documented in its own comments as "state-consuming" and order-dependent
   (a single shared seeded invitation). Left uninvestigated and unfixed —
   out of scope for a registration-architecture pass (it concerns
   post-acceptance membership/landing resolution, a different subsystem)
   and appears environment/ordering-related rather than caused by this
   revision's changes.

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
`completeMigration`, `resetPasswordAndSignOut` — and the one place that reads
it (`migrationEligibility`) reads `user.app_metadata?.[PASSWORD_SET_FLAG]`,
never `user_metadata`. `user_metadata` is still used elsewhere in this
preview purely for non-security presentation data (none currently), matching
the brief's explicit allowance.

> **Revision 4 note**: this paragraph originally also named
> `finishPasswordSignUp` (a setter) and `resumePasswordSignUpEmail` (a
> reader) — both **removed** in revision 4's promotion to Architecture B (see
> *Registration architecture* → *Removed — Architecture-A-only machinery*
> above), since `signUp()` sets the password atomically and there is no
> interrupted-signup state left for either to cover. `migrationEligibility`
> is the only reader now; the flag's write-side list above reflects the
> current, revision-4 call sites.

**Tested** (`auth-password-preview.test.ts`): the flag is read from and
written to `app_metadata` throughout; a dedicated test seeds a user whose
`user_metadata` carries a forged flag with an empty `app_metadata` and
confirms `migrationEligibility()` still reports "no password set" — proving
the forged value is ignored.

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
- **Never logged, never sent to analytics, never in `localStorage`/
  `sessionStorage`.** Stale as of Architecture A (revisions 1-3): the
  password used to be held in React state and re-submitted as a hidden
  `<input type="hidden" name="password">` field on the OTP screen, because
  `verifyPasswordSignUp`'s `updateUser({password})` call needed it there.
  **Under Architecture B (revision 4+), this no longer applies**: the
  password is submitted exactly once, directly to `signUp()`
  (`requestPasswordSignUp`) — it is set atomically as part of account
  creation, before any confirmation email is even sent. It does not survive
  into the OTP step at all: `verifyPasswordSignUp` takes only the email and
  the 6-digit code, and no password-type input, hidden or otherwise, exists
  anywhere on that screen or its resend form (`sign-up-form.tsx`). It is
  never stored or resubmitted between registration screens.
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

## CAPTCHA — implemented architecture (application-scoped, 2026-09-24)

**This section is authoritative; the two sections below are history.** The
"Option B" recommendation below was approved and is implemented:

- **Supabase global CAPTCHA stays OFF** (`[auth.captcha]` absent from
  `config.toml`; never enabled on hosted projects).
- **Create Account** (`requestPasswordSignUp`, and its resend-code step
  `resendPasswordSignUpCode`) and **Forgot Password request**
  (`requestRecoveryCode`) require a Turnstile token that the APP verifies
  server-side with **Cloudflare Siteverify** (`server/auth/turnstile.ts` →
  `verifyTurnstileToken`) BEFORE Supabase Auth is called. No token is passed
  to Supabase any more.
- **Sign In has no CAPTCHA** — no widget, no token, no invisible challenge.
  The invisible variant and `NEXT_PUBLIC_TURNSTILE_INVISIBLE_SITE_KEY` are
  removed.
- **Fail closed**: only an explicit `success: true` passes. A missing or
  oversized token, a rejected token, a non-2xx response, malformed JSON, a
  network error, a 5-second timeout, or a missing secret outside local dev all
  fail. The client IP is forwarded as `remoteip` only when it parses as an IP.
  Secret and token are never logged; Cloudflare's `error-codes` never reach
  the user — only the existing neutral `captchaRequired` / `captchaRejected`
  copy.
- **Single use**: Cloudflare rejects a replayed token
  (`timeout-or-duplicate`); the widget remounts after every submission
  (`resetKey`) to obtain a fresh one.
- **Secrets**: `TURNSTILE_SECRET_KEY` is server-only (`serverEnvSchema`,
  never `NEXT_PUBLIC_*`); `NEXT_PUBLIC_TURNSTILE_SITE_KEY` stays public.
  Locally, with both unset, the widget uses Cloudflare's always-pass TEST
  site key (`1x00000000000000000000AA`) and the server Cloudflare's
  always-pass TEST secret (`1x0000000000000000000000000000000AA`) — still a
  real Siteverify round trip, nothing bypassed. Outside `local` an unset
  secret fails closed.
- `hostname`/`action` are not yet checked (the test keys report a fixed
  hostname); add a hostname allow-list when real staging keys exist.
- The canonical passwordless flows are unaffected (Supabase's toggle never
  turns on).

## CAPTCHA / abuse protection (revision 3 — HISTORY, superseded above)

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

## CAPTCHA architecture — corrected (HISTORY — Option B below is now implemented, see above)

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

Resolved in revision 4: registration promoted to Architecture B
(`signUp()`-first), `signUp()`'s `user_already_exists` account-enumeration
leak closed (`isAccountExistsError` normalization, tested unit + live), and
the Architecture-A-only interrupted-signup machinery
(`resumePasswordSignUpEmail`/`finishPasswordSignUp`/hidden password field)
removed.

Resolved in revision 5: the registration response-time side-channel closed
(`padToRegistrationFloor`, 500ms, measured before/after — see *Account
enumeration* above), and the canonical passwordless `/auth/sign-up` +
`/auth/sign-in` flows independently re-tested live against
`enable_confirmations=true` (found/fixed one unrelated pre-existing OTP-fill
test bug along the way).

Still open:
- The emailed-link variant of password recovery (OTP code is the only wired
  path).
- Folding the duplicated post-session redirect helper back into one shared
  module with `server/actions/auth.ts`.
- HaveIBeenPwned/Pro-plan leaked-password integration (recommendation
  recorded, pending approval — unchanged from revision 2).
- **New, revision 5**: a genuinely full `pnpm e2e` sweep (every spec file,
  not just the two canonical scenarios this pass targeted) against
  `enable_confirmations=true`, before any hosted promotion.
- **New, revision 5, unrelated**: `account-registration.spec.ts`'s "a valid
  invitation is accepted by the matching account" test's landing-resolution
  flake (`/home` instead of `/b2b`) — appears pre-existing/environment-order
  related, not an OTP/email issue; not investigated (out of scope — see
  *Remaining blockers* above).
- **New, revision 4**: flipping `aladdin-staging`'s hosted "Confirm email"
  dashboard setting — required before Architecture B could run against a
  hosted project at all; not done from an isolated preview session.
- Live hosted `aladdin-staging` Auth-config audit (see that section) —
  blocked this session on credential access; safe alternatives offered
  there.
- Updating the ~20 supporting docs / in-code "passwordless" assertions
  (unchanged list from revision 1).
