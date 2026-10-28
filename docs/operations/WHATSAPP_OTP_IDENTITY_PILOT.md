# WhatsApp OTP — Existing Account Identity Compatibility and Pilot Plan
**Date:** 2026-10-28 | **Scope:** Acceptance, proposal only | **Status:** not implemented or approved

## Why this is a release blocker
The existing `/installer/sign-in` and `/showroom/sign-in` flows both call `phonePasswordSignIn` in `frontend/src/server/auth/phone-password.ts` through role-specific server actions. Registration creates an email/password identity whose **internal email is derived from the normalized phone** (`p2010...@craftsman-login.aladdin.invalid`); `public.profiles.phone_e164` is the app's authoritative phone claim. Supabase `auth.users.phone` is not populated by these flows. Profile phone changes and secondary-number reservation have separate database uniqueness/cooldown rules. The existing account ID, membership/points, portfolio, consent and roles cannot be replaced.

**Never expose the synthetic email alias to the user.** Never enable generic `signInWithOtp({phone})` or automatically create/merge Auth phone users in response to a phone entered on a sign-in screen. The current Send SMS Hook is **transport only** and cannot independently provide account linking.

## Read-only Acceptance inventory — 2026-10-28
Read-only aggregate SQL against `nxossqhdfltcqdwvbewi` (no user identity or phone exposed):
- 6 total `auth.users`.
- 0 aliases ending in `@craftsman-login.aladdin.invalid`.
- 0 users with nonempty `auth.users.phone`.
- 0 alias users with Auth phone already populated.

**Interpretation:** hosted Acceptance has no existing synthetic-phone-alias fixture to prove preservation of a canonical installer/showroom user ID. Do not claim full compatibility based on transport or isolated OTP tests. A controlled seeded fixture on local Supabase first (then Acceptance only after approval) is necessary.

## Proposed first product pilot — signed-in phone ownership proof (NOT anonymous login)
Given a pre-existing **authenticated** account (initially an owner-controlled test fixture), validate the current primary phone and initiate a verified phone change/enrollment via Supabase Auth:
1. Start with an authenticated SSR session and obtain `auth.getUser()` server-side; verify original `user.id` and entry account category. Reconfirm current password using existing audited password-confirm receipt if a password exists. Reuse existing rate limiter/Turnstile protections.
2. Check the requested canonical Egyptian E.164 number against `public.profiles.phone_e164` and reservation/secondary-phone rules before initiating a challenge; the authenticated user may challenge only **their already claimed primary phone** at first. Do not rely solely on the client-supplied phone.
3. If accepted by GoTrue, call `supabase.auth.updateUser({phone})` **on the current authenticated user's session**. This is the Supabase-documented phone-update flow, not new-user `signInWithOtp`. This may require enabling phone provider in isolated Acceptance; review its global signup implications first.
4. Supabase Auth creates/sends the phone-change challenge; the signed HTTPS Send SMS Hook can transport it to Meta only when the approved Acceptance allowlist/delivery gate is enabled. The Worker does not generate/store/verify codes.
5. User supplies code; only Supabase `verifyOtp({phone,token,type:"phone_change"})` can validate it. Check `user.id` **before and after**; abort/quarantine any mismatch, verified-phone conflict or unauthorized target change.
6. Confirm original password login still functions, the alias email remains unchanged, all memberships/RLS/points unchanged, and any Auth/provider identities behave as expected. Never silently change profile phone or secondary reservation during this test.

### Preconditions and unresolved questions
- Supabase Auth Phone provider activation has global consequences; check `auth.sms.enable_signup`/hosted equivalent, CAPTCHA, rate limits, OTP length/expiry, and provider behavior before enabling it even in Acceptance.
- Verify that Send SMS Hook fires for the **phone_change** case under the precise GoTrue version and how it represents `user.phone` while change is pending. Do not rely on documentation alone.
- Check the behavior when the email-alias user is password-only, phone is presently NULL in Auth, profile phone already claimed, and a second user attempts that number.
- Authentication owner may need step-up reauthentication before updating phone; setting a phone can create a new phone-login route, so validate token/session scope and recovery behavior with adversarial tests.
- For UI, label the first capability **Verify my phone**, not **Log in with WhatsApp**. Future role-specific login/forgot-password experience requires its own signed-off identity plan.

