# Phone Identity & Verification — Phase A foundation (no paid activation)

**Date:** 2026-10-29  
**Status:** implementation contract and acceptance gates; **no production behavior changes in this PR**.  
**Applies to:** Installer, Showroom, and eventually other Aladdin roles.  
**Explicit owner direction (updated 2026-10-29):** reuse current implementations and preserve existing users. **Meta's per-message WhatsApp OTP charges are acceptable** when a separately approved real-delivery pilot/launch starts. **Do not activate the Supabase Advanced Phone MFA paid add-on** (approximately $75/month for the first project); it is explicitly deferred. Phase A remains local/mock with no paid sends; Cloudflare `aladdin-whatsapp-otp-preview` keeps `WHATSAPP_DELIVERY_ENABLED=false` and Send SMS Hook OFF until an explicit controlled activation.

## 1. Existing implementation; do not rebuild

- `public.profiles.phone_e164` and `phone_verified_at` already exist. The `loadMyIdentity()` projection already exposes `phoneVerified` by reading `phone_verified_at != NULL`. An Installer Settings badge already displays verified/unverified (`frontend/src/features/installer-settings/installer-settings.tsx`). **Do not add another primary-phone verification column or duplicate badge.**
- Installer/Showroom phone+password signup in `frontend/src/server/auth/phone-password.ts` creates an internal `p<digits>@craftsman-login.aladdin.invalid` Auth email alias; `auth.users.phone` is not the canonical profile phone. Registration currently has **no phone OTP**. Preserve existing `auth.users.id`, roles, memberships, consent, points and email alias.
- `public.secondary_phone_reservations` already implements one active unverified secondary reservation per user, 7 days + one 7-day renewal; expiry/cancellation starts a **30-day secondary reservation cooldown**; account-password receipt for reserve/change/convert; global uniqueness/advisory locking across primary and secondary claims. See `20261021090004_secondary_phone_reservations.sql`. Do **not** replace or automatically bypass these policies.
- For Installer phone-login identities, primary-phone changes are mediated by a journal reconciling `profiles.phone_e164` with the internal Auth alias. A successful change sets `phone_verified_at = NULL`: password reauthentication proves account control, **not possession of the new number**. See `20261024090004_installer_phone_change_journal.sql` and later guards.
- `organizations.contact_phone` and `organization_contacts` are **business contact fields**, distinct from account identity. `contact_email` has its own explicit link-verification, contact/recovery boundaries and anti-enumeration patterns. Do not turn these into sign-in credentials by side effect.

## 2. Product decisions — approved scope

| Subject | Target behavior |
| --- | --- |
| Existing primary phones | Render **Unverified / Verify** beside the existing number if `phone_verified_at IS NULL`; do **not** mass-convert to verified or retroactively lock out existing users. |
| New phone-based registration | Require WhatsApp possession proof **before granting full account access**. Keep pre-verification identity/session provisional, avoid duplicate Auth users; cannot enable this live gate until real delivery is explicitly funded/approved. |
| New additional phone | User may save the unverified reservation and defer verification, edit an incorrect number using existing receipt/locking/cooldown rules, and verify later before reservation expiry. No automatic extension on verification attempt. |
| Verified secondary | Verification means **number possession only**. No automatic login, recovery, primary promotion, MFA enrollment, or business-contact opt-in. These require a **separate explicit, protected action**. |
| Primary phone replacement | Verification evidence must bind to the **new exact E.164**, current account ID and change operation; keep the existing journal / alias recovery protections. Evaluate verify-before-switch so the old login is not abandoned on an unreachable new number. |
| WhatsApp proof | A completed OTP proves current access to the WhatsApp account on that number **at verification time**, not permanent deliverability or marketing consent. Track channel and time. |
| MFA | Native TOTP/Authenticator is the initial no-add-on-cost candidate. WhatsApp Phone MFA (paid Supabase add-on + Meta messages), any custom WhatsApp MFA, email-as-MFA, passkeys and recovery-code design are **future separately reviewed work**. |
| Paid boundary | No Meta Authentication template sends; no Supabase Advanced Phone MFA activation; no billable email/SMS/provider upgrade; no billable hosted resource provisioning for this phase. |

