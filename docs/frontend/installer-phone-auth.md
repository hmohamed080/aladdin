# Installer/technician phone + password authentication

**Status:** the approved, permanent, role-specific authentication entry point for
installer/technician (الصنايعية) accounts — the one documented exception to the
passwordless model (PRODUCT_DIRECTION_GUIDE, Change History 2026-09-27). Visual
implementation approved. Verified against local Supabase. **Not deployed; hosted
Supabase untouched.** It creates ordinary `professional / installer_technician` accounts
through the existing infrastructure and hands them to the existing installer experience.

- Sign up: **`/installer/sign-up`** — full name, phone, password, one consent checkbox
  (+ Turnstile). No email, no OTP, no username, no role picker.
- Sign in: **`/installer/sign-in`** — phone + password (+ a validated `next`). No OTP,
  no forgot-password (pending — see *Known limitations*).
- Compatibility: `/temporary/craftsman/sign-up` and `/temporary/craftsman/sign-in` are
  permanent (308) redirects to the routes above (`next.config.ts`), query string kept.

The shared `/auth/sign-up` and `/auth/sign-in` routes keep serving the email/passwordless
flow for **every** account type (including installers who registered by email); only a
secondary link was added to `/auth/sign-in`. `server/actions/auth.ts`'s email-OTP
behavior, the password preview (`/preview/auth-password/*`), other account types and the
hosted phone provider are **unchanged**.

**Naming.** `installer` is the canonical product/code term (DB persona
`installer_technician`, the "Installer/Technician Pilot", `installer-dashboard`,
`installer-home`), so the routes and folders use it. Identifiers that predate the
promotion are kept to avoid a terminology refactor: the `temporaryCraftsman` i18n
namespace, `Craftsman*` component/action names, `lib/auth/craftsman-login-alias.ts`, the
alias domain `craftsman-login.aladdin.invalid` and the stored `registration_source` value
`temporary_craftsman_password_flow` (the last two are data on existing accounts and must
never change).

## Entry points and redirect rules

| Situation | Reliable signal | Destination |
|---|---|---|
| Homepage (production/local, `landing-v2`) — "الصنايعية والفنيون" audience tile | explicit role choice | `/installer/sign-up` |
| Homepage (staging, `landing-preview`) — installers role dialog "إنشاء حساب" | explicit role choice | `/installer/sign-up` |
| Every other role CTA/card/link | — | unchanged (`/auth/sign-up`) |
| Shared `/auth/sign-in` | — | secondary link "صنايعي؟ سجّل الدخول برقم الهاتف" → `/installer/sign-in`, carrying `?next=` **only** when the page itself received one, re-validated with `sanitizeNext` |
| Explicit sign-out (`signOut`, `server/actions/auth.ts`) | the signed-in account's own identity, read before the session ends | phone-alias account → `/installer/sign-in`; every other account → `/auth/sign-in` (as before) |
| Expired session / signed-out visit to a protected route (`middleware.ts`, page guards) | none — no protected route is installer-only (`/home/*` is shared by every personal persona) | unchanged: `/auth/sign-in?next=…`; the installer uses the secondary link, which forwards that `next` |
| Signed-in visit to `/installer/sign-up` or `/installer/sign-in` | session | `/onboarding` (middleware, same rule as `/auth/*`) → the caller's landing |
| After installer sign-in | validated `next` | exactly the `verifyEmailOtp` rule: `sanitizeNext` allow-list (never `//host` or an absolute URL); `/onboarding…` and `/auth/invite/…` pass through; not access-ready → `/onboarding`; otherwise `next` only if it is the caller's landing or below it, else the landing (`/home`) |

No anonymous visitor is ever routed to the installer pages by guessing: the only
automatic installer redirect is sign-out, where the identity is known.

## Why a login alias (decision: Option B, product-owner approved 2026-09-27)

Supabase Auth has no phone identity in this project (phone provider off, no SMS/WhatsApp
sender), and every verified-caller gate in the database (`app.require_verified_caller`,
`my_registration_state`, `record_consent`) reads `auth.users.email_confirmed_at`. Instead
of enabling the hosted phone provider and widening those gates (Option A — a production
auth change), each account signs in with an **internal login alias derived from its
canonical phone**:

```
+201012345678  →  p201012345678@craftsman-login.aladdin.invalid
```

`.invalid` is reserved (RFC 2606): nothing can ever be delivered there. The alias is a
login key, never a contact, and is **never shown** — see *Alias is never exposed*.

## Flow

