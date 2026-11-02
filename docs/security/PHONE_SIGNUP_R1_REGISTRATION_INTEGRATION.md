# Required changes in the registration PRs (#113, #116, #114, #121)

**Nothing in #113, #116 or #114 was changed by R1.** This is the exact list of what each must change so that the R1 authority and guard can be switched on safely. Line references are to #113 head `58b63e7e` and #116 head `83c16967` as fetched on 2026-10-29.

## Ground rules the integration must keep
1. The Auth user for a phone sign-up is created **only** with a grant: `signupCreateUserPayload(grant, …)` (exported from `server/phone-verification/signup-service.ts`) puts `phone_signup_grant` and `phone_signup_registration` in **`app_metadata`**. Never in `user_metadata` (a caller can set that).
2. Verification is recorded **only** by `phone_signup_attach` after the initialisation RPCs ran (the profile must already hold the number).
3. A taken number must look exactly like a free one to the browser: same screen, same timing, no message sent. The service guarantees the timing by sending **after** the reply: call `getPhoneSignupService()` from the server action itself (it wires Next `after()`, which maps to `waitUntil` on Workers) and do not `await` anything delivery-related around it. A delivery failure is not visible in the reply; the person simply never receives a code and uses Resend. The authority does this (`deliver:false`); the form must not add a separate "number already registered" answer **before** the code step.
4. No log line may carry a code or a number; the delivery switch is `PHONE_OTP_DELIVERY` (default off), never `NEXT_PUBLIC_APP_ENV`.
5. Email + password (Supabase Email OTP via Resend SMTP), email sign-in, recovery, interrupted-registration continuation, Google, Facebook (incl. no/unverified e-mail), legacy phone/password sign-in and identity linking are **not touched**; WhatsApp proof is **not** required for e-mail or OAuth registration.

