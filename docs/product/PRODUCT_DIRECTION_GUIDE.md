# Product Direction Guide

<!-- CANONICAL PROJECT MEMORY — read before any product decision. -->

| | |
|---|---|
| **Status** | Living document (canonical project memory) |
| **Version** | Living (canonical) · rev 2026-08-12 |
| **Owner** | Product |
| **Last updated** | 2026-08-12 |
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
- **Businesses** (organizations, classified by `org_type`) — Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Contractor company. The daily user is always a *person* acting through a membership in one of these.
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

**Where each capacity lives is not uniform.** Personal personas (End Consumer, Installer/Technician, Engineer, Interior Designer, Sales, Contractor, Trainer, Trainee) describe **the person**. The business classifications in that list (Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, contractor company, design/engineering office) describe **a business the person owns or works in** — canonically `organizations.org_type`, never the person's long-term identity. See [Business Classification Belongs to the Organization](#business-classification-belongs-to-the-organization).

## Canonical Identity Model
- **One person = one user ID.** A human has exactly **one** authentication/user identity. Creating or joining another business **never** creates a second user for the same person.
- **One canonical identity per person**, regardless of verification method (WhatsApp OTP or Email OTP/verification link). No duplicate accounts per role, per contact channel, or per business.
- **Passwordless.** No passwords, and no password/forgot/reset flows anywhere — those are legacy/superseded.
- A user verifies exactly **one** primary contact at account creation; a secondary is added later from profile settings.
- **Organization membership, branch assignment, and permission capabilities are separate from identity** — they attach to the canonical account, they do not fork it.

## Personal Identity Is Not a Business
**Personal identity/profile data belongs to the user/profile domain** — End Consumer, Engineer, Interior Designer, Installer/Technician, Contractor, Salesperson. **A personal professional can exist with no organization at all;** an organization is never required for a usable account.

**A business is an Organization.** A Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, contractor company, or design/engineering office is represented internally as an **Organization** — never as a second user account.

The user must **not** experience this as *"create an account, then create an organization."* In the UX **they create their business once**; the backend may transactionally create the **organization + owner membership + primary branch** as one operation.

## Business Classification Belongs to the Organization
**Concrete business classifications are properties of the business, not of the person.** Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · Contractor company · Design/Engineering office — and every future business classification — are **canonically `organizations.org_type`**. They must **never** be treated as a person's long-term personal identity.

Why this is structural, not stylistic: **a user may own several businesses of different types at once.**

> *Ahmed Hassan* — personal persona: **Engineer** · *AH Showroom*: Owner, `org_type = showroom_dealer` · *AH Import*: Owner, `org_type = importer`. **Same user ID.**

A single `users.primary_account_type` cannot simultaneously be `showroom_dealer` **and** `importer`, so business type cannot be the canonical user identity in the target multi-organization model.

**`users.primary_account_type` represents personal identity / persona state** — it is not the type of every business the user owns or joins.

### Registration UX stays direct
The user may still pick *"I am a Showroom" · "I am a Supplier" · "I am an Importer"* directly — that is good UX and stays. Architecturally that selection means **"I am creating a business whose `org_type` is X"**, *not* "my personal identity becomes X". The backend creates, in one transactional and idempotent business-creation operation:

```
User (unchanged)
 └─ Organization(org_type = X)
     ├─ Owner Membership
     └─ Primary Branch
```

### The separation is enforced by the type system (Sprint 13)
The two taxonomies now live in **two disjoint database types**, so the rule above is no longer a convention that code must remember:

| | Type | Contains |
|---|---|---|
| A person | `public.persona_type` | `end_consumer` · `engineer` · `interior_designer` · `installer_technician` · `contractor` · `sales` · `trainer` · `trainee` |
| A business | `public.organization_type` | `showroom_dealer` · `supplier` · `manufacturer` · `importer` · `wholesaler` · `contractor_company` · `design_office` |

`users.primary_account_type` is a `persona_type` and `organizations.org_type` is an `organization_type`, so **`user.primary_account_type = 'supplier'` and `organizations.org_type = 'engineer'` are type errors** — in every code path, including a direct SQL statement by a superuser. The shared `account_type` enum is **dropped**; the transitional debt it represented is closed, not documented.

Two nuances worth knowing:
- **A business whose classification shared a persona spelling kept its identity, under a business-shaped name.** A design studio typed `interior_designer` is now `design_office`; a contracting company typed `contractor` is now `contractor_company`. The owner of either may separately hold the matching *personal* persona — the two values now coexist honestly instead of colliding.
- **The registration CHOICE is the one place the taxonomies meet**, because the card the person taps either claims a persona or names a business to create. `onboarding_progress` therefore records it in two separate typed columns (`selected_persona`, `selected_org_type`), mutually exclusive and consistent with the track — never one union column.