```
name + phone + password + consent + Turnstile
  → validation (features/installer-phone-auth/validation.ts; re-run server-side)
      phone:    toCanonicalPhone(…, "EG")  (lib/contact/phone.ts, libphonenumber-js) → E.164
      password: existing policy — ≥10 chars, ≤72 bytes, common/sequential/account-related rejected
  → Turnstile Siteverify (server/auth/turnstile.ts)
  → duplicate check: any profiles.phone_e164 = E.164           (service role, read-only)
  → auth.admin.createUser({ email: alias, password, email_confirm: true,
        user_metadata: { full_name, locale: "ar" },
        app_metadata: { registration_source: "temporary_craftsman_password_flow" } })
      ↳ app.handle_new_user trigger creates public.users + public.profiles (display_name = name)
  → signInWithPassword({ email: alias, password })  → normal @supabase/ssr cookie session
  → as that user: record_consent([terms, privacy, pilot])
                  onboarding_select_account_type('professional', 'installer_technician')
                  profile_set_phone('EG', national, E.164)
                  profile_set_username('craftsman.<8 random>')   (retried on collision)
  → my_registration_state() must be access_ready
  → redirect(resolveActiveLanding())  → /home (installer dashboard)
```

`onboarding_select_account_type` on the professional track records the declared persona
(`individual_onboarding.prof_concrete_type`, migration `…090011`) — exactly what a
craftsman registered through the canonical flow gets, so the account appears and behaves
the same in Admin, `/home`, opportunities, points, permissions and profile completion.
`users.primary_account_type` is not written, same as canonical registration (Admin-applied
only).

**Rollback.** If anything after `createUser` fails (session, any RPC, or the final state
check), the session cookies are dropped and the just-created user is deleted with the
admin API; `public.users`/`profiles` and every row written cascade. A duplicate that
loses the race at `profile_set_phone` (unique index, 23505) rolls back and shows the
duplicate-phone message.

**Sign in** maps the phone to its alias and calls `signInWithPassword`. Every credential
failure (unknown number, wrong password, disabled account) gets one generic message;
rate limits are reported separately. A non-`access_ready` account resumes `/onboarding`.

## Security

- Passwords go to GoTrue once and are hashed there (bcrypt). Never stored, logged, echoed
  back to the form, or placed in URLs/cookies/storage by this app.
- The only intentional bypass: no OTP. Turnstile stays on sign-up (the service-role
  create path is not covered by GoTrue's per-IP sign-up limit, so Turnstile is the
  abuse control); sign-in is bounded by GoTrue's own rate limits, like the preview.
- Service-role use is limited to three calls in `lib/supabase/admin-server.ts`:
  phone-uniqueness read, user creation, rollback delete. Everything after the user exists
  runs as the user, under RLS.
- Logs carry only a step name and an error code (and a user id if a rollback delete
  fails) — never the phone, alias, password or tokens.
- **Duplicate phone is disclosed** ("يوجد حساب مسجل بالفعل بهذا الرقم") by product
  decision, behind Turnstile. This is a deliberate exception to the enumeration-safe
  wording elsewhere.
- **The phone is not verified.** Anyone can register a number they do not own and
  block its owner from this flow. Inherent to "no OTP"; the auth `phone` column stays
  NULL, so nothing treats these numbers as verified.

## Alias is never exposed

- App surfaces that render the auth email go through `userFacingEmail()`
  (`lib/auth/craftsman-login-alias.ts`): account menu (`server/queries/identity.ts`,
  which falls back to the profile phone), `/home/settings`, `/b2b/settings`, the
  onboarding contact step (`server/queries/onboarding.ts`).
- Database-rendered surfaces all go through `app.mask_email`, which now returns `'•••'`
  for the alias domain (migration `20260927090001_mask_craftsman_login_alias.sql`,
  pgTAP `64_mask_craftsman_login_alias_test.sql`). No table, column, policy or grant
  changed.
- The two layers are **defense in depth** (decision, 2026-09-28): the email reaches the
  screen by two independent paths — straight from Supabase Auth (`auth.getUser()`), and
  through the SQL RPCs — and each layer covers one. Neither replaces the other. The raw
  alias stays available internally wherever authentication needs it (alias derivation,
  `createUser`, `signInWithPassword`, `auth.users.email`); masking is presentation only.
- **Phone accounts never enter the password-preview email flows.** `/preview/auth-password/migrate`
  and `/change-password` (which delegates to it), plus their server actions
  (`requestMigrationCode`, `completeMigration`, `changePassword`), turn an alias account
  away on the server (`redirectPhoneLoginAccount` in `server/actions/auth-password-preview.ts`)
  before the alias can reach a page payload or an action response: to `/home/settings`
  with app access, otherwise to `/onboarding`. These flows email the account's address,
  which a phone account does not have; no password change for phone accounts exists yet.
