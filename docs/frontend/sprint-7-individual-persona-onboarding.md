# Sprint 7.4 — Individual Persona Onboarding (frontend)

| | |
|---|---|
| **Status** | Implemented · 2026-08-08 · Phase 2 |
| **Branch** | `feature/individual-persona-onboarding` (from `main` @ `e5a1560`, PR #13 merged) · PR → `main` |
| **Objective** | The persona-specific onboarding journeys for individual users (End Consumer + the four individual professionals), built on the Sprint 7.3 shared engine — no duplicated flows, approved UI-UX preserved, bilingual integrity intact. |
| **Builds on** | Sprint 7.3 shared onboarding (progress shell, resumable state, account-type intent), Sprint 7.2 registration/consent, Sprint 2 account-upgrade/verification workflow. |

## Audited canonical design references

Read-only via the Pencil MCP export (`.pen` untouched):

- **Consumer Onboarding — `05.1.1–05.1.5`** (`GROUP — Consumer Experience → FLOW — Consumer Onboarding`): Project Overview (usage intent + "your exact location stays private" note) → Interests (category chips) → General Location (governorate + general city, **no** detailed address) → Optional Budget (bands + "not decided", skippable) → Review.
- **Professional Onboarding — `05.2.1–05.2.6`** (`GROUP — Professional and Talent Experience → FLOW — Professional Onboarding`): Identity (public headline, years of experience, short bio, selected profession, specialization) → Services & Skills (core + additional services, languages, availability) → Service Location (served areas, remote-consult toggle, governorate/city, max travel — **no office address**) → Portfolio (media, **optional**) → Verification Requirements (informational checklist) → Review → "Continue to documents".
- Reused canonical components observed: Progress Header, Category Selector, Choice Chip, Optional Tag, Service Area Selector, Governorate/City selects, Review Section, Verif/Req items.

## Architecture — one shared engine, minimal branching

```
Shared onboarding (7.3)  →  account-type INTENT
        └── /onboarding resolver (derived state)
              ├── consumer  → /onboarding/consumer            (one wizard: 05.1.x + review + terminal)
              └── professional → /onboarding/professional      (one common wizard: 05.2.1–5)
                                → /onboarding/professional/review  (05.2.6 + submitted terminal)
```

There is **one** consumer wizard and **one** professional wizard. The professional
persona branch is deliberately small, exactly where the product differs:

- **Engineer / Designer** resolves a **concrete type** (`engineer` vs `interior_designer`) — the account-type model and design keep these distinct, so the identity step offers the sub-choice and the submission requests an upgrade to the chosen one.
- **Installer/Technician, Contractor, Salesperson** have a fixed concrete type and draw their **specialization / service** option sets from their own lists (`lib/onboarding/persona-fields.ts`). No other structural difference.

State lives in the DB (hydrated on load); there is **no client state library** — each wizard holds local step state and persists the accumulated answers on every Continue.

## Consumer sequence (all steps optional)

Project intent → interests → general location (governorate + general city only) →
optional budget → review → **completion terminal**. Completion is a **handoff, not
activation**: `users.status` is untouched, no organization is created, no
professional verification is requested. The terminal shows a read-only recap and a
safe sign-out/return. (No B2C workspace exists yet — see PRODUCT DECISION below.)

## Professional common flow + persona differences

Identity → Services & Skills → Service Location → Portfolio → Verification → Review.
`headline`, `bio`, and `languages` are written to **`profiles`** (reused, not
duplicated). The **Portfolio** step is informational/optional this sprint — media
upload is Storage-gated and deferred (like the 7.3 avatar), so no half-feature was
invented. **Verification Requirements** is an informational checklist; the actual
document submission belongs to the later designed flow.

Submit (`Review → Submit for review`) validates the required fields, stamps
completion, and **hands off to the existing trusted upgrade workflow**
(`request_account_upgrade` → a `submitted` verification). The terminal is the
"with review" state.

## Persistence / state model

One new migration `20260808100000_individual_persona_onboarding.sql` — the smallest
coherent addition:

- **`public.individual_onboarding`** (one self-owned row/user): the consumer branch (`consumer_intent`, `consumer_interests[]`, `consumer_governorate/city`, `consumer_budget`) and the professional common branch (`prof_concrete_type`, `prof_years_experience`, `prof_specialization`, `prof_services[]`, `prof_additional_services[]`, `prof_availability`, `prof_service_areas[]`, `prof_offers_remote`, `prof_governorate/city`, `prof_max_travel_km`), plus `consumer_completed_at` / `professional_completed_at`. **Reused, not duplicated:** `profiles.headline/bio/languages`. RLS self-select; **writes only via RPCs**.
- **RPCs** (security-definer, `auth.uid()`-derived, verified-email gated via the 7.3 `app.require_verified_caller()`, `search_path` pinned): `individual_save_consumer` + `individual_complete_consumer` (consumer-track gated; all fields optional; audits `onboarding.consumer_completed`); `individual_save_professional` (professional-track gated; also writes `profiles.*` transactionally) + `individual_submit_professional` (required-field check, calls `request_account_upgrade`, audits `onboarding.professional_submitted`). Track gating (`app.onboarding_selected_track`) keeps a consumer out of the professional branch and vice-versa at the database boundary.
- **`my_registration_state()`** re-created with two finer terminals: `consumer_onboarding_complete` and `persona_review_pending`. **No stored state column** — state stays derived (now also from `individual_onboarding` + the submitted verification).

**`users.primary_account_type` is never mutated** by onboarding (proved by the DB test); the account type applies only through the trusted upgrade/review workflow (Sprint 7.5+ admin review UI). **Phone remains unverified.** No new PII; no speculative tables.

## Account-upgrade integration (per persona)

| Persona | Concrete type | On completion |
|---|---|---|
| End Consumer | none | onboarding completed + audited; **no activation**, no upgrade request |
| Engineer / Designer | `engineer` **or** `interior_designer` (resolved) | `request_account_upgrade` → review pending |
| Installer / Technician | `installer_technician` | `request_account_upgrade` → review pending |
| Contractor | `contractor` | `request_account_upgrade` → review pending |
| Salesperson | `sales` | `request_account_upgrade` → review pending; **no org created, no showroom attachment** |

Manual-review rules were **not** invented: submission produces a `submitted`
verification and hands off to the existing review RPCs; document upload is left to
the later designed flow.

## Bilingual validation

All new consumer/professional copy added to `en.ts` + `ar.ts` with natural Arabic in
logical reading order. `i18n.test.ts` gains a **Sprint 7.4** block: full
consumer+professional surface present in both locales (>120 keys), every Arabic
value real Arabic and non-empty, and placeholder parity (incl. the `{n}` experience
counter). Parity / no-stray-script guards from earlier sprints cover the rest. No
hard-coded user-facing strings in the changed components; locale switch updates every
label; the wizard progress and Back/Continue mirror correctly in RTL via logical
properties; governorate/city/budget values are DB taxonomy keys resolved through
i18n (not translation defects).

## Browser / E2E evidence

`e2e/individual-onboarding.spec.ts` drives the **real** flow (Email-OTP + consent +
shared steps) for all five personas across the desktop (1440×900) and mobile
(390×844) Playwright projects:

- **End Consumer** (en/light): optional flow → review → completion terminal; **refresh resumes** on the next step; **Back** preserves the saved intent selection; no horizontal overflow.
- **Engineer / Designer** (en/light): the concrete-type sub-choice; the Review shows the resolved **Engineer** type; submit → "with review" terminal.
- **Installer / Technician** (**Arabic + dark**): fixed type, `dir=rtl`, no overflow, submit → Arabic "with review".
- **Contractor** / **Salesperson** (en/light): common flow → submit; the salesperson **never enters `/b2b`** and no org is created.
- **Persona isolation**: a consumer deep-linking `/onboarding/professional[/review]` is bounced back to `/onboarding/consumer`.

Sign-out/sign-in resume, the active-member bypass, and business/invitation isolation
remain covered by the Sprint 7.3 suite (unchanged state entry points).

DB: `supabase/tests/11_individual_persona_onboarding_test.sql` (17 assertions) proves
the track gates, persistence, the required-field submit gate, the handoff to a
`submitted` verification for the resolved concrete type, and that
`primary_account_type` / `users.status` are **never** changed by onboarding.

## Production-mode quality

The persona routes build at ~126 kB first-load JS; **shared JS steady at 103 kB (no
regression)**. Warm-median figures for the representative Consumer and Professional
routes are captured in the PR validation notes. No second broad performance suite was
added (the standard E2E harness already runs in production mode).

## Unresolved — PRODUCT DECISION REQUIRED

- **Consumer terminal / activation**: no B2C workspace or discovery surface exists yet, so consumer completion is a **handoff, not activation** (owner-confirmed for this sprint). When/what activates a consumer account and where it lands is a later product decision.
- **Portfolio & verification-document upload**: Storage-gated (deferred since 7.3). Represented as optional/"complete later"; the real upload + document review belong to a later designed flow.
- **Localities**: no `localities` table yet (the `profiles.locality_id` FK is deferred). Governorate/city are stored as taxonomy-key text for now.

## Remaining work for Sprint 7.5

- Business / organization onboarding behind `organization_setup_pending` (identity, official info, branches, documents), org creation, and employee invite/accept.
- The professional **document verification** submission + the admin manual-review UI that drives `review_*` / `apply_account_upgrade`.
- Consumer activation + the B2C destination once that surface exists.
- Deferred platform-wide: Phone/WhatsApp OTP, media/document upload, payments/subscriptions, wallet/incentives, the Sales Passport feature set.
