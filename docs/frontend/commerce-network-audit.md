# Phase 6 + 7 — Commerce & Network: architecture audit (read-only)

Branch `feature/showroom-fullstack-v2`, runtime `aladdin_sr2`. Nothing in this document is implemented yet.
Status words: **implemented** (works, reusable as-is), **partial** (exists, needs an adapter or extension), **absent**.

## A. What exists

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Purchase Request (internal need) | **absent** | no table/RPC/view; `20261007090003` removed the `open_purchase_requests` figure because it had been computed from `rfq_list` | `rfqs` is NOT a purchase request: it is one requester -> exactly one supplier, created to be sent. |
| RFQ (outgoing / incoming) | **implemented** | `rfqs`, `rfq_items`, `create_rfq`, `add_rfq_item`, `submit_rfq`, `cancel_rfq`, `rfq_list` (`20260810090001`) | statuses `draft/submitted/quoted/closed/cancelled`; `ck_rfqs_distinct_orgs`; items snapshot name/unit and keep a soft `product_id`. |
| Quotation (received / sent) | **implemented** | `quotations`, `quotation_items`, `create_quotation`, `set_quotation_item_price`, `submit_quotation`, `decide_quotation`, `quotation_list` | one live quotation per RFQ (`uq_quotations_rfq_live`); draft private to supplier; requester sees it only once submitted. |
| Purchase order | **implemented** | `orders`, `order_items`, `create_order_from_quotation`, `start_order`, `cancel_order`, `order_list` (`20260811090001`) | one order per accepted quotation; only the buyer commits; lines frozen from the quotation. |
| Capabilities | **implemented** | `rfq.create`, `rfq.respond`, `quote.submit`, `quote.decide`, `order.create`, `order.manage`, `job.post`, `job.manage`; `org.manage` is a super-key | showroom nav already filters on them (`navigation.ts`). |
| Private product price | **implemented** | `product_prices` (own-org SELECT only, RPC-only writes, `20261010090001`) | quotation prices are a separate, per-RFQ number owned by the quotation; they never read `product_prices` of the other side. |
| Supplier discovery | **partial** | `organization_public_directory` (verified/active orgs, no contact columns), `listOrganizations` (hard `LIST_LIMIT`, no pagination), legacy `/b2b/suppliers` | supplier org types: `supplier`, `manufacturer`, `importer` (`wholesaler` remapped to `supplier`, `20260924090004`). No contact projection exists. |
| Craftsman discovery | **partial** | `profile_public_directory` (listed, active personal profiles; display name, headline, bio, locality, languages), trades taxonomy, availability, portfolio, reviews | no contact fields, no org context; no contact-visibility setting anywhere (`contacts` table is user-private WhatsApp/email). |
| Network referrals | **partial** | `network_referrals` (`known_organization` resolves instantly, `new_showroom` goes `pending` -> admin approve/reject, Points only on approved NEW org) | covers **showrooms only**, and requires a *personal professional* referrer. Not usable by a showroom, and has no supplier or craftsman candidate type. |
| Sales-affiliation referrals | n/a | `organization_referrals` / `organization_join_requests` | closed to non-sales personas by `20260831090001`; must not be reused. |
| Jobs / applications | **implemented** | `jobs`, `job_applications`, `job_assignments`, `job_create/publish/close/...`, `open_job_opportunities` (installer pool, verified posters only) | `can_post_job` = `job.post`; `can_manage_job` = `job.manage`. Discovery view is installer-oriented (has_applied, personal). |
| Showroom shell routes | **absent** | suppliers, craftsmen, jobs, purchase-requests, pricing-requests-sent, quotes-received, purchase-orders, customer-rfqs, customer-quotes all fall to the generic "not available yet" `[page]` route | navigation + capability gating already exist. |
| Legacy /b2b UI + actions | **implemented** | `app/b2b/{rfqs,quotations,orders,suppliers,jobs}`, `features/commerce/*`, `server/actions/commerce*.ts`, `server/queries/commerce.ts` | working reference for the data layer; presentation is the old shell, so showroom needs adapters, not copies. |

## B. Gaps that matter

1. **Purchase Request** has no entity. It must be new, and must stay distinct from RFQ.
2. **Contact visibility** has no model for organizations or craftsmen. Showing a phone number is a privacy decision, not a column.
3. **Referral/review** supports only "a professional refers a showroom". Needs a supplier/craftsman candidate path that a *showroom* organization can submit, with its org preserved.
4. **Directory pagination** is a hard limit, not bounded server-side paging.
5. **Job discovery** is built for installers; a showroom needs (a) its own posted jobs and (b) browse of open jobs with its poster/applicant roles.
6. **Cross-account fixtures** (a supplier org that can answer an RFQ from the showroom) must be created in `aladdin_sr2` only.

## C. Proposed design (for approval, nothing built)

### Purchase Request — SUPERSEDED
The internal-only model proposed in revision 1 is withdrawn. See **Revision 2** below.

### Contact visibility (new, additive)
- Organization: `organization_contact_settings` (`show_phone`, `show_whatsapp`, `show_email`, default **all false**) and a SECURITY DEFINER reader behind a security_invoker view that returns a contact only when the owner opted in AND the viewer is an authenticated member of a business org.
- Craftsman: same idea on the profile, default hidden; reuses verified `contacts` values, never raw user data.

### Referral/review for unregistered supplier or craftsman
- Extend `network_referrals` with a `candidate_kind` (`showroom | supplier | craftsman`) and a nullable `submitted_by_org_id`; relax the personal-professional-only guard for a showroom member holding a defined capability. No Auth user is created, status starts `pending`, **zero Points until admin approval** (reuse the existing `referral.organization_approved` event; craftsman approval event is a decision, below).

### Sales side
- No new RFQ backend. `customer-rfqs` = `rfq_list` where `supplier_org_id = org` and status `<> draft`; `customer-quotes` = `quotation_list` where `supplier_org_id = org`. Buying side is the mirror. Adapters only.

