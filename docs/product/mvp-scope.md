# MVP Scope — Private Pilot

**Status:** Living document · 2026-07-29

## Purpose

State what the Private Pilot MVP includes, in what order, and what is explicitly out — so build effort stays aligned.

## Current decision

**Product:** an AI-first, **B2B-first** operating system for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector, with a connected B2C consultation/discovery layer. Consultation-first, **not** a price-war marketplace. Value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.**

**Design approach (from founder brief):** design the full Information Architecture and Design System for the whole platform, but build screens in phases — MVP journeys in detail first.

**MVP capability areas:** Authentication (passwordless) · Onboarding & Profiles · Roles & derived navigation (one current primary account type; no persona/profile switcher — work-context switching across the user's own organizations is a separate, deferred concept) · Portfolio · Product Catalog · Smart Search · AI Assistant · Notifications · Subscription · Advertisement · Admin Dashboard. Plus the core value journey (AI consult → intent → discovery → search → matching → profile → product → RFQ → quote → project).

**Build order (roadmap):**
1. **05C — B2B Sales operating workflow** (first; Sales is the key daily-active user): Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task.
2. **05A — Core B2C value journey**: AI consult → Intent → Discovery → Search → Matching → Profile → Product → RFQ.
3. **05B — Quote & project journey**: RFQ → Responses → Quote comparison → Decision → Project → Follow-up.
4. **05D — Supplier/Showroom/Product operations**: Catalog → Availability → Requests → Quotes → Orders → Campaigns.
5. **05E — B2B Cockpit & Admin completion** (dashboards last, after inner workflows exist).

**Installer/Technician Pilot (added 2026-08-31).** Runs as its own milestone alongside the above, delivering the `installer_technician` persona **end-to-end**: onboarding · professional profile · skills/specialties · service areas · experience · portfolio · certificates · availability · public professional profile · home/dashboard · job opportunity discovery · job details · job application · My Work lifecycle · work detail/progress · ratings/reviews · showroom/business network · personal Points access · settings/support. **The next milestone after it** is the transactional messaging expansion (full Chat Center, personal↔organization chat where approved, Realtime chat and notifications, chat attachments) — which is why Installer surfaces ship without messaging entry points.

**Roles (kept separate):** End Consumer · Installer/Technician · Engineer · Interior Designer · Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · Sales · Contractor · Trainer · Trainee · Administrator. A user holds **one current primary account type** (personal persona); the **business classifications** in this list are canonically `organizations.org_type`, reached through organization membership — one user may own organizations of several different types at once. The `supplier` classification is user-facing **"Distributor"** in English and **"الموزع"** in Arabic; `supplier` is the internal identifier only ([terminology](./PRODUCT_DIRECTION_GUIDE.md#the-separation-is-enforced-by-the-type-system-sprint-13)).

**Cross-cutting MVP requirements:** English (LTR) + Arabic (RTL); Light + Dark; responsive Desktop/Tablet/Mobile (PWA); Egyptian data conventions (localities, EGP). **Arabic is the default language** and English is a first-class alternative with **exact information and action parity** — the same data, the same actions, correct RTL/LTR, and no mixed-language UI beyond approved brand and technical terms.

**Private Pilot subscription boundary:** eligible activated users use the service **free** during the Pilot. **No online payment is collected and there is no checkout**; future packages may be described informationally only. *(An Installer Job's **offered compensation** amount, approved 2026-08-31, is **disclosure only** and does not breach this boundary: it is what an organization states it offers for the work, never a payment the platform processes, holds or records — no wallet, escrow, payment status, payout, settlement, commission or invoice.)* Upgrading an account extends the **same canonical identity** — it never creates a second user. (Account *activation* itself follows [`PRODUCT_DIRECTION_GUIDE.md` → Activation vs. Verification](./PRODUCT_DIRECTION_GUIDE.md), not a payment or a review gate.)

## Rationale

Sales-first sequencing targets the highest-frequency user and the workflows that generate liquidity (opportunities → quotes) before dashboards that merely summarize them.

## Scope

Product-level scope and sequencing. Not an engineering spec.

## What is deferred (post-MVP / Full Platform)

RFQ at industrial scale, AI matching / match scoring, learning & training, business opportunities, full supply-chain workflow, and payments/milestones/disputes — designed at the IA/DS level but built later.

**Superseded for `installer_technician` (2026-08-31).** The *installation & service marketplace* and *project-execution workflow* were previously deferred here in full. They are now **in Pilot scope for the Installer/Technician persona only**, as the **Installer Jobs** domain: an organization posts a job, an individual installer applies, is assigned, executes, reports progress, and has completion confirmed — anchoring a rating. This is a **new domain**; the organization↔organization RFQ/quotation/order/project spine is unchanged and is not adapted to carry it. Organization↔organization *project execution* remains deferred, and AI-driven *matching depth* remains deferred (discovery is filter-based, not scored). See [`docs/database/installer-jobs.md`](../database/installer-jobs.md) and the [Change History entry](./PRODUCT_DIRECTION_GUIDE.md#change-history).

## Consequences

Feature work references this ordering. Building a later module before its prerequisites (or dashboards before inner workflows) requires an explicit decision.

## Related files

`client-brief.md` · `design-idea.md` · `../architecture/overview.md` · `../../CLAUDE.md`
