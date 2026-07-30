# Product Direction Guide

**Status:** Living document · 2026-07-30

**Purpose:** the durable "why and where" of Aladdin — vision, positioning, and the priority rules agents use to decide *what to build and what to refuse*. It sits above [`mvp-scope.md`](./mvp-scope.md) (the "what and in what order") and the [ADRs](../decisions/) (the "how"). Where this guide and `mvp-scope.md` disagree on sequencing, `mvp-scope.md` wins for the current cycle.

## Product Vision
An **AI-first operating system** for Egypt's finishing, construction, interior design, furnishing, supply, and professional-services sector — the trusted digital infrastructure that runs the whole value chain: **Need → Advice → Discovery → Trusted Match → RFQ → Quote → Decision → Execution → Follow-up.** B2B-first, with a connected B2C consultation layer.

## Mission
Make it fast and trustworthy to get the right advice, find the right verified provider/product, and execute a project — replacing WhatsApp threads, spreadsheets, and word-of-mouth with one intelligent, bilingual system.

## Product Philosophy
- **Consultation-first, not commerce-first.** We guide decisions; we are not a checkout.
- **Trust over cheapest.** The product optimizes for the *right, verified* match, never a race-to-the-bottom price war.
- **AI as an operator's copilot,** not an autonomous actor — it drafts, explains, and ranks; humans decide and send.
- **One system, many roles.** A single account holds multiple roles and switches profiles; the platform adapts, the user doesn't fragment.

## Mission-critical framing: three surfaces
- **B2C** — discovery/consultation for end consumers.
- **B2B workspace** — where **Sales** (the key daily-active user) and organizations operate.
- **Admin** — control and governance.
They are skins of one design/data system, not three products.

## Target Users
- **Sales** — the highest-frequency daily user; the product's center of gravity.
- **End Consumer** — seeking advice, discovery, and trusted execution.
- **Service providers** — Installer/Technician, Engineer, Interior Designer (kept as separate roles).
- **Businesses** — Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Contractor.
- **Learning** — Trainer, Trainee.
- **Administrator** — governance and platform operations.

## Core Problems Being Solved
- The sector is **fragmented, informal, and trust-poor**: finding a *reliable* provider or genuine product is hard.
- Buyers face **price-war noise** instead of good advice and verified matches.
- There is **no structured path** from need → RFQ → comparable quotes → project → follow-up.
- **Sales teams operate blind** on WhatsApp/spreadsheets, with no pipeline, no follow-up discipline, and no shared context.
- Provider/product data is **unstructured and unsearchable**.

## Why This CRM Exists
The **B2B Sales operating workflow is the wedge** (roadmap 05C, first). Sales is the most frequent user, and turning *Opportunity → Need → Match → Smart Share → Follow-up → Quote → Pipeline → Task* into a system:
1. creates immediate daily value for the user who shows up most,
2. generates the **liquidity and structured data** (needs, matches, quotes) that power discovery, matching, and AI for every other surface.
The CRM is not the whole product — it is the beachhead that makes the rest work.

## Product Positioning
- **Not** a marketplace with add-to-cart/checkout.
- **Not** a generic horizontal CRM.
- **Is** a **vertical, AI-first operating system** for one sector in one market, consultation-first and bilingual.

## Competitive Advantage
- **Vertical + market fit:** built for Egyptian construction/finishing realities (localities, EGP, Arabic RTL, informal-market trust gaps).
- **Trusted-match over cheapest:** verification, provenance, and AI-explained matching instead of blind price bidding.
- **Integrated value chain:** advice → discovery → RFQ → quote → project → follow-up in one system, not stitched tools.
- **AI woven through the workflow,** not bolted on as a chatbot.
- **Bilingual by construction** (AR-RTL / EN-LTR) from day one.

## MVP Scope
See [`mvp-scope.md`](./mvp-scope.md) for the authoritative list and order. In short: passwordless auth, onboarding/profiles, roles, portfolio, catalog, smart search, AI assistant, notifications, subscription, advertisement, admin — plus the core value journey — built **Sales-first** (05C → 05A → 05B → 05D → 05E).

## Non Goals
- Payments, escrow, milestones, and disputes (designed later; **not** MVP).
- Marketplace checkout / add-to-cart commerce.
- A generic, configurable horizontal CRM.
- Price-war reverse-auction bidding.
- Building the entire platform at once (design broadly, build in phases).
- Speculative infrastructure (see ADR-0001 exclusions).

## Core Modules
Authentication (passwordless) · Onboarding & Profiles · Roles & Active-Profile Switching · Portfolio · Product Catalog · Smart Search · AI Assistant · Notifications · Subscription · Advertisement · Admin — plus the **value journey** (consult → intent → discovery → search → matching → profile → product → RFQ → quote → project) and the **Sales operating workflow**.

## Multi-Tenant Philosophy
- The tenant unit is the **organization**, with **branch** scoping where applicable.
- **RLS is the isolation spine** — cross-tenant data must never leak, in UI, API, worker, or AI retrieval.
- **One canonical account/identity** regardless of verification method; it may hold multiple roles/profiles across tenants without duplicate accounts.

