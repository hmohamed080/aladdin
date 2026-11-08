# Hosted Acceptance E2E: manual headed run (visible Chrome)

The hosted workflow runs in a headless browser on a GitHub runner. Cloudflare answers that browser with an interactive Turnstile
challenge that nobody can complete (run 42472986863, 2026-11-08: widget events `init`, `interactiveBegin`, then no `complete`).
This run does the same suite on the owner's PC in visible Google Chrome, so a person completes a **genuine** challenge. Turnstile,
Supabase Auth CAPTCHA and Cloudflare Access are not stubbed, bypassed, disabled or modified.

## Run it (Scorpion, from the repository root)

PowerShell or Git Bash, on a branch that contains this change (`claude/hosted-e2e-real-turnstile`, PR #156):

```
git fetch origin claude/hosted-e2e-real-turnstile
git switch claude/hosted-e2e-real-turnstile
git pull --ff-only
pnpm install --frozen-lockfile --filter frontend
pnpm --filter frontend exec playwright install chrome    # only if Google Chrome is not installed
pnpm --filter frontend e2e:acceptance:headed
```

Type the five values when asked (hidden input, nothing displayed or saved): the Access service-token Client ID and Client Secret,
then the Owner, Sales Manager and Sales Rep passwords. Use a normal terminal window (not a piped or redirected one). GitHub
Secrets are not available locally; the values are not read from files or the environment.

Then: a no-browser preflight must say "Preview answered through Cloudflare Access", Chrome opens, and each sign-in prints
`[manual] ...`. If Cloudflare shows a verification in the window, complete it yourself (up to 5 minutes per sign-in; the owner
account signs in twice and the other two once each, so expect up to four). Leave the window open until the run ends.

## What it covers

The unchanged suite (`frontend/e2e-acceptance/hosted-acceptance.spec.ts`): public smoke, then for the Owner, Sales Manager and Sales
Rep the Sales screens, People access and branch scope, plus the record-only RC2 drift observations. 11 tests.

## Guards that stay on

- Acceptance preview only: `ACCEPTANCE_BASE_URL` is fixed to the preview and the config refuses anything else; requests to the live
  Supabase project or aladdindecore.com abort the run and fail it.
- Access token only on the exact preview origin, never on redirects or other hosts; an Access login redirect is a failure.
- Read-only. Trace, video and screenshots are off. Errors are scrubbed; Turnstile diagnostics are fixed categories and numeric codes.
- The JSON report (test names and scrubbed messages) is written to a new folder under the OS temp directory; its path is printed.
- The values live only in the memory of the launcher and the test process, and end with it.

## Local-only changes

`ACCEPTANCE_E2E_HEADED=1` (set by `frontend/e2e-acceptance/run-headed.mjs`, never by the workflow) switches the config to headed
Chrome, a 20-minute test timeout and longer Turnstile/sign-in waits. The hosted workflow is unchanged.
