# MVP Scope — Private Pilot

**Status:** Living document · 2026-07-29

## Purpose

State what the Private Pilot MVP includes, in what order, and what is explicitly out — so build effort stays aligned.

## Current decision

**Product:** an AI-first, **B2B-first** operating system for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector, with a connected B2C consultation/discovery layer. Consultation-first, **not** a price-war marketplace. Value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.**

**Design approach (from founder brief):** design the full Information Architecture and Design System for the whole platform, but build screens in phases — MVP journeys in detail first.

**MVP capability areas:** Authentication (passwordless) · Onboarding & Profiles · Roles & active-profile switching · Portfolio · Product Catalog · Smart Search · AI Assistant · Notifications · Subscription · Advertisement · Admin Dashboard. Plus the core value journey (AI consult → intent → discovery → search → matching → profile → product → RFQ → quote → project).

**Build order (roadmap):**
1. **05C — B2B Sales operating workflow** (first; Sales is the key daily-active user): Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task.
2. **05A — Core B2C value journey**: AI consult → Intent → Discovery → Search → Matching → Profile → Product → RFQ.
3. **05B — Quote & project journey**: RFQ → Responses → Quote comparison → Decision → Project → Follow-up.
4. **05D — Supplier/Showroom/Product operations**: Catalog → Availability → Requests → Quotes → Orders → Campaigns.
5. **05E — B2B Cockpit & Admin completion** (dashboards last, after inner workflows exist).

**Roles (kept separate, one account can hold several):** End Consumer · Installer/Technician · Engineer · Interior Designer · Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · Sales · Contractor · Trainer · Trainee · Administrator.

**Cross-cutting MVP requirements:** English (LTR) + Arabic (RTL); Light + Dark; responsive Desktop/Tablet/Mobile (PWA); Egyptian data conventions (localities, EGP).

## Rationale

Sales-first sequencing targets the highest-frequency user and the workflows that generate liquidity (opportunities → quotes) before dashboards that merely summarize them.

## Scope

Product-level scope and sequencing. Not an engineering spec.

## What is deferred (post-MVP / Full Platform)

Installation & service marketplace, RFQ at industrial scale, supplier/technician matching depth, project-execution workflow, learning & training, business opportunities, full supply-chain workflow, and payments/milestones/disputes — designed at the IA/DS level but built later.

## Consequences

Feature work references this ordering. Building a later module before its prerequisites (or dashboards before inner workflows) requires an explicit decision.

## Related files

`client-brief.md` · `design-idea.md` · `../architecture/overview.md` · `../../CLAUDE.md`
