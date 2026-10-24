# E2E shared failures triage (2026-10-22)

The nine desktop suites (auth-password-preview, installer-phone-auth, account-workspace-model, pr89-media, sales, recovery-replay, showroom-mvp, profile-completion, orders-projects) were run on the Node server (Next.js 15 baseline) and on the Workers build (`playwright.workers.config.ts`, Next.js 16, OpenNext). Both runs failed **the same 51 tests**: the Workers migration and the Next.js 16 upgrade add no regression. None of the 51 is caused by the host.

This file classifies the 51 so each one has an owner. Runs were local (sandbox, local Supabase, Mailpit); nothing here is a real-provider result. Re-run of the fixed installer and profile specs on Node: 8 passed, 17 failed, every remaining failure explained below.

| Group | Count | Cause | Status |
|---|---|---|---|
| Turnstile token empty | 21 | Create Account and Forgot Password verify the Turnstile token server-side (Siteverify). The sandbox cannot reach Cloudflare, so `captchaToken` stays empty and the form never submits. auth-password-preview ×15 (all but :635), profile-completion :123 :135 :146 :192 :273 :298. | Environment, not code. Run in GitHub CI with Cloudflare's Turnstile test keys (always-pass site key `1x00000000000000000000AA`, secret `1x0000000000000000000000000000000AA`). |
| Sign In CAPTCHA | 1 | auth-password-preview :635 asserts Sign In has no Turnstile widget (the documented rule). `sign-in-form.tsx` renders `TurnstileWidget action="sign-in"` since commit 05c4eec (2026-10-14). | **Owner decision**: code or docs is wrong. Asked the owner. |
| Installer phone label | 8 | installer-phone-auth: `getByLabel("رقم الهاتف")` also matches the phone entry tab panel (strict-mode violation). | **Selector fixed**: the spec targets the textbox by role. The re-run then stops at the next layer: installer sign-up now renders a Turnstile challenge, so in the sandbox it fails like the first group. |
| Profile Country picker | 2 | profile-completion :321 :387: Country became a custom `CountryPicker` button + listbox; the spec still used `selectOption`. | **Picker fixed**: the spec drives the picker. The re-run then exposed two more stale assertions: :321 expected the avatar URL path to change after a re-upload, but R2 media serves every avatar from `/api/media/avatar` and only the query changes (fixed); :387 looks for the `identity-card` on `/b2b/settings`, which now redirects to the RC2 `/showroom/settings` (product review, like the last group). |
| recovery-replay port | 2 | The spec builds its own browser contexts with a hard-coded `127.0.0.1:3100` base URL, so on Workers (port 3300) it hits a closed port. On Node it then fails on the Turnstile token like the first group. | **Fixed** the port (uses the active config's `baseURL`); the Turnstile part goes with the first group. |
| Showroom RC2 surface drift | 17 | The specs predate the Showroom RC2 shell (`features/showroom-shell`, October 2026). They assert August labels and controls the RC2 shell renamed or moved: sidebar groups "Buying/Network/Selling/Business", "Committed spend" tile, `/b2b/rfqs` h1 "Purchase requests" (now "Direct RFQs", deliberately kept apart from Shared Purchase Requests in `navigation.ts`), settings "Workspace" heading, `locale-ar` in the profile menu, the Arabic nav label, `activity-selector` on `/b2b/settings` (now redirects to `/showroom/settings`), the `workspace-switcher` and "Add business" menu item, the Orders nav link, the sales branch `<select>`, the language toggle, and a consumer's `/business/new` landing on `/business/applications` instead of `/home`. showroom-mvp ×7, account-workspace-model ×5, sales ×3, orders-projects :50, profile-completion :414. | **Needs product review, not a migration fix.** Each is either a stale assertion or a real RC2 regression (the workspace switcher and the consumer redirect deserve a look first). Rewriting the specs to match whatever renders today would hide the second kind, so they are left failing and listed here. |

Total: 21 + 1 + 8 + 2 + 2 + 17 = 51.

## Where the Turnstile group runs now (2026-10-24)

The CAPTCHA-dependent suites run in GitHub Actions, in `.github/workflows/auth-captcha-e2e.yml` (job `auth-captcha-e2e`). A GitHub runner can reach Cloudflare, so the real widget and the real Siteverify call run there. The job:

- runs on push to `claude/cloudflare-workers-2ibvgs`, on manual dispatch, and on pull requests to `main` that touch the auth, CAPTCHA, env or E2E files it lists;
- starts a local Supabase stack on the runner (`supabase start` + `db reset`) and runs `chromium-desktop` against the Node build (`next build` + `next start`, from `frontend/playwright.config.ts`);
- runs `auth-password-preview`, `profile-completion`, `installer-phone-auth` and `recovery-replay`. It leaves out the Sign In "renders no Turnstile widget" test (waiting on the owner decision) and the profile-completion "seeded account" block (waiting on product review);
- uses Cloudflare's public test keys and `NEXT_PUBLIC_APP_ENV=local`, and sets both E2E stubs (`E2E_STUB_TURNSTILE`, `E2E_TURNSTILE_STUB`) to `0`. It reads no repository secrets. A first step calls Siteverify with the test secret and saves Cloudflare's reply as an artifact (`siteverify-test-key.json`), including the hostname it returns.

Hostname: the app accepts a test-key result (`metadata.result_with_testing_key: true`) before it checks the hostname or action, and only when `NEXT_PUBLIC_APP_ENV=local` (`frontend/src/server/auth/turnstile.ts`). So `TURNSTILE_ALLOWED_HOSTNAMES` does not decide this job. It is set to `127.0.0.1,localhost` in the job env only. No application code was changed.

Only the installer phone sign-up calls Siteverify from the app. Create Account and Forgot Password pass the token to GoTrue, where `[auth.captcha]` is off. In the sandbox those flows fail earlier: the widget script never loads, so no token is minted.

## How to reproduce

```bash
cd frontend
E2E_STUB_TURNSTILE=1 pnpm exec playwright test --project=chromium-desktop <spec>        # Node
E2E_STUB_TURNSTILE=1 pnpm exec playwright test -c playwright.workers.config.ts --project=chromium-desktop <spec>   # Workers
```

Both need the local Supabase stack (`pnpm exec supabase start` from the repository root) and the env described in `docs/guides/`.