## Membership Connects a User to an Organization
```
User  ↕  Membership  ↕  Organization
```
`Membership` is the link, and it owns the **organization relationship**, **role/capabilities**, **branch scope**, and **lifecycle/status**. **Employees join an existing business through an invitation** — they never create another organization in order to join one.

## Multiple Business Contexts Are Allowed
One user may have **zero, one, or many** organizations. Example — *Ahmed Hassan*: Personal → Engineer · *AH Design Studio* → Owner · *ABC Design* → Engineer/member. **Same login, same user ID**, three contexts.

## Workspace Is a UX Concept
- **Personal Workspace** = derived from **User + Profile**.
- **Business Workspace** = derived from **Organization + the user's active Membership**.

Both are **derived**. Do **not** introduce a generic `workspaces` table at this stage.

## Switching: What Is Forbidden, What Is Allowed
Workspace switching is **not** persona/profile switching.

- **NO** arbitrary switching between personal personas / account identities. There is no Profile Switcher and no "Use As" mode. A user has **one current primary account type** at a time, and it changes only through the approved, reviewed upgrade workflow.
- **YES** switching the **active work context** between the user's personal surface and the organizations where that same user holds an **active membership**. This changes *which context you are working in*, never *who you are*.

What the user can see and do inside any context stays **derived**, not toggled — from:
- primary account type,
- organization membership,
- branch assignment,
- permission capabilities,
- verification state,
- subscription state.

Keep roles separate in the taxonomy, and never imply simultaneous *profile* switching in product, navigation, or copy.

> **Implementation status:** the work-context switcher and the account lifecycle below are **approved direction, not built.** This section is the target model, not a claim that the UI exists.

## An Existing User Can Create a Business Later
Ahmed registers today as an Engineer. A year later the **same login** uses *Add / Create Business* → *AH Design Studio*, and the backend creates the Organization + Owner Membership **for the existing user**. **No new sign-up. No second auth identity. No duplicate personal profile.**

## Single Source of Truth — No Duplicated Identity
| Data | Canonical owner |
|---|---|
| Auth identity (email/phone credential) | the **auth user** |
| Personal identity / profile | **`users`/`profiles`** + the professional-profile domain |
| Business identity | **`organizations`** |
| Relationship, role, capabilities | **`memberships`** |
| Branches | **`branches`** |
| Business products, customers, RFQs, quotations, orders, projects | **organization-owned records** |

**Never** copy business identity onto the user as a second source of truth, and **never** copy personal identity into organization records as a second source of truth. Draft/onboarding rows may hold entered values **temporarily, as a draft only**; after commit every canonical read comes from the owning entity.

## Duplicate-Business Protection (for the upcoming implementation)
Business creation must be **transactional and idempotent**: retrying the same completed business-onboarding operation must return the **same organization** rather than create duplicates. **Business name alone is never the permanent unique identity;** future verified identifiers may include normalized legal/business identifiers where appropriate.

## Membership History
Leaving a company does **not** delete history. **Membership lifecycle is separate from user/account lifecycle** — a former/revoked membership must stop access while retaining historical attribution.

## Account Lifecycle — Approved Future Rule (do NOT implement now)
Recorded as approved direction only; **no deletion feature is in current scope.**
- **Deactivate** is reversible.
- A **delete request** starts a grace period.
- **Final deletion** removes/releases the login identity per the privacy policy; **business and audit history remains.**
- A later account using the same released email/phone gets a **NEW user ID** and **never** automatically inherits the old memberships, permissions, or history.
- Historical business actions may keep showing the person's historical name as **muted, non-clickable attribution** once the old account no longer exists.
- **Leaving an organization and deleting an Aladdin account are different events.**

## Activation vs. Verification (Pilot UAT round 1, 2026-08-11)
**Completing onboarding activates the account. Verification is an independent trust state and is never the activation mechanism.**

- Finishing consumer onboarding, and submitting a professional profile, make the personal account **usable immediately** — the user reaches their own `/home`. An Engineer, Interior Designer, Installer/Technician, Contractor, or organization-less Salesperson is never held in a review-waiting screen.
- Verification is reported alongside the account, never folded into it: *not verified · pending review · more info needed · verified · rejected*. It gates **trust and public discoverability**, not access.
- An Admin decision may add trust — the approved-and-applied review is still the only thing that writes `users.primary_account_type` and sets `profiles.public_profile_status = 'listed'` — but it must never be what lets someone in.
- **Profile completeness** is a separate, always-DERIVED signal computed from the applicable profile fields for that persona. It is never a stored percentage, never includes verification, and never blocks usage.

## The Salesperson Pilot Rule (Sprint 13, 2026-08-15)
**A Salesperson has a usable personal Aladdin account immediately. A showroom's Sales / B2B tools require an ACTIVE affiliation with that showroom.**

