# Product

<!-- impeccable:product-schema 1 -->

<!--
Impeccable's durable product record for Aladdin. It distills the canonical
project-memory docs into the schema the design skill reads before any surface
work. It does not replace them — the deeper authorities remain:
  - docs/product/PRODUCT_DIRECTION_GUIDE.md — vision, positioning, guardrails
  - docs/product/mvp-scope.md — what and in what order
  - UI-UX/UI_UX_SYSTEM_GUIDE.md — design system, tokens, UX rules
  - docs/product/design-idea.md — founder brief (Arabic, verbatim)
When those and this file disagree, they win; update this file to match.
-->

## Platform

web

Next.js App Router web app, delivered as a responsive PWA (Desktop / Tablet / Mobile). Mobile is responsive web, not a native app.

## Users

**Primary daily-active user: Sales.** Sales is the product's center of gravity and highest-frequency user — an operator running a real pipeline inside an organization (the tenant). Optimize relentlessly for their speed and low friction; when priorities conflict, the Sales workflow leads.

Other confirmed audiences, kept as **separate roles** even where behavior overlaps:
- **End Consumer** (B2C) — seeking advice, discovery, and a path to trusted execution.
- **Service providers** — Installer/Technician, Engineer, Interior Designer.
- **Businesses** (organizations, classified by `org_type` — not personal identities) — Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Contractor company.
- **Learning** — Trainer, Trainee.
- **Administrator** — governance and platform operations (a deliberately darker/utilitarian surface).

Market and context: Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector. English-first release, with Arabic (RTL) part of the MVP.

## Product Purpose

Aladdin is an **AI-first operating system / digital infrastructure** for one vertical in one market: it runs the whole value chain — **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up** — replacing WhatsApp threads, spreadsheets, and word-of-mouth with one intelligent, bilingual system.

**B2B-first**, with a connected **B2C consultation/discovery** layer that is the demand-and-discovery face of the same value chain — not a separate product and not a storefront.

Success means: a Sales user runs their real daily pipeline in Aladdin instead of WhatsApp/spreadsheets; a need becomes a trusted, verified match and a comparable quote without leaving the system; cross-tenant isolation holds everywhere; bilingual and light/dark parity hold from day one; and AI output is always attributable and human-reviewed before it acts.

## Positioning

A **vertical, AI-first operating system** — consultation-first, trust-first, and bilingual (Arabic RTL / English LTR). The defensible mechanism is guiding a decision to the *right, verified* provider/product and turning the B2B Sales operating workflow into structured data (needs, matches, quotes, pipeline) that powers discovery, matching, and AI for every other surface.

It is deliberately **not**:
- a marketplace with add-to-cart / checkout / storefront commerce;
- a price-war reverse-auction / blind price bidding;
- a generic, configurable horizontal CRM.

## Operating Context

- **The organization is the tenant.** Sales operates inside it; the B2B workflow is the wedge (design roadmap 05C, built first): Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task.
- **Three surfaces are skins of one design/data system**, not three products: B2C (discovery/consultation), B2B workspace (Sales-led), Admin (governance).
- **Surface-appropriate navigation:** B2C uses discovery-style top navigation with prominent search; B2B/Admin use a workspace shell with a sidebar. Navigation is **derived** (from primary account type, org membership, branch assignment, permission capabilities, verification state, subscription state) — never a role toggle.
- **Egyptian conventions are factual:** real locality data (Cairo, New Cairo, Sheikh Zayed), currency in EGP.
- Replaces the incumbent tooling of the sector: WhatsApp threads, spreadsheets, and word-of-mouth referrals.

## Capabilities and Constraints

**MVP capability areas:** passwordless Authentication · Onboarding & Profiles · Roles & derived navigation · Portfolio · Product Catalog · Smart Search · AI Assistant · Notifications · Subscription · Advertisement · Admin — plus the core value journey (AI consult → intent → discovery → search → matching → profile → product → RFQ → quote → project).

**Authentication (canonical, hard constraint):** Passwordless. Register / sign in via **WhatsApp OTP** or **Email OTP / verification link**. WhatsApp OTP only for phone (no SMS). The user verifies exactly **one** primary contact at account creation; a secondary is added later from profile settings. **No passwords, and no password / forgot / reset flows anywhere.** reCAPTCHA only on Create Account. One canonical identity regardless of verification method.

**Identity model (hard constraint):** **One person = one user ID** — one canonical identity per person, never a second user for another role, contact channel, or business. Roles stay separate in the taxonomy; they are merged only by an explicit, recorded decision. **One current primary account type at a time — no Profile Switcher, no "Use As" mode, no persona/account-identity-switching UI.** Organization membership, branch assignment, and permission capabilities attach to the canonical account; they do not fork it.