When a verification is legitimately completed, associate evidence with **account ID + normalized phone + purpose + challenge ID**, and update status only in an authorized server-controlled transaction. Never let a client assert `verified=true` or write `phone_verified_at` directly. A change to the phone invalidates its old verification proof. Treat all existing `NULL` verification values as unknown/unverified, not necessarily evidence of fraud.

## 3. Separate concerns; do not confuse these states

1. **Phone claim:** primary profile phone, active secondary reservation, or organization/business contact.
2. **Possession verification:** unverified / challenge pending / verified. `phone_verified_at` is the existing primary source of truth; secondary reservation needs an independently designed verification record/state, rather than a client-only boolean.
3. **Purpose authorization:** contact-only, optional sign-in, password recovery, 2FA, business notifications — different consents/actions with their own audit and step-up requirements. Possession proof must **never** implicitly authorize an account-access purpose.
4. **Challenge lifecycle:** created, expires, invalidated, verified/consumed. A challenge must be cryptographically bound to exactly one account + number + purpose and have strict expiry, attempt/resend limits, anti-replay and anti-enumeration. Never log/store raw OTP; do not depend on Cloudflare transport D1 alone as the proof-of-ownership authority.
5. **MFA enrollment/assurance:** distinct from ordinary contact verification; a normal phone proof must never mark the session `aal2`. For TOTP rely on Supabase Auth `mfa.enroll`, `challenge`, `verify` and enforce authorization server-side and via the appropriate RLS/AAL rules.

## 4. Proposed delivery architecture (design to validate with local fixtures)

```text
User chooses purpose (signup verification, primary proof, secondary proof)
  -> backend resolves caller/registration intent, exact E.164 and permissions
  -> dedicated, purpose-bound challenge created by a trusted authority
  -> transport adapter (fake/no-send during Phase A; WhatsApp Worker later)
  -> code supplied to verification authority; rate limits + one-time use
  -> server-side state transition: verified_at updated for that specific claim
  -> source of truth read back; identity and permissions unchanged
```

**Do not use `supabase.auth.signInWithOtp({phone})` to validate an existing internal email-alias account.** It can create a parallel Auth user and break canonical identity. Also do not assume that `auth.updateUser({phone})` is safe for every additional contact: it changes Auth identity semantics, and the currently deployed Worker deliberately rejects unvalidated `new_phone` hook payloads. Pilot any native phone enrollment only against isolated fixtures after confirming the GoTrue payload contract and user-ID preservation.

For **new phone signup**, choose the challenge authority and when the Auth user is created only after local identity experiments. The `registration_state` / `hasAppAccess` gate needs explicit review: it currently admits certain provisioned `access_ready` identities without phone possession proof. Use server+DB enforcement, not only a form step. Gracefather existing accounts explicitly, but never derive permission to skip verification from a client flag.

For **secondary phone**, the active 7+7 reservation and 30-day cooldown stay database-authoritative; adding verified status must not permit someone to keep an expired reservation indefinitely or grant a reserved number to an unrelated user. If the reservation is edited, expires, cancelled or converted, invalidate pending proof. Do not mark an expired reservation verified.

## 5. Test matrix — first automated local milestone

No production or hosted changes. Build fixtures in **local Supabase**, and mock sending; never use a real phone or paid template.

