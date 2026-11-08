# Acceptance L1 / L2 readiness (release candidate fc62c4b5)

Status: owner runbook, 2026-11-08. Documentation only. Nothing here was executed: no Production write, merge, deployment,
secret change, Access policy change or workflow dispatch. WhatsApp delivery stays OFF throughout.

- Release candidate (RC): `origin/main` = `fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a` (includes #147 Access token support and #148).
- Preview Worker: `https://aladdin-frontend-preview.bstalent9.workers.dev` (Acceptance Supabase `nxossqhdfltcqdwvbewi`), behind
  Cloudflare Access. It still runs a build of `5861d879`, so A1 (redeploy from main) is required before the RC is tested.
- Access service token: DONE. The dedicated `aladdin-acceptance-e2e` token exists, both `ACCEPTANCE_E2E_ACCESS_CLIENT_ID/SECRET`
  secrets are set in the `acceptance-e2e` Environment and the Service Auth policy is saved. Details and rotation live in
  [ACCEPTANCE_E2E_ACCESS_TOKEN.md](ACCEPTANCE_E2E_ACCESS_TOKEN.md); not repeated here.
- DECISION: real CAPTCHA stays ON on hosted Acceptance (Supabase CAPTCHA secret and the preview's
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY` stay real). PR #155 (always-pass test keys) is ON HOLD. Never weaken CAPTCHA to pass a test.
- L1 = hosted Playwright suite `frontend/e2e-acceptance/hosted-acceptance.spec.ts` (workflow `hosted-acceptance-e2e.yml`).
  L2 = manual owner checks in a browser (section 2).

## 1. A1: redeploy the preview from main (needs owner approval, NOT RUN)

### 1.1 Precheck: main's runtime paths still equal the RC (read-only)

```
git fetch origin
git diff --stat fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a origin/main -- frontend/src frontend/public frontend/wrangler.jsonc frontend/next.config.ts backend edge supabase pnpm-lock.yaml
```

Empty output = the deploy inputs equal the RC (checked on 2026-11-08: empty). Any output means main moved: re-name the RC
and re-decide before deploying. Docs, workflows and tests outside those paths do not change the build.

### 1.2 Owner commands (Git Bash; each needs explicit approval)

```
gh workflow run cloudflare-frontend-preview.yml --ref main --repo hmohamed080/aladdin
gh run list --workflow cloudflare-frontend-preview.yml --repo hmohamed080/aladdin --limit 1 --json databaseId,headSha,status,conclusion
gh run watch <databaseId> --repo hmohamed080/aladdin --exit-status
```

### 1.3 Verify the deployed version equals the RC (read-only)

1. `headSha` of that run must equal `fc62c4b5a3f9284fb2fc7d9b52df8193d558a13a` (or the new RC if 1.1 showed a change).
2. In `frontend/`: `npx wrangler versions list --name aladdin-frontend-preview` then `npx wrangler versions view <version-id> --name aladdin-frontend-preview`.
   Note the version id and creation time, and check the bindings and plain-text vars read-only: Supabase URL host is
   `nxossqhdfltcqdwvbewi.supabase.co` (never `kkpkgjrweysgvhvkhzun`), and no Production domain appears.
3. Record the preview deployment id printed in the workflow log next to the SHA.
4. The workflow's smoke step is green and `/api/backend/health` answers `"env":"staging"` (also the first L1 smoke check).

## 2. L2 manual checklist (owner, browser, real CAPTCHA)

Use a private window per account, the Acceptance preview only, Acceptance data only. You pass Access with your normal Access
login. Run it on the RC build (after A1); rows marked Now may be pre-run today on `5861d879` but must be repeated after A1.
Never write a password into a screenshot, note or chat. Never submit a sign-up form; edit no data.

Accounts: **O** = `test1@example.com` (owner), **M** = `acc6-sales-manager@example.test` (Sales Manager),
**R** = `acc6-sales-rep@example.test` (Sales Rep). Sign in methods: email, username, legacy phone number (the mobile number
plus password; no WhatsApp code is requested, delivery is OFF). Google and Facebook apply to **O** only, and only if a linked
identity exists for it.

| # | Check | Accounts | Expected | Pass/fail evidence |
|---|---|---|---|---|
| 1 | Sign in by email | O, M, R | Lands on the role home (not `/onboarding`, `/auth`, `/installer`); no error banner | Screenshot of the landing URL bar and page, per account |
| 2 | Sign in by username | each account that has a username | Same as 1 | Note which accounts have a username; screenshot per account |
| 3 | Sign in by legacy phone number | each account that has a verified mobile | Same as 1; no OTP prompt | Screenshot; note "no code requested" |
| 4 | Sign in with Google, then Facebook | O only, if linked | Same as 1; no extra account created | Screenshot of landing page |
| 5 | Wrong password | O, M, R | Generic invalid-credentials message, still on `/auth/sign-in`, no account hint | Screenshot of the message |
| 6 | Forgot password (`/auth/forgot-password`) | O (or a throwaway) | Reaches the email-code step; does not reveal if the address exists. Do NOT complete the reset | Screenshot of the code step; "reset not completed" |
| 7 | Sign out from the profile menu | O, M, R | Signed-out page; Back shows no protected content | Screenshot after pressing Back |
| 8 | Workspace routes render: `/b2b`, `/b2b/leads`, `/b2b/customers`, `/showroom/home` | O, M, R | Each opens an authenticated shell, no "Application error", no `Digest:`, no sign-in redirect (`/b2b` may client-redirect to `/showroom/home`) | One screenshot per route per account, or a note "4/4 OK" |
| 9 | People management `/b2b/organization` | O | Not refused; the invite form (`#invite-email`) is present. Do not send an invite | Screenshot of the page with the form |
| 10 | People management `/b2b/organization` | M, R | Refused with "You're not allowed to manage members here."; no invite form | Screenshot of the message |
| 11 | Branch isolation: `/b2b/customers`, open the Branch filter | O | Options after "All": ACC6 Cairo, ACC6 Giza, test | Screenshot of the open filter |
| 12 | Same filter | M | Same three branches as O (Manager sees the whole organization) | Screenshot of the open filter |
| 13 | Same filter | R | Only ACC6 Cairo | Screenshot of the open filter |
| 14 | Retired routes (DevTools Network, "Preserve log") | signed out | `/installer/sign-in`, `/showroom/sign-in`, `/temporary/craftsman/sign-in` answer 308 to `/auth/sign-in`; `/installer/sign-up` to `/auth/sign-up?type=installer_technician`; `/showroom/sign-up` to `/auth/sign-up?type=showroom_dealer` | Screenshot of the status and Location of each |
| 15 | `/showroom` and `/showroom/home` | signed out | Redirected to a `sign-in` page | Screenshot of the URL bar |
| 16 | Admin pages: `/admin`, `/admin/backups`, `/admin/staff`, `/admin/whatsapp-otp`, `/admin/phone-cooldowns` | O | Each loads without application error, 5xx or console error; do not press activate or run. Backups (PR #140) exists only after A1 | Screenshot per page; console clean note |
| 17 | Same Admin URLs | M, R | Not available (redirect, 404 or access-denied; no Admin content, no Backups nav entry) | Screenshot per account |
| 18 | No account created, no data edited | all | Acceptance Supabase Auth user count and newest `created_at` equal the values noted before the session | Before and after counts in the run note |
| 19 | WhatsApp delivery stays OFF | all | No WhatsApp message arrives for any step; the Admin WhatsApp OTP page (O) shows delivery off | Note "no message"; screenshot of the page |

Header of the run note: date, the SHA/version id from section 1.3, browser, tester. Row 17 expectation is the intended role
rule for Admin; if a non-owner can open an Admin page, record it as a defect, not a pass.

## 2a. Results (owner-reported summary, RC fc62c4b5)

Date: 2026-11-08. Build: RC `fc62c4b5` (origin/main is now `7d965394`, runtime paths unchanged vs the RC). The Acceptance
preview was redeployed from `fc62c4b5` (workflow run 42469324988, preview version `d8ff501d-4d01-4d4c-95ac-e0948347a46b`,
2026-11-08T10:00Z).

**Owner-reported (summary, no per-row evidence attached).** Recorded as reported by the owner, not re-checked by an agent:

- Backend: PASS
- Owner account: PASS
- Sales Manager: PASS
- Sales Rep: PASS
- Other authentication methods: PASS

**Agent-verified (separate from the owner report).** Seen by the agent in the run log of 42469324988:

- Workflow smoke: `/api/health` 200, `/` 200, `/auth/sign-in` 200, `/legal/terms` 200, `/showroom` 307 (with the Access token; the
  redirect target was not recorded).
- Read-only `wrangler` verification of the bindings: Acceptance Supabase, backend, and OTP preview Worker (staging).
- NOT verified by the agent: Backend `env:staging` health JSON, and `/installer/sign-in` 308.

### Re-assessment of all 19 checklist rows

Legend: **OR** = Owner-reported PASS (category summary only, no per-row evidence); **AV** = Agent-verified; **NE** = NO explicit
evidence yet. A category summary is not treated as proof of a specific row unless it plainly covers it. Nothing here is marked
passed on the agent's own judgement.

| # | Check | Status | Basis |
|---|---|---|---|
| 1 | Sign in by email (O, M, R) | OR | Owner / Sales Manager / Sales Rep PASS |
| 2 | Sign in by username | OR | Same account summaries; no list of which accounts have a username |
| 3 | Sign in by legacy phone | OR | "Other authentication methods: PASS"; "no code requested" not stated |
| 4 | Google, then Facebook (O) | OR | "Other authentication methods: PASS"; whether linked identities exist not stated |
| 5 | Wrong password message | NE | Not covered by any stated result |
| 6 | Forgot password code step | NE | Not covered |
| 7 | Sign out, Back shows nothing protected | NE | Not covered |
| 8 | Workspace routes render (O, M, R) | OR | Account summaries; routes not enumerated |
| 9 | People page for O (form present) | OR | Owner account summary; not itemised |
| 10 | People refused for M, R (exact message) | NE | Role denial message not stated |
| 11 | Branch filter for O (3 branches) | NE | Branch isolation not stated |
| 12 | Branch filter for M (3 branches) | NE | Not stated |
| 13 | Branch filter for R (ACC6 Cairo only) | NE | Not stated |
| 14 | Retired routes answer 308 | NE | `/installer/sign-in` 308 not verified; other routes not checked |
| 15 | `/showroom`, `/showroom/home` signed out redirect | NE | Only `/showroom` 307 seen (token attached, target not recorded); `/showroom/home` not seen |
| 16 | Admin pages for O (incl. Backups) | NE | Admin and Backups not stated |
| 17 | Admin hidden from M, R | NE | Not stated |
| 18 | No account created, no data edited | NE | No before/after Auth user counts |
| 19 | WhatsApp delivery stays OFF | NE | Not stated |

Total: 0 rows with explicit per-row evidence, 6 rows (1-4, 8, 9) covered only by an owner category summary, 13 rows with no
explicit evidence. Row 14 and 15 partly relate to agent-seen facts (`/showroom` 307) but are not satisfied by them. The agent
facts (health, `/`, sign-in and legal 200, bindings) support the deployment and smoke prerequisites, not any L2 row.

### Rows still lacking explicit evidence: what to capture (never passwords)

| Rows | Capture |
|---|---|
| 5 | Screenshot of the generic invalid-credentials message on `/auth/sign-in` for O, M, R |
| 6 | Screenshot of the email-code step; note "reset not completed" |
| 7 | Screenshot after pressing Back post sign-out (per account) |
| 10 | Screenshot of "You're not allowed to manage members here." for M and R, no invite form |
| 11, 12, 13 | Screenshot of the open Branch filter for O, M and R (options listed) |
| 14 | DevTools Network (Preserve log) lines showing 308 to `/auth/sign-in` for the retired routes, signed out |
| 15 | Screenshot of the URL bar after `/showroom` and `/showroom/home`, signed out (landing on a sign-in page) |
| 16 | Per Admin URL for O: loads, no error or console error; Backups page included; activate/run not pressed |
| 17 | Per account M, R: screenshot of redirect, 404 or access-denied; no Backups nav entry |
| 18 | Acceptance Supabase Auth user count and newest `created_at`, before and after the session |
| 19 | Note "no WhatsApp message arrived"; screenshot of the Admin WhatsApp OTP page showing delivery off |
| Also | Backend `env:staging` health JSON (`/api/backend/health`), read-only |

For rows 1-4, 8 and 9 an itemised owner note (accounts, methods, routes) would upgrade the summary to explicit evidence.

## 3. Automation coverage gaps and the release-gate exception

Real CAPTCHA is ON, but the hosted spec stubs Turnstile with a dummy token (`TURNSTILE_STUB`), which Supabase Auth refuses.
So the L1 persona blocks fail at sign-in: 3 persona describes (workspace routes, People, branch scope) and the owner drift block.

| Can the hosted E2E still prove it? | Detail |
|---|---|
| Yes: "public smoke" (no sign-in, through Access with the service token) | `/api/health` 200; `/api/backend/health` = `{status:"ok", service:"backend", env:"staging"}`; `/`, `/auth/sign-in`, `/legal/terms` 200; `/installer/sign-in` is a 308 to same-origin `/auth/sign-in`; `/showroom` signed out lands on a `sign-in` path; no request to a Production host |
| No: every persona sign-in, route render, People refusal, and branch scope check | Covered instead by L2 rows 1-13 (manual, real CAPTCHA) |

The workflow runs the whole spec, so a dispatch ends red even if the smoke test passes. Read the report: smoke green plus
persona sign-in failures with a CAPTCHA/auth message is the expected result under this decision, not an Access problem.

**Proposed release-gate exception (wording; no workflow is changed by this PR):**

> L1 automated persona run is waived for the release candidate `<SHA>` because real CAPTCHA remains ON on hosted Acceptance; it is
> replaced by the manual L1/L2 table (section 2) on the deployed RC build, and the public smoke test must still pass.

Basis today: the owner-reported category summary (section 2a, all five categories PASS, no per-row evidence). Before signing,
either supply explicit evidence for every row marked NE in section 2a, or record an explicit owner waiver per row. A category
summary alone does not satisfy rows 5-7, 10-19.

Signed by the repository owner (`hmohamed080`) in the run note, with the SHA, date and the smoke run id. A second reviewer
is optional.

Future improvement (not implemented): a `workflow_dispatch` input such as `grep` passed as `playwright test --grep "public smoke"`,
so the smoke can be run alone and end green. Another option (decide separately): a spec change that uses the real widget with an always-pass test key
(PR #155, ON HOLD: it would need test keys on Acceptance, which contradicts the current decision).

## 4. Failure triage

| Symptom | Likely cause | What to do |
|---|---|---|
| First step: "... is missing from the acceptance-e2e Environment" | A secret is absent | `gh secret list --env acceptance-e2e --repo hmohamed080/aladdin` (names only); set the missing one |
| HTTP **302** to a `cloudflareaccess.com` login | Token not in a Service Auth policy for this application, wrong application, or dispatched from a ref without #147 | Dispatch from `main`; re-check the policy per ACCEPTANCE_E2E_ACCESS_TOKEN.md. The run does not follow the redirect |
| **401 / 403** | Wrong or expired token, ID and secret swapped, or a Block rule ahead of the policy | Check expiry in Service Tokens; check policy order; rotate per the token doc |
| 200 but `env` is not `staging` | Preview bound to the wrong backend | Stop. Do not run L2. Investigate the deploy |
| Persona fails at sign-in with a CAPTCHA/auth message | Expected: stub token vs real CAPTCHA (section 3) | Not a defect. Use L2. Do not switch CAPTCHA off |
| Persona lands on `/onboarding`, `/auth` or `/installer` | Test account not fully provisioned | Fix the account data, not the test |
| Request to a Production host (`kkpkgjrweysgvhvkhzun`, `aladdindecore.com`) | Preview points at Production | Stop; deploy configuration incident |
| "Application error" / `Digest:` | Real defect or missing runtime secret on the Worker | Capture the path, check Worker logs; stop L2 |

**CF_Authorization cookie assumption.** The token is attached to the first request only; later hops (for example `/b2b` to
`/showroom/home`) rely on the `CF_Authorization` cookie that Access issues for a valid service token. This is proven only with
local simulated servers (`frontend/e2e-access-routing/access-routing.spec.ts`) and will be confirmed (or not) only by the first
hosted run that reaches a later navigation. If the smoke test shows an Access 302 on its `/showroom` navigation (not on the
first request), suspect this assumption (cookie not issued, scoped differently, or session too short) instead of the token,
and fix it in a follow-up PR; do not widen where the token is sent.

## 5. Not done by this document

No token created, no secrets set, no Access policy or CAPTCHA change, no merge, no deploy, no workflow dispatch, no WhatsApp activation.
