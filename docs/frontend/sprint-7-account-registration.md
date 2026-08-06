# Sprint 7.2 — Account Access & Registration

| | |
|---|---|
| **Status** | Implemented · 2026-08-06 · Phase 2 |
| **Branch** | `feature/account-registration` (from `main` @ `4831082`, PR #11 merged) · PR → `main` |
| **Objective** | The shared Pilot account-access + Email-OTP registration journey: bilingual integrity, consent, resumable registration state, invitation entry, and a safe lost-email support path. **No persona-specific onboarding.** |
| **Builds on** | Sprint 7.0 audit (`ui-auth-onboarding-audit.md`) and Sprint 7.1 split-panel auth foundation (`sprint-7-client-ready-ui-foundation.md`). |

## Pilot rules implemented

- **Email OTP only.** Phone / WhatsApp OTP are out of scope; no phone collection (deferred to onboarding).
- **Sign In and Sign Up are separate routes.** Sign In never creates a user (`shouldCreateUser: false`); Sign Up may (`shouldCreateUser: true`).
- **No passwords, no phone fields, no WhatsApp choices, no fake social logins, no account enumeration** — an already-registered email and an unknown email produce identical responses until a code is verified.
- **Public registration** (end consumer / independent professional / organization owner-manager) via Sign Up; **invited employees** enter via an invitation token only.
- **Personal activation** = verified email + required consent. **Organization activation is not completed here** (later business onboarding / manual review).
- **Lost email** → no automatic email replacement; the user is directed to the configured manual support path.
- **Registration is resumable** after verified account creation (`/onboarding` resolves the next step).

## Routes added / refined

| Route | Purpose |
|---|---|
| `/auth/sign-in` (refined) | Existing-account Email-OTP. Added Sign Up + Recovery links; removed a duplicate language switcher; now shares the OTP flow component. Behavior unchanged (`shouldCreateUser: false`, resend, change-email, sibling forms). |
| `/auth/sign-up` (new) | Email + Terms/Privacy/Pilot consent → OTP → identity bootstrap → consent receipt → `/onboarding`. Consent gate disables send until all three are accepted and is re-checked server-side. |
| `/auth/verify` (new) | Standalone email + code verification (no PII in the URL). |
| `/auth/recovery` (new) | Requests a fresh Email OTP for an account whose email the user still controls; explains the single verification channel; links to support. |
| `/auth/support` (new) | Lost-channel help: manual identity review, never reveals whether an email has an account, shows the configured `NEXT_PUBLIC_SUPPORT_CONTACT` or a safe unavailable state — never a fabricated contact. |
| `/auth/invite/[token]` (new) | Token invitation entry: invalid / expired / used / withdrawn states; masked invited email; accept when signed in as the matching verified email; sign-in / create-account CTAs otherwise. |
| `/onboarding` (new) | Post-registration handoff. Resolves and displays the current setup state + next required step only — **no persona fields**. Active users are forwarded to `/b2b`; unauthenticated to `/auth/sign-in`. |

The shared two-step Email-OTP flow (`features/auth/email-otp-flow.tsx`) is used by Sign In, Sign Up, and Recovery — one component, no merged/ambiguous screen. Post-auth redirects use a strict internal allowlist (`server/auth/next.ts`) preventing open redirects.

## Database changes

One migration — `20260806100000_account_registration.sql` (smallest coherent additions; the rest is derived from existing tables):

- **`consent_receipts`** (+ `consent_type` enum) — auditable acceptance: user, type, **server-controlled version** (`app.current_consent_version`), locale, timestamp. No user-agent / tracking data. Written only via `record_consent()`; RLS self-read; no client write path.
- **`organization_invitations`** (+ `invitation_status` enum) — token-addressable pre-account invitation. RPCs: `invitation_create` (needs `org.members.manage`), `invitation_lookup` (anti-enumeration; returns only a masked email + org name + resolved state; callable by anon), `invitation_accept` (email-bound, single-use, **bridges into the existing `memberships` model** and emits `membership.*` audit — not a second invitation system).
- **`my_registration_state()`** — derives `unverified | consent_pending | onboarding_pending | invitation_pending | organization_setup_pending | active_personal | manually_blocked` from `auth.users` + `consent_receipts` + `users.status` + `memberships`. **No new state column.**

All functions are `security definer`, pin `search_path`, schema-qualify references, and derive the actor from `auth.uid()`. `users.status` / `primary_account_type` stay server-controlled — this migration never lets a client flip them.

## Consent model

Three required consent types (`terms`, `privacy`, `pilot`). A receipt is `(user, type, version, locale, accepted_at)`, unique on `(user, type, version)` so re-accepting a version is a no-op. **Versions are configuration constants**, not client input. Consent is captured before a code is sent (gate) and persisted immediately after verification; `/onboarding` re-requests it if a receipt is still outstanding.

## Registration state & resume

State is **derived**, not stored. Resume rules: no session → `/auth/sign-in`; `active_personal` (active membership or active status) → `/b2b`; `consent_pending` → the consent step; `onboarding_pending` → verified handoff (persona onboarding is a later sprint); `invitation_pending` → open the invitation link; `organization_setup_pending` → in-review notice; `manually_blocked` → contact support. Existing active members (e.g. invited salespeople) are **never re-gated on the registration consent step**. Expected validation errors preserve entered consent (controlled state).

## Invitation behavior

`invitation_lookup` never returns the raw email or organization id — only a masked email (`k•••@•••.test`), the org name, and a state. `invitation_accept` requires a signed-in, email-verified caller whose email matches the invitation; it is single-use, cannot be accepted by another email, and creates/activates a normal membership through the trusted backend path. Invalid / expired / used / withdrawn all render distinct states.

## Recovery limitations

The Pilot has a single verification channel (email). Recovery only re-sends a code to an address the user still controls. When the user has lost the email, the only path is manual identity review via `/auth/support` — the system never auto-changes an account's email and never exposes whether an email has an account. If `NEXT_PUBLIC_SUPPORT_CONTACT` is unset, a safe unavailable state is shown (no fabricated contact).

## Bilingual audit — findings & fixes

- **Fixed:** duplicate language switcher on `/auth/sign-in` (the layout already provides one).
- **Parity:** Arabic and English catalogs have exact key parity (enforced by `i18n.test.ts`). All new auth / onboarding / consent / support / invitation copy exists in both, is natural (not mechanically reversed) Arabic and fully-English English.
- **New automated guards** (`i18n.test.ts`): (1) the English catalog contains **no Arabic characters**; (2) the Arabic catalog contains **no unintended English words** (placeholders stripped; a one-entry whitelist for the neutral `you@company.com` email sample). Locale switch updates every visible string; Arabic stays RTL, English LTR; email/OTP/technical identifiers render `dir="ltr"` where needed.

## Testing

- Frontend: `typecheck` ✓ · `lint` ✓ · **132 unit tests** ✓ (incl. 2 new bilingual guards) · `build` ✓ (shared JS ~103 kB; new routes 0.6–3.9 kB each).
- Database: `supabase db reset` ✓ · `db lint` ✓ (no new warnings) · `supabase test db` ✓ — new pgTAP `20_account_registration_test.sql` (**25 assertions**: consent recording/forgery/idempotency, derived state, invitation create/lookup/accept, email-binding, single-use).
- E2E (`account-registration.spec.ts`, real Email-OTP via Mailpit): sign-up consent gate → create → verify → resume at `/onboarding`; Arabic RTL with no mixed-language leakage; recovery send; support unavailable state; invalid invitation; existing sign-in; valid invitation accepted by the matching account. Browser QA at 390×844 / 768×1024 / 1440×900 across ar/en × light/dark with no horizontal overflow.

## Remaining work for Sprint 7.3 (shared onboarding engine)

- Progress-header onboarding shell + Basic Profile (personal → contact → phone collection) and account-type selection; autosave/resume of persona answers.
- Wire the `organization_setup_pending` / org-creation flow (not reachable yet).
- Optional: a manager-facing "invite employee" UI on top of `invitation_create` (backend + entry screen exist; no compose UI this sprint).
- A production `NEXT_PUBLIC_SUPPORT_CONTACT` value once approved.