- [ ] Fixture: legacy Installer phone/password alias, legacy Showroom phone/password alias, email-created account with profile phone, organization-only contact. Check stable `auth.users.id` and membership/permissions fingerprints.
- [ ] Existing primary with `phone_verified_at = NULL` renders **Unverified**, maintains current legacy access. Already verified timestamp renders Verified, no fake buttons.
- [ ] New phone registration: unverified session cannot access protected features; verification is required before activation; no duplicate `auth.users` identity or orphan account on expiry/failure.
- [ ] Primary verification: wrong number / user, expired code, wrong code, repeated code, rate-limited resend, direct API and replay all rejected; successful proof updates only the caller's exact current phone verification timestamp.
- [ ] Account phone change: old proof invalidated; verify-before-switch or proven safe equivalent; journal rollback and alias repair preserve sign-in and user ID on failure.
- [ ] Secondary reservation: no verification needed to save/edit; original uniqueness, 7+7 expiry, 30-day cooldown and password receipt still enforced; incorrect-number correction does not skip these rules.
- [ ] Secondary proof: only an active reservation is verifiable; proof for a different/expired/converted number is rejected. No automatic login/recovery/MFA/contact marketing permissions.
- [ ] Race conditions: two accounts claim the same E.164; two simultaneous verification responses; edit during in-flight OTP; expiry boundary; malicious direct RPC and forged verification flag.
- [ ] Rate-limit and Turnstile bypass via direct Auth/HTTP endpoints; consistent generic errors where enumeration would reveal ownership.
- [ ] Confirm no raw OTP, phone number, internal alias or token appears in logs, Worker observability or commit history.
- [ ] Delivery OFF and Supabase Send SMS Hook OFF; **zero paid sends** throughout local tests.
- [ ] Confirm production schemas, settings, sessions and credentials unchanged.

## 6. Order of implementation & stop/go

**A1 — foundation / this PR:** document actual existing contracts and test matrix, isolate from WhatsApp Worker PR #114. No code path or hosted settings changed.

**A2 — local only:** add read-only invariant/fixture tests for legacy accounts, phone reservation and existing verified state. Select proof authority with evidence; design minimal schema delta. Do not modify `phone_verified_at` or an Auth user until identity tests are green. **Registration integration must account for stacked PR #116 on #113**; do not duplicate or overwrite the continue-registration/username-lease changes. Wait for a stable merged base before touching those flows.

**B — phone signup & primary verification:** implement backend + UI behind feature flag, mock delivery; protect full access at server/DB. Existing accounts remain grandfathered/unverified pending voluntary proof.

**C — secondary verification:** use active reservation, purpose-bound proof, and separate secure actions for conversion/login/recovery. Preserve current cooldown/reauth rules.

**D — TOTP MFA:** only after identity flow, use native Supabase TOTP and AAL protections; no Phone MFA paid add-on.

**E — Meta messaging activation gate:** Meta OTP per-message cost is **approved in principle**, not yet permission to flip a live Worker switch. Do an isolated hosted Acceptance pilot, sender/payload/allowlist tests, spend limits, rollout and rollback **after separate explicit deployment/activation approval**. Keep paid Supabase Phone MFA disabled. **No launch of mandatory WhatsApp signup verification without a working tested delivery channel**, or new-user signups would be blocked.

## 7. Evidence/source paths

- `frontend/src/server/auth/phone-password.ts` — current phone/password sign-up (no OTP).
- `frontend/src/server/queries/profile-identity.ts` — `phoneVerified` field and secondary reservation projection.
- `frontend/src/features/installer-settings/installer-settings.tsx` — existing primary verified/unverified badge.
- `frontend/src/features/settings/secondary-phone.tsx` — unverified secondary reservation UI.
- `frontend/src/server/actions/secondary-phone.ts` — reserve, edit, renew, cancel, convert.
- `supabase/migrations/20261021090004_secondary_phone_reservations.sql` — single authority on reservation rules.
- `supabase/migrations/20261024090004_installer_phone_change_journal.sql` — phone/alias journal and invalidate verification on change.
- `frontend/src/server/queries/registration.ts` — `hasAppAccess()` existing gate.
- `docs/operations/WHATSAPP_OTP_IDENTITY_PILOT.md` (PR #114) — preliminary compatibility warning and `new_phone` contract.
- Supabase MFA TOTP guide: https://supabase.com/docs/guides/auth/auth-mfa/totp
- Supabase Phone MFA pricing: https://supabase.com/docs/guides/auth/auth-mfa/phone
- Meta template billing: https://developers.facebook.com/docs/whatsapp/pricing/
