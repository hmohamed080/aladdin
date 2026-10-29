# ADR-0026 — "Complete your account": phone, governorate and town, specialties for every account

**Status:** Accepted for the preview · 2026-10-28 · owner decisions in the project thread ("onboarding for all accounts: phone, location (governorate, town), category"; category = the installer specialties list). Production only on the owner's production GO.

**Builds on:** [ADR-0025](ADR-0025-one-field-sign-in-whatsapp-sign-up.md) (sign-up) and the existing trade catalogue (`public.trades`, `public.user_trades`).

## Decision

1. **One screen, `/onboarding/basics`.** Asks, in this order and only for what is still missing: phone, governorate + town (an "Other" town can be typed), specialties (chips from `public.trades`; the first pick is the main one). Existing onboarding wizards are unchanged; what they already collected is reused and never asked again.
2. **When it shows.** Right after sign-up, and once at the next sign-in for existing accounts: `postSessionRedirect`, `entryLandingPath` and `/onboarding` (ready states) redirect there while anything is missing. The check **fails open**: a read error never blocks sign-in.
3. **Storage.**
   - Phone: the existing `public.profile_set_phone` (unverified, as on the profile page).
   - Location: new `profiles.governorate_key`, `city_key`, `city_custom_name`, validated by `app.normalize_business_location` (same catalogue as branches). `my_account_basics()` falls back to the primary branch of an organization the person **owns** (active membership with `org.manage`; the oldest ownership when there are several), so an owner who gave the business location in business onboarding is not asked again. An employee's employer branch never counts as their own location, and the branch location is only read, never copied onto the profile.
   - Specialties: professional personas keep using `public.user_trades` (through `user_trades_set`); every other account writes the new `public.user_specialties` (self/support read, written only by the RPC), so the professional-only rule on `user_trades` stays intact. Only the table of the **current** persona is read, so specialties left from an earlier persona never satisfy the requirement.
4. **RPCs.** `public.account_basics_set(governorate, city, city_custom, specialties[])` (security definer; a null part is left unchanged; 1–30 active trades) and `public.my_account_basics()` (jsonb). Both are granted to `authenticated` only, with exact contracts in `supabase/permissions/20261029090001.json`.

## Configuration

- Migration `20261029090001_account_basics.sql` (renamed from `20261028090002` on 2026-10-29 so it sorts after `20261028090003`, already on Acceptance from PR #116) must be pushed with the Supabase CLI (`supabase db push`, versioned history) before this code is deployed against a project. No manual SQL Editor runs, no history edits.
- Not covered here: the interrupted sign-up / email-code resume problem is tracked separately (PR #116).

## Consequences

- Every account now carries a location and at least one specialty, usable later for matching and discovery.
- The phone collected here is not verified; a WhatsApp check can be added later with the ADR-0025 code flow.
- Non-professional specialties live in a separate table; reads should use `my_account_basics()` (or union both tables) rather than `user_trades` alone.

## Amendment 2026-10-29 — steps inside onboarding, a list per account type (migration `20261029090002`)

Owner decisions in the project thread: phone, location and specialties are **steps inside onboarding**, not a separate page; and each account type sees **its own** specialty list (owner lists of 2026-10-29). The lists are the platform's existing vocabularies, so nothing new is invented:

| Account | List | Where it is asked | Stored in |
|---|---|---|---|
| Craftsmen | the 14 active `public.trades` | `/onboarding/basics`, one step per missing item | `public.user_trades` (`user_trades_set`) |
| Engineer | `public.activities` persona `engineer`: Civil engineer, Architect (`finishing` retired) | `/onboarding/basics` | `public.user_activities` |
| Showroom, Supplier, Manufacturer, Importer | `public.activities` of the organization type (Showroom 4, Supplier 2, Manufacturer 2, Importer 2) | business setup ("Business activity"), now for every business type with a list | `public.organization_activities` |
| Sales Team, Contractor, Personal | none yet (owner: later) | not asked | — |

- A business account's list belongs to the **business** (business classification is the organization's), so it is never stored on the person. While the first business is outstanding, `/onboarding/basics` redirects to business setup, which also asks the owner's phone when it is missing; the business location counts as theirs once the business exists.
- `app.account_specialty_kind(uuid)` names the personal list: `trades | engineer | none`, from the current persona only.
- A professional's first location also becomes their primary service area (`user_service_areas_set`) when they have none, so the profile does not ask for it again.
- `public.user_specialties` (installer trades offered to businesses) is dropped; it never reached Production.