Five states, each moving on its own — never combined into one percentage or one badge:

| State | Example | What it controls |
|---|---|---|
| Account status | `ACTIVE` | Whether the person can use Aladdin at all — yes, from onboarding onward |
| Profile completeness | `80%` | Nothing. A derived quality signal |
| Personal verification | `PENDING` | Trust and public discoverability, never access |
| Showroom affiliation | `PENDING` | Whether *that showroom's* Sales tools open |
| Showroom verification | `PENDING` | The showroom's own trust state, not the salesperson's |

A salesperson in exactly that combination uses their personal account normally and simply cannot yet open that showroom's B2B workspace. **Verification must never become the general account-activation gate again**, and landing is never derived from persona — "Salesperson → always `/b2b`" is wrong, because an independent salesperson may have no showroom at all.

Two paths reach an affiliation, and neither creates a second user:
- **The showroom is on Aladdin** → the salesperson finds it, requests to join, and an Owner/Manager of *that* organization decides, using the existing `org.members.manage` capability on the existing People surface. Approval activates a **Sales membership** through the same trusted path an invitation uses. A rejection never disables the personal account.
- **The showroom is not on Aladdin** → the salesperson **refers** it. This is emphatically not the owner "Add Business" flow: submitting creates no organization, and an Admin reviews the candidate through the existing verification architecture, preferring to **link** it to an organization that already exists over creating a duplicate. Company name stays non-unique — de-duplication is a reviewed decision, not a constraint.

**The referrer is never the Owner.** A referred showroom that nobody has claimed is created with a primary branch and the referring salesperson's Sales membership, and with **no owner membership at all** — the data model requires none, so a platform-managed, claimable business is available and fabricating an owner is unnecessary. Referral **attribution** is retained write-once (`organizations.source` + `organizations.referred_by_user_id`) so a future rewards feature can credit the salesperson; **no points, wallet, leaderboard or reward calculation exists.**

## "Owner / manager" is not an account type or a business type
It describes the **relationship between a user and a business**, so it carries no `account_type` and is never an `org_type`. Never create an `owner_manager` account type or organization type.

**Target registration UX:** *Choose what you are* → a **personal persona** **or** a **concrete business type** (e.g. Showroom/Dealer) → enter the business information → **the creator becomes Owner automatically.** If a manager-created-business path is supported, "Manager" is **relationship metadata inside business setup**, never a business/account type.

