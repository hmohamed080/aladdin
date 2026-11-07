# ADR-0025 — One-field sign-in, mobile or email sign-up with WhatsApp codes

**Status:** Accepted for the preview · 2026-10-28 · owner decisions in the project thread ("look like Instagram", "every account type", "Meta WhatsApp Cloud API"). Production only on the owner's production GO.

**Refines:** the 2026-09-28 Email + Password model ([PRODUCT_DIRECTION_GUIDE](../product/PRODUCT_DIRECTION_GUIDE.md) Change History) and [ADR-0023](ADR-0023-supabase-auth-verifies-turnstile.md). **Retires:** the installer and showroom phone entry pages (`/installer/sign-in|sign-up`, `/showroom/sign-in|sign-up`, ADR-0014's separate entry).

## Decision

1. **Sign in (`/auth/sign-in`).** One field, "Mobile number, username or email", plus password. `lib/auth/sign-in-identifier.ts` classifies it: `@` → email; digits → canonical E.164 mobile (Egypt default); a letter-first handle → username. A mobile number or username is resolved to the account's auth email on the server (`resolveSignInEmail`, service role, `profiles.phone_e164` / `username_normalized`), behind the durable phone limiter; a miss answers exactly like a wrong password after the same minimum delay. The password grant is unchanged (GoTrue judges the interaction-only Turnstile token).
2. **Sign up (`/auth/sign-up`).** Google / Facebook first, then: Mobile number or email, Password, Birthday, Full name, Username, Account type (hidden when the landing page chose it). One agreement line replaces the three consent checkboxes; the form still submits the three consents and the server still records them. No confirm-password; the password rules show only as an error.
   - **Email** → the existing `signUp()` + 6-digit email code (Architecture B).
   - **Mobile number, any account type** → `server/auth/phone-sign-up.ts`: Siteverify (action `sign-up`), the phone limiter plus 5 codes per number per hour, an HMAC of a 6-digit code in `public.phone_verification_challenges` (service role only, 10 minutes, 5 attempts counted compare-and-set before checking), sent with the Meta WhatsApp Cloud API Authentication template `aladdin_login_code`. The form fields ride a sealed cookie (AES-256-GCM, httpOnly, `/auth`, 10 minutes). Only after the code is verified and consumed is the account created (internal login alias, unchanged), signed in (GoTrue judges a second Turnstile token) and set up through the usual RPCs; any failure deletes it.
3. **Birthday.** Required, 18 or older, private: `public.users.birth_date` (self-only row), written by the server after verification. Privacy policy updated.
4. **Google / Facebook** on both pages (`server/auth/entry-oauth.ts`, one general callback). A new person's consent is recorded, an account type chosen on the landing page is applied after a server re-check, and the rest is finished on `/auth/finish-registration`. Buttons appear only for providers switched on in that Supabase project.
5. **Removed:** the four phone entry routes (permanent redirects to `/auth/*`, the installer and showroom sign-up links carry `?type=`), their forms, actions and the kind-specific OAuth/email entry code. Existing phone accounts sign in on `/auth/sign-in` with their mobile number. Sign-out always returns to `/auth/sign-in`.

## Configuration

- Worker secrets `WHATSAPP_ACCESS_TOKEN` (System User token, `whatsapp_business_messaging`) and `WHATSAPP_PHONE_NUMBER_ID`; variable `WHATSAPP_OTP_TEMPLATE` in `frontend/wrangler.jsonc`. Without them, mobile sign-up says it is unavailable (local development prints the code to the server console).
- Migration `20261028090001_sign_up_birthday_and_phone_codes.sql` must be pushed to a Supabase project before this code is deployed against it.

## Consequences

- Business types may now register with a mobile number; their account still verifies a channel (WhatsApp) before it exists.
- Each WhatsApp code costs money: it is sent only after Turnstile, the limiter and every field check pass.
- Installer Forgot Password is still deferred (recovery by WhatsApp code is the natural next step).

## Amendment (R2, 2026-10-31): one verification authority
The WhatsApp code for mobile sign-up is no longer generated, stored or checked by the sign-up server. It belongs to the phone verification authority (`supabase/migrations/20261030090001/2`, `frontend/src/server/phone-verification`): the account is created only with that authority's single-use grant, and `profiles.phone_verified_at` is set only after the usual initialisation. The sign-up server holds no code, no hash and no table of its own, and no longer calls Meta; delivery goes through one interface (`PHONE_OTP_DELIVERY`, default off). The first step no longer says whether a number is registered (a registered number simply receives no code). The legacy table `public.phone_verification_challenges` is dropped by the forward-only migration `20261031090001`. Everything ships OFF; see `docs/security/PHONE_SIGNUP_R2_INTEGRATION.md`.
