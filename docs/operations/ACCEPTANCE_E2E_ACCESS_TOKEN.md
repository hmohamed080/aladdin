# Hosted Acceptance E2E: Cloudflare Access service token

The Acceptance preview Worker (`https://aladdin-frontend-preview.bstalent9.workers.dev`) is behind Cloudflare Access.
`hosted-acceptance-e2e.yml` therefore needs a service token, or its first request is redirected to the Access login page and
nothing is tested (observed on run 42450831535, 2026-11-08).

## What the owner configures (values are never written in the repository or in chat)

GitHub Environment **`acceptance-e2e`** (not `cloudflare-preview`: that one holds deploy credentials and must stay separate).
Two new secrets, next to the three existing `ACCEPTANCE_E2E_*_PASSWORD` secrets:

| Secret | Value |
|---|---|
| `ACCEPTANCE_E2E_ACCESS_CLIENT_ID` | Client ID of a **dedicated** Access service token |
| `ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET` | Client Secret of that token (shown once by Cloudflare when it is created) |

Recommended Cloudflare setup (owner-run, in Zero Trust):

1. Create a **new** service token used only by this workflow (for example named `aladdin-acceptance-e2e`), with the shortest
   duration you can maintain. Do not reuse the `cloudflare-preview` deploy/smoke token (`CF_ACCESS_CLIENT_ID`/`SECRET`).
2. In the Access application that protects `aladdin-frontend-preview`, add a policy with action **Service Auth** that includes
   **only this token**. Do not attach the token to any other application and do not add a bypass policy.
3. Store the two values with `gh secret set ACCEPTANCE_E2E_ACCESS_CLIENT_ID --env acceptance-e2e` and
   `gh secret set ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET --env acceptance-e2e` (the CLI prompts for the value; nothing is echoed).
4. Rotate by creating a new token, updating both secrets, then deleting the old token.

## How the code uses it (fail closed)

- `frontend/e2e-acceptance/access.mjs` holds the logic; `access.test.ts` covers it (vitest, runs in the `frontend` CI job).
- **Both credentials are required.** The workflow's first step, the preflight, and `playwright.acceptance.config.ts` each stop the
  run if either is missing or blank. There is no unauthenticated fallback.
- **Exact origin only.** The headers `CF-Access-Client-Id` / `CF-Access-Client-Secret` are added only to requests whose origin
  is exactly `https://aladdin-frontend-preview.bstalent9.workers.dev` (browser traffic through a context route, API calls per
  request). They are not Playwright `extraHTTPHeaders`, so Supabase, Turnstile, other hosts, look-alike hosts, other ports and
  `http://` never receive them.
- **No redirect following with the token.** The preflight uses `redirect: "manual"` and the API calls use `maxRedirects: 0`.
  A redirect to a `*.cloudflareaccess.com` login (or any 3xx without a location) fails the run with a clear message; a browser
  request to an Access login host is aborted and recorded as a violation that fails the suite.
- **Preflight** requires HTTP 200, a JSON body and `{status:"ok", service:"backend", env:"staging"}` from `/api/backend/health`.
- Unchanged: the suite stays read-only, Acceptance-only (requests to Production hosts are aborted), and trace, video and
  screenshots stay off. The token is never printed (GitHub also masks the secrets).

## Verify after configuring (needs separate approval to run)

`gh workflow run hosted-acceptance-e2e.yml --ref main` once this change is on `main`. The first step must say
"Preview answered through Cloudflare Access: backend ok, env staging."