**Business classification (hard constraint):** Concrete business classifications (Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · contractor company · design/engineering office) are canonically **`organizations.org_type`** — never the person's long-term identity. **`users.primary_account_type` is personal persona state only;** one user may own organizations of several different types simultaneously, which a single value cannot represent. Choosing *"I am a Showroom"* at registration stays good UX and means *"I am creating a business whose `org_type` is X"*. Business-valued account types that exist today are **transitional compatibility**, not the target source of truth.

**Personal vs. business (hard constraint):** Personal identity is **not** a business — a personal professional (Engineer, Interior Designer, Installer/Technician, Contractor, Salesperson, Consumer) is fully usable with **zero** organizations. A business is an **Organization**, created **once** in the UX (the backend transactionally creates organization + owner membership + primary branch), linked to the user by a **Membership** that owns the relationship, capabilities, branch scope, and lifecycle. The same login may hold **zero, one, or many** organizations, and an existing user can add a business later without a second sign-up. **"Owner/manager" is a relationship, never an account or business type.** A **workspace** is a derived UX concept (Personal = User+Profile · Business = Organization+active Membership) — switching the active **work context** is allowed and is *not* persona switching. Full rules: [`docs/product/PRODUCT_DIRECTION_GUIDE.md`](docs/product/PRODUCT_DIRECTION_GUIDE.md).

**AI (hard constraint):** AI-first, tenant-scoped, human-reviewable. It drafts, explains, and ranks (intent extraction, consultation, match explanation, follow-up drafting, document RAG, evaluations); **humans decide and send.** AI never auto-sends or takes irreversible action silently. Retrieval applies authorization filters before returning content — no cross-organization leakage, ever.

**Cross-cutting requirements:** English (LTR) + Arabic (RTL) from day one; Light + Dark as first-class designed themes; responsive Desktop / Tablet / Mobile (PWA); token-driven design (components consume semantic tokens rather than raw brand values).

**Deferred / never:** Payments, escrow, milestones, disputes are designed later, **not** MVP. Add-to-cart/checkout commerce, price-war reverse-auction bidding, and a generic horizontal CRM are **never** built.

**Terminology:** the value chain terms (Need, Advice, Discovery, Trusted Match, RFQ, Quote, Decision, Execution, Follow-up), Smart Share, Opportunity, Pipeline, and the role names above are canonical — keep them consistent and do not merge roles.

**Undecided (do not fabricate):** commercial/monetization model beyond the presence of "Subscription" and "Advertisement" capability areas, pricing, licensing, deployment claims, and pilot success **metrics** are not yet specified. The formal client/business brief has not been supplied (`docs/product/client-brief.md` is a placeholder). Record these as open; future work must not invent them.

## Screen Organization and Variant Governance

This section is mandatory project policy for `UI-UX/design.pen` and every future design task.

### Permanent screen-organization policy

All product screens must always be organized as:

**Product Surface → Flow → Device → Theme → Sequence**

- Canonical device order: **Desktop → Tablet → Mobile**.
- Canonical theme order inside every device: **Light → Dark**.
- Sequence order inside each theme is determined by screen ID and the documented user flow, with the main path before supporting, error, exception, responsive-test, and specification states.
- Desktop, Tablet, and Mobile frames must never share an unstructured row.
- Light and Dark variants must never be mixed randomly. Every device and theme requires an explicit labelled lane or group.
- Product surfaces remain separate: Authentication, B2C/Consumer, Professional/Talent, B2B/Business, Admin, Shared/System, Foundation/Components/Documentation, and Archive.

### Future-screen placement rule

Every new screen or variant must be placed immediately in its correct product surface, flow, device, theme, and sequence position. A screen must not be created in a temporary unrelated canvas location and left there after completion. Nearby empty space must not be used when it violates the hierarchy.

### Future-edit preservation rule

Every modification, refactor, screen-completion task, or automated design task must preserve the established organization. Agents must not flatten the hierarchy, recombine devices into one row, mix Light and Dark variants, move screens into unrelated flows, remove organizational labels, place new screens over existing screens, or leave new frames outside their correct lane.

### Missing-screen rule

When a planned variant is missing, retain a labelled workspace-only placeholder in its correct lane. Do not hide missing coverage by collapsing the lane, and do not treat one device/theme variant as proof that the whole screen is complete. A large missing journey is documented as its expected sequence, never represented by a fake product screen.

### Variant completeness rule

Coverage is tracked independently as:

