# Aladdin WhatsApp OTP transport — PREVIEW ONLY

**Not deployed. No real message sent by this branch. No Supabase Hook is enabled.** The existing Phone + Password login remains unchanged.

## Target architecture
Website / future mobile apps → Supabase Auth Phone OTP → signed HTTPS Send SMS Hook → isolated Cloudflare Worker → Meta WhatsApp Cloud API.

This Worker is a transport, not a credential authority. Only Supabase can issue/verify OTP and manage sessions. Current installer/showroom accounts use Phone + Password through a **synthetic email alias**, with Supabase phone provider OFF. Simply enabling Send SMS Hook does NOT integrate those users; account-migration design and tests are required.

## Runtime settings
Never commit secrets, paste them into a chat, or put them in NEXT_PUBLIC variables.
- Cloudflare **Secrets Store**: owner-created `WHATSAPP_ACCESS_TOKEN` (Meta System User token) lives in account store `default_secrets_store`; Wrangler declares an isolated `secrets_store_secrets` binding named `WHATSAPP_ACCESS_TOKEN` and code retrieves it with `await env.WHATSAPP_ACCESS_TOKEN.get()` only after a signed, enabled request. The value is never committed or read into the frontend.
- Cloudflare account-level Secrets Store secret: `SUPABASE_SEND_SMS_HOOK_SECRET` (Standard Webhooks `v1,whsec_...`). The owner created it and Cloudflare confirms it active. The Worker reads via `await env.SUPABASE_SEND_SMS_HOOK_SECRET.get()`. The matching secret is **not yet configured in Supabase Auth Hook**, which remains disabled.
- Preview-only secret `OTP_ALLOWED_RECIPIENTS`: comma-separated owned/test E.164 Egyptian mobile numbers, example `+2010XXXXXXXX` (no personal numbers in source control); if empty, all sends are denied.
- **D1 binding** `IDEMPOTENCY_DB`: an isolated Acceptance D1 database with migration `migrations/0001_hook_events.sql`. The dedicated Acceptance database exists and the migration's DDL was applied and inspected. No OTP or telephone value is written to this table. Local Worker/D1 integration passed. A bounded seven-day cleanup helper now exists in source but has **no scheduled trigger**; hosted Worker/D1 integration, cron configuration, retention approval and monitoring remain required.
- Non-secret preview vars: `WHATSAPP_PHONE_NUMBER_ID=1415528588305492` (owner-supplied Meta sender Phone Number ID; verify against Meta before live rollout), `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_OTP_LANGUAGE=ar`, `WHATSAPP_GRAPH_API_VERSION=v25.0`, `WHATSAPP_DELIVERY_ENABLED=false`.
- **Phone-change safety:** official Supabase docs mention `new_phone` in phone-change hooks. The exact intended destination is not yet verified in hosted Acceptance. The Worker rejects payloads with `new_phone` (top-level, `user` or `sms`) with HTTP 422, rather than risking sending an OTP to the previous `user.phone`. **Authenticated `phone_change` is NOT supported yet.** See `docs/operations/WHATSAPP_OTP_IDENTITY_PILOT.md`.
- Endpoint: `POST /hooks/supabase/send-sms`, Standard Webhooks signature + timestamp required. It accepts only verified `{user:{phone:"+2010..."},sms:{otp:"6 digits"}}`.
- Sends the approved Arabic Authentication/Copy Code template, with the code in the body and button parameter. Meta acceptance is **not** device delivery.

## Preview deployment preflight (NOT an authorization to deploy)
- Run `node scripts/check-preview-config.mjs` and `npx wrangler deploy --dry-run`; the preview guard refuses Production routes, mismatched D1 or an enabled delivery flag.
- `SUPABASE_SEND_SMS_HOOK_SECRET` is already present in Cloudflare account-level Secrets Store, and kept in the operator's Password Manager. Never paste its value in chat, Git, or frontend. It still needs separate configuration in Supabase Acceptance when Hook activation is approved.
- `OTP_ALLOWED_RECIPIENTS` is empty/missing and all sends are denied, even if someone toggles delivery.
- A Preview Worker deployment needs explicit owner approval and a runtime health/test plan; successful bundling is **not** a live integration test.

