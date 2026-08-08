# Sprint 7.3 — Shared Onboarding Engine (frontend)

| | |
|---|---|
| **Status** | Implemented · 2026-08-08 · Phase 2 |
| **Branch** | `feature/shared-onboarding-engine` (from `main` @ `9a7b2c0`, PR #12 merged) · PR → `main` |
| **Objective** | One resumable shared onboarding engine for every account type: Basic Profile → Contact → Account-Type → Persona Handoff. **No persona-specific questions this sprint.** |
| **Builds on** | Sprint 7.2 registration + consent + derived registration state; Sprint 7.1 client-ready auth/onboarding shell. |

## Shared sequence

1. **Basic Profile** (`/onboarding/profile`) — display name + preferred language. First/last name are **not** collected (the profile model has no such columns). Avatar is a placeholder only (no upload this sprint). The language Select defaults to the locale the visitor is browsing in.
2. **Contact Information** (`/onboarding/contact`) — the verified email is shown **read-only**; an Egyptian mobile is collected and stored **UNVERIFIED** (clearly labelled "not verified yet"; no Phone/WhatsApp OTP). Email/phone render `dir="ltr"` for correct bidi.
3. **Account-Type Selection** (`/onboarding/account-type`) — grouped Individual / Business cards; records the chosen track + concrete type as **intent only**. The invited-employee path is a non-selectable note (rejected server-side).
4. **Handoff** (`/onboarding/complete`) — shows the selected type and the next onboarding family. A handoff state, **not** activation.

`/onboarding` itself is the router: it resolves the derived state and forwards to the next incomplete step, the handoff, or the workspace.

## Persistence model

One new migration `20260808090001_shared_onboarding.sql` — the smallest coherent additions:

- **`public.onboarding_progress`** (one self-owned row/user): `phone` (unverified, EG-format CHECK), `selected_track` (`onboarding_track` enum: consumer/professional/business), `selected_account_type` (`account_type`, null for consumer / org-owner), per-step completion stamps (`profile_/contact_/account_type_completed_at`), and `completed_at` (handoff). RLS self-select; **writes only via RPCs**.
- **RPCs** (security-definer, `auth.uid()`-derived, verified-email gated, `search_path` pinned): `onboarding_save_profile` (also writes `profiles.display_name` + `users.locale` in one transaction), `onboarding_save_contact` (EG-mobile validation, requires profile done), `onboarding_select_account_type` (records intent, enforces step order + track rules, audits `onboarding.completed`). A shared `app.require_verified_caller()` helper gates all three.
- **`my_registration_state()`** re-created to emit the finer resumable states (`profile_pending`, `contact_pending`, `account_type_pending`, `consumer_onboarding_pending`, `persona_onboarding_pending`, keeping `organization_setup_pending`, `invitation_pending`, `active_personal`, `consent_pending`, `manually_blocked`). **No stored state column** — state stays derived (now also from `onboarding_progress`).

**Reused, not duplicated:** `profiles.display_name`, `users.locale`, the `account_type` enum, Sprint 7.2 registration/consent state. **`users.primary_account_type` is never mutated** by onboarding — professional/business types still apply only through the trusted account-upgrade/review workflow (Sprint 7.4/7.5). Reaching the handoff is the only meaningful state change, and it is audited (`onboarding.completed`, added to the audit allow-list).

## Resume rules

- Each step persists independently on explicit **Continue** (no global state library; no per-keystroke autosave).
- Reopening `/onboarding` (or any step route) forwards to the **next incomplete step**; deep-linking a later step bounces back.
- Refresh / browser Back never lose saved progress; a prior account-type choice is re-selected from the stored track + type.
- Validation errors preserve entered input (controlled consent/selection, `defaultValue` fields).
- **Sign-out → sign-in resumes**: `verifyEmailOtp` routes a non-active caller to `/onboarding` when the destination was the default workspace (an explicit invitation/onboarding target is honoured as-is).
- **Active existing members** (e.g. the seeded manager) skip onboarding and reach `/b2b`; **invited employees** continue via the invitation/member path; **incomplete new accounts** remain in onboarding.

## Account-type grouping & rules

| Group | Choices | Track → terminal state |
|---|---|---|
| **Individual** | end consumer | consumer → `consumer_onboarding_pending` |
| | engineer/designer, installer/technician, contractor, salesperson | professional → `persona_onboarding_pending` |
| **Business** | showroom/dealer, supplier, manufacturer/importer/wholesaler, organization owner/manager | business → `organization_setup_pending` |
| **Invitation** | invited organization employee | **not selectable** — directed to the invitation link |

Rules enforced (server + UI): the invited-employee type cannot be chosen through public registration (rejected by the RPC and by the action); consumer stores a null concrete type; "organization owner/manager" has no `account_type` enum value (null concrete type, business track). Business organizations are **not activated** this sprint; no payment/verification requirements were invented. Account type is intent only and is not silently overwritten; changing it after completion still routes through the existing upgrade workflow.

## Bilingual validation

All new onboarding/step/account-type/handoff copy added to `en.ts` + `ar.ts` with natural Arabic (logical reading order). Guards in `i18n.test.ts`: exact AR/EN key parity; no Arabic characters in the English catalog; no unintended English prose in the Arabic catalog; a dedicated Sprint 7.3 block asserting the new keys are present, real Arabic, and preserve the `{current}`/`{total}` step-counter placeholders (the `01012345678` phone sample is whitelisted as a neutral technical sample). Locale switch updates every label; the progress header + Back/Continue mirror correctly in RTL via logical properties; email/phone use `dir="ltr"`.

## Browser evidence

Executed E2E (`shared-onboarding.spec.ts`, real Email-OTP via Mailpit, both desktop 1440×900 and mobile 390×844 projects): full individual flow → persona handoff; refresh resumes saved profile and phone stays unverified; deep-link redirects to the next incomplete step; **Arabic + dark** business flow → organization-setup handoff with `dir=rtl` and no horizontal overflow; sign-out → sign-in resumes at the next step; an active member skips onboarding to `/b2b`. Sprint 7.2's sign-up test was updated to assert the new resume target (`/onboarding/profile`). Progress step direction, focus after validation, and no clipped actions were verified across 390×844 / 768×1024 / 1440×900 in en/ar × light/dark.

## Production-mode performance

Measured against a production server (`next build` + `next start`) with `PERF=1` (`onboarding-perf.spec.ts`): cold + median-of-3-warm load, request count, transferred bytes, and console/page/failed-request counts for `/onboarding`, `/onboarding/profile`, `/onboarding/contact`, `/onboarding/account-type`. Result: **no console errors (beyond the known `/favicon.ico` 404 tech debt), no page errors, no failed requests, no duplicate submissions; warm LCP within budget; shared JS steady at ~103 kB (no regression)**. Exact measured values are recorded in the PR's validation notes. (See the Final Report for the captured figures.)

## Remaining work for Sprints 7.4 & 7.5

- **7.4 — Individual persona onboarding**: the professional questions behind `persona_onboarding_pending` (services/skills, service location, portfolio, verification submission via the existing `request_account_upgrade` workflow).
- **7.5 — Business/org onboarding**: the organization-setup flow behind `organization_setup_pending` (business identity, official info, branches, documents), org creation, and employee invite/accept.
- Deferred here: Phone/WhatsApp OTP + phone verification, avatar/media upload, document verification, payments/subscriptions, and the manual-review admin UI.
