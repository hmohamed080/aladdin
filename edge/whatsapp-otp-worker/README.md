# Aladdin WhatsApp OTP transport — PREVIEW ONLY

**Not deployed. No real message sent by this branch. No Supabase Hook is enabled.** The existing Phone + Password login remains unchanged.

## Target architecture
Website / future mobile apps → Supabase Auth Phone OTP → signed HTTPS Send SMS Hook → isolated Cloudflare Worker → Meta WhatsApp Cloud API.

This Worker is a transport, not a credential authority. Only Supabase can issue/verify OTP and manage sessions. Current installer/showroom accounts use Phone + Password through a **synthetic email alias**, with Supabase phone provider OFF. Simply enabling Send SMS Hook does NOT integrate those users; account-migration design and tests are required.

## Runtime settings
Never commit secrets, paste them into a chat, or put them in NEXT_PUBLIC variables.
- Cloudflare secrets: `WHATSAPP_ACCESS_TOKEN` (Meta System User token), `WHATSAPP_PHONE_NUMBER_ID` (Meta phone ID), `SUPABASE_SEND_SMS_HOOK_SECRET` (Standard Webhooks secret, `v1,whsec_...`).
- Non-secret preview vars: `WHATSAPP_OTP_TEMPLATE=aladdin_otp`, `WHATSAPP_OTP_LANGUAGE=ar`, `WHATSAPP_GRAPH_API_VERSION=v25.0`, `WHATSAPP_DELIVERY_ENABLED=false`.
- Endpoint: `POST /hooks/supabase/send-sms`, Standard Webhooks signature + timestamp required. It accepts only verified `{user:{phone:"+2010..."},sms:{otp:"6 digits"}}`.
- Sends the approved Arabic Authentication/Copy Code template, with the code in the body and button parameter. Meta acceptance is **not** device delivery.

## Blocking prerequisites before enabling delivery
1. Confirm ownership and unique linking of canonical phone to existing Supabase email-alias identities. No duplicate account, takeover or implicit phone-only signup.
2. Add **durable replay protection** keyed by `webhook-id` (signed retries/replays must not duplicate billable sends). Test concurrency, timestamp skew and failures.
3. Validate Supabase Auth CAPTCHA coverage, phone/IP rate limits, resend cooldown, OTP expiration (match 5-minute message), and brute-force attempt caps.
4. Generate a minimally scoped Meta System User token and store it as a Cloudflare Secret, never a temporary developer token. Test with acceptance-only owned numbers.
5. Run Worker and repository tests, then deploy Preview only after explicit approval. Never enable Production hooks on this branch.
6. Create a separate Meta message-status webhook if handset delivery auditing is required. No automatic retries of failed Meta requests.

**Verification status:** isolated local prototype passed 7 mock tests and a TypeScript typecheck; the committed branch and full repository CI still need to be verified independently. This transport has not been sent to Meta live.
