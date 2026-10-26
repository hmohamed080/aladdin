# ADR-0023 — Supabase Auth verifies sign-in Turnstile tokens; the app verifies only what bypasses it

**Status:** Accepted (code, tests and docs) · 2026-10-26 · owner decision "Option 2 — implement real server-side Turnstile verification", then Option B on the proposal ([Sign-in security: real Turnstile verification](https://claude.ai/artifact/XApKUShLDLvnHE9iojQcXS)). **The hosted half is not in effect** until the owner turns on Supabase Auth CAPTCHA protection on each project (Acceptance first, then Production), after this code is live there.

**Supersedes** the 2026-09-24 "application-scoped CAPTCHA, `[auth.captcha]` permanently off" decision ([ARCHITECTURE_GUIDE](../architecture/ARCHITECTURE_GUIDE.md) change history), which commit 05c4eec had already left behind in code: since then every Supabase Auth call forwards its token to Supabase Auth, while Supabase Auth's CAPTCHA protection stayed off, so those tokens were only checked for presence.

## Context (audit, 2026-10-26)

| Flow | Token sent to | Verified before this ADR |
|---|---|---|
| Create Account, resend sign-up code | Supabase Auth (`signUp`, `resend`) | presence only |
| Sign In (email + password, phone + password) | Supabase Auth (password grant) | presence only |
| Email code send / resend | Supabase Auth (`signInWithOtp`) | presence only |
| Forgot Password request, recovery resend | Supabase Auth (`resetPasswordForEmail`) | presence only |
| Change password (current-password check) | Supabase Auth (password grant) | presence only |
| Phone sign-up (Installer/Showroom), account creation | app → Cloudflare Siteverify, then Admin API | **yes** (hostname + action) |
| Phone sign-up, first session | Supabase Auth (password grant, second token) | presence only |

The public (anon) key is public, so anyone can call `/auth/v1` directly. An app-only check (Option A) cannot cover those calls; only Supabase Auth's own CAPTCHA protection can.

## Decision

1. **Supabase Auth verifies every token for the operations it processes**: sign up, resend, password sign in, email code, password recovery. Hosted projects run with CAPTCHA protection ON, provider Turnstile, with the secret of the site key the app's widget uses. This also covers requests that skip the app.
2. **The app verifies with Cloudflare Siteverify only where Supabase Auth never sees a token**: the phone sign-up's service-role account creation (`verifyTurnstileToken`, with hostname and action checks, fail closed). That flow submits two independent tokens, so each is verified exactly once.
3. **Each token is verified exactly once.** A token forwarded to Supabase Auth is never also sent to Siteverify (Turnstile tokens are single-use; the second check would fail as `timeout-or-duplicate`). The app still refuses a missing token before calling Supabase Auth, so no email is sent for an unchallenged request.
4. **Fail closed, neutral copy.** Supabase Auth's `captcha_failed` (missing, invalid, expired or reused token) and every Siteverify failure map to the existing neutral "verification failed, try again" messages. Rate limits, session checks and account isolation are unchanged.
5. **Minimal friction.** Sign In, code resends and Change Password use Turnstile's `interaction-only` appearance (nothing shows unless Cloudflare asks for interaction). Create Account, Forgot Password and phone sign-up keep the visible widget. An early submit is held until the token exists (PR #105).
6. **No server-side password grant without a challenge.** A check the server makes on its own (the Installer password-change "did the new password apply?" probe) asks the database (`account_password_confirm` through the caller's session) instead of a password grant.
7. **Local and CI.** The committed `supabase/config.toml` keeps `[auth.captcha]` off, because a local Supabase Auth that cannot reach Cloudflare would refuse every protected call. The Auth CAPTCHA E2E workflow turns it on with Cloudflare's public test secrets (`scripts/ci/enable-gotrue-captcha.sh`) and runs the browser suites plus direct `/auth/v1` calls.

## What is proven, and what is not

- **Proven in CI (direct `/auth/v1` calls with the public key, no app):** a missing token is refused on all five operations; a token Cloudflare rejects (2x test secret, what a real secret answers for a made-up or invalid token) is refused; a token Cloudflare reports as already spent (3x test secret, the replay/expiry answer) is refused; a genuine test token gets past the check. Unit tests cover the app's Siteverify: one call per token, replay refused, expired/invalid/unavailable, hostname and action mismatch.
- **Not proven:** a real replay against Cloudflare (test keys do not track single use; it can only be observed with real keys, for example on Acceptance after the hosted switch). Supabase Auth does **not** check a token's hostname or action; hostname protection on those calls relies on the Turnstile widget's hostname allowlist in Cloudflare. Supabase Auth CAPTCHA does not cover `verifyOtp`, token refresh, OAuth or the Admin API; those rely on rate limits and their own checks.
- **Until the hosted switch is on, hosted projects still check presence only.** No document may describe hosted sign-in as CAPTCHA-verified before that.

## Rollout (each step needs the owner's GO)

1. Merge #105, then this follow-up PR. Deploy that code to the environment.
2. In that project's Dashboard → Authentication → Attack Protection, enable CAPTCHA protection, provider Turnstile, with the secret matching `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (owner pastes it; never in chat or Git). Acceptance first, then Production.
3. Smoke test: sign up, sign in (email and phone), forgot password, change password; and a direct `/auth/v1/token?grant_type=password` call with no token must answer `captcha_failed`.
4. Rollback: switch CAPTCHA protection off in the dashboard (no deploy needed).

Turning the switch on before step 1 breaks code that sends no token: the currently live Production build (a9723a0) has a token-less password grant in `profile-identity.ts`.