- Desktop Light
- Desktop Dark
- Tablet Light
- Tablet Dark
- Mobile Light
- Mobile Dark

A screen or flow is not fully complete unless every variant explicitly required by approved scope exists. This does not require every theoretical combination; only approved variants are required. Status reporting must use **Complete**, **Partial**, **Missing**, **Needs Review**, or **Not Required** for each variant independently.

### Responsive-test rule

The 360px and 430px variants belong in a separate **Responsive Test Variants** section. They test responsive behavior and never replace the canonical 390px Mobile screen. Canonical viewports remain Desktop 1440 × 1024, Tablet 768 × 1024, and Mobile 390 × 844.

### Product-screen protection rule

Existing product screens are locked during workspace organization. Only their complete top-level frames may be repositioned or reparented into the correct organizational lane. Internal UI layers must not be edited, resized, renamed, detached, or restructured merely to improve canvas organization.

### Organization validation rule

Before completing any future design task, validate that:

1. Every screen is in the correct product surface and flow.
2. Every screen is in the correct device and theme group.
3. Screen order matches its ID and documented user flow.
4. Main-path screens precede supporting and error states.
5. Responsive tests and specifications remain in their dedicated lanes.
6. No independent frames, labels, placeholders, or wrappers overlap.
7. No new frame remains outside its correct organizational lane.

This validation is mandatory before reporting a design task complete.

## Brand Commitments

- **Name:** Aladdin (confirmed).
- **Personality / voice:** "calm authority" — confident, uncluttered, expert; a premium professional tool, not a flashy consumer marketplace. Consultation-first, trust signals over hype.
- **No technical leakage in copy** (never surface "WhatsApp Business API", "reCAPTCHA verified", "canonical account", stack/schema jargon in the UI).
- **Approved identity direction (2026-08-01):** **The Aperture — a point of intelligent light in precise architectural structure.** The mark is a chamfered architectural opening focused on one warm Lumen core; never a literal lamp, genie, or ornamental heritage motif.
- **Approved type system:** Archivo for Latin brand/display, Reem Kufi for Arabic brand/display, Readex Pro for bilingual product UI, and JetBrains Mono for EGP figures, RFQ/quote codes, and quantities.
- **Approved color system:** Basalt and Limestone are the two authored grounds; Lumen is reserved for brand/AI/focus, Bronze for trust/verification, Lapis for data/information, and Ink/Limestone carry primary actions. Exact values and semantic theme mappings live in root `DESIGN.md` and are mirrored into frontend tokens.

## Evidence on Hand

- **Visual source of truth:** `UI-UX/design.pen` (encrypted; access only via `mcp__pencil__*` tools). The canonical premium direction is the phone/OTP verification screen family; the old flat "Basic / Contact Information" look is the rejected direction.
- **Founder brief:** `docs/product/design-idea.md` (Arabic, verbatim) — the working product source alongside `mvp-scope.md`.
- **Canonical project memory:** `docs/product/PRODUCT_DIRECTION_GUIDE.md`, `docs/architecture/ARCHITECTURE_GUIDE.md`, `UI-UX/UI_UX_SYSTEM_GUIDE.md`, plus ADRs under `docs/decisions/`.
- **Absences future work must not fabricate:** no formal client/business brief in text form, no confirmed customers, testimonials, benchmarks, pricing, or pilot metrics. `client-brief.md` is a placeholder.

## Product Principles

1. **Sales-first.** The highest-frequency daily user's workflow leads; build inner workflows before the dashboards that summarize them.
2. **Consultation-first, never commerce-first.** Guide decisions toward the right, verified match — trust over cheapest. Never frame a consultation as a transaction or add a checkout.
3. **One canonical identity, derived access.** Roles stay separate; a user has one current primary account type; navigation and capability are derived, never toggled. A business is an Organization joined by Membership — never a second account.
4. **Trust and isolation are never traded for speed.** Cross-tenant RLS isolation and human-in-the-loop AI are requirements, not "later."
5. **Bilingual and dual-theme by construction.** Every layout works identically in AR-RTL and EN-LTR, and every token is defined in both light and dark.

## Accessibility & Inclusion

- **Bilingual, RTL-first parity:** every layout, navigation affordance (leading/trailing, chevron direction, back gestures), and component works identically in Arabic (RTL) and English (LTR). Never encode meaning with italics in Arabic; use weight/size/color tokens.
- **WCAG AA contrast** is the target, re-verified independently in both light and dark themes.
- **Color is reinforcement, never the sole signal** — pair with icon/label/shape — required for accessibility and RTL parity.