## Roles & Permissions Philosophy
- **Roles stay separate** even when behaviors overlap (easier analysis/search; merge later only by explicit decision).
- One account, **many roles**, with **active-profile switching** — no new account per role.
- **Authorization is enforced server-side (RLS + checks)**; the UI never implies access it cannot grant. Least privilege by default.

## Collaboration Philosophy
- Collaboration forms **around a shared object** — an RFQ, a quote, a project — not around a chat inbox.
- Sales **Smart Share** brings the right provider/product to the right buyer with context.
- **Human-in-the-loop always:** AI assists; people decide, approve, and send.

## AI Vision
- **AI-first, tenant-scoped, human-reviewable.** Capabilities: intent extraction, consultation, matching + suggestion *explanation*, follow-up drafting, document retrieval/RAG, and AI evaluations.
- **Retrieval applies authorization filters before returning content** — no cross-organization leakage, ever.
- AI **drafts and ranks; it never auto-sends** or takes irreversible action on a user's behalf silently.

## Automation Vision
- Automate **drudgery, not judgment.** Background jobs: OCR, embeddings, document chunking, Excel imports, PDF generation, email + operational WhatsApp delivery, expensive analytics refreshes.
- Heavy/slow/external work runs **off the request path** (Supabase Queues + workers); the UI stays responsive with live status.

## Analytics Vision
- Operator-centric: pipeline, opportunity, and follow-up analytics that drive the *next action*, not vanity dashboards.
- **Postgres-first** (FTS/`pg_trgm`/`pgvector`); expensive aggregations refresh asynchronously.
- Dashboards are built **after** the workflows they summarize exist (roadmap 05E last).

## UX Positioning
Premium, calm authority — a professional tool, not a flashy consumer app. Consultation-first, bilingual (AR-RTL/EN-LTR), light + dark, token-driven, and consistent across the three surfaces. Full rules: [`UI-UX/AGENTS.md`](../../UI-UX/AGENTS.md).

## Technical Philosophy
- **Modular monolith** (ADR-0001): one Next.js web app, one Supabase data platform, one specialized FastAPI service, workers where needed.
- **Supabase SQL migrations are the only schema source of truth** (ADR-0002); FastAPI is specialized (AI/OCR/RAG/documents/workers), not the CRUD backend.
- **Write-it-yourself dependency discipline**, centralized validated config, fail-fast, and a non-negotiable security baseline (RLS, server-only secrets, JWT-derived identity).

## Scalability Direction
Ship the monolith; move to the next rung only against **measured** need. Invest in **clean module boundaries** now so a domain can be extracted later without a rewrite. Options are documented, not pre-built. See [`../architecture/scaling-strategy.md`](../architecture/scaling-strategy.md).

## Long-Term Roadmap
- **Now (MVP):** the core journeys, Sales-first (05C → 05A → 05B → 05D → 05E).
- **Then (Full Aladdin Platform):** installation & service marketplace, industrial/RFQ at scale, deeper supplier/technician matching, project-execution workflow, learning & training, business opportunities, supply-chain workflow, and **payments/milestones/disputes**.
- Information architecture and design system are designed for the whole platform up front; screens are built in phases.

## Feature Priority Rules
1. **Sales-first** — the daily-active user's workflow leads.
2. **Inner workflows before dashboards** (build the thing before the summary of the thing).
3. **Approved spec before build** — no product tables/features without a written spec + ADR where architectural.
4. **Value-chain order** — respect the roadmap sequence; don't start a module before its prerequisites exist.
5. **Trust and isolation are never traded for speed** — RLS/tenant isolation and human-in-the-loop AI are not "later."
6. When unsure, **ship the smallest slice that delivers the next real action** in the value chain.

## What Agents Must NEVER Do
- **Never** build commerce/marketplace framing (add-to-cart, checkout, price-war bidding) — this is consultation-first.
- **Never** add password/forgot/reset UI or flows — the product is **passwordless** (WhatsApp/Email OTP).
- **Never** merge roles or collapse profiles — roles stay separate; one account switches profiles.
- **Never** leak data across organizations in UI, API, workers, or AI retrieval; **never** bypass RLS or trust client-supplied `user_id`/`organization_id`.
- **Never** put technical/implementation copy in the UI ("WhatsApp Business API", "reCAPTCHA verified", "canonical account", stack/schema jargon).
- **Never** let AI auto-send or take irreversible action without human review.
- **Never** edit, rename, duplicate, or delete `.pen` files, and never create another canonical design file.
- **Never** build product features, tables, or connect production services during a foundation/spec-less task.
- **Never** introduce Alembic, `Base.metadata.create_all()` in staging/prod, a Vite/SPA frontend, or excluded infrastructure (ADR-0001/0002).
- **Never** invent an "approved" brand (final logo/font/color) before sign-off, or hardcode raw values instead of tokens.
- **Never** claim unfinished work is complete.

## Related files
[`mvp-scope.md`](./mvp-scope.md) · [`design-idea.md`](./design-idea.md) · [`client-brief.md`](./client-brief.md) · [`../architecture/overview.md`](../architecture/overview.md) · [`../decisions/ADR-0001-approved-architecture.md`](../decisions/ADR-0001-approved-architecture.md) · [`../../UI-UX/AGENTS.md`](../../UI-UX/AGENTS.md) · [`../../AGENTS.md`](../../AGENTS.md)
