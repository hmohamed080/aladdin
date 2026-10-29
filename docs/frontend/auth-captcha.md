# Sign-in CAPTCHA (Cloudflare Turnstile)

The approved behaviour, per [ADR-0023](../decisions/ADR-0023-supabase-auth-verifies-turnstile.md). Code: `frontend/src/server/auth/captcha.ts` (shared rules), `frontend/src/server/auth/turnstile.ts` (app Siteverify), `frontend/src/features/auth-password-preview/turnstile-widget.tsx` (widget).

## Where a challenge runs and who verifies it

| Screen / action | Widget | Turnstile action | Verified by |
|---|---|---|---|
| Create Account (`/auth/sign-up`) | visible | `sign-up` | Supabase Auth (`signUp`) |
| Resend sign-up code | visible | `sign-up-resend` | Supabase Auth (`resend`) |
| Sign In, email + password | interaction-only | `sign-in` | Supabase Auth (password grant) |
| Sign In, phone + password (Installer, Showroom) | interaction-only | `phone-sign-in` | Supabase Auth (password grant) |
| Email code send / resend | interaction-only | `otp-send`, `otp-resend` | Supabase Auth (`signInWithOtp`) |
| Forgot Password request | visible | `recovery-request` | Supabase Auth (`resetPasswordForEmail`) |
| Recovery code resend | interaction-only | `recovery-resend` | Supabase Auth (`resetPasswordForEmail`) |
| Change Password (current password) | interaction-only | `change-password` | Supabase Auth (password grant) |
| Phone sign-up: account creation | visible | `phone-sign-up` | **the app**: Cloudflare Siteverify, hostname + action, then the Admin API |
| Phone sign-up: first session | interaction-only | `phone-sign-up-session` | Supabase Auth (password grant) |

`interaction-only` shows nothing unless Cloudflare decides it needs the person to interact. A submit made before the token exists is held and replayed once it does (or after 8 s, so the server can answer).

## Rules

- **One verifier per token.** Tokens are single-use. A token forwarded to Supabase Auth is never sent to Siteverify too; the phone sign-up uses two separate tokens.
- **Missing token = refused before Supabase Auth is called**, so nothing is sent for an unchallenged request.
- **Fail closed.** Supabase Auth's `captcha_failed` and every Siteverify failure (rejected, expired, replayed, wrong hostname, wrong action, Cloudflare unreachable) map to the neutral "verification failed, try again" copy. Cloudflare's and Supabase's own error text never reaches the screen or the logs, and tokens and secrets are never logged.
- **No server-side password grant without a challenge.** Checks the server makes on its own use the database (`account_password_confirm`).
- Rate limits, session checks and account isolation are separate and unchanged.

## Environments

| Where | Supabase Auth CAPTCHA protection | Effect |
|---|---|---|
| Hosted (Acceptance, Production) | ON since 2026-10-28 (Turnstile, the secret matching `NEXT_PUBLIC_TURNSTILE_SITE_KEY`), set by the owner in Dashboard → Authentication → Attack Protection | Every protected call is verified, including direct `/auth/v1` calls |
| Hosted, if the switch is ever turned OFF (the rollback) | — | Tokens are only checked for presence. Do not describe the project as CAPTCHA-verified while it is off. |
| Local (`supabase/config.toml`) | OFF by default | A local stack often cannot reach Cloudflare. To try it: add the `[auth.captcha]` block shown in `config.toml` with the always-pass test secret. |
| CI, `auth-captcha-e2e.yml` | ON with Cloudflare's public test secrets (`scripts/ci/enable-gotrue-captcha.sh`) | Browser suites run through Supabase Auth's check; `frontend/e2e-gotrue-captcha/` calls `/auth/v1` directly |

## Tests

- `frontend/e2e-gotrue-captcha/direct-auth.spec.ts` (config `playwright.gotrue-captcha.config.ts`): for password sign in, sign up, email code, recovery and resend, called directly with the public key: no token → refused; a token Cloudflare accepts → gets past the check (1x secret, which accepts any token); every token refused with the 2x secret (rejected: what a real secret answers for a made-up or invalid token) and the 3x secret (already spent: the replay/expiry answer).
- `frontend/src/server/auth/turnstile.test.ts`: Siteverify pass, missing, invalid, expired/replayed, hostname, action, test-key outside local, unavailable (non-2xx, timeout, network, malformed), exactly one call, replay refused.
- `frontend/src/server/auth/installer-security.test.ts`: the password-change probe uses the database, never a password grant.
- Browser suites in `auth-captcha-e2e.yml` (44 tests) with the real widget and Supabase Auth's check on.

## Known limits

- Supabase Auth does not check a token's hostname or action. On those calls hostname protection is the widget's hostname allowlist in Cloudflare.
- A real replay against Cloudflare cannot be shown with test keys; the 3x secret simulates Cloudflare's answer. A real check needs real keys (Acceptance).
- Supabase Auth CAPTCHA does not cover `verifyOtp`, token refresh, OAuth or the Admin API.
