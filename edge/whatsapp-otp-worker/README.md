# Aladdin WhatsApp OTP transport — PREVIEW ONLY

**Not deployed. No real message sent by this branch. No Supabase Hook is enabled.** The existing Phone + Password login remains unchanged.

## Target architecture
Website / future mobile apps → Supabase Auth Phone OTP → signed HTTPS Send SMS Hook → isolated Cloudflare Worker → Meta WhatsApp Cloud API.

This Worker is a transport, not a credential authority. Only Supabase can issue/verify OTP and manage sessions. Current installer/showroom accounts use Phone + Password through a **synthetic email alias**, with Supabase phone provider OFF. Simply enabling Send SMS Hook does NOT integrate those users; account-migration design and tests are required.

## Runtime settings
Never commit secrets, paste them into a chat, or put them in NEXT_PUBLIC variables.
- Cloudflare **Secrets Store**: owner-created `WHATSAPP_ACCESS_TOKEN` (Meta System User token) lives in account store `default_secrets_store`; Wrangler declares an isolated `secrets_store_secrets` binding named `WHATSAPP_ACCESS_TOKEN` and code retrieves it with `await env.WHATSAPP_ACCESS_TOKEN.get()` only after a signed, enabled request. The value is never committed or read into the frontend.
- Per-Worker runtime secrets: `WHATSAPP_PHONE_NUMBER_ID` (Meta phone ID, not itself a credential) and `SUPABASE_SEND_SMS_HOOK_SECRET` (Standard Webhooks secret, `v1,whsec_...`).
- Non-secret preview vars: `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_OTP_LANGUAGE=ar`, `WHATSAPP_GRAPH_API_VERSION=v25.0`, `WHATSAPP_DELIVERY_ENABLED=false`.
- Endpoint: `POST /hooks/supabase/send-sms`, Standard Webhooks signature + timestamp required. It accepts only verified `{user:{phone:"+2010..."},sms:{otp:"6 digits"}}`.
- Sends the approved Arabic Authentication/Copy Code template, with the code in the body and button parameter. Meta acceptance is **not** device delivery.

## Blocking prerequisites before enabling delivery
1. Confirm ownership and unique linking of canonical phone to existing Supabase email-alias identities. No duplicate account, takeover or implicit phone-only signup.
2. Add **durable replay protection** keyed by `webhook-id` (signed retries/replays must not duplicate billable sends). Test concurrency, timestamp skew and failures.
3. Validate Supabase Auth CAPTCHA coverage, phone/IP rate limits, resend cooldown, OTP expiration (match 5-minute message), and brute-force attempt caps.
4. Owner created minimally scoped Meta System User token in Cloudflare Secrets Store (active); Worker binding is configured in source only and not yet deployed. Test with acceptance-only owned numbers when allowed.
5. Run Worker and repository tests, then deploy Preview only after explicit approval. Never enable Production hooks on this branch.
6. Create a separate Meta message-status webhook if handset delivery auditing is required. No automatic retries of failed Meta requests.

**Verification status:** initial local prototype passed 7 mock tests and a TypeScript typecheck before the Secrets Store integration; two gating tests were added in PR, but the modified branch's TypeScript/test status has not yet been independently verified. CI and Wrangler dry-run are mandatory before deployment. This transport has not been sent to Meta live.