## Blocking prerequisites before enabling delivery
1. Confirm ownership and unique linking of canonical phone to existing Supabase email-alias identities. No duplicate account, takeover or implicit phone-only signup.
2. **Code and dedicated database prepared, Worker not deployed:** atomically reserve SHA-256(`webhook-id`) in isolated D1 *before* calling Meta. A duplicate accepted event returns success without resending; other duplicates fail closed. Network uncertainty is **not** retried automatically, so a user must request a fresh code. The migration is applied in Acceptance; run full Worker-to-D1 runtime/concurrency tests before activation. A bounded seven-day expiry helper (`purgeExpiredReplayClaims`, max 250 rows per invocation) and local D1 test are present, but **no cron/scheduled handler is configured** and no hosted records will be purged automatically. Review retry horizon and enable a monitored cleanup separately before live OTP.
3. Validate Supabase Auth CAPTCHA coverage, phone/IP rate limits, resend cooldown, OTP expiration (match 5-minute message), and brute-force attempt caps.
4. Owner created minimally scoped Meta System User token in Cloudflare Secrets Store (active); Worker binding is configured in source only and not yet deployed. Test with acceptance-only owned numbers when allowed.
5. CI workflow `WhatsApp OTP Transport CI` runs typecheck and mocked security tests; additionally require real D1/Worker integration testing, Wrangler dry-run, then Preview deployment **only after explicit approval**. Never enable Production hooks on this branch.
6. Create a separate Meta message-status webhook if handset delivery auditing is required. No automatic retries of failed Meta requests.

## Identity compatibility (proposal only)
- Acceptance read-only user inventory shows 6 Auth users, 0 installer/showroom synthetic-email-alias users and 0 GoTrue phone identities. No existing-user linking test can be claimed on this dataset.
- See `docs/operations/WHATSAPP_OTP_IDENTITY_PILOT.md` for the proposed authenticated `phone_change` pilot, safety gates and tests. Generic anonymous `signInWithOtp({phone})` remains disallowed until explicitly designed and approved.

## Completed isolated runtime integration
- `npm run test:integration` runs Miniflare D1 SQL (actual Cloudflare local workerd D1 engine, **not hosted D1**) against the signed handler and verifies concurrency, accepted replay, and failed provider no-retry behavior using a mocked provider. No external network sends.
- The local D1 integration test also checks bounded seven-day replay expiry: old hash removed, fresh hash preserved; no hosted purge configured.
- A separate Miniflare test loads Wrangler's **built JS bundle** and sends real local HTTP requests with `WHATSAPP_DELIVERY_ENABLED=false`. Verifies GET `404`, unsupported content `415`, unsigned JSON `401`, signed dummy OTP `503` and **zero D1 writes**.
- `npm run test:unit` covers mock security/failure logic and negative preview-config checks. GitHub OTP CI executes these as separate steps after a Wrangler dry-run.
- The local bundled Worker test fails closed when async Secrets Store binding is absent. Miniflare plain bindings cannot impersonate that async secret: test the actual `get()` in hosted Preview after approved deployment.
- Pinned stable Miniflare's local workerd supports only compatibility date `2026-08-06`; the **test-only HTTP runtime** uses that date, while the real Worker config remains `2026-10-01`. A hosted smoke test on the target date is still required.

**Verification status (2026-10-28):** dedicated OTP CI PASS (including Wrangler dry-run, typecheck and mocked security tests); general CI and RLS PASS. The dedicated remote D1 passed sequential and parallel replay duplicate-insert tests with fake hashes, and all test rows were deleted. The `aladdin-whatsapp-otp-preview` Worker is **not deployed**, Secrets Store runtime access is untested, and no Supabase Hook or real Auth integration has been activated. See `docs/operations/WHATSAPP_OTP_IMPLEMENTATION_LOG.md`.
