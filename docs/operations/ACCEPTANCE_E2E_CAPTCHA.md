# Hosted Acceptance E2E and Turnstile CAPTCHA

Status: 2026-11-08. Applies to `frontend/e2e-acceptance/` and `.github/workflows/hosted-acceptance-e2e.yml`. Acceptance only; never Production.

## Verified facts (read-only, 2026-11-08)

- Acceptance (`nxossqhdfltcqdwvbewi`) Supabase Auth CAPTCHA protection is ON. Verified: one password grant for a made-up address with no captcha token answered `captcha_failed` ("no captcha_token found"), not "Invalid login credentials". Repo docs agree (`docs/frontend/auth-captcha.md`, `docs/operations/RUNTIME_STATE.md`).
- The public `/auth/v1/settings` endpoint does not expose the CAPTCHA setting.
- The preview's `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is a GitHub Environment variable (`cloudflare-preview`), not in the repo. Whether it is a test key or a real widget key is NOT verified from the repo. Which Turnstile secret Acceptance Supabase holds is also not verifiable read-only.

## Design

CAPTCHA stays ON. The old spec stub returned a dummy token, valid only while CAPTCHA was OFF. A dummy token passes ON-protection only when the Supabase secret is Cloudflare's always-pass test secret; a real secret rejects it.

`frontend/e2e-acceptance/turnstile.mjs`: the stub now records the site key the page renders with and answers only for the always-pass test site key (`1x00000000000000000000AA`). `signIn` reads the recorded key and fails closed with a clear message for any other key (real, always-block, forced-interaction, missing). Nothing is bypassed.

Rejected: driving the real widget. Sign In uses `interaction-only` mode, which can pass without a click, but automation is often challenged or flagged, and a token is bound to the page hostname. It would be flaky as a gate.

## Owner-run steps (needed unless Acceptance already uses the always-pass pair)

Acceptance only. Never touch Production keys, widgets or secrets. Never paste secret values in chat or Git.

1. Cloudflare Turnstile: no new widget is needed. The always-pass test site key is public: `1x00000000000000000000AA`. Its paired test secret is Cloudflare's published always-pass secret.
2. Acceptance Supabase Dashboard, Authentication, Attack Protection: keep CAPTCHA ON, provider Turnstile, and set the secret to the always-pass test secret from Cloudflare's Turnstile testing docs.
3. GitHub Environment `cloudflare-preview`: set variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the always-pass test site key.
4. Run the `Cloudflare frontend preview` workflow to rebuild the preview (the site key is inlined at build time).
5. Re-run `Hosted acceptance E2E`.

Trade-off to accept: with the test secret, Acceptance no longer verifies real tokens, so it does not prove real-widget behaviour (Production keeps real keys; real keys are verified there by the owner smoke test). Acceptance sign-ups become scriptable by anyone with a dummy token; the preview is behind Cloudflare Access, which limits exposure of the app but not direct calls to the public Supabase URL. If the owner will not accept that, keep real keys and run this suite only locally or in `auth-captcha-e2e.yml` (test keys on a runner); the hosted run will then fail closed with the message above.
