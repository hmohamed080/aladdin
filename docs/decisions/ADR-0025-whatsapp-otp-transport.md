# ADR-0025 — Supabase-owned OTP, Cloudflare WhatsApp transport (preview preparation)

**Status:** Proposed (owner selected target architecture on 2026-10-28; rollout and phone-identity migration NOT approved)
**Scope:** WhatsApp OTP delivery transport. Does not change the existing identity model, signup, login, or recovery.

## Purpose
Provide secure WhatsApp delivery for six-digit phone OTP using the already-verified Arabic Meta Authentication/Copy Code template `aladdin_otp`, without reinventing token issuance, verification, or session management.

## Current decision / target design
Website and future mobile apps → **Supabase Auth (OTP issuer/verifier)** → **signed HTTPS Send SMS Hook** → **isolated Cloudflare Worker** → **Meta WhatsApp Cloud API**.

The Worker verifies Standard Webhooks HMAC over the raw body, checks clock skew, validates recipient/OTP shape, and submits the Arabic template with matching OTP in the message body and copy button. It reads a scoped Meta System User token asynchronously via a Cloudflare Secrets Store binding; no OTP/provider token is written to D1. It does not generate or verify credentials and never intentionally logs sensitive payloads.

## Current product incompatibility (BLOCKER)
The existing canonical account model is General **Email + Password**, with Email OTP during registration and recovery. Installer/Showroom uses **Phone + Password** with a synthetic email alias; Supabase Phone Auth is disabled and phone identifiers must remain tied to the existing user ID. Enabling Send SMS Hook alone does not add WhatsApp OTP to those flows. A user can already hold one or more organizational roles; never create duplicate users by independently calling `signInWithOtp({phone})` without identity-linking analysis.

The first product flow for WhatsApp (phone verification, installer recovery, phone sign-in, or phone enrollment) must be chosen and security-reviewed; identity migration/account linking is a separate, guarded change and requires adversarial tests.

## Rationale
Supabase owns auth/session lifecycle and canonical identity. A narrowly scoped Cloudflare Worker isolates Meta credentials from the browser, avoids database lookups on the transport path, and can be reused by web/mobile.

## Security and operational gates
- Protect the public HTTPS Hook endpoint with verified Standard Webhooks signature, expiry, and **durable event-id replay/idempotency defense**. The preview Worker includes an atomic D1 event-hash reservation and test-only recipient allowlist. The isolated hosted D1 table exists and has passed database-only duplicate-insert smoke tests. **Do not enable delivery** until actual Worker+D1 runtime tests, retention cleanup and identity safety checks pass.
- Never trust an arbitrary browser-supplied OTP/recipient. Confirm configured Auth CAPTCHA (including direct Auth API calls), cooldown, IP/phone limits, fail-closed behavior and anti-enumeration before activation.
- Meta System User credential must have only needed asset scopes and live in Cloudflare **Secret**. `WHATSAPP_DELIVERY_ENABLED=false` is the initial deployment gate.
- Align Meta template's displayed 5-minute expiry to Supabase OTP expiry, reject incorrect/expired/replayed codes, and audit eventual provider delivery via Meta webhook separately.
- Use Acceptance (`nxossqhdfltcqdwvbewi`) and `aladdin-whatsapp-otp-preview` only. Do not change Production project `kkpkgjrweysgvhvkhzun`, the existing auth flows, or production worker bindings.
- Confirm resource usage/billing and provider outage handling before scaled sending. Provider failure must not silently report a delivered OTP.

## What is deferred
Phone Auth enrollment/identity migration and account recovery, dual-language template, replay record retention policy and cleanup automation, delivery-status webhooks, hosted hook activation, production traffic, mobile app integration.

## Consequences
One extra narrowly scoped Worker, one dedicated hosted Acceptance D1 for replay claims, an account-level Secrets Store binding for Meta token, and a separate as-yet-unconfigured Supabase signing secret. The sender ID is a non-secret configuration variable and the acceptance phone allowlist must be protected; no client-facing credentials. Hosted D1 table and account secret were created with owner direction, but the Worker and Auth Hook have not been deployed/enabled. CI passed as of 2026-10-28 and a release approval is still required.

## Verification snapshot — 2026-10-28
- D1 `aladdin-whatsapp-otp-acceptance` provisioned; committed replay schema applied via Cloudflare API; duplicate inserts (including concurrent requests) returned one insert and one ignored duplicate, with dummy data cleaned.
- Dedicated PR CI with Wrangler dry-run, mocked security/replay tests and TypeScript is green; project general CI and Supabase RLS green.
- **Worker not deployed, Supabase Signing Secret absent, Supabase Hook disabled, no real Worker/D1 or Auth end-to-end test.**
- A preview-only configuration guard in `scripts/check-preview-config.mjs` rejects wrong resource names, production routing and delivery-enabled configuration.
- The full chronological implementation evidence, exact blockers, resource matrix and rollback checklist are in `docs/operations/WHATSAPP_OTP_IMPLEMENTATION_LOG.md`.

## Related files
- `edge/whatsapp-otp-worker/`
- `docs/frontend/installer-phone-auth.md`
- `docs/frontend/entry-auth-methods.md`
- `docs/architecture/ARCHITECTURE_GUIDE.md`
- `docs/decisions/ADR-0023-supabase-auth-verifies-turnstile.md`
- [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
