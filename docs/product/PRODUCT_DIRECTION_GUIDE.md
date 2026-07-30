# Product Direction Guide

<!-- CANONICAL PROJECT MEMORY — read before any product decision. -->

| | |
|---|---|
| **Status** | Living document (canonical project memory) |
| **Last updated** | 2026-07-30 |
| **Scope** | The durable *why and where* of Aladdin — vision, positioning, priority rules, and the guardrails agents use to decide what to build and what to refuse. |
| **Authority** | Authoritative for **product direction**. Sits above [`mvp-scope.md`](./mvp-scope.md) (the *what and in what order*) and the [ADRs](../decisions/) (the *how*). Where this guide and `mvp-scope.md` disagree on sequencing, `mvp-scope.md` wins for the current cycle. |
| **Update triggers** | Any change to vision, positioning, target users, MVP boundaries, roadmap order, the account/identity model, or the "never do" guardrails. Every such change requires **explicit user approval** and a new [Change History](#change-history) entry. |

This is **core architecture**, not optional documentation. Product direction must never live only in a prompt or chat history — if a direction changes in conversation, record it here (and in an ADR when it is also architectural) before acting on it.

## Product Vision
An **AI-first operating system** for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector — the trusted digital infrastructure that runs the whole value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.** B2B-first, with a connected B2C consultation layer.

## Product Mission
Make it fast and trustworthy to get the right advice, find the right verified provider/product, and execute a project — replacing WhatsApp threads, spreadsheets, and word-of-mouth with one intelligent, bilingual system.

## Product Positioning
- **Not** a marketplace with add-to-cart/checkout.
- **Not** a generic horizontal CRM.
- **Not** a price-war reverse-auction.
- **Is** a **vertical, AI-first operating system** for one sector in one market: consultation-first, trust-first, and bilingual (Arabic RTL / English LTR).

## B2B-First Strategy
Aladdin is built **B2B-first**. The organization is the tenant; **Sales is the highest-frequency daily-active user** and the product's center of gravity. The B2B operating workflow is what generates the structured data (needs, matches, quotes, pipeline) that every other surface depends on. We build the operator's workflow first and let the rest of the platform draft off the liquidity it creates.

## Connected B2C Consultation Layer
B2C is a **consultation/discovery** layer for end consumers — advice, discovery, and a path to trusted execution — connected to the same data and design system as B2B. It is not a separate product and not a storefront; it is the demand-and-discovery face of the same value chain.

## Three Product Surfaces
- **B2C** — discovery/consultation for end consumers.
- **B2B workspace** — where Sales (the key daily-active user) and organizations operate.
- **Admin** — control and governance (intentionally darker/utilitarian).

They are **skins of one design/data system**, not three products.

## Core Value Chain
**Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.**

Every feature must locate itself somewhere on this chain and move the user to the next real step.

## Primary User & Daily-Active-User Priority
- **Sales** — the highest-frequency daily user; optimize relentlessly for their speed and low friction.
- **End Consumer** — seeking advice, discovery, and trusted execution.
- **Service providers** — Installer/Technician, Engineer, Interior Designer.
- **Businesses** — Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Contractor.
- **Learning** — Trainer, Trainee.
- **Administrator** — governance and platform operations.

When priorities conflict, the daily-active Sales user's workflow leads.

## Sales Workflow as the Implementation Wedge
The **B2B Sales operating workflow is the wedge** (design roadmap 05C, first). Turning *Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task* into a system:
1. creates immediate daily value for the user who shows up most, and
2. generates the **liquidity and structured data** that power discovery, matching, and AI for every other surface.

The CRM is not the whole product — it is the beachhead that makes the rest work.

## User & Account Taxonomy
One person can legitimately relate to the platform in several capacities (End Consumer, Installer/Technician, Engineer, Interior Designer, Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Sales, Contractor, Trainer, Trainee, Administrator). **Roles stay separate** in the taxonomy even when their behavior overlaps — this keeps analysis, search, and permissions clean. Roles are merged later only by an explicit, recorded decision.

## Canonical Identity Model
- **One canonical identity per person**, regardless of verification method (WhatsApp OTP or Email OTP/verification link). No duplicate accounts per role or per contact channel.
- **Passwordless.** No passwords, and no password/forgot/reset flows anywhere — those are legacy/superseded.
- A user verifies exactly **one** primary contact at account creation; a secondary is added later from profile settings.
- **Organization membership, branch assignment, and permission capabilities are separate from identity** — they attach to the canonical account, they do not fork it.

## No-Profile-Switcher Rule
There is **no Profile Switcher and no "Use As" mode.** A user has **one current primary account type** at a time; they do not hold multiple simultaneously-active profiles, and there is no role-switching UI.

What the user can see and do is **derived**, not toggled — from:
- primary account type,
- organization membership,
- branch assignment,
- permission capabilities,
- verification state,
- subscription state.

Keep roles separate in the taxonomy, but never imply simultaneous profile switching in product, navigation, or copy.

## Consultation-First Principle
We **guide decisions; we are not a checkout.** The product optimizes for the *right, verified* match — trust over cheapest — never a race-to-the-bottom price war. Advice, verification, and provenance lead; pricing pressure never does.

## Marketplace & Commerce Anti-Patterns (never build)
- Add-to-cart, checkout, buy-now, storefront commerce.
- Price-war reverse-auction / blind price bidding.
- A generic, configurable horizontal CRM.
- Framing any flow as a transaction when it is a consultation.

## AI Principles
- **AI-first, tenant-scoped, human-reviewable.** Capabilities: intent extraction, consultation, matching + suggestion *explanation*, follow-up drafting, document retrieval/RAG, and AI evaluations.
- **AI is an operator's copilot, not an autonomous actor** — it drafts, explains, and ranks; humans decide and send.
- **Retrieval applies authorization filters before returning content** — no cross-organization leakage, ever.
- Automate **drudgery, not judgment** (OCR, embeddings, chunking, imports, document generation, operational delivery). Heavy/slow/external work runs off the request path with live status.

## Human-Review Requirements
AI **drafts and ranks; it never auto-sends** or takes irreversible action on a user's behalf silently. Smart Share and follow-up drafting are AI-assisted but always human-reviewed before send. Human-in-the-loop is a product requirement, not a "later" nicety.

## MVP Boundaries
See [`mvp-scope.md`](./mvp-scope.md) for the authoritative list and order. In short: passwordless auth, onboarding/profiles, roles, portfolio, catalog, smart search, AI assistant, notifications, subscription, advertisement, admin — plus the core value journey — built **Sales-first** (05C → 05A → 05B → 05D → 05E).

## Deferred Scope (explicitly out of MVP)
- Payments, escrow, milestones, and disputes (designed later; **not** MVP).
- Marketplace checkout / add-to-cart commerce (never).
- A generic, configurable horizontal CRM (never).
- Price-war reverse-auction bidding (never).
- Building the entire platform at once — design broadly, build in phases.
- Speculative infrastructure (see ADR-0001 exclusions).

## Product Success Criteria
- A Sales user runs their real daily pipeline in Aladdin instead of WhatsApp/spreadsheets.
- A need becomes a trusted, verified match and a comparable quote without leaving the system.
- Cross-tenant isolation holds everywhere (UI, API, workers, AI retrieval) — zero cross-org leakage.
- Bilingual (AR-RTL / EN-LTR) and light/dark parity hold from day one.
- AI output is always attributable and human-reviewed before it acts.

## Product Roadmap

### Design roadmap (screen/workflow build order — order matters)
1. **05C** — B2B Sales Operating Workflow *(first — Sales is the daily driver)*
2. **05A** — Core B2C Value Journey
3. **05B** — Quote and Project Journey
4. **05D** — Supplier, Showroom, and Product Operations
5. **05E** — Cockpit and Admin Completion *(dashboards last)*

Build inner workflows **before** the dashboards that summarize them.

### Implementation roadmap (engineering build order)
1. **Architecture hardening** — the foundation is scaffolded; reconcile and validate before feature work.
2. **Identity and multi-tenancy** — canonical identity, passwordless verification, tenant model.
3. **Organizations, memberships, branches, and permissions** — the derivation inputs for navigation and access.
4. **RLS and tenant-isolation tests** — the isolation spine, with tests, before feature data.
5. **B2B Sales implementation** — the 05C workflow on top of the hardened foundation.

The design roadmap orders *what the user sees*; the implementation roadmap orders *what must exist underneath it first*. Neither may be reordered without a [Change History](#change-history) entry.

### Long-term (Full Aladdin Platform)
Installation & service marketplace, industrial/RFQ at scale, deeper supplier/technician matching, project-execution workflow, learning & training, business opportunities, supply-chain workflow, and **payments/milestones/disputes**. The information architecture and design system are designed for the whole platform up front; screens are built in phases.

## Product-Decision Process
1. A product-direction change is **proposed explicitly** and approved by the user — never changed silently by an agent.
2. It is recorded here (and in a new/updated ADR when it is also architectural).
3. A new [Change History](#change-history) entry is appended.
4. Affected specs (`mvp-scope.md`, feature specs) and `RUNTIME_STATE.md` are updated in the same session.

## Feature Priority Rules
1. **Sales-first** — the daily-active user's workflow leads.
2. **Inner workflows before dashboards** — build the thing before the summary of the thing.
3. **Approved spec before build** — no product tables/features without a written spec + ADR where architectural.
4. **Value-chain order** — respect the roadmap sequence; don't start a module before its prerequisites exist.
5. **Trust and isolation are never traded for speed** — RLS/tenant isolation and human-in-the-loop AI are not "later."
6. When unsure, **ship the smallest slice that delivers the next real action** in the value chain.

## What Agents Must NEVER Do
- **Never** build commerce/marketplace framing (add-to-cart, checkout, price-war bidding) — this is consultation-first.
- **Never** add password/forgot/reset UI or flows — the product is **passwordless** (WhatsApp/Email OTP).
- **Never** merge roles, and **never** add a Profile Switcher / "Use As" mode or any role-switching UI — roles stay separate in the taxonomy; navigation is **derived**, not toggled. One current primary account type at a time.
- **Never** leak data across organizations in UI, API, workers, or AI retrieval; **never** bypass RLS or trust client-supplied `user_id`/`organization_id`.
- **Never** put technical/implementation copy in the UI ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", stack/schema jargon).
- **Never** let AI auto-send or take irreversible action without human review.
- **Never** edit, rename, duplicate, or delete `.pen` files, and never create another canonical design file.
- **Never** build product features, tables, or connect production services during a foundation/spec-less task.
- **Never** introduce Alembic, `Base.metadata.create_all()` in staging/prod, a Vite/SPA frontend, or excluded infrastructure (ADR-0001/0002).
- **Never** invent an "approved" brand (final logo/font/color) before sign-off, or hardcode raw values instead of tokens.
- **Never** change product direction silently, and **never** claim unfinished work is complete.

## Change History
Newest first. Every product-direction change gets an entry: date, what changed, why, and who approved it.

### 2026-07-30 — Canonical memory promotion + account-model correction
- **What:** Promoted this guide to a canonical project-memory file (`product-direction.md` → `PRODUCT_DIRECTION_GUIDE.md`, history preserved via `git mv`). Added the metadata block, an explicit dual roadmap (design + implementation), the product-decision process, and this change history. **Corrected the account model** from "active-profile switching" to the canonical **one-current-primary-account-type / no-profile-switcher / derived-navigation** model across all product statements.
- **Why:** Establish enforceable project memory and remove the profile-switching contradiction; align with the canonical identity model. This is a **wording/consistency correction of the identity model, not a change to product strategy.**
- **Approved by:** User (memory-consolidation task, 2026-07-30).

### 2026-07-29/30 — Initial product-direction guide
- **What:** First version created during the repository architecture foundation session — vision, positioning, philosophy, priority rules, and "agents must never" guardrails.
- **Why:** Give agents a durable "why and where" above the MVP scope and ADRs.
- **Approved by:** User (foundation session).

## Related files
[`mvp-scope.md`](./mvp-scope.md) · [`design-idea.md`](./design-idea.md) · [`client-brief.md`](./client-brief.md) · [`../architecture/ARCHITECTURE_GUIDE.md`](../architecture/ARCHITECTURE_GUIDE.md) · [`../architecture/overview.md`](../architecture/overview.md) · [`../../UI-UX/UI_UX_SYSTEM_GUIDE.md`](../../UI-UX/UI_UX_SYSTEM_GUIDE.md) · [`../decisions/ADR-0001-approved-architecture.md`](../decisions/ADR-0001-approved-architecture.md) · [`../../AGENTS.md`](../../AGENTS.md)
