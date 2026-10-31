# #113 E2E failures: root causes, and the CI plan for the stacked PRs

Evidence: GitHub Actions run logs for the head of #113 (`58b63e7e`), workflow runs `40882460563` (Auth CAPTCHA E2E) and `40882460423` (Showroom RC2 E2E). I did **not** reproduce these locally (they need a Next.js build, Playwright and Turnstile test keys); the causes below are read from the failing runs' error text and ARIA snapshots.

> **CORRECTION (R1, after reading #113's source):** there is ONE root cause, not two. PR #122's first draft said the Auth CAPTCHA spec "never completes the basics step". It does: `expectAppLanding` calls `reachLanding`, which calls `completeAccountBasics()`. What fails is that helper's **specialty step**: #113's commit `58b63e7e` ("Complete your account: specialties from a dropdown", 2026-10-29) replaced the chip buttons with `<select id="specialtyAdd">`, while the helper still clicks `[aria-labelledby="basics-specialties"][role="group"] button`. Nothing is picked, the form answers "Pick at least one specialty", the page stays on `/onboarding/basics`, and every caller times out. The auth spec's message ("the page is at /onboarding/basics") and the Showroom suite's `waitForURL` timeout are the same failure seen from two callers. The fix is one block in `frontend/e2e/helpers/auth.ts`; it is prepared and run in `docs/security/PHONE_SIGNUP_R1_REPORT.md` §7 and delivered as a separate Draft PR against #113's branch, leaving #113 itself untouched.

## 1. Root causes (original analysis; read the correction above)

Both jobs fail for the **same underlying reason: the E2E harness was not updated for the new "Complete your account" step that #113 inserts after registration.** The product behaves as designed (it requires a specialty); the tests do not satisfy it.

| Workflow | Failures | Root cause | Evidence |
|---|---|---|---|
| **Auth CAPTCHA E2E** (`auth-password-preview.spec.ts`) | 18 failed / 16 passed (30 error lines incl. retries); every failure has the same message | After OTP verification the app now lands on `/onboarding/basics`. `expectAppLanding` still expects `/home`, and the spec never completes the basics step. | `Expected the app landing (/home) after OTP verification but the page is at /onboarding/basics. Visible alerts: ["اختر تخصصًا واحدًا على الأقل.","أكمل حسابك"]` |
| **Showroom RC2 E2E** (`orders-projects`, `profile-completion`, …) | 49 failed (39 in the main pass + 10 in the second pass; the log shows both summaries), 1 skipped | `completeAccountBasics()` in `e2e/helpers/auth.ts` fills phone and governorate but selects a specialty by clicking `[aria-labelledby="basics-specialties"][role="group"] button`. The current UI renders a specialty **combobox** ("Add a specialty"), so nothing is clicked, the page stays on basics with `Pick at least one specialty.`, and `page.waitForURL(landing)` times out after 20 s. | ARIA snapshot at failure: heading "Complete your account", button "Add a specialty", `alert: Pick at least one specialty.`; stack `helpers/auth.ts:168` |

Why it appeared now: the specialty UI changed in #113's own recent commits (`ec035c76` "Onboarding for every account: phone, governorate and town, specialties", then `700146f0` "Account basics review: … persona-matched specialties"), and `e2e/helpers/auth.ts` was last touched before the combobox landed.

### Outcome (R1): root cause confirmed, fixed independently by #113, both workflows reproduced green locally
See `PHONE_SIGNUP_R1_REPORT.md` §7: the fix described below was prepared and verified on `58b63e7e`; #113's own later commits landed an equivalent change (`select#specialtyAdd`); on #113's current head `03f59733` the Showroom workflow passes (38 + 11) and the CAPTCHA workflow passes (33, 1 flaky on retry). The remaining Windows-only helper bug is PR #124.

### Minimal fix (as originally proposed in PR #122; superseded by #113's own commit)
1. Update `completeAccountBasics()` to open the specialty combobox and choose the first option (role-based locators, not the old chip selector).
2. In `auth-password-preview.spec.ts` complete the basics step (reuse the helper) before asserting the landing, or assert `/onboarding/basics` as the new post-OTP destination.
3. Re-run both workflows; they must be green before #113 merges.

Not caused by phone verification or by B1 (neither is in #113's tree); `supabase-rls`, `migration-policy` and the permission gate are green on #113.

## 2. Why #121, #116, #120 have no checks, and how to run them

The workflows trigger on `pull_request` **to `main`** only. #116 targets the #113 branch, #120 targets #119's branch, #121 targets #120's branch, so GitHub starts nothing for them. Every relevant workflow has `workflow_dispatch` ("Manual runs on stacked release branches").

| Order | Branch | Dispatch | Required to be green |
|---|---|---|---|
| 1 | #113 `claude/project-thread-1bi6x0` | already runs; fix the two E2E jobs, re-run | `ci` (backend, docs, frontend, frontend-cloudflare, migration-policy), `supabase-rls`, `auth-captcha-e2e`, `showroom-rc2-e2e`, `gotrue-direct` |
| 2 | #116 `claude/registration-resume` | `gh workflow run ci.yml --ref claude/registration-resume` and the same for `supabase-rls.yml`, `auth-captcha-e2e.yml`, `showroom-rc2-e2e.yml` | the same set |
| 3 | #119/#120 | after #119 is retargeted/merged, or `gh workflow run supabase-rls.yml --ref test/phone-identity-a2-local-20261029` | `supabase-rls`, `migration-policy` |
| 4 | #121 | `gh workflow run ci.yml --ref feat/phone-verification-b1-20261029` and `supabase-rls.yml` | `supabase-rls` incl. **Verify exact RC2 upgrade**, **Verify fresh effective function permissions**, the pgTAP run with the new `119_*` file, the repeatability reset; `frontend` (typecheck/lint/unit) |
| 5 | this branch | `gh workflow run supabase-rls.yml --ref test/phone-signup-security-20261029` is **not useful** (the security suite is local-only by design and is not wired into CI); wire it only with the implementation PR | – |

Notes
* A dispatched run uses the branch's own workflow file; for #121/#120 that file is identical to `main`'s.
* The permission-contract step compares against `supabase/permissions/<latest migration>.json`. After #113 + #116 + #121 are combined, regenerate that file once on the merged tree (`node supabase/tests/b1/permission_contract.mjs <container> generate`) and review the diff: it must add only B1's 7 functions plus #113's `account_basics_set`, `my_account_basics` and #116's `app.lock_username`, `app.username_lease_interval`, `app.username_leased_by_other`.
* Do **not** treat a dispatched run on a stacked branch as a substitute for the PR-to-`main` run: re-run on the final merge candidate.
* No workflow listed deploys anything; the Cloudflare/hosted-acceptance workflows are deliberately excluded from this plan.
