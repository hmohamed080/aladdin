# WhatsApp OTP: Worker integration, Acceptance pilot, Production readiness

**Status:** Draft. Nothing merged, deployed, migrated, activated or sent. No hosted resource was touched; no Meta call was made.

## 1. What is integrated (this branch = #126 + #114 + the adaptation)
R1/R2 stays the **only** authority (generates, MACs, verifies; single-use grant; Auth user created with the grant). The Worker is **delivery only**.

| | #114 as it was | now |
|---|---|---|
| Route | `POST /hooks/supabase/send-sms` (Supabase Send-SMS hook) | `POST /v1/otp/send` (R2's signed request) + signed `POST /v1/preflight`. **The hook route is removed**: Supabase Phone Auth / Send SMS Hook are never needed or activated |
| Signing secret | Supabase hook secret | new dedicated `OTP_SIGNING_SECRET` (Secrets Store secret `PHONE_OTP_WORKER_SECRET`); the app holds the same value as `PHONE_OTP_WORKER_SECRET`. The Meta token (`WHATSAPP_ACCESS_TOKEN`) stays only on the Worker |
| Idempotency | `webhook-id` chosen by the sender (R2's transport used a fresh random id per send, so a repeat of one challenge's delivery could have sent twice) | request id **must equal `otp_<delivery_id>`** (the challenge id); the D1 claim is keyed on its hash; one challenge delivers at most once; a failed or ambiguous attempt is never retried (a resend is a new challenge, decided by the authority's cooldowns) |
| Policy | allowlist, Egypt-only, Arabic-only | allowlist **mandatory**; `open` mode works only when `OTP_ENVIRONMENT=production`; a locale without an approved template language falls back to Arabic; delivery off by default; the token is not even read before every gate passes |
| Logs | - | nothing logs a code, number, header, body or secret (tested) |
| App | `WORKER_WIRED=false` | `PHONE_OTP_DELIVERY=worker` works but throws unless `PHONE_OTP_WORKER_URL` **and** `PHONE_OTP_WORKER_SECRET` are set (never silently off); still default `off` |

**Evidence (local):** Worker 37/37 (unit, real-SQL Miniflare D1 concurrency, config guard, preflight); dry-run bundle builds; app 5/5 **contract tests that run the app's real signer against the Worker's real verifier** (accepted; one Meta call per challenge even if attempted twice; every refusal surfaces as a generic failure; a wrong secret is refused; the signup service passes the challenge id as the delivery identity); app phone-verification unit tests pass. Wrong, expired, replayed and duplicate **codes**, cooldowns, concurrency and existing numbers are the authority's behaviour, already covered by the R1 matrix and E2E in #126 (green on GitHub).
**Not yet done:** a browser E2E through the Worker with a fake Meta (the app-to-Worker-to-Meta-payload path is covered by the contract test, not by Playwright); a GitHub run of this branch (push triggers #114's Worker CI).

## 2. Sender and template verification (needs the Meta token; read-only)
`edge/whatsapp-otp-worker/scripts/meta-preflight.mjs` (two GETs; prints booleans and the last 4 digits only) checks: sender `CONNECTED`, **`account_mode LIVE` (not a sandbox/test number)**, code verified, name approved, quality not RED; template `aladdin_otp` exists in `ar`, is `APPROVED`, category `AUTHENTICATION`, with a body and an OTP (copy-code) button, which is the shape the Worker's payload fills (body parameter plus button `sub_type:"url"`, `index:"0"`). `WHATSAPP_PHONE_NUMBER_ID=1415528588305492` in the repository's preview config is **unverified**: it may be a test number. Run it in your own shell: `WHATSAPP_ACCESS_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... WHATSAPP_BUSINESS_ACCOUNT_ID=... node edge/whatsapp-otp-worker/scripts/meta-preflight.mjs`.

## 3. Acceptance pilot steps (each needs your explicit approval; none executed)
1. Meta preflight passes (section 2).
2. Create the new Secrets Store secret `PHONE_OTP_WORKER_SECRET` (a fresh `whsec_...` value); put the same value in the Acceptance app's `PHONE_OTP_WORKER_SECRET`.
3. Deploy the Worker with `WHATSAPP_DELIVERY_ENABLED="false"`; set `OTP_ALLOWED_RECIPIENTS` to your authorised test number **in the Worker dashboard** (never in the repository). Run the signed preflight and expect `meta_token_bound:true`, `d1_reachable:true`, `allowlist_entries:1`, `delivery_enabled:false`.
4. Apply the dormant migrations `20261030090001/2` to Acceptance after the read-only exact-history check. Set the Acceptance app env: `PHONE_OTP_DELIVERY=worker`, `PHONE_OTP_WORKER_URL`, `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, the keyring and `PHONE_SIGNUP_COOKIE_SECRET`. Database: `alias_guard_mode='observe'`, then `enabled` and `signup_enabled` true.
5. Set `WHATSAPP_DELIVERY_ENABLED="true"` on the Acceptance Worker (the **only** switch that lets a message leave).
6. Sign up with your number. **Success = the code arrives on the handset and entering it creates the account with `phone_verified_at` set.** Meta "accepted" alone is not success.
**Rollback:** `WHATSAPP_DELIVERY_ENABLED="false"` (instant, on the Worker); app `PHONE_OTP_DELIVERY=off`; database `update app.phone_verification_config set signup_enabled=false, alias_guard_mode='off'`.

## 4. Exactly what blocks
**The first real Acceptance message:** (a) your approvals for steps 2-5; (b) the Meta preflight result (is `1415528588305492` a live sender; is `aladdin_otp` approved in `ar` with the OTP button); (c) the new Secrets Store secret; (d) the Acceptance migration history confirmed read-only (needs the token holder); (e) this branch's CI green on GitHub.
**Production:** everything in R2's release plan (exact hosted history, Acceptance rehearsal, a planned window, the rule that the guard is enforced only when no grant-less build can serve traffic) **plus** a production Worker (own D1, own secrets, `OTP_ENVIRONMENT=production`, `OTP_RECIPIENT_MODE=open`, preferably reached by a Cloudflare service binding rather than a public URL), the production sender and template verified, and a delivery-reliability observation window.

## 5. Merge-order risk (analysis only, NOT yet simulated)
If the R1 stack (#119-#125) merges before #113/#116, the latest permission contract (R1's, reconciled only inside #126) lacks six functions that #113/#116 add, so `supabase-rls` would fail on the second block until the contracts are reconciled in that PR. Also R1's `20261030` migrations would exist before `20261028/29` are applied on a project that lacks them, which is out of order for `supabase db push` and must not be "repaired" around. The safer plan is atomic: merge #126 (which already contains the reconciliation) as the single integration, or reconcile the contracts inside #113's PR before it merges. A real stage-by-stage simulation on GitHub (one branch per stage, `supabase-rls` dispatched on each) is the remaining proof and has **not** been done.

## 6. Next owner approval needed
(1) Permission to run the Meta preflight with your token in your own shell and report the result; (2) approval to create the Acceptance signing secret and deploy the Worker **with delivery disabled**; (3) then the separate approval, in your words, for the single controlled real message to your test number.