### Jobs
- Reuse `jobs` tables. Add one read projection for a business viewer (open jobs from other verified posters, plus the showroom's own postings) with bounded pagination.

## D. Migrations proposed (none written)

1. (withdrawn - see Revision 2, section R7)
2. `contact_visibility` for organizations and craftsmen + `supplier_directory` / `craftsman_directory` projections (paged, filterable, case-insensitive search).
3. `network_referrals` candidate kinds + org attribution + approve/reject paths for supplier/craftsman (no Auth user).
4. `business_job_opportunities` read projection.
5. pgTAP: cross-tenant isolation, price visibility, capability denials, no-points-before-approval, no-self-RFQ.

## E. Routes (showroom suite, `/preview/showroom-suite-v2/...`)

`suppliers`, `suppliers/[orgId]`, `craftsmen`, `craftsmen/[profileId]`, `jobs`, `jobs/[jobId]`, `purchase-requests` (+ `new`, `[id]`), `pricing-requests-sent` (+ `[id]`), `quotes-received` (+ `[id]`), `purchase-orders` (+ `[id]`), `customer-rfqs` (+ `[id]`), `customer-quotes` (+ `[id]`), plus "suggest a supplier/craftsman" entry points.

## F. Order and dependencies

1. Contact-visibility + directory projections (unblocks Network).
2. Suppliers, Craftsmen pages (UI blocked on references, see below).
3. Referral/review extension.
4. Purchase Requests (new entity).
5. RFQ sent / quotes received / purchase orders adapters.
6. Customer RFQs / quotations sent adapters.
7. Jobs integration.
8. Cross-account pgTAP + browser E2E (showroom -> supplier -> quotation -> accepted -> order).

## G. UI references

Existing: showroom `my-products`, `offers`, `points`; Installer-Technician `02-job-opportunities`, `06-showroom-network`; legacy Distributor set (old theme, composition only). **Missing:** a dedicated Suppliers directory, Craftsmen directory, Purchase request / RFQ / quotation / order list+detail pages, Jobs (business view). A reference request accompanies the checkpoint.

---

# Revision 2 — shared demand publishing, product audiences, contacts, network.refer

Supersedes the Purchase Request parts of revision 1. Nothing here is implemented. Items marked **DECISION** need approval before any migration is written.

## R1. Revised Purchase Request domain

A Purchase Request is a **published buyer-defined demand**, visible to a defined set of business/persona audiences, answerable by several of them. It is not an RFQ (single requester -> single supplier), not a catalog product, not an Offer (supplier-published price package).

- `purchase_requests`: `id`, `requester_user_id` (always the actor), `requester_org_id` (nullable: personal requesters have no organization), `requester_kind` (canonical audience code, derived server-side from the active workspace, never client-supplied), `title`, `note` (250-char rule), `needed_by`, `share_with_showrooms boolean` (the "إظهار لمعارض أخرى" switch, showroom requesters only), `status` (`draft | published | closed | cancelled`), `version`, timestamps.
- `purchase_request_items`: `request_id`, `position`, `name` (required), `sku` (optional), `category_code` (FK `product_categories`, the 15 canonical codes, required), `color_items jsonb` (same `{name,hex,code}` shape and validators as products), `quantity numeric`, `unit` (existing `product_unit` enum), `spec` (250 chars via `DESCRIPTION_MAX_CHARS` / the characters validator). No `product_id`: items are free-form requirements and **never create catalog products**.
- `purchase_request_images`: at most **2 per item**, modelled on `product_images` (state machine, slot, owner-bound metadata) in a **new private bucket** `purchase-request-images`. Read = requester (own user/org) + currently-eligible viewers of a **published** request, sign-only (same `sign`/`sign_many` pattern as `product_images_select_public`).
- Writes: RPC only, security definer, actor from `auth.uid()`, optimistic `version`, audit events; no client DML.
- Requester capability: org requesters need `rfq.create` (reuse) on the active workspace; personal requesters need an active, supported persona. Unsupported personas (`sales`, `trainer`, `trainee`) cannot publish.
- Removed from revision 1: `rfqs.purchase_request_id` fan-out. Not needed until the acceptance model (R5) is approved.

## R2. Exact audience mapping

Canonical viewer/requester kind = `app.viewer_offer_audience(p_org_id)` semantics (active workspace `organization_type`, or the personal `persona_type`). No new enum. Only an **additive reference table** `purchase_request_audience_rules(requester_kind, viewer_kind)` (seeded, read-only, RLS select for authenticated), so the matrix is data, not scattered `case` logic.

| Requester kind (canonical) | UI label | Eligible viewer kinds |
|---|---|---|
| `installer_technician` | صنايعي | `showroom_dealer` |
| `contractor`, `contractor_company` | مقاول | `showroom_dealer` |
| `engineer`, `design_office` | مهندس / مكتب تصميم | `showroom_dealer` |
| `end_consumer` | عميل نهائي | `showroom_dealer` |
| `showroom_dealer` | معرض | `supplier`, `manufacturer`, `importer` |
| `showroom_dealer` + `share_with_showrooms` | معرض | `supplier`, `manufacturer`, `importer`, `showroom_dealer` (other showrooms) |
| `supplier` (and legacy `wholesaler`) | مورد | `supplier` |
| `manufacturer` | مصنع | `manufacturer` |
| `importer` | مستورد | `importer` |

Rules enforced in one function `app.request_visible_to(p_request_id, p_org_id)`:
1. viewer must be authenticated and (if `p_org_id` given) a member of it, with the audience taken from that organization;
2. viewer kind is in the matrix row for the request's `requester_kind` (plus showrooms only if `share_with_showrooms`);
3. **a request is never an opportunity to its own requester**: `p_org_id <> requester_org_id` and `auth.uid() <> requester_user_id`, so two workspaces of one person cannot answer each other's requests either;
4. request is `published`, requester org live (verified/active/non-deleted, same liveness rule as jobs/offers).

**DECISIONS:** (a) `interior_designer` persona is not named in the matrix: treat as Engineer (recommended) or unsupported? (b) `wholesaler` rows are remapped to `supplier` already; confirm no separate wholesaler audience.

## R3. Product audience-targeting architecture

- New `product_audiences (product_id, audience)` with `audience` FK to a **product** audience catalogue. Create Offer uses `offer_audience_types`, which lacks `end_consumer` and has `feed_ready` flags tied to Offers feeds, so Products get their own catalogue table (`product_audience_types`) that seeds the same canonical codes plus `end_consumer`; **no Offer audience rules are reused** for Requests or Products (both stay separate tables).
- Eight UI choices map to canonical codes: معرض `showroom_dealer`; مورد `supplier`; مصنع `manufacturer`; مستورد `importer`; مقاول `contractor`+`contractor_company`; مهندس `engineer`+`design_office`; صنايعي `installer_technician`; العميل النهائي `end_consumer`. The picker stores the UI choice; the catalogue expands it to canonical codes (so `design_office` orgs and `engineer` personas both see "مهندس" products).
- **Backward-compatible policy:** every product that is `published` at migration time receives **all eight** audiences (behaviour unchanged for existing data). Drafts get none. New products must choose at least one audience to publish (validated in `set_product_published` / `own_product_*`, plus a `ck`-style trigger so a published product with zero audiences cannot exist). Editing audiences on a published product takes effect immediately.
- Own-organization exclusion from Browse stays; an owner always reads their own products.
- Saved products: a saved row whose product stops being visible to the viewer's audience is hidden from the Saved list (same view-level filter) and cannot be re-saved; `save_product` re-checks audience.

## R4. Existing catalog RLS implications (the bypass)

Findings from the audit:

1. `products_select_published` (`20260810090001`): **any authenticated user may `select` any published row of `public.products`** straight through PostgREST. `catalog_published_products` became `security_invoker = true` (`20260817100000`), so it inherits that policy: the view and the table have **the same hole**. Audience filtering in the view alone would be bypassable by `from("products")`.
2. `product_images_select_public` (table) and the storage policy `product_images_select_public` both gate on `app.product_is_public(product_id)` = published only. Image keys are therefore signable by any authenticated user for any published product.
3. `add_rfq_item` accepts a published product of the supplier org with no viewer audience check, so a non-targeted viewer who guessed an id could build an RFQ line for it.
4. `saved_products`/`saved_product_list` and `search.ts` (which reads `catalog_published_products` and `products`) inherit the same exposure.
5. Frontend already does `from("products")` in `search.ts`, `commerce.ts`, `offers.ts`: those cross-tenant reads must be re-routed.

Proposed secure architecture (to be proven by pgTAP **before** the UI work):

- **Hard floor in RLS**: replace `products_select_published` with a policy `using (status='published' and deleted_at is null and app.product_audience_allows_caller(id))`, where the predicate is the **union** of all audiences the caller holds across their active memberships + personal persona (RLS cannot see the "active workspace"). A user holding several workspaces can therefore see any product that *one* of their own workspaces may see, never one that none may. Same predicate on `product_images_select_public`, storage policy and `app.product_is_public`.
- **Exact per-workspace read**: browse, detail, search, saved and direct links go through `security definer` readers taking `p_org_id` (the offers pattern: `catalog_feed(p_org_id, ...)`, `catalog_detail(p_org_id, id)`), which apply the *active workspace* audience and exclude own organization. `catalog_published_products` is reduced to the exact reader's projection or dropped; no frontend code reads `products` for other tenants.
- `product_prices` untouched (owner-select policy only); no price columns in any new reader (pgTAP asserts it).
- Pagination: readers take `(offset, limit<=10 batches)` with a total order, as today's 10/+10/-10 queries do.
- Risk: the union predicate is a deliberate, documented compromise. If you prefer **exact** isolation per workspace, the alternative is to deny direct table reads of other tenants' products altogether (revoke SELECT on the published path, readers only). That removes the union weakness but is a larger change to `search.ts`/RFQ/offers code. **DECISION.**

## R5. Multi-responder quotation approach

Audit result - the existing RFQ/quotation lifecycle cannot carry a broadcast request through a thin adapter:

1. `rfqs.requester_org_id` is `NOT NULL` and every RFQ RPC requires org membership + `rfq.create`: **personal requesters (customer, craftsman, engineer without an org) have no RFQ identity.**
2. An RFQ names exactly one `supplier_org_id`; `uq_quotations_rfq_live` allows one live quotation per RFQ.
3. `rfq_items` snapshot a product name and an enum unit; requests have free-form items with images/colours/category the RFQ tables cannot hold.
4. Creating one RFQ per responder automatically would have a responder (or the system) create an RFQ **as** the requester: impersonation, forbidden.

Options for approval (**DECISION**):

- **A (recommended).** Additive `purchase_request_responses` (+ `_items` priced against the request's items): one non-binding response per responding business per request (`draft | submitted | withdrawn | declined | selected`), unique per `(request_id, responder_org_id)`, same mechanics as quotations (RPC-only, version, capability `quote.submit`, price visible only to requester and that responder, never to other responders). Needed because of 1-3 above. Acceptance/selection and order creation are **not specified here**.
- **B.** Same as A, plus a requester-initiated bridge: "ask this responder for a formal quotation" creates a canonical direct RFQ *by the requester themself* (org requesters only), reusing the existing RFQ -> quotation -> order lifecycle for the binding part.
- **C (rejected).** Auto-create per-responder RFQs: impersonation and fails for personal requesters.

Open acceptance questions I will not assume: can a requester select several responses (partial fulfilment by item), does selection close the request, who creates the order for a personal requester (orders require `requester_org_id`)?

## R6. Direct RFQs stay unchanged

No change to `rfqs`, `quotations`, `orders`, their RPCs, views, or `Browse product -> Request quotation`. Distinct nav entries and metrics: Published Purchase Request (my / browse), Direct RFQ (sent / received), Supplier Quotation (received / sent), Purchase Order, Public Offer. `showroom_home_metrics` keeps no purchase-request figure until the request domain exists and then adds its own keys.

## R7. Contact visibility design

`organizations` has **no phone/email columns** and `contacts` is user-level. So:
- New `organization_contact_settings (organization_id, phone, whatsapp, email, show_phone, show_whatsapp, show_email)`: values owned by the org, three flags default **false**; write RPC requires `org.manage`.
- Craftsmen: reuse `contacts` (verified WhatsApp/email) and a profile-level `show_whatsapp/show_email` flags (default false); phone only if the profile already stores one (to check in the build step).
- A `security definer` reader returns a field only if its flag is on **and** the viewer is an authenticated member of a business organization (and, for craftsmen, an eligible viewer). Values never appear in `organization_public_directory` or `profile_public_directory`.
- Unregistered candidate contact stays in `network_referrals` columns, readable only by the submitter, their org's `network.refer`/`org.manage` members and platform reviewers, and never projected into any directory until approved and claimed.

## R8. network.refer integration

- `network.refer` is a new key in the fixed capability allow-list `ck_membership_capability_key` (recreated, as 6 prior migrations did), assignable by `org.members.manage`/owner like any capability; `org.manage` implies it.
- `network_referrals` gets `candidate_kind` (`showroom` default, `supplier`, `craftsman`), `submitted_by_org_id` (nullable), and contact columns; existing rows backfill as `showroom`.
- New RPC `network_candidate_create(kind, ...)`: caller needs `network.refer` on the active org; never creates an Auth user; `status='pending'`, stores submitter, org, kind, contact, timestamps, audit event. Existing `network_referral_create_*` (craftsman refers showroom) are untouched.
- Approve/reject for the new kinds ends in "reviewed" state only; it does **not** create accounts (claiming an organization/profile is a later, separate flow - **DECISION** whether approval should create an unowned supplier organization like showrooms do).

## R9. Points compatibility

`referral.organization_approved` is awarded only inside the `new_showroom` branch of `network_referral_approve`. The new approve path for `supplier`/`craftsman` candidates calls no `app.award_points`; a pgTAP test asserts zero `points_ledger` rows after approval. Craftsman-refers-showroom reward stays as is. Approval status and reward eligibility remain separate columns/events.

## R10. Proposed schema changes (none applied)

1. `product_audience_types`, `product_audiences`, backfill (all eight on published rows), publish guard, RLS/reader rework (R3/R4), storage policy update.
2. `organization_contact_settings` + profile contact flags + contact reader.
3. `network.refer` capability; `network_referrals` candidate columns; `network_candidate_create/approve/reject`.
4. `purchase_requests`, `_items`, `_images` (+ bucket), `purchase_request_audience_rules`, `app.request_visible_to`, create/publish/close/cancel RPCs, `purchase_request_feed` / `_detail` readers.
5. `purchase_request_responses` (+ items) once R5 is approved.
6. Business jobs read projection.

Order proposal: (2) and (3) are approved and independent of R4/R5, so they go first; (1) needs the RLS decision; (4) needs R2 decisions; (5) is blocked on R5.

## R11. Shared account routes

Shared feature module `features/purchase-requests/*` and `server/*/purchase-requests*` with one data layer, mounted by each shell as a thin adapter (no per-account tables):
- Showroom: `/preview/showroom-suite-v2/purchase-requests` (mine), `.../purchase-requests/new`, `.../purchase-requests/[id]`, `.../browse-requests` (+ `[id]`, `[id]/respond`).
- Other shells (craftsman, engineer/design office, customer, supplier/manufacturer/importer) mount the same components under their own roots when their reference exists. Navigation label split: **طلبات الشراء** (mine) vs **تصفح الطلبات** (browse); direct RFQ entries stay separate.

## R12. Suppliers page - UI composition brief (not a final layout)

Reuses shell, tokens, RTL/Light/Dark, `PageHero`, `FilterBar liveSearch`, `Select`/`SelectMenu`, `Pager`+`usePagedList` (10 / +10 / -10), `IconStat`. Proposed sections for your reference mock:
1. Page hero: icon + "الموردون" title, one-line description. No fake counters.
2. Filter bar: live search (name), organization type (مورد / مصنع / مستورد), product category, governorate/city, "verified only" toggle.
3. Optional summary tiles only from real data (count of eligible businesses, how many already worked with this showroom).
4. Results, Grid/List toggle: card = logo, name, type badge, verified mark, location, category chips (from real published products), product count, shared-work badge, actions: **View details**, **Request quotation** (existing direct RFQ), **Contact** (only fields the owner opted in).
5. Detail page: header, about, categories, published products (links into Browse filtered by supplier), contact block (opt-in only), "Request quotation" CTA.
6. Empty/no-result/error states; pagination footer.
7. "Suggest a supplier" secondary action for `network.refer` holders (pending-review form, no account created).
Need from you: reference image(s) for the grid/list card and the detail page, and any logo/placeholder asset (ASSET REQUEST will follow with exact sizes once the reference is in).

## R13. Decisions still needed

1. `interior_designer` audience mapping and confirm the eight-to-canonical expansion in R3.
2. Exact vs union product-audience enforcement (R4).
3. Response/acceptance model A or B, and the acceptance questions in R5.
4. Whether approving a supplier/craftsman candidate creates an unowned organization/profile.
5. Confirm backfill "all eight audiences" for existing published products.

---

# Revision 3 — approved decisions (supersedes Revision 2 where they differ)

## V1. The nine official account types (canonical identifiers already in the repo)

Source of truth: `frontend/src/lib/onboarding/account-types.ts` (`ACCOUNT_TYPE_CHOICES`, `REGISTRATION_CHOICE_ORDER`). Nothing is invented here.

| # | Label | Canonical identifier(s) | Kind |
|---|---|---|---|
| 1 | المعرض Showroom | `organization_type = showroom_dealer` | business |
| 2 | المورد Supplier | `organization_type = supplier` | business |
| 3 | المصنع Manufacturer | `organization_type = manufacturer` | business |
| 4 | المستورد Importer | `organization_type = importer` | business |
| 5 | المقاول Contractor | `persona_type = contractor` | personal persona (there is no contractor org type) |
| 6 | المهندس Engineer | `persona_type = engineer`; its business form is `organization_type = design_office` ("the canonical business behind the Engineer label", per the repo comment) | persona + business |
| 7 | الصنايعي Craftsman | `persona_type = installer_technician` (key unchanged, label only) | personal persona |
| 8 | فريق المبيعات Sales Team | `persona_type = sales` | persona that acts through an organization membership |
| 9 | حساب شخصي Personal | `persona_type = end_consumer` | personal persona |

**Legacy / technical values (kept for compatibility, never offered, never a new category):** `interior_designer` (persona; transitional registration key), `wholesaler` (org type; already remapped to `supplier` by `20260924090004`), `contractor_company` (org type, unused), `trainer`, `trainee`. None of them gets an audience, a label or a selector entry. Compatibility implications, stated explicitly instead of silently merging:
- a legacy `interior_designer` persona user has **no audience**; under exact-only enforcement they see no audience-restricted product and cannot publish a purchase request until they hold a supported account type (no automatic relabel to Engineer);
- legacy `wholesaler` organizations are already `supplier`; a `contractor_company` organization has no audience and no request privileges;
- the `design_office` organization type is covered because it is the repo's own canonical Engineer business, not because a legacy value was merged.

## V2. Product audiences (eight) vs account types (nine)

The eight audiences are targeting groups: **معرض, مورد, مصنع, مستورد, مقاول, مهندس, صنايعي, العميل النهائي**. Expansion to canonical codes, explicit and closed:

| Audience | Matches viewer whose active workspace/persona is |
|---|---|
| معرض | org `showroom_dealer` |
| مورد | org `supplier` |
| مصنع | org `manufacturer` |
| مستورد | org `importer` |
| مقاول | persona `contractor` |
| مهندس | persona `engineer` or org `design_office` |
| صنايعي | persona `installer_technician` |
| العميل النهائي | persona `end_consumer` |

Sales Team is **not** a ninth audience. A Sales Team user acts through the organization they are a member of: the viewer's audience is that **workspace's** `organization_type` (same rule as `app.viewer_offer_audience(p_org_id)`), so access never widens beyond the workspace they are authorised for. A Sales person with no active workspace has no audience.

**Narrow business decision (does not block foundation work):** should a Sales Team user ever be targetable on their own (e.g. a "sales team" audience for training/promo products)? Default until decided: no.

## V3. Product audience security — exact-only (approved)

The union-of-workspaces floor in R4 is **withdrawn**. Design:
- RLS on `public.products` for other tenants' rows is **removed** (`products_select_published` dropped). Other tenants' products are read **only** through workspace-aware `security definer` readers that take `p_org_id`, verify membership via `app.is_org_member`, derive the audience from that workspace (`organization_type`, or the persona when no workspace), exclude the viewer's own organization, and filter on `product_audiences`.
- Owner reads stay on the existing own-organization policy; platform support policy stays.
- `product_images_select_public` (table) and the storage `product_images_select_public` policy stop depending on "published only": signing requires the viewer's workspace to be eligible. Because storage policies cannot receive a workspace argument, image URLs are minted by a definer function the reader calls, not by a policy on `storage.objects` for arbitrary callers (design detail verified in the Milestone B spike before broad changes).
- `catalog_published_products` becomes the reader's projection (or is dropped); `saved_product_list`, `search.ts`, `offers` product reads and `add_rfq_item` all re-route through an eligibility function.
- Required pgTAP: direct `from("products")` of another tenant's published row fails; targeted workspace succeeds; non-targeted fails; switching `p_org_id` flips access for the same person; direct URL/detail, image and saved-list reads cannot bypass; `product_prices` stays unreadable.
- A full impact audit (every consumer of `products`, `product_images`, `catalog_published_products`, `saved_product_list`) precedes the RLS change; it is Milestone B step 1.

## V4. Purchase Requests — ownership correction (approved)

Request ownership has two explicit shapes, **no fake organization**:
- **A. Individual** requester: `requester_user_id` set, `requester_org_id` null. Allowed for Craftsman, Contractor, Engineer and Personal personas.
- **B. Organization** requester: acting through an active workspace; `requester_org_id` set; capability `rfq.create` (reuse) on that workspace.

The earlier "requester organization must be live" condition applies **only when `requester_org_id` is set**. A personal request is visible to eligible showrooms with no organization check on the requester, and the requester always manages their own requests (owner policy by `requester_user_id`, or by org membership + capability for case B) regardless of whether the request appears in Browse. Browse excludes the viewer's own requests and, for case B, every request of the viewer's own workspace.

## V5. Responses — Option A with full / partial quotes (approved)

`purchase_request_responses` + `purchase_request_response_items`: per responder, per request, independent and private to responder and requester; an item references the original `request_item_id`, stores original quantity and unit (snapshot), offered quantity (`> 0`, `<= requested`), `unit_price numeric(14,2)`, stored line total, optional note; unit must equal the requested unit (no cross-unit conversion). Requester may **shortlist** several responses (non-binding flag). Shortlisting creates no order, closes nothing, allocates nothing. Not approved yet and **not built**: binding acceptance, allocation across responders, order creation, payment, request fulfilment states. They can later bridge to the canonical direct RFQ -> quotation -> order lifecycle without schema changes here.

## V6. network.refer / candidates / contacts / Points

Implemented in Milestone A (`20261021090004`, `20261018090002`):
- `network.refer` capability; owners grant it through the existing no-escalation RPC without receiving anything extra; `org.manage` implies it.
- `network_candidates` is a **separate** table (not new columns on `network_referrals`) so the showroom approve RPC, which materialises an organization and pays the Points event, can never be reached by the new kinds. Approve/reject are status changes: no Auth user, no organization, no profile, no contact exposure, no Points.
- `organization_contacts` + `profile_contact_visibility`: three independent flags, default false; readers `business_contact` / `craftsman_contact` need an active member workspace and a directory-eligible target; candidate contacts are never read by them.
- Existing `network_referral_*` (craftsman refers showroom) and its Points award are untouched; the full pgTAP suite including `50_*`/`51_*` passes.


---

# Revision 4 - Milestone B: product audiences, exact-only (implemented)

## W1. Final decision incorporated: Sales Team audience behaviour

Sales Team stays one of the nine account types and is **not** a target audience. It inherits eligibility from the workspace it is actively and legitimately representing:

| Viewer | Audience used |
|---|---|
| Sales Team in a showroom / supplier / manufacturer / importer workspace | that workspace's audience (showroom_dealer / supplier / manufacturer / importer) |
| Sales Team in a design office workspace | engineer (the repo's canonical Engineer business) |
| Sales Team in a workspace with no audience (e.g. a contractor company) | none - sees nothing |
| Sales Team with no valid membership / no workspace | none |

Enforcement is in the database (`app.viewer_product_audience`, called by every reader), not in UI filtering: the workspace is a parameter, membership is verified with `app.is_org_member`, the audience is derived from that single organization, and a workspace the caller does not belong to raises 42501. Switching workspace changes the argument and therefore the result; nothing is combined. The same principle (workspace in, audience out, never a union) is the rule for Purchase Request discovery and quotation permissions in Milestone C. `product_audiences_set` refuses `sales` as an audience code (pgTAP 72).

## W2. Impact audit (done before the RLS change)

Every consumer of the published-product policy / views, and what happened to it:

| Consumer | Relied on | Now |
|---|---|---|
| `products_select_published` policy | any user reads any published row | **dropped**; owner and platform-support policies remain |
| `catalog_published_products` view (Browse, Detail, Search, Recommended, supplier facets, RFQ supplier product picker, Offers helpers) | invoker view over the open policy | **removed**; `catalog_products(p_org_id)` reader (same 19 columns, no price) |
| `saved_product_list` view (Saved page, Home KPI, Reports, dashboards) | catalog view join | **removed**; `saved_products_for(p_org_id)`; `showroom_home_metrics` recreated to count through it |
| `product_images_select_public` (table) | open published images | **dropped**; `catalog_product_images(p_org_id, ids)` reader |
| `product_images_select_public` (storage.objects, sign only) | `app.is_public_product_image_object` | now requires `app.has_product_image_grant`, which re-derives eligibility from live data on every use |
| `save_product` | published + org live | also requires the product to be visible to the saving workspace |
| `add_rfq_item` | product belongs to the RFQ's supplier | also requires visibility to the **requesting** workspace |
| `order_category_spend` view (Reports spend by category) | joined `products` through the open policy | uses `app.rfq_item_category(rfq_item_id)`, a narrow definer lookup keyed by an RFQ line the caller can already read; output unchanged |
| Offers (feed, detail, images) | definer RPCs | unchanged logic; image signing now requests a grant that also honours live offers for the viewer's offer audience |
| Direct URL `/catalog/[id]`, RFQ-new product param | the view | reader with the active workspace; untargeted -> not found |
| Own products / My Products / Offer builder / prices | owner policy | unchanged |
| `product_prices` | owner-only table | unchanged, never returned by a reader |

## W3. What was built

- **Migration `20261019090001`**: `product_audience_types` (8 codes), `product_audiences`, backfill of every existing published product with all eight, `product.audiences_set` audit action, `app.org_product_audience` / `persona_product_audience` / `viewer_product_audience` / `product_visible_to`, `product_audiences_set` (owner, `catalog.write`, archived refused, published product keeps >= 1), `set_product_published` publish guard, the three readers, `product_image_grants` + `product_image_access_grant` + `app.has_product_image_grant`, the dropped policies/views, and the audience-aware `save_product` / `add_rfq_item`.
- **Migration `20261019090002`** (security-review finding "stale grant"): a grant is only a workspace marker; `app.product_image_viewable` re-checks membership, audience and publication on **every** use. Retargeting, a suspended membership or a type change end signing immediately.
- **Seed**: `seed-pilot.sql` gives seeded published products all eight audiences, exactly like the migration backfill.
- **Front-end**: every catalog/saved/search/recommended/facet/image read passes the active workspace (`org.organizationId`, or `null` for a personal viewer); `signProductImageUrls(..., { orgId })` requests the grant first; eight-audience selector on **Create and Edit Product** (showroom form and the legacy `/b2b/products` form) reusing the Create Offer chip pattern and labels; audiences are saved **before** the product update so a refusal stops the whole save; activation without an audience shows a translated explanation.

## W4. Tests

- pgTAP `72_product_audiences_exact_only_test.sql` (90): structure, mapping (incl. design_office -> engineer, contractor_company -> none), owner write path, direct table reads fail (products, audiences, prices, images), targeted vs non-targeted, same person switching workspace, Sales Team inheriting / having none / not borrowing a workspace, every personal persona incl. legacy `interior_designer`, retargeting, saved + RFQ direct references, image grants (targeted / non-targeted / switching / unpublish / retarget / suspended membership), anon denial, audit without prices.
- Nine existing pgTAP files adapted where they relied on the open policy (23, 24, 29, 32, 33, 34, 67, 68, 69, 70); 69 now asserts the opposite where the old behaviour was the exposure ("the products table is no longer readable across tenants").
- Live check against the isolated runtime with real supabase-js calls and real Storage (25 assertions): the exact browse/count/head/facet call shapes, direct table read returns nothing, publish without audience refused, owner uploads a real PNG, targeted workspace is granted and the signed URL serves the bytes (200), non-targeted workspace cannot sign, retargeting kills an unexpired grant.

## W5. Compatibility and known limits

- Existing users: every published product stays visible to everyone who could see it before (backfill = all eight), so nothing disappears on deploy. Audience-less viewers (legacy `interior_designer`, `trainer`, `trainee`, `wholesaler`/`contractor_company` workspaces, a Sales person with no workspace, a business-valued legacy `primary_account_type` with no workspace) now see **no** cross-organization products - this is the approved exact-only behaviour, and the compatibility implication of not merging legacy types.
- Platform support keeps its existing direct read policy on `products` (support tooling).
- `catalog_products` is a plpgsql reader, so PostgREST filters/pagination apply after it returns the visible set. Fine at pilot scale; push filters/limit into the function before the catalog reaches thousands of rows (tracked, not done).
- `app.is_public_product_image_object` is now unused by policies (kept for compatibility); remove in a later cleanup.
- Browser-level (Playwright) pass over the rewired pages was **not** re-run in this milestone; type-check, unit tests and the live PostgREST/Storage check cover the call shapes, but the visual pages should get an e2e sweep with the next UI milestone.
- Not built here: any UI to *see* the audience on cards, the purchase request model (Milestone C), contact settings and candidate forms (waiting on Settings / Suppliers / Craftsmen pages).

---

# Revision 5 - Milestone C: the shared Purchase Request foundation (implemented)

## X1. Ownership (no fake organization)

| Shape | Who | Stored as | Who manages |
|---|---|---|---|
| Individual | Craftsman (`installer_technician`), Contractor, Engineer, Personal (`end_consumer`) personas | `requester_org_id = null`, `requester_user_id = author` | the author, always |
| Organization | showroom / supplier / manufacturer / importer / design office (= Engineer business) acting through an ACTIVE workspace | `requester_org_id` set | members holding `rfq.create` (or `org.manage`) |

A Sales Team member cannot publish as an individual (their persona is not a requester audience); they act through their workspace and the request carries that workspace's audience. A `contractor_company` organization (no audience) cannot publish. "Requester organization is live" is checked only when an organization owns the request; an individual request never depends on any organization. The requester audience is derived by the database from the persona or workspace - never accepted from the client.

## X2. Visibility matrix (workspace-based, exact-only)

| Requester | Discovered by (viewer workspace type) |
|---|---|
| Craftsman / Contractor / Engineer (persona or design office) / Personal | Showroom |
| Showroom | Supplier, Manufacturer, Importer; also other Showrooms only with the "إظهار لمعارض أخرى" option |
| Supplier | other Suppliers |
| Manufacturer | other Manufacturers |
| Importer | other Importers |

Viewers are workspaces: audience comes from the ONE workspace named (membership verified), Sales Team inherits it, a workspace with no audience sees nothing, switching workspace changes the result, nothing is unioned. A request is never discovered by its own organization or its own author (even through another workspace of theirs). A responder keeps a request it answered after the requester CLOSES it, but a DRAFT or CANCELLED request is gone for everyone except the owner side.

## X3. Data model (one shared system)

`purchase_requests` (status draft/published/closed/cancelled, optimistic `version`, `share_with_showrooms` only for showrooms), `purchase_request_items` (name, optional code, canonical category from the 15, colours via the same normalizer as products, `numeric(14,3)` quantity, unit from the six showroom units, specs <= 250 characters, no product reference - no catalog product is created), `purchase_request_images` (<= 2 per item, private bucket `purchase-request-images`, owner scope = organization or person), `purchase_request_responses` (one live response per responder organization), `purchase_request_response_items` (snapshot of requested quantity/unit, offered quantity, `numeric(14,2)` unit price, stored generated line total, optional line note).

Writes are RPC-only: `purchase_request_save` (create/edit a DRAFT, items merged by id), `purchase_request_publish/close/cancel`, image `request_upload/confirm_upload/remove`, `purchase_request_response_save/withdraw/shortlist`. Reads: owner side by RLS; everything cross-tenant through `purchase_requests_discover(p_org_id)` (bounded, filterable, exact count), `purchase_request_detail`, `purchase_request_responses_for_requester`, and per-workspace re-validated image signing (`request_image_access_grant`).

## X4. Responses (Option A, non-binding)

Many independent responses; a responder reads only its own, the requester reads every submitted one. FULL or PARTIAL is derived by the database (every item at the full requested quantity = full). Server-validated: `0 < offered <= requested`, quantity <= 3 decimals, unit = the requested unit (no conversion; a stated different unit is refused), price > 0, <= 2 decimals, <= 100,000,000 EGP; line total is a stored generated column; the response total is the sum. Revising a response clears any shortlist mark (it must be re-reviewed); withdrawing removes it from the comparison. Shortlisting any number of responses creates no RFQ, quotation or order, allocates nothing and does not close the request (verified by row counts in pgTAP and in the live check). Not built, not approved: binding acceptance, allocation across responders, order creation, partial fulfilment, payment, request expiry.

Future bridge to RFQ -> Quotation -> Order is possible without schema changes here (a response is already a priced, per-item offer addressed to one requester); the direct RFQ flow is untouched.

## X5. Security review findings addressed

An automated review of the first commit reported an authorization-state-bypass. Two real gaps were closed in `20261020090002`: (1) a reference-image ticket issued while the request was a draft could still be uploaded and confirmed after publishing - confirm and the storage INSERT predicate now require a draft; (2) a responder kept reading and signing a request the requester had CANCELLED - responder retention now covers published/closed only. Regression tests added.

## X6. Tests

- pgTAP `73_shared_purchase_requests_test.sql` (187): ownership shapes, no fake org, item validation (category, unit, quantity, 250-character specs in characters, 30-item cap), the whole matrix incl. design office / Sales Team / share option / own-request exclusion / org-liveness only for org requests, direct reads fail, responses full/partial + all refusals, isolation, non-binding shortlist (row counts unchanged), revise/withdraw/close/cancel lifecycle, images (<= 2, draft-only, grants, re-validation, cancel), audit without money. `47_*` storage-policy inventory updated for the four new policies. Full suite: 74 files, 3161 tests passing on a clean reset.
- Vitest: model/parsers/mapper, actions (23), queries (11). Total 208 files, 2573+ tests.
- Live check on the isolated runtime with real supabase-js + Storage (31 assertions): exact discover call shape (rpc + contains + ilike + range + count), individual identity hidden, owner uploads a real PNG, audience is granted and the signed URL serves the bytes, outside audience gets nothing, full + partial responses, over-offer refused, comparison totals computed by the database, two shortlisted without closing or creating any order, cancel hides it from responders.

## X7. Known limits / decisions still open

- A published request is not editable (close or cancel it); draft editing only. Whether to allow editing details after publishing is unapproved.
- Individual requesters' identity is never shown to responders; how/when contact is exposed (owner-controlled visibility from Milestone A) in the request/response flow is not wired.
- Request expiry / auto-close, notifications and chat for responses are not built.
- Units are the six showroom product units; adding more is a one-line migration.
- `purchase_requests_discover` is plpgsql (filters apply after the visible set is built); fine at pilot scale, push filters into the function before large volumes.
- Deleting an item removes its image rows; the bytes are orphaned in the private bucket (unreachable). A cleanup job is not built.
- No UI yet for any of this (Milestone D); typed actions, queries, parsers, error mapping and i18n error keys are ready for the pages.

---

# Revision 6 - canonical taxonomy closeout, shared units, image lifetime (implemented)

Supersedes the "legacy values kept for compatibility" paragraph of V1: the retired values no longer exist in the database.

## Y1. The nine public accounts (single source: `frontend/src/lib/taxonomy/accounts.ts`)

| # | Account | Identifier | Business subtypes (`public.activities`) | Audience |
|---|---|---|---|---|
| 1 | Showroom / المعرض | `organization_type = showroom_dealer` | `decor_showroom`, `paint_showroom`, `decor_and_paint_showroom`, `building_and_finishing_supplies_retailer` (موان) | showroom_dealer |
| 2 | Supplier / المورد | `supplier` | `distributor`, `wholesaler` | supplier |
| 3 | Manufacturer / المصنع | `manufacturer` | `paint_manufacturer`, `decor_manufacturer` | manufacturer |
| 4 | Importer / المستورد | `importer` | `decor_supplies_importer`, `paint_importer` | importer |
| 5 | Contractor / المقاول | `persona_type = contractor`; internal business `contractor_company` | none | contractor |
| 6 | Engineer / المهندس | `persona_type = engineer`; internal business `design_office` | `finishing` | engineer |
| 7 | Craftsman / الصنايعي | `persona_type = installer_technician` | none; 14 active **multi-select** specialties (`public.trades` / `user_trades`) | installer_technician |
| 8 | Sales Team / فريق المبيعات | `persona_type = sales` | none (staff roles `sales_rep`, `sales_manager` stay internal) | none - inherits the active workspace |
| 9 | Personal / حساب شخصي (العميل النهائي in audience context) | `persona_type = end_consumer` | none | end_consumer |

## Y2. Database changes (migrations 20261021090001 - 090006)

- **Found (isolated runtime):** users by persona: contractor 1, end_consumer 2, engineer 3, installer_technician 6, interior_designer 2, sales 3, none 10; organizations: contractor_company 1 (Horizon Contracting, with RFQs/orders/projects/jobs), design_office 2, importer 2, manufacturer 2, showroom_dealer 2, supplier 3; wholesaler organizations 0 (already remapped), trainer/trainee rows 0. Subtypes were already modelled: 13 `activities` rows.
- **Migrated:** the two `interior_designer` test users -> `engineer` (explicit, one statement per column: users, individual_onboarding, onboarding_progress, verifications); `wholesaler` organization/intent rows -> `supplier` + the `wholesaler` activity; `trainer`/`trainee` -> null (none existed). `contractor_company` was NOT removed: Horizon has live dependents and it is the business behind the single Contractor account.
- **Enums rebuilt** (Postgres cannot drop a label in place): `persona_type` = end_consumer, engineer, installer_technician, contractor, sales; `organization_type` = showroom_dealer, supplier, manufacturer, importer, contractor_company, design_office. The migration captures and re-creates the 15 dependent functions, 2 views, check constraints and defaults, patches function bodies that compared against a retired label and asserts none remain. Reproducible from a clean reset.
- **Integrity in the database, not only in RPCs:** triggers `organization_activities_type_guard`, `user_activities_type_guard`, `organizations_type_change_guard` (an activity can only attach to an organization/person of its type; an organization cannot change type while holding the old type's subtypes). The business registration track is restricted to showroom/supplier/manufacturer/importer/design_office inside `onboarding_select_account_type`; drafts, onboarding rows, referrals and (for a signed-in caller) organizations refuse `contractor_company` (it carries the Contractor audience, so it must not be self-assignable - found by the automated security review, closed in 20261021090005/6).
- **Offer audiences** no longer include `wholesaler`/`interior_designer` (existing targets carried to supplier/engineer).
- **Decision taken, please confirm:** a `contractor_company` workspace acts with the Contractor audience (products, and as a requester it is discovered by Showrooms), exactly as `design_office` acts as Engineer. Previously it had no audience, which left the Contractor account's business workspace blind. Reversible in one function (`app.org_product_audience`).

## Y3. Shared units (20261021090004)

Twelve units for products and Purchase Requests: kilogram, gallon, pail, roll, meter, sheet (unchanged) + piece, square_meter, linear_meter, liter, box ("علبة أو كرتونة"), set. One immutable list (`app.showroom_units()`) feeds the product validator, the request item normalizer and `ck_pri_unit`; `public.measurement_units` carries the grouping. `meter` is never reinterpreted as `linear_meter`; ton/bag/pack stay refused; no conversion exists (a response must use the requested unit). The product form suggests category-appropriate units first (`UNIT_SUGGESTIONS_BY_CATEGORY`) and keeps all others selectable.

## Y4. Product image signed URLs

Reduced from 3600 s to 300 s. A shorter lifetime breaks lazily loaded or long-open images, so `ProductMedia` now refreshes an expired URL once through `refreshProductImageUrlAction`, which signs with the CALLER's session after the database re-grants signing for the active workspace (or the personal audience on /home). A photo the caller may no longer see comes back as the placeholder. Signed URLs and already-downloaded images cannot be revoked; the lifetime only bounds the exposure.

## Y5. Suppliers page - reference specification for Milestone D (waiting for your reference images)

Unchanged R12 structure, now fixed on the canonical data: the type filter offers **Supplier / Manufacturer / Importer** (+ sub-filter by that account's subtypes: distributor/wholesaler, paint/decor manufacturer, decor/paint importer); `contractor_company`, `wholesaler` and Sales staff roles never appear as a type. Needed from you before layout: (1) the grid/list card reference, (2) the detail page reference, (3) logo/placeholder specs; the page is composed from `PageHero`, `FilterBar`, `SelectMenu`, `Pager` and the existing directory queries.