## PR #113 — new registration + WhatsApp OTP
| Where | Change |
|---|---|
| `supabase/migrations/20261028090001_sign_up_birthday_and_phone_codes.sql` (unmerged, so editable) | Keep `users.birth_date`. **Remove** `public.phone_verification_challenges` (the app-owned second authority). Update `supabase/tests/116_sign_up_birthday_phone_codes_test.sql` accordingly. |
| `frontend/src/lib/supabase/admin-server.ts` | Delete `countRecentPhoneChallenges / insertPhoneChallenge / deletePhoneChallenge / loadPhoneChallenge / recordPhoneChallengeAttempt / consumePhoneChallenge`. `createPhoneSignUpUser` takes the grant and uses `signupCreateUserPayload` (keep `registration_source: "phone_whatsapp_sign_up"` and the password-set flag in `appMetadata`). |
| `frontend/src/server/auth/phone-sign-up.ts` | Replace `issueCode / codeHash / insertPhoneChallenge / sendWhatsAppCode` by `getPhoneSignupService().start(registrationId, phone.e164, ip, locale)`; the sealed cookie holds a random **`registrationId`** and the latest `challengeId` (it already holds `cid`). `verifyPhoneSignUp` becomes: `service.verify(registrationId, cid, token, ip)` → on `verified`: `createPhoneSignUpUser(grant…)` → sign in → `initializeAccount` → **`service.attach(userId, grant.id)`**; `attach` ≠ `attached` is treated as an initialisation failure (existing rollback deletes the new user). Remove the pre-check `isCanonicalPhoneTaken → phoneExists` from the request step (see owner decision below). |
| `frontend/src/server/auth/whatsapp-otp.ts` and its test | **Delete.** It logs `[local only] WhatsApp sign-up code for ${e164}: ${code}` and is gated by `NEXT_PUBLIC_APP_ENV`; it also calls Meta directly from the Next server. Delivery goes through the transport (`PHONE_OTP_DELIVERY`). |
| `frontend/e2e/helpers/phone-sign-up.ts` | Stop overwriting `code_hash` in the database. Read the code from the local outbox (`latestOutboxCode(PHONE_OTP_OUTBOX_DIR, e164, "signup_proof")`) – the same way a person would read the message. Set `PHONE_VERIFICATION_ENABLED=true`, `PHONE_SIGNUP_VERIFICATION_ENABLED=true`, `PHONE_OTP_DELIVERY=outbox`, `PHONE_OTP_HMAC_KEYS=<test keyring>` and the DB switches for the E2E stack. |
| `frontend/wrangler.jsonc`, `frontend/.env.example`, `lib/env/index.ts` | Remove `WHATSAPP_OTP_TEMPLATE` and the `WHATSAPP_*` readers from the web app (the Meta token must live only in the Worker's secret store). Add the five `PHONE_*` variables from `lib/env/phone-verification.ts` to `.env.example`. |
| Retire the no-grant creators | `createCraftsmanPasswordUser` / `createShowroomPasswordUser` and every route that still reaches them must be gone (the `/installer/*` and `/showroom/*` sign-up pages are already redirects in #113). **`alias_guard_mode = 'enforce'` refuses them** (SEC-C5). |
| Sealed cookie | Out of R1's scope but flagged: it keeps the password (AES-GCM) and derives its key from `AUTH_PASSWORD_PREVIEW_GRANT_SECRET`, the same secret that keys the code HMAC today. After R1 the HMAC is the keyring's; give the cookie its own key. |
| `frontend/e2e/helpers/auth.ts` | The specialty-step fix (separate Draft PR, see the report §7). |
| `supabase/permissions/` | Regenerate once on the merged tree (`node supabase/tests/b1/permission_contract.mjs <container> generate`). |

**Owner decision (UX vs enumeration):** the authority returns the same reply for a taken number so the form cannot reveal whether a number is registered. #113 today answers `phoneExists` at the first step. Removing it means a person whose number is already registered receives no code and no explanation; the usual mitigation is a neutral screen ("if this number is not registered you will receive a code; otherwise sign in") plus the sign-in link. Keeping `phoneExists` keeps a phone-number existence oracle (behind Turnstile and the durable limiter, but still an oracle). The authority supports either; the form must choose.

## PR #116 — interrupted-registration continuation
* No file overlaps with R1 (checked with `git merge-tree`: clean against R1).
* Retarget to `main` after #113; regenerate its permission contract on the merged tree.
* Optional: the phone path could take #116's 30-minute username lease (today a code can be spent and the sign-up then fail on "username taken"). Not required for R1.
* Email-registration continuation is untouched: e-mail accounts never pass through the alias guard (trigger `WHEN` clause, pgTAP 120 A7, SEC-X1…X5).

## PR #114 — Cloudflare WhatsApp transport (stays disabled)
| Change | Why |
|---|---|
| Add an application route (e.g. `POST /v1/otp/send`) accepting the signed body that `createWorkerTransport` sends: `{to, code, purpose, locale, ttl_seconds}` with `webhook-id / webhook-timestamp / webhook-signature` | Today the Worker only serves the Supabase Send-SMS-hook route. R1's transport and the Worker already agree on the signing format (`id.timestamp.body`, HMAC-SHA256, `v1,base64`), covered by `delivery.test.ts`. |
| Take the language from the request instead of the hard-coded `ar`; make the country allow-list configuration, not an Egyptian-mobile regex | `signup_proof` serves English and Arabic users. |
| Keep `WHATSAPP_DELIVERY_ENABLED = "false"`, the mandatory recipient allow-list and D1 replay claims | Two independent switches (app `PHONE_OTP_DELIVERY=worker` **and** Worker flag) must be on before anything is sent. |
| Renumber its ADR (a second "ADR-0025" exists in #113) and resolve the `RUNTIME_STATE.md` conflict | Documentation hygiene found in the reconciliation review. |
| Unify the template name (`aladdin_otp` vs #113's `aladdin_login_code`) | One Meta template per purpose, chosen by the Worker. |

R1 does **not** wire `worker` mode (`WORKER_WIRED = false`): even with every flag on, the app has no path to send a real message.

## PR #121 — B1 (the base of this stack)
* R1's migration `20261030090002` extends B1's objects and `CREATE OR REPLACE`s `phone_verification_purge`; B1's `20261030090001` is unchanged.
* B1's tests `104` and `119` each have one allow-list assertion for the writers of `profiles.phone_*` / `phone_verified_at`; R1 adds `public.phone_signup_attach` to both with a stated reason.
* Merge order: #113 (fixed) → #116 → #119 → #120 → #114 (reconciled) → #121 → this PR → the #113 integration above. Regenerate `supabase/permissions/*.json` once at the end; R1's file (`20261030090002.json`) is generated against a clean replay on the CI toolchain and adds exactly the 7 new functions.
