# Acceptance L1 / L2 readiness (release candidate 78d1b5c0)

Status: owner runbook, 2026-11-08. Documentation only. Nothing here was executed: no Production write, merge, deployment,
secret change, Access policy change or workflow dispatch. WhatsApp delivery stays OFF throughout.

- Release candidate (RC): `origin/main` = `78d1b5c0c743ef3afb40285d01baeb8d62152692`.
- Preview Worker: `https://aladdin-frontend-preview.bstalent9.workers.dev` (Acceptance Supabase `nxossqhdfltcqdwvbewi`), behind
  Cloudflare Access. It currently runs a build of `5861d879`, which is 69 commits older than the RC.
- L1 = hosted read-only Playwright suite `frontend/e2e-acceptance/hosted-acceptance.spec.ts` (workflow
  `.github/workflows/hosted-acceptance-e2e.yml`, three Acceptance test accounts).
- L2 = manual owner checks in a browser (section 3).

## 1. Owner steps: a dedicated Access service token (no values in logs or chat)

PR #147 (`fix/acceptance-e2e-access-token-20261108`) reads two secrets from the GitHub Environment `acceptance-e2e`:
`ACCEPTANCE_E2E_ACCESS_CLIENT_ID` and `ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET`. Do NOT reuse the `cloudflare-preview` pair
(`CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, used by the deploy smoke check): that environment holds deploy credentials
and the two jobs must stay separate.

### 1.1 Create the token (Cloudflare Zero Trust dashboard)

1. Zero Trust, **Access**, **Service credentials** (older UI: Access, Service Auth), **Service Tokens**, **Create Service Token**.
2. Name it `aladdin-acceptance-e2e`. Set **Service Token Duration** as short as you can maintain (for example 3 months; avoid
   "Non-expiring").
3. Click **Generate token**. Cloudflare shows the Client Secret **once**. Do not paste it into chat, a ticket, a file or a
   terminal command line. Leave the page open until step 1.3 is done.

### 1.2 Authorise it for the preview application only

1. Zero Trust, **Access**, **Applications**, open the application that protects `aladdin-frontend-preview.bstalent9.workers.dev`.
2. **Policies**, add a policy: action **Service Auth**, Include rule **Service Token** = `aladdin-acceptance-e2e` and nothing else
   (no Everyone, no email, no IP range).
3. Do not add a **Bypass** policy. Do not attach this token to any other application. Existing human (Allow) policies stay as they are.
4. Check the policy order: the token's policy must not be shadowed by a Block rule.

### 1.3 Store the two secrets without echoing them (Git Bash or PowerShell)

```
gh secret set ACCEPTANCE_E2E_ACCESS_CLIENT_ID --env acceptance-e2e --repo hmohamed080/aladdin
gh secret set ACCEPTANCE_E2E_ACCESS_CLIENT_SECRET --env acceptance-e2e --repo hmohamed080/aladdin
```

Each command prompts for the value on stdin and echoes nothing; paste the Client ID, then the Client Secret, and press
Enter. Do not add `--body` or `-b` (that would put the value in shell history). Confirm presence only (names, never values):

```
gh secret list --env acceptance-e2e --repo hmohamed080/aladdin
```

It must list the three `ACCEPTANCE_E2E_*_PASSWORD` secrets plus the two new ones. Then close the Cloudflare page.

### 1.4 Rotation

1. Create a second token (`aladdin-acceptance-e2e-2`), add it to the same Service Auth policy (Include).
2. Re-run both `gh secret set` commands with the new values.
3. Run L1 once (section 2). When it passes, remove the old token from the policy and delete it in **Service Tokens**.
4. Rotate before the duration ends, immediately after any suspected exposure, and when a person who handled it leaves.
   Expiry shows up as the Access 302/401/403 triage entry in section 4.

## 2. Ordered gate sequence

Each gate needs the owner's explicit approval; this document authorises none of them.

| # | Gate | What | Done when |
|---|---|---|---|
| G0 | Token | Section 1 complete (token, policy, two secrets). | `gh secret list --env acceptance-e2e` shows 5 secrets. |
| G1 | Merge PR #147 | Merge after the owner reviews it. It makes the workflow send the token to the exact preview origin only. | `main` contains `frontend/e2e-acceptance/access.mjs`. |
| G2 | A1: redeploy preview from the RC | Dispatch `cloudflare-frontend-preview.yml` from `main`, Acceptance only (`cloudflare-preview` Environment, `CLOUDFLARE_PREVIEW_ENABLED=true`). Re-do it on the RC: the live build is `5861d879`. Merging #147 moves `main` past 78d1b5c0 (workflow, tests and docs only, no app code), so either redeploy from the new `main` and re-name the RC, or deploy 78d1b5c0 explicitly. State which SHA was deployed. | The workflow's smoke step is green and `/api/backend/health` returns `"env":"staging"`. |
| G3 | L1 | Dispatch `hosted-acceptance-e2e.yml` from `main`. | Section 4 expected results. |
| G4 | L2 | Section 3, on the RC build. | Every row passes, no account created. |

## 3. L2 manual checklist (owner, in a browser)

Use a private window, the Acceptance preview only, and Acceptance test data. Do not use real customers' phone numbers. You pass
Cloudflare Access with your normal Access login (not the service token).

Column "When": **Now** = can be run today against the CURRENT build (5861d879); **After A1** = only meaningful on the RC build.
Rows marked Now must be re-run after A1 as part of the final pass.

| # | Check | Expected | When |
|---|---|---|---|
| L2-1 | Sign in with Google (existing Acceptance Google test user) | Lands on the role home; no extra account; no error banner. | Now (re-run after A1) |
| L2-2 | Sign in with Facebook (existing test user) | Same as L2-1. | Now (re-run after A1) |
| L2-3 | Legacy phone number sign-in: an existing Acceptance account's mobile number plus its password, on `/auth/sign-in` | Signs in as that account. WhatsApp OTP is NOT involved (delivery is OFF): no code is requested or sent. | Now (re-run after A1: the phone-verification work is among the 69 newer commits) |
| L2-4 | Username sign-in (existing account with a username) | Signs in. | Now (re-run after A1) |
| L2-5 | Email sign-in | Signs in. | Now (re-run after A1) |
| L2-6 | Forgot password on `/auth/forgot-password` for an Acceptance email you control | The page confirms an email was sent without revealing whether the address exists. The recovery email arrives; do not complete the reset on a shared account unless it is a throwaway. | Now (re-run after A1) |
| L2-7 | Sign out from the profile menu | Returns to a signed-out page; Back does not show protected content. | Now (re-run after A1) |
| L2-8 | `/installer/sign-in`, `/installer/sign-up`, `/showroom/sign-in`, `/showroom/sign-up` (also `/temporary/craftsman/sign-in` and `/sign-up`) | Permanent (308) redirect to `/auth/sign-in`, or `/auth/sign-up?type=installer_technician` / `?type=showroom_dealer` (from `frontend/next.config.ts`). DevTools Network shows 308. | Now (the redirects date from 2026-10-28; confirm) |
| L2-9 | `/showroom` and `/showroom/home` while signed out | Redirected to a `/auth/sign-in` page (the L1 smoke asserts a path matching `sign-in`). | Now (re-run after A1) |
| L2-10 | No account created: Acceptance Supabase Auth user count and last-created time are unchanged after all of the above; never complete a sign-up form | Unchanged. | Now (compare before and after) |
| L2-11 | Admin Backups page (`/admin/backups`) as an Admin: loads, no application error, no 5xx, no console errors; do not press activate or run | Renders (or the documented not-activated state). Backups landed in PR #140, merged after 5861d879, so the current build cannot show them. | After A1 only |
| L2-12 | Other Admin pages (`/admin`, `/admin/staff`, `/admin/whatsapp-otp`, `/admin/phone-cooldowns`) load without breaking | Render; the Backups nav entry appears only for the right role. | After A1 only |
| L2-13 | WhatsApp delivery stays OFF: no WhatsApp message arrives for any flow above; the Admin WhatsApp OTP page (if opened) shows delivery off | Nothing sent. | "No message" check Now; Admin page After A1 |

Record the SHA shown by the deploy workflow next to the date and the pass/fail of each row.

## 4. Expected L1 results and failure triage

What the suite does (verified in `hosted-acceptance.spec.ts` on main): the "public smoke" test calls `/api/health` and
`/api/backend/health` (backend must be `{status:"ok", service:"backend", env:"staging"}`), GETs `/`, `/auth/sign-in`,
`/installer/sign-in`, `/legal/terms` expecting 200 (the installer path is a 308 in `next.config.ts`; the browser-style request
follows it to `/auth/sign-in`, and #147 changes this to assert the 308 without following), and checks `/showroom` asks a
signed-out visitor to sign in. Then, per persona (owner `test1@example.com`, `acc6-sales-manager`, `acc6-sales-rep`): sign in,
render `/b2b`, `/b2b/leads`, `/b2b/customers`, `/showroom/home`, People management allowed (owner) or refused (others), Sales
branch scope matches the membership. A last block records "Showroom RC2 drift" as annotations and never fails on them. It
creates, edits and deletes nothing; requests to Production hosts are aborted and fail the run.

Expected on a healthy RC with a valid token: all smoke and persona tests pass; the drift block passes with annotations only.

| Symptom | Likely cause | What to do |
|---|---|---|
| First step fails: "... is missing from the acceptance-e2e Environment" | A secret is absent (with #147 merged, five are required). | `gh secret list --env acceptance-e2e`; set the missing one (section 1.3). |
| Preflight or smoke: HTTP **302** to a `cloudflareaccess.com` login (the original run 42450831535 failure) | No token sent (workflow run from a branch without #147), token not in the policy, or the policy is not Service Auth. | Confirm G1 merged and dispatch was from `main`; re-check section 1.2. #147 does not follow the redirect, so the token never travels to the login host. |
| **401 / 403** | Wrong or expired token, stray space, ID and secret swapped, or a Block rule ahead of the policy. | Check expiry in Service Tokens; re-set both secrets; check policy order; rotate (1.4). |
| 200 but `env` is not `staging` | Preview is bound to the wrong backend. | Stop. Do not run L2. Investigate the deploy; this is a safety gate. |
| Sign-in test fails at the CAPTCHA step or with an auth error | **Turnstile stub caveat.** The spec on main replaces `challenges.cloudflare.com/turnstile/v0/api.js` with a stub that supplies a dummy token. That is valid only if Supabase Auth CAPTCHA is OFF on Acceptance. Draft PR #146 states CAPTCHA has been ON since 2026-10-28 and that the stub would be refused; #147 does not change the stub. This is not verifiable from the repository. | Before G3, the owner checks Supabase Auth, Attack Protection (CAPTCHA) on the Acceptance project. If ON, expect persona tests to fail at sign-in with a CAPTCHA error: a separate blocker, not an Access problem. Do not switch CAPTCHA off to pass the test; the fix is a spec change (real widget, or Cloudflare's always-pass test key) in its own PR. |
| Persona signs in but lands on `/onboarding`, `/auth` or `/installer` | The test account is not fully provisioned on Acceptance. | Fix the account data, not the test. |
| `People` test fails | Role or membership drift on Acceptance. | Compare the membership with the persona table in the spec. |
| Violation: request to a Production host (`kkpkgjrweysgvhvkhzun`, `aladdindecore.com`) | The preview build points at Production. | Stop. Treat as a deploy configuration incident. |
| "Application error" / `Digest:` on a page | A real defect in the RC or a missing runtime secret on the Worker. | Capture the path, check Worker logs; do not continue to L2. |

### The CF_Authorization cookie assumption (untested against real Access)

Per #147's owner doc, the token is attached to the **first** request only. Real Chromium forwards overridden headers to a
cross-origin redirect target, so #147 does not use `route.continue({headers})`; it fetches the first hop with
`maxRedirects: 0`, fulfils the response, and lets the browser follow redirects. Later hops (for example `/b2b` to
`/showroom/home`) therefore rely on the `CF_Authorization` session cookie that Access issues for a valid service token and sets
via `Set-Cookie` on that first response. This was proven only with local simulated servers
(`frontend/e2e-access-routing/access-routing.spec.ts`), never against real Cloudflare Access. If the first hosted run shows
an Access 302 on a **later** navigation (not the first request), suspect this assumption (for example the Access session
cookie is not issued, is scoped differently, or the session duration is too short) rather than a bad token, and fix it in a
follow-up PR instead of widening where the token is sent.

## 5. Not done by this document

No token created, no secrets set, no Access policy changed, no merge, no deploy, no workflow dispatch, no WhatsApp activation.