## Rejected shortcut and alternatives
| Option | Current verdict | Reason |
|---|---|---|
| Turn on Phone Auth + use `signInWithOtp({phone})` for any entered phone | **NO-GO** | Can create new Auth user, bypass existing alias mapping and split memberships/roles |
| Enable Send SMS Hook without implementing a triggering Supabase Phone OTP flow | **NO-GO** | Does not affect installer/showroom Phone + Password; no WhatsApp challenge fires |
| Use OTP entirely generated/verified by Cloudflare Worker | **NO-GO** | Duplicates auth/session authority and introduces new credential store and abuse risk |
| Signed-in `updateUser({phone})` + `phone_change` | **Candidate first pilot** | Preserves existing signed-in Auth user if thoroughly validated; still requires approval and security tests |
| Password recovery via WhatsApp for logged-out alias user | **Defer** | Needs secure identity resolution/recovery binding, anti-takeover and transaction replay design |

## Acceptance test matrix to implement before activating Hook
- [ ] Seed a controlled local installer alias fixture and showroom alias fixture using existing signup APIs (no Production user import). Document stable user IDs; no personal data in snapshots.
- [ ] Assert phone-password sign-in, SSR session, persona, membership and permission fingerprints before enrollment.
- [ ] Authenticated phone challenge with exact profile phone; wrong number, duplicate/secondary reservation, non-Egyptian input and unauthorized role attempts denied.
- [ ] Verified `phone_change` retains `auth.users.id` and alias; original password remains valid; no extra `auth.users` row or conflicting `auth.identities` entry.
- [ ] Brute-force attempts, expired OTP, replay and resend cooldown rejected by GoTrue; validated anti-enumeration and direct API behavior.
- [ ] Meta hook invalid signature/stale timestamp/replay, D1 outage, invalid template/Meta outage, rate limit and fail-closed paths covered.
- [ ] User-owned test mobile, no shared secret in logs/chat; delivery checked on handset if separately authorized.
- [ ] Distinct account kinds: installer, showroom; later test email+password and Google/Facebook linking only after product sign-off.
- [ ] Sign-out/in (original password), account access/permissions and session revocation after phone enrollment.
- [ ] Verify Production remains unaffected, and Supabase Acceptance rollback returns to pre-test state.

## Decision/approval needed before coding UI or changing hosted Auth
Decide which user action to ship first: (A) verified phone ownership while signed in (**recommended pilot**), (B) logged-out password recovery, or (C) WhatsApp OTP sign-in. Option (A) is the least disruptive to existing identities but is still **proposed**, not approved. Following approval, add a separate authenticated UI + server-action PR behind a flag and keep #114 as the isolated transport PR.

## Readable primary references
- Repo: `frontend/src/server/auth/phone-password.ts`, `frontend/src/server/actions/installer-phone-auth.ts`, `frontend/src/server/actions/showroom-phone-auth.ts`, `frontend/src/lib/auth/craftsman-login-alias.ts`, `frontend/src/server/actions/profile-identity.ts`, `frontend/src/server/actions/secondary-phone.ts`.
- [Supabase Phone Login — update phone](https://supabase.com/docs/guides/auth/phone-login#updating-a-phone-number)
- [Supabase Send SMS Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-sms-hook)
- [Supabase verifyOtp](https://supabase.com/docs/reference/javascript/auth-verifyotp)
- [WhatsApp OTP implementation ledger](WHATSAPP_OTP_IMPLEMENTATION_LOG.md)
