# Aladdin WhatsApp OTP transport — PREVIEW ONLY

**Not deployed. No real message sent by this branch. No Supabase Hook is enabled.** The existing Phone + Password login remains unchanged.

## Target architecture
Website / future mobile apps → Supabase Auth Phone OTP → signed HTTPS Send SMS Hook → isolated Cloudflare Worker → Meta WhatsApp Cloud API.

This Worker is a transport, not a credential authority. Only Supabase can issue/verify OTP and manage sessions. Current installer/showroom accounts use Phone + Password through a **synthetic email alias**, with Supabase phone provider OFF. Simply enabling Send SMS Hook does NOT integrate those users; account-migration design and tests are required.

## Runtime settings
Never commit secrets, paste them into a chat, or put them in NEXT_PUBLIC variables.
- Cloudflare **Secrets Store**: owner-created `WHATSAPP_ACCESS_TOKEN` (Meta System User token) lives in account store `default_secrets_store`; Wrangler declares an isolated `secrets_store_secrets` binding named `WHATSAPP_ACCESS_TOKEN` and code retrieves it with `await env.WHATSAPP_ACCESS_TOKEN.get()` only after a signed, enabled request. The value is never committed or read into the frontend.
- Per-Worker runtime secret: `SUPABASE_SEND_SMS_HOOK_SECRET` (Standard Webhooks secret, `v1,whsec_...`; **not created or installed yet**).
- Preview-only secret `OTP_ALLOWED_RECIPIENTS`: comma-separated owned/test E.164 Egyptian mobile numbers, example `+2010XXXXXXXX` (no personal numbers in source control); if empty, all sends are denied.
- **D1 binding** `IDEMPOTENCY_DB`: an isolated Acceptance D1 database with migration `migrations/0001_hook_events.sql`. Its database does not exist yet, therefore **do not enable delivery or deploy** without provisioning, binding and applying this migration. No OTP or telephone value is written to this table.
- Non-secret preview vars: `WHATSAPP_PHONE_NUMBER_ID=1415528588305492` (owner-supplied Meta sender Phone Number ID; verify against Meta before live rollout), `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_OTP_LANGUAGE=ar`, `WHATSAPP_GRAPH_API_VERSION=v25.0`, `WHATSAPP_DELIVERY_ENABLED=false`.
- Endpoint: `POST /hooks/supabase/send-sms`, Standard Webhooks signature + timestamp required. It accepts only verified `{user:{phone:"+2010..."},sms:{otp:"6 digits"}}`.
- Sends the approved Arabic Authentication/Copy Code template, with the code in the body and button parameter. Meta acceptance is **not** device delivery.

## Blocking prerequisites before enabling delivery
1. Confirm ownership and unique linking of canonical phone to existing Supabase email-alias identities. No duplicate account, takeover or implicit phone-only signup.
2. **Code implemented, infrastructure still pending:** atomically reserve SHA-256(`webhook-id`) in isolated D1 *before* calling Meta. A duplicate accepted event returns success without resending; other duplicates fail closed. Network uncertainty is **not** retried automatically, so a user must request a fresh code. Apply the migration and run real D1 integration/concurrency tests before activation. Enforce a reviewed TTL cleanup (at least longer than maximum webhook retry window).
3. Validate Supabase Auth CAPTCHA coverage, phone/IP rate limits, resend cooldown, OTP expiration (match 5-minute message), and brute-force attempt caps.
4. Owner created minimally scoped Meta System User token in Cloudflare Secrets Store (active); Worker binding is configured in source only and not yet deployed. Test with acceptance-only owned numbers when allowed.
5. CI workflow `WhatsApp OTP Transport CI` runs typecheck and mocked security tests; additionally require real D1/Worker integration testing, Wrangler dry-run, then Preview deployment **only after explicit approval**. Never enable Production hooks on this branch.
6. Create a separate Meta message-status webhook if handset delivery auditing is required. No automatic retries of failed Meta requests.

**Verification status:** the initial local prototype passed 7 mocks and typecheck before Secrets Store integration. The current branch includes more tests (D1 atomic replay, failure paths, allowlist) and dedicated GitHub CI; record its actual result before claiming PASS. Real D1 binding/remote deployment tests and Wrangler dry-run remain pending. This transport has not been sent to Meta live.