**Transitional (backward compatibility only):** the generic *"organization owner/manager"* registration entry — it carries a null concrete type, and the real organization type (Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler) is chosen during business onboarding. It exists so already-saved and in-flight onboarding rows resume safely. It is **not** the target registration UX and must not be extended or treated as canonical.

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
- **Never** merge roles, and **never** add a Profile Switcher / "Use As" mode or any persona/account-identity-switching UI — roles stay separate in the taxonomy; navigation is **derived**, not toggled. One current primary account type at a time. *(Switching the active **work context** between the personal surface and organizations where the user has an active membership is a different, allowed concept — see [Switching](#switching-what-is-forbidden-what-is-allowed).)*
- **Never** create a second user/auth identity for the same person — not for another role, another contact channel, or another business. A business is an **Organization**, never a second account.
- **Never** copy business identity onto the user, or personal identity into organization records, as a second source of truth; after a draft is committed, read from the owning entity.
- **Never** treat a business classification (Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, …) as the person's canonical identity, and never mirror `organizations.org_type` permanently into `users.primary_account_type` — one user may own several businesses of different types at once.
- **Never** introduce a generic `workspaces` table — a workspace is derived (User+Profile, or Organization+active Membership).
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

### 2026-08-12 — Account & Workspace Model implemented
- **What:** The model recorded in the two entries below is now **built**, not just documented. `users.primary_account_type` is **nullable, has no default, and means personal persona only**; a **business-only identity legitimately has no personal persona**, which the old `not null default 'end_consumer'` column could not even represent. `organizations.org_type` remains the sole business classification and is never mirrored onto a user; `request_account_upgrade` refuses business values outright. Business creation moved to a **per-attempt draft** (`business_creation_drafts`) whose id is both the resume handle and the **idempotency key**, replacing the one-draft-per-user shape that structurally prevented a second business — so retries return the same organization while a new draft legitimately creates another. Registration became a **direct Personal-or-Business choice** with concrete business types; the generic **"Organization owner / manager" entry is no longer offered** and the owner/manager confirmation is gone (the creator *is* the owner). An existing user can **add a business** from the workspace menu with no second sign-up, and a **workspace switcher** changes the active work context — Personal or any organization with an active membership — without ever touching persona or membership. Landing is deterministic, and merely belonging to an organization no longer evicts a person from their personal `/home`.
- **Why:** The Pilot UAT alignment recorded the model but left the schema unable to express it; business owners were carrying their organization's type as a personal identity, and no user could own a second business.
- **Scope:** Two migrations (`20260814090001`, `20260814090002`), frontend work-context/registration/business-creation changes, Admin compatibility, EN/AR copy. Legacy rows preserved; no user, organization, membership, branch, capability, or commercial record created or destroyed by the migration. Build notes: [`docs/frontend/sprint-12-account-workspace-model.md`](../frontend/sprint-12-account-workspace-model.md).
- **Remaining debt:** the `account_type` enum still contains the business members because `organizations.org_type` is typed with it — correct for the organization, unreachable for a person; splitting it is a separate mechanical migration.
- **Approved by:** User (Pilot Account & Workspace Model feature sprint, 2026-08-12).

### 2026-08-12 — Business classification belongs to the Organization
- **What:** Resolved the remaining ambiguity around business types. **Concrete business classifications** (Showroom/Dealer · Supplier · Manufacturer · Importer · Wholesaler · contractor company · design/engineering office · future classifications) are canonically **`organizations.org_type`** and must never be treated as a person's long-term personal identity. **`users.primary_account_type` represents personal identity/persona state**, not the type of every business the user owns or joins — a single value cannot be `showroom_dealer` *and* `importer` at once, which the multi-organization model requires (*Ahmed Hassan*: persona Engineer · *AH Showroom* `showroom_dealer` · *AH Import* `importer`, same user ID). **Registration UX is unchanged** — picking *"I am a Showroom"* stays, but it architecturally means *"I am creating a business whose `org_type` is X"*, and the backend creates Organization + Owner Membership + Primary Branch in one transactional, idempotent operation. Existing business-valued `primary_account_type`/account-type paths are recorded as **transitional technical debt** to be audited and migrated by the upcoming Account & Workspace Model feature, never duplicated into a second source of truth.
- **Why:** The docs still listed business classifications among the capacities of a *person*, which contradicts the approved multi-organization model and would push implementers to mirror `org_type` into the user.
- **Scope:** Documentation only. **No database enum, migration, schema, code, or test change** in this PR.
- **Approved by:** User (Pilot UAT account-model clarification, 2026-08-12).

### 2026-08-12 — Account / organization / workspace model made canonical
- **What:** Recorded the approved account-and-workspace model as canonical: **one person = one user ID** (another business never creates another user); **personal identity is not a business** and a personal professional may hold **zero** organizations; **a business is an Organization** created once in the UX (backend transactionally creates organization + owner membership + primary branch); **Membership** is the only user↔organization link and owns relationship, capabilities, branch scope, and lifecycle; **one user may hold zero/one/many organizations on the same login**; **Workspace is a derived UX concept** (Personal = User+Profile, Business = Organization+active Membership) with **no `workspaces` table**; an **existing user can create a business later** with no second sign-up; a **single-source-of-truth ownership table** forbidding identity duplication in either direction; **duplicate-business protection** (transactional + idempotent creation, name alone is never the permanent identity); **membership history survives leaving**; and the **approved future account-lifecycle rule** (deactivate reversible · delete request → grace period → identity released, history retained · a reused email/phone gets a NEW user ID inheriting nothing · muted historical attribution) which is **explicitly not implemented**. **Clarified the no-profile-switcher rule:** switching *personas/account identities* stays forbidden; switching the *active work context* between the personal surface and organizations where the same user has an **active membership** is allowed and is not persona switching. **Owner/Manager** was restated as a **relationship**, never an account or business type, with the target *personal persona OR concrete business type* registration UX recorded and the generic owner/manager entry demoted to **transitional backward-compatibility** behaviour.
- **Why:** The Pilot UAT discussion surfaced that the docs implied a business was a second account and that any context switching was forbidden — which blocks the approved multi-organization model and would have driven duplicate users, duplicated identity data, and duplicate organizations. Documentation alignment only: **no workspace switcher and no account lifecycle is implemented in this patch.**
- **Approved by:** User (Pilot UAT product-direction alignment task, 2026-08-12).

### 2026-08-11 — Activation vs. verification; owner/manager is not a business type
- **What:** Added the *Activation vs. Verification* rule and the *"Organization owner / manager" is not a business type* rule. Completing onboarding now activates a personal account and the user reaches `/home`; verification became an independent trust state that gates discoverability, not access. Profile completeness was defined as an always-derived signal that excludes verification. The generic owner/manager registration entry carries no `account_type`; the real organization type is chosen during business onboarding.
- **Why:** Manual Pilot testing found consumers and individual professionals trapped after finishing onboarding — an Admin approval was the de-facto activation mechanism — and the generic owner/manager path failed outright with a generic save error.
- **Approved by:** User (Pilot UAT fix round 1 task, 2026-08-11).

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
