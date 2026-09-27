# Temporary craftsman phone + password auth

**Status:** implemented locally, verified against local Supabase. **Not deployed; hosted
Supabase untouched.** A TEMPORARY, parallel entry point for installer/technician
(الصنايعي) accounts while craftsman registration through the canonical email-OTP flow
is blocked. It is an entry point only: it creates an ordinary account through the
existing infrastructure and hands it to the existing installer experience.

- Sign up: `/temporary/craftsman/sign-up` — full name, phone, password, one consent checkbox
  (+ Turnstile). No email, no OTP, no username, no role picker.
- Sign in: `/temporary/craftsman/sign-in` — phone + password. No OTP, no forgot-password.

The canonical `/auth/*` routes, `server/actions/auth.ts`, the email-OTP behavior, the
password preview (`/preview/auth-password/*`), other account types and the hosted phone
provider are **unchanged**.

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
  → validation (features/temporary-craftsman-auth/validation.ts; re-run server-side)
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
- Admin lists read `public.users`/`profiles`, never `auth.users.email`.
- E2E asserts the full HTML (including the RSC payload) of `/home`, `/home/settings`,
  `/settings/profile`, `/admin/users` and the user detail never contains the alias.

## Known limitations

- **Forgot password is hidden.** Recovery is email-based (`resetPasswordForEmail`) and
  cannot reach an alias; there is no SMS/WhatsApp sender. The production recovery flow
  is unchanged. A forgotten password needs an admin-assisted reset for now.
- **The generated username cannot be changed** — the product has no username-edit UI
  after registration. It is `craftsman.` + 8 random characters.
- These accounts cannot self-serve a change to a real email: `double_confirm_changes`
  would require confirming the undeliverable alias. Moving them to a real phone/email
  identity is admin work when the flow is removed.
- Phone invitations still bind by email/bearer token; the alias never matches an
  email invitation.
- **Imagery is the approved, supplied artwork** (product owner, 2026-09-27) in
  `public/temporary/craftsman/`: `worksite-hero.webp` (desktop/tablet scene — craftsman and bands are part of
  the artwork), `craftsman-sign-up.webp` / `craftsman-sign-in.webp` (mobile headers), and the briefcase / bell /
  people tiles split losslessly from the supplied icon sheet. All are referenced only through
  `features/temporary-craftsman-auth/assets.ts`. **No chart/growth tile was supplied**: the sign-up "develop your
  skills" benefit shows a token-coloured stand-in tile until `icons.chart` is set.
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
E2E: `e2e/temporary-craftsman-auth.spec.ts` against local Supabase + a production build.
Where `challenges.cloudflare.com` is unreachable, run it with `E2E_TURNSTILE_STUB=1`
and a local HTTPS stand-in for Siteverify on `challenges.cloudflare.com` (hosts entry +
a throwaway CA passed to the server via `NODE_EXTRA_CA_CERTS`) that accepts only
Cloudflare's dummy test token — the server's Siteverify call still runs.

## Removal

Delete `app/temporary/`, `features/temporary-craftsman-auth/`,
`server/actions/temporary-craftsman-auth.ts`, the craftsman section of
`lib/supabase/admin-server.ts`, the `temporaryCraftsman` i18n namespace and the E2E spec.
Keep `lib/auth/craftsman-login-alias.ts`, its call sites and the `mask_email` migration
until every alias account has been migrated to a real identity.
