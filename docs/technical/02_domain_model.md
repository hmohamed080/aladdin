# 02 — Domain Model

| | |
|---|---|
| **Status** | Specification · Phase 0.7 (pre-implementation) |
| **Version** | 1.0.0 |
| **Owner** | Architecture / Foundation |
| **Last Updated** | 2026-08-01 |
| **Depends On** | 01_system_overview.md, ../product/PRODUCT_DIRECTION_GUIDE.md |
| **Related** | 03_database_design.md, 04_relationships.md, 11_state_machines.md |

Every MVP business entity: purpose, responsibilities, relationships, lifecycle, ownership, and constraints. Physical columns/types are in [03_database_design.md](03_database_design.md); cardinality/cascade in [04_relationships.md](04_relationships.md).

**Ownership legend:** `USER` = personal (owned by `user_id`); `ORG` = tenant-owned (`organization_id`); `ORG+BRANCH` = branch-scoped; `PLATFORM` = platform-level/reference (admin-owned or global). Every entity has `created_at`, `updated_at`, and (where noted) soft-delete `deleted_at`.

## Reconciliation of "Role" and "Permission"

The product model (PRODUCT_DIRECTION_GUIDE) is **capability-based derived access**, not role toggles. Therefore:

- **Account Type** (a person's *one current primary* type) and **Platform Role** (admin-team tier) replace the generic notion of "Role".
- **Capability** (a granted permission on a membership) replaces a free-standing "Permission" entity.
- A user has **one canonical identity** and **one primary account type at a time**; there is **no profile switcher**. What they can see/do is derived from: account type + org membership + branch assignment + capabilities + verification state + subscription state.

---

## A. Identity & Accounts (`auth`, `accounts`)

### User
- **Purpose:** the single canonical identity for a person, regardless of verification channel.
- **Responsibilities:** anchor authentication (Supabase Auth), hold the current `primary_account_type`, own personal data.
- **Relationships:** 1–1 `Profile`; 1–* `Contact`; 0–* `Membership`; 0–* personal records (needs, conversations, notifications).
- **Lifecycle:** `pending_verification` → `active` → (`suspended`) → (`deactivated`). Created at first successful OTP; never duplicated per channel.
- **Ownership:** `USER`. Mirrors `auth.users` (Supabase); app-level `users` row keyed by `auth.uid()`.
- **Constraints:** exactly **one** verified primary contact at creation; passwordless (no password fields ever); one primary account type at a time. **`primary_account_type` is server-controlled** — it is not directly user-editable; it changes only through the approved account-upgrade / admin workflow (transactional + auditable), which *extends* the one identity (no second user/profile, no profile switcher). See [ADR-0007 D10](../decisions/ADR-0007-identity-and-tenancy-model.md).

### Profile
- **Purpose:** display and professional information for a user (name, headline, bio, avatar, locality, languages).
- **Relationships:** 1–1 `User`; references `Locality`; 0–* `Media` (portfolio) for professional account types.
- **Lifecycle:** created with the user (progressive disclosure — minimal at signup, enriched in settings).
- **Ownership:** `USER`. **Constraints:** avatar via `avatars/` bucket; portfolio only for professional types.
- **Public visibility (server-controlled):** `public_profile_status` (`hidden`/`listed`) gates appearance in public professional discovery. It is **not** directly writable by browser or service roles and is distinct from identity verification (`User.is_verified`), account type, and the `Verification` decision entity; the implemented professional-upgrade workflow sets it to `listed` only from an approved eligibility flag. A professional **account type alone never makes a profile public** — see [ADR-0007 D11/D17](../decisions/ADR-0007-identity-and-tenancy-model.md).

### Contact
- **Purpose:** a verified or pending contact channel (phone via WhatsApp, or email).
- **Relationships:** *–1 `User`.
- **Lifecycle:** `pending` → `verified` (via OTP) → (`primary` flag). Exactly one `is_primary` per user; a secondary is added later from settings.
- **Ownership:** `USER`. **Constraints:** `channel ∈ {whatsapp, email}`; unique verified contact value per channel across users; phone OTP only via WhatsApp (no SMS).

### AccountType (reference)
- **Purpose:** enumerates the canonical primary account types (End Consumer, Installer/Technician, Engineer, Interior Designer, Showroom/Dealer, Supplier, Manufacturer, Importer, Wholesaler, Sales, Contractor, Trainer, Trainee, Administrator).
- **Ownership:** `PLATFORM` (reference/enum). **Constraints:** roles stay **separate**; never merged without a recorded decision.

### OtpChallenge (transient)
- **Purpose:** a short-lived OTP/verification challenge; not durable business data.
- **Lifecycle:** `issued` → `verified` | `expired` | `consumed`. **Constraints:** rate-limited; reCAPTCHA only on account creation; TTL + attempt cap (see [12](12_validation_rules.md)). Handled largely by Supabase Auth; app persistence only if audit requires.

---

## B. Organizations & Access (`organizations`)

### Organization
- **Purpose:** the **tenant** — a company/showroom/supplier/contractor entity that groups memberships, branches, catalog, pipeline, and subscription.
- **Responsibilities:** own all tenant data; hold verification and subscription state; be the RLS boundary.
- **Relationships:** 1–* `Branch`; 1–* `Membership`; 1–* `Product`; 1–1 (current) `Subscription`; 1–* `Verification`; 1–* `Opportunity`/`Project`/`Quote`.
- **Lifecycle:** `draft` → `pending_verification` → `active` → (`suspended`) → (`archived`). See [11](11_state_machines.md).
- **Ownership:** `ORG` (self). **Constraints:** `org_type` aligns with account types that can own an org; a personal End-Consumer identity is not an org.

### Branch
- **Purpose:** a physical/operational sub-unit of an organization (e.g. Cairo branch) for scoping catalog, inventory, pipeline, and staff.
- **Relationships:** *–1 `Organization`; 1–* `Membership` (branch assignment); scopes `Inventory`, some `Opportunity`/`Task`.
- **Lifecycle:** `active` → (`inactive`). **Ownership:** `ORG+BRANCH`. **Constraints:** every branch belongs to exactly one org; branch-scoped rows carry `branch_id`.

### Membership
- **Purpose:** links a `User` to an `Organization` (and optionally a `Branch`) with a set of **capabilities**.
- **Responsibilities:** the unit that derives what an org-user can do; carries invite/acceptance state.
- **Relationships:** *–1 `User`, *–1 `Organization`, 0–1 `Branch`, 1–* `Capability`.
- **Lifecycle:** `invited` → `active` → (`suspended`) → `revoked`. **Ownership:** `ORG`. **Constraints:** unique (`user_id`, `organization_id`); does **not** fork the canonical identity.

### Capability (permission grant)
- **Purpose:** a granular permission attached to a membership (e.g. `catalog.write`, `quote.approve`, `verification.submit`).
- **Relationships:** *–1 `Membership`.
- **Ownership:** `ORG`. **Constraints:** capability keys come from a **fixed catalog** (see [07_permissions_matrix.md](07_permissions_matrix.md)); UI hides ungranted items (authorization also enforced server-side via RLS).

### PlatformRole (admin team)
- **Purpose:** platform governance tiers for the admin team: **Support**, **Moderator**, **Administrator** (⚑ future **Super Admin**).
- **Ownership:** `PLATFORM`. **Constraints:** platform roles are distinct from org account types; grant cross-tenant read/moderation strictly per [06](06_rls_strategy.md)/[07](07_permissions_matrix.md).

---

## C. Verification (`verification`)

### Verification
- **Purpose:** a request+decision record proving identity/organization/professional legitimacy (trust is core to the product).
- **Responsibilities:** drive the trust badge; gate certain capabilities/visibility; a professional verification is the workflow that transitions `primary_account_type` and sets `public_profile_status = 'listed'` on approval.
- **Relationships:** *–1 subject (`User` **or** `Organization`); 1–* `VerificationDocument`; reviewed by a `PlatformRole` actor.
- **Lifecycle:** `draft` → `submitted` → `under_review` → `approved` | `rejected` | `needs_more_info` → (`expired`). See [11](11_state_machines.md).
- **Ownership:** `USER` or `ORG` (subject). **Constraints:** no self-approval; decision + reviewer + timestamp are auditable; rejection carries a reason.
- **Implemented (Sprint 2; hardened Sprint 2.1):** the `verifications` table + the `request → review → approve/reject → apply` RPCs (migrations `20260803090001` and `20260804090001`). Extensions beyond the base spec: `requested_account_type`, reviewer-set `grants_public_listing`, and `applied_at`. Direct application-role DML is revoked; subject/type/target and terminal decisions are immutable; assigned-reviewer and expiry checks are enforced. See [ADR-0007](../decisions/ADR-0007-identity-and-tenancy-model.md).

### VerificationDocument
- **Purpose:** an uploaded evidence file (commercial register, ID, license) + OCR-derived text.
- **Relationships:** *–1 `Verification`; references a `Document`/`Media` object in the private `verification/` bucket.
- **Ownership:** `USER`/`ORG`. **Constraints:** private bucket; MIME/size limits ([05](05_storage_design.md)); OCR runs async ([09](09_background_jobs.md)); never surfaced cross-tenant.

---

## D. Catalog (`catalog`)

### Product
- **Purpose:** a catalog item offered by an organization (finishing/construction/furnishing material or product).
- **Responsibilities:** discovery, matching, RFQ/quote line items, advertisement.
- **Relationships:** *–1 `Organization`; *–1 `Brand`; *–1 `Category`; 1–* `ProductMedia`; 1–1..* `Inventory`/`Availability`; referenced by `Match`, `RfqItem`, `QuoteItem`, `Advertisement`.
- **Lifecycle:** `draft` → `active`(published) → (`archived`) → soft-deleted. See [11](11_state_machines.md).
- **Ownership:** `ORG`. **Constraints:** publish requires required fields + at least one media ([12](12_validation_rules.md)); consultation-first — **no price/checkout semantics** (indicative pricing only, expressed as ranges where relevant).

### Brand
- **Purpose:** a manufacturer/brand grouping for products.
- **Relationships:** 1–* `Product`; may be `PLATFORM` (global registry) or `ORG` (org-defined).
- **Lifecycle:** `active` → (`archived`). **Ownership:** `PLATFORM` (curated) with `ORG` proposals. ⚑ OPEN: global vs per-org brand governance.

### Category
- **Purpose:** a hierarchical taxonomy for products/discovery.
- **Relationships:** self-referential tree (`parent_id`); 1–* `Product`.
- **Ownership:** `PLATFORM` (curated reference). **Constraints:** acyclic; slug unique per parent; bilingual labels (AR/EN).

### ProductMedia
- **Purpose:** images/reels/spec sheets for a product.
- **Relationships:** *–1 `Product`; wraps a `Media` object.
- **Ownership:** `ORG`. **Constraints:** `products/` bucket; ordered; primary image flag; MIME/size limits.

---

## E. Inventory & Availability (`inventory`)

### Inventory
- **Purpose:** stock/quantity signal for a product at an org/branch (not a commerce ledger — a trust/availability signal).
- **Relationships:** *–1 `Product`; 0–1 `Branch`.
- **Ownership:** `ORG+BRANCH`. **Constraints:** non-negative quantities; unit consistent with product.

### Availability
- **Purpose:** a coarse availability state usable in discovery/matching (`in_stock`, `low`, `made_to_order`, `unavailable`) and lead time.
- **Relationships:** *–1 `Product` (0–1 `Branch`).
- **Ownership:** `ORG+BRANCH`. **Constraints:** streamed via Realtime (inventory availability channel).

---

## F. Sales operating workflow (`sales`) — the wedge (05C)

### Opportunity
- **Purpose:** a sales prospect/deal a Sales user works (the pipeline's unit).
- **Relationships:** *–1 `Organization` (owner tenant); *–1 owner `Membership` (Sales user); 0–1 originating `Need`/consultation; 1–* `Task`, `FollowUp`, `Match`; 0–* `RfqRequest`/`Quote`.
- **Lifecycle:** pipeline stages (`new` → `qualified` → `matching` → `quoted` → `won` | `lost`). See [11](11_state_machines.md).
- **Ownership:** `ORG+BRANCH`. **Constraints:** always has an owner and a current stage; stage changes stream live.

### Need
- **Purpose:** a structured statement of what a consumer/opportunity requires (extracted from consultation or entered by Sales).
- **Relationships:** *–1 subject (`User` consumer or `Opportunity`); 1–* `Match`; 0–* `RfqRequest`.
- **Ownership:** `USER` (consumer-originated) or `ORG` (opportunity-originated). **Constraints:** carries structured attributes (category, quantity, locality, budget-range) used for matching.

### Match
- **Purpose:** a ranked, **explainable** suggestion linking a `Need`/`Opportunity` to a `Product`/provider.
- **Relationships:** *–1 `Need`/`Opportunity`; *–1 `Product`/`Organization`.
- **Ownership:** `ORG`/`USER` (context). **Constraints:** AI-assisted, human-reviewed; carries a match **score + explanation**; never auto-acts.

### PipelineStage (reference/enum)
- **Purpose:** ordered stage definitions for opportunities. **Ownership:** `PLATFORM` (enum) — ⚑ OPEN whether org-customizable in MVP (default: fixed set).

### Task
- **Purpose:** an actionable to-do tied to an opportunity/project (call, send docs, follow up).
- **Relationships:** *–1 `Opportunity` (or `Project`); assigned to a `Membership`.
- **Lifecycle:** `open` → `in_progress` → `done` | `cancelled`. **Ownership:** `ORG+BRANCH`.

### FollowUp
- **Purpose:** an AI-**drafted**, human-reviewed follow-up (message/reminder) on an opportunity.
- **Relationships:** *–1 `Opportunity`; 0–1 `Conversation`/`Message` (when sent).
- **Lifecycle:** `drafted` → `scheduled` → `sent` | `dismissed`. **Constraints:** never auto-sent; human approves before send.

---

## G. RFQ & Quotations (`rfq`, `quotations`)

### RfqRequest
- **Purpose:** a request for quotes derived from a need/discovery/opportunity, sent to one or more providers.
- **Relationships:** *–1 requester (`User`/`Organization`); 0–1 `Need`/`Opportunity`; 1–* `RfqItem`; 1–* `Quote` (responses).
- **Lifecycle:** `draft` → `sent` → `responses_in` → `closed` | `cancelled`. See [11](11_state_machines.md).
- **Ownership:** requester `USER`/`ORG`. **Constraints:** consultation-first (not an auction); providers see only their own view; **no blind price-war bidding**.

### RfqItem
- **Purpose:** a single line (product/spec + quantity) in an RFQ.
- **Relationships:** *–1 `RfqRequest`; 0–1 `Product`. **Ownership:** inherits RFQ. **Constraints:** quantity > 0; spec text or product reference required.

### Quote
- **Purpose:** a provider's response to an RFQ — the comparable offer.
- **Relationships:** *–1 `RfqRequest`; *–1 responding `Organization`; 1–* `QuoteItem`; 0–1 `QuoteDecision`.
- **Lifecycle:** `draft` → `submitted` → `under_review` → `accepted` | `rejected` | `expired`. See [11](11_state_machines.md).
- **Ownership:** responder `ORG`. **Constraints:** EGP amounts (mono formatting in UI); validity window; one active decision.

### QuoteItem
- **Purpose:** priced line matching an RFQ item.
- **Relationships:** *–1 `Quote`; 0–1 `RfqItem`/`Product`. **Ownership:** inherits Quote. **Constraints:** non-negative amounts; currency = EGP.

### QuoteDecision
- **Purpose:** the requester's decision on a quote (accept/reject) with rationale.
- **Relationships:** 1–1 `Quote`; actor `Membership`/`User`. **Constraints:** only the requester side decides; decision is auditable; transitions the linked opportunity/project.

---

## H. Projects (`projects`)

### Project
- **Purpose:** execution/tracking of accepted work (post-decision follow-up), **not** payments/milestones (deferred).
- **Relationships:** *–1 `Organization`; 0–1 originating `Quote`/`Opportunity`; 1–* `ProjectActivity`, `Task`; 0–* `Conversation`, `Document`.
- **Lifecycle:** `planned` → `active` → `on_hold` → `completed` | `cancelled`. See [11](11_state_machines.md).
- **Ownership:** `ORG+BRANCH`. **Constraints:** MVP scope = tracking/follow-up only; no escrow/milestone/dispute logic.

### ProjectActivity
- **Purpose:** a timeline event on a project (status change, note, upload).
- **Relationships:** *–1 `Project`; actor `Membership`. **Ownership:** `ORG`. **Constraints:** append-only; streams via Realtime (project activity).

---

## I. Conversations & Messaging (`conversations`)

### Conversation
- **Purpose:** a threaded discussion attached to a consultation, RFQ, quote, or project.
- **Relationships:** polymorphic subject (`Need`/`RfqRequest`/`Quote`/`Project`); 1–* `Message`; *–* participants (via membership/user).
- **Lifecycle:** `open` → (`archived`) → (`closed`). **Ownership:** `ORG`/`USER` (context) with participant access. **Constraints:** participants scoped by RLS; no cross-tenant leakage.

### Message
- **Purpose:** a single message (text + optional attachments); may be AI-drafted (Smart Share/follow-up) but human-sent.
- **Relationships:** *–1 `Conversation`; author `User`; 0–* attachments (`Media`/`Document`).
- **Lifecycle:** `draft` (optional) → `sent` → (`read`). **Constraints:** attachments via `attachments/` bucket; delivery streams via Realtime; **no technical implementation copy** surfaced.

---

## J. Notifications (`notifications`)

### Notification
- **Purpose:** an in-app notification record with a type, subject reference, and read state; may fan out to email/WhatsApp.
- **Relationships:** *–1 recipient `User`; 0–1 `Organization` context; references a subject entity.
- **Lifecycle:** `created` → `delivered` → `read` → (`archived`). See [11](11_state_machines.md).
- **Ownership:** `USER`. **Constraints:** severity + type; **never color-only** in UI; critical/actionable items are not auto-toasted; respects preferences.

### NotificationPreference
- **Purpose:** per-user channel/type preferences (in-app / email / WhatsApp).
- **Relationships:** *–1 `User`. **Ownership:** `USER`. **Constraints:** operational (transactional) notifications may be non-disable-able; marketing ones are opt-in.

---

## K. Advertisements (`advertisements`)

### Advertisement
- **Purpose:** a promoted placement for an org's product/brand (MVP capability area).
- **Relationships:** *–1 `Organization`; 0–1 `Product`/`Brand`; 1–* `AdPlacement`.
- **Lifecycle:** `draft` → `pending_review` → `active` → `paused` | `ended` | `rejected`. **Ownership:** `ORG`. **Constraints:** consultation-first framing (promoted discovery, not commerce); moderated before active. ⚑ OPEN: billing model for ads (tied to subscription vs paid placement).

### AdPlacement
- **Purpose:** where/when an ad shows (surface, slot, schedule).
- **Relationships:** *–1 `Advertisement`. **Ownership:** `ORG`/`PLATFORM` (slot inventory). **Constraints:** slot availability governed platform-side.

---

## L. Subscriptions (`subscriptions`)

### Plan (a.k.a. "Package")
- **Purpose:** a subscription package defining entitlements/limits (catalog size, seats, ad slots, AI usage).
- **Ownership:** `PLATFORM` (reference). **Constraints:** ⚑ **OPEN** — concrete tiers/pricing are **undecided** (PRODUCT.md). Model structurally now; populate on product-owner decision. **No payment processing in MVP.**

### Subscription
- **Purpose:** an organization's (or user's) current plan + state; **gates** access/capabilities/limits.
- **Relationships:** *–1 `Organization` (or `User`); *–1 `Plan`.
- **Lifecycle:** `trialing` → `active` → `past_due` → `canceled` | `expired`. See [11](11_state_machines.md).
- **Ownership:** `ORG`/`USER`. **Constraints:** entitlement checks are server-side; MVP has no billing integration (state is administratively set). ⚑ OPEN.

---

## M. Documents, Media & Locality (cross-cutting)

### Document
- **Purpose:** a stored file with metadata + optional OCR-extracted text (verification docs, project files, spec sheets).
- **Relationships:** polymorphic owner (`Verification`/`Project`/`Product`/`Message`); 0–1 OCR `Extraction`.
- **Ownership:** context owner. **Constraints:** private buckets by default; MIME/size limits; OCR async; never cross-tenant.

### Media
- **Purpose:** an image/reel/asset (avatars, product images, portfolio, ad creatives).
- **Relationships:** polymorphic owner (`Profile`/`Product`/`Advertisement`/`Message`).
- **Ownership:** context owner. **Constraints:** bucket per purpose ([05](05_storage_design.md)); dimensions/transform handled in-app (Supabase Storage; **not** Cloudinary).

### Locality (reference)
- **Purpose:** Egyptian locality hierarchy (governorate → city → district; e.g. Cairo, New Cairo, Sheikh Zayed) for profiles, needs, discovery, geo.
- **Ownership:** `PLATFORM` (reference/seed). **Constraints:** bilingual names; optional PostGIS geometry; **internal data, not Google Places**.

---

## N. Analytics & Audit (`analytics`, `admin`)

### AnalyticsSnapshot (derived)
- **Purpose:** precomputed aggregates for cockpits/admin dashboards (pipeline counts, quote win-rate, verification throughput).
- **Relationships:** scoped by `Organization`/`Branch`/global (admin).
- **Ownership:** `ORG`/`PLATFORM`. **Constraints:** derived (refresh async); dashboards are built **after** inner workflows; source-of-truth remains the operational tables.

### AuditLog
- **Purpose:** an append-only record of security-relevant and state-changing actions (who did what, when, to which entity).
- **Relationships:** references any subject entity + actor `User`/`PlatformRole`.
- **Ownership:** `PLATFORM` (write-once). **Constraints:** immutable; production inserts come only from constrained in-transaction workflow writers (not direct `service_role` DML); captures verification decisions, membership/capability changes, moderation, admin overrides, quote decisions; PII-minimized; retained per policy ([05](05_storage_design.md)/[14](14_future_extensions.md)).

---

## Entity → context → ownership summary

| Entity | Context | Ownership | Soft-delete | Realtime |
|---|---|---|---|---|
| User, Profile, Contact | accounts | USER | Profile: yes | — |
| Organization, Branch | organizations | ORG / ORG+BRANCH | yes | — |
| Membership, Capability | organizations | ORG | Membership: revoke | — |
| Verification, VerificationDocument | verification | USER/ORG | no (audit) | status |
| Product, ProductMedia | catalog | ORG | yes | — |
| Brand, Category, Locality, AccountType, Plan, PipelineStage | reference | PLATFORM | archive | — |
| Inventory, Availability | inventory | ORG+BRANCH | no | availability |
| Opportunity, Need, Match, Task, FollowUp | sales | ORG(+BRANCH)/USER | yes | pipeline/task |
| RfqRequest, RfqItem | rfq | USER/ORG | cancel | — |
| Quote, QuoteItem, QuoteDecision | quotations | ORG | no (audit) | quote status |
| Project, ProjectActivity | projects | ORG+BRANCH | cancel | project activity |
| Conversation, Message | conversations | ORG/USER | archive | messages |
| Notification, NotificationPreference | notifications | USER | archive | notifications |
| Advertisement, AdPlacement | advertisements | ORG/PLATFORM | yes | — |
| Subscription | subscriptions | ORG/USER | no | — |
| Document, Media | documents/media | context | yes | — |
| AnalyticsSnapshot | analytics | ORG/PLATFORM | n/a | — |
| AuditLog | admin | PLATFORM | never | — |
