# Showroom and Installer entry pages: Google, Facebook, email and phone

> **Superseded 2026-10-28 (ADR-0025).** The showroom and installer entry pages are retired (permanent redirects to `/auth/*`). Google and Facebook now sit on `/auth/sign-in` and `/auth/sign-up` (general flow in `src/server/auth/entry-oauth.ts`; an open `?type=` is applied after the server re-checks it). See [ADR-0025](../decisions/ADR-0025-one-field-sign-in-whatsapp-sign-up.md). The text below is kept as history.

Pages: `/showroom/sign-in`, `/showroom/sign-up`, `/installer/sign-in`, `/installer/sign-up`.

Each page offers, in order: Google and Facebook (only the providers switched on in Supabase Auth render), then a Phone | Email switch over the password forms. Phone stays the default, so the existing phone + password flow is unchanged. `?method=email` opens the email tab.

| Method | Sign-up | Sign-in | Account-type check |
| --- | --- | --- | --- |
| Phone + password | unchanged (`phonePasswordSignUp`) | unchanged | `phone_password_account_allowed(kind, phone)` |
| Email + password | canonical `requestPasswordSignUp` → 6-digit email OTP (`verifyPasswordSignUp`), account type fixed by the page, generated username | `entryEmailSignIn` | `account_entry_allowed(kind)` |
| Google / Facebook | first visit creates the account for the page's kind (consent, account type, display name, generated username) | `/auth/callback` | `account_entry_allowed(kind)` |

- One identity: Supabase links a Google/Facebook identity to an existing user with the same confirmed email. Phone-registered accounts have no real email, so Google/Facebook cannot link to them.
- A Showroom account is refused on the Installer pages and the reverse, for every method; the session is signed out and the page explains why.
- Consent: the OAuth buttons sit above a notice that continuing accepts the Terms and Privacy Policy; the callback records the three receipts for a new account.
- `account_entry_allowed` (migration `20261017134139`) is the phone check without the phone binding; pgTAP `91_account_entry_allowed_test.sql`.

## Hosted configuration (owner)

1. Supabase → Authentication → URL Configuration: Site URL `https://aladdindecore.com`; add Redirect URL `https://aladdindecore.com/auth/callback**` (and the preview domain if previews should work).
2. Supabase → Authentication → Providers → Google: enable, paste the Google OAuth Client ID and Secret. In Google Cloud Console (OAuth client, type Web) set the Authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Supabase → Providers → Facebook: enable, paste the Meta App ID and App Secret. In Meta for Developers → Facebook Login → Settings add the same Supabase callback as a Valid OAuth Redirect URI, and request the `email` permission.
4. Migration `20261017134139_account_entry_allowed.sql` is applied to hosted `aladdin-staging` (email and OAuth sign-in fail closed without it; phone is unaffected).