- **Settings copy follows the account's sign-in method.** `/home/settings` and `/b2b/settings`
  pick the sign-in text on the server from the same alias check: phone accounts read "You sign
  in with the phone number you registered with and your password." (AR: "تسجّل الدخول برقم الهاتف
  الذي سجّلت به وكلمة المرور."); email accounts keep the passwordless one-time-code text. The
  "change it from your profile" hint is not shown to phone accounts — a profile phone edit does
  not change the number they sign in with (the alias is fixed at creation; see Known limitations).
- Admin lists read `public.users`/`profiles`, never `auth.users.email`.
- E2E asserts the full HTML (including the RSC payload) of `/home`, `/home/settings`,
  `/settings/profile`, `/admin/users` and the user detail never contains the alias.

## Known limitations

- **Forgot password is hidden — PENDING authentication item (product decision, 2026-09-27).**
  Every existing recovery flow is email-based (`/auth/recovery` email OTP;
  `/preview/auth-password/forgot-password` → `resetPasswordForEmail`) and cannot reach a
  phone/alias account; there is no SMS/WhatsApp sender. These flows must NOT be linked
  from the craftsman pages, no interim workaround (support link, admin shortcut) is to be
  built, and the email recovery flows stay unchanged. The intended recovery flow, to be
  implemented once an OTP provider is integrated: phone number → OTP via SMS/WhatsApp →
  identity verification → set new password. Until then a craftsman who forgets their
  password cannot recover it self-service.
- **Profile phone vs. sign-in phone.** A phone account can edit its profile phone
  (`profile_set_phone`), but its login alias — and so the number it signs in with — stays the
  one it registered with. Aligning them (or locking the edit) is a follow-up decision.
- **The generated username cannot be changed** — the product has no username-edit UI
  after registration. It is `craftsman.` + 8 random characters.
- These accounts cannot self-serve a change to a real email: `double_confirm_changes`
  would require confirming the undeliverable alias. Moving them to a real phone/email
  identity is admin work when the flow is removed.
- Phone invitations still bind by email/bearer token; the alias never matches an
  email invitation.
- **Imagery is the approved, supplied artwork** (product owner, 2026-09-27) in
  `public/installer-auth/`: `worksite-hero.webp` (desktop/tablet scene — craftsman and bands are part of
  the artwork), `craftsman-sign-up.webp` / `craftsman-sign-in.webp` (mobile headers), and the briefcase / bell /
  people / chart benefit tiles (split or cropped losslessly from the supplied files, no redraw). All are
  referenced only through `features/installer-phone-auth/assets.ts`.
- **Consent receipts vs. displayed text.** The page shows one checkbox: "أوافق على شروط الخدمة وسياسة
  الخصوصية." `my_registration_state()` still requires three receipts (terms, privacy, pilot), so the flow
  records `pilot` too, although the pilot-release sentence is no longer displayed (product decision,
  2026-09-27). `/legal/terms` and `/legal/privacy` are still placeholder pages; the pilot clause should live in
  the Terms text when it is written.

## Hosted requirements (not done)

- Migrations `20260924090001`–`…090013` and `20260927090001` must be applied to the
  target project (the flow uses `profile_set_username`, `profile_set_phone`,
  `access_ready`, and the declared-persona assignment). Check the hosted state first.
- `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY`
  set in the Vercel environment. Without the Turnstile secret sign-up fails closed.
- Hosted Auth minimum password length should be ≥ 10 to match the app policy.

## Local verification

Unit/component: `pnpm --filter frontend test`. Database: `supabase test db`.
E2E: `e2e/installer-phone-auth.spec.ts` against local Supabase + a production build.
Where `challenges.cloudflare.com` is unreachable, run it with `E2E_TURNSTILE_STUB=1`
and a local HTTPS stand-in for Siteverify on `challenges.cloudflare.com` (hosts entry +
a throwaway CA passed to the server via `NODE_EXTRA_CA_CERTS`) that accepts only
Cloudflare's dummy test token — the server's Siteverify call still runs.

## Removal / future

The installer entry point is permanent. If it is ever retired: remove `app/installer/`,
`features/installer-phone-auth/`, `server/actions/installer-phone-auth.ts`, the installer
section of `lib/supabase/admin-server.ts`, the landing links, the `/auth/sign-in`
secondary link, the `signOut` branch and the E2E spec — but keep
`lib/auth/craftsman-login-alias.ts`, its call sites and the `mask_email` handling until
every alias account has been migrated to a verified phone (WhatsApp/SMS OTP) or email
identity.
