# Sprint 8 — Business Readiness & Client-Ready Sales

Completes the **business / organization onboarding** track of the shared onboarding
engine and polishes the existing **Sales workspace** to client-ready visual quality
for the B2B Pilot. Feature sprint; no payments/subscriptions, no OTP, no speculative
verification requirements. Builds on the Sprint 7.2/7.3/7.4 registration + shared +
individual onboarding foundation.

## Business flows completed

One **shared** business onboarding flow (`/onboarding/business`,
`features/onboarding/business-flow.tsx`) serves every business persona — the
persona-specific difference is only the pre-selected business type:

- **Showroom / Dealer**, **Supplier**, **Manufacturer / Importer / Wholesaler** — the
  concrete `org_type` chosen at the shared account-type step pre-selects the type.
- **Organization owner / manager** — the generic business choice; the owner picks the
  type in the wizard. **Transitional (2026-08-12):** kept for backward compatibility and
  resume safety only. Owner/manager is a *relationship*, never an account or business
  type; the target registration UX is *personal persona OR concrete business type*, with
  the creator becoming Owner automatically (PRODUCT_DIRECTION_GUIDE).
- **Invited organization employee** — joins through the **existing** invitation path
  (`/auth/invite/[token]` → `invitation_accept`), unchanged. An invited employee never
  creates an org: acceptance only bridges into a membership.

Supported common sequence (5 steps + handoff): **Business identity** (display + legal
name, description) → **Business type** → **Primary location** (governorate + general
city) → **Primary branch** → **Review** (with the explicit owner/manager confirmation)
→ organization created + Pilot review handoff. State is persisted per step in
`public.business_onboarding` and hydrated on load (no client store), matching the
individual-onboarding pattern.

## Organization / membership behavior

Owner submit runs the trusted, transactional path `app.organization_create_owned`
(internal; reached only via `business_submit`), which in one transaction:

- creates the **organization** with `status = pending_verification`, `is_verified =
  false` — never self-verified (existing product rule);
- creates the owner's **active membership**;
- grants the **full owner capability set** (26 keys incl. `org.manage`, which drives
  Sales authority in the workspace);
- creates the **primary branch** and wires `memberships.primary_branch_id`;
- emits `organization.created` / `branch.created` / `membership.granted` /
  `membership.activated` audit events.

Result: the owner's now-active membership makes `my_registration_state()` resolve to
`active_personal`, so they enter the **B2B workspace** immediately while the org stays
`pending_verification` (public listing unlocks after verification). No user gains
organization access outside a trusted membership path — the org-creation helper is not
client-callable, direct writes to the draft table are denied, and RLS is self-only.

Invited employee: `invitation_accept` (unchanged) verifies the email match, activates
the membership within the org/branch scope, and lands the employee in `/b2b`.

## Sales UI surfaces polished

Client-ready refinement of the existing functional Sales surfaces — **no** business
rule, Realtime, ownership, or RPC changes:

- **Shared `PageHeader`** (`features/sales/page-parts.tsx`) upgraded: one-line
  subtitle, a subtle result-count pill, and an iconized primary action (leading `+`,
  consistent with the home quick actions). Direction-neutral for RTL.
- Applied enriched headers (subtitle + live count) to **/b2b/customers**, **/b2b/leads**
  (+ pipeline view), and **/b2b/follow-ups**.
- **Empty states** on all three list surfaces now render an intentional icon.
- Existing detail/edit forms, badges, timelines, filters, and mobile layouts were
  reviewed and left on the established design system (already client-ready).

## Bilingual quality

All touched surfaces pass EN (LTR) / AR (RTL) parity — translation keys added under
`onboarding.business.*` and `customers/leads/followUps.subtitle` in both catalogs;
i18n parity test green. No hard-coded interface copy; directional controls use logical
properties (no manual flipping); no horizontal overflow on the business wizard.

## Validation result

- **DB**: new migration `20260809100000_business_onboarding.sql`; pgTAP
  `supabase/tests/22_business_onboarding_test.sql` (19 assertions) covering the track
  gate, required-field gates, transactional org+membership+branch+capabilities
  creation, `pending_verification`/unverified invariant, idempotency, audit, RLS, and
  the internal-only helper. `db reset` / `db lint` / `test db` run in the final gate.
- **Frontend**: `typecheck` ✓, `lint` ✓, `test` ✓ (144 incl. the new `business-flow`
  component test), `build` in the final gate.
- **E2E**: `business-onboarding.spec.ts` (owner full flow → workspace; persona
  isolation); updated the stale Sprint 7.3 assertion for the business handoff (now
  enters the wizard). Full standard integration gate run once at sprint end.

## Unresolved MVP gaps (post-Sprint 8)

- Owner can't yet **invite employees / add branches** from inside the workspace (org
  admin UI) — invitations exist at the RPC + accept-link level only.
- Organization **verification review UI** (platform-side approval to flip
  `pending_verification` → `active`/verified) is a later admin sprint.
- Supplier/Showroom **catalog & product ops** (05D) and the B2C value journey (05A/05B)
  remain out of scope.
- Business location is captured on the draft but not yet surfaced as a structured
  locality/address (localities model is a later phase).
