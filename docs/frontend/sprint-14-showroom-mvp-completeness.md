# Sprint 14 — Showroom MVP Completeness

| | |
|---|---|
| **Branch** | `feature/showroom-mvp-completeness` (cut from `main` @ `678ba32`) |
| **Goal** | Make the **Showroom / buyer** account the strongest, most complete MVP account: audit the implemented surfaces, reorganize the information architecture, raise UI quality to client-presentable, and add the missing showroom modules. |
| **Scope guard** | No consumer work. No product-direction change. No `.pen` edit. No unrelated module touched. |
| **Inspiration** | `UI-UX/references/showroom/*` — 13 reference images, **inspiration only, not copy targets**. |

---

## 1. Audit

### 1.1 Reference material

The inspiration set was supplied as loose images at the repository root (`showroom/`). There was no
existing reference-assets convention under `UI-UX/`, so the images were moved — unmodified — to
**`UI-UX/references/showroom/`** and are used as visual/product inspiration only. No `.pen` file was
touched.

What the references establish (extracted structure, not visual language):

| Reference | Surface | Structure extracted |
|---|---|---|
| `1.png`, `12.jpeg` | Home | KPI strip → "what do you want to do today" action row → discovery strip → three-column work panels (open requests · category split · latest offers) |
| `2.png` | Incoming Offers | Title+subtitle → status filter chips → scope dropdown → table (offer no · supplier · product · qty · price · date · status · action) → count + pagination |
| `3.png` | My Orders | KPI strip → status tabs → filter toolbar → table with status badges |
| `4.png` | Suppliers | KPI strip → filter toolbar → directory table (logo · name/code · location · categories · status) |
| `5.png` | Saved Products | Category tabs → count + sort/filter → product **card grid** with unsave + "request a quote" |
| `6.png` | Technicians (الصنايعية) | Filter toolbar → KPI strip → roster table (avatar · specialties · area · status) |
| `7.png` | Sales Team (فريقي – البائعون) | KPI strip → tabs → roster table with per-seller performance |
| `8.png` | Projects | KPI strip → filter toolbar → project table with progress |
| `9.png` | Institutions (المؤسسات) | KPI strip → filter toolbar → institution table (type · location · activity) |
| `10.png` | Reports & Analytics | Scope filters → KPI row → trend + distribution + rankings |
| `11.png` | Settings | Settings sub-nav + panelled sections (identity · notifications · preferences · security) |

**Deliberately NOT adopted** — these are in the references but contradict the approved Aladdin
direction, and copying them would have been a product change smuggled in as a UI change:

- **Points / rewards / "المستوى الذهبي" tier card** — no points, wallet, or leaderboard exists in Aladdin, and
  Sprint 13 explicitly kept referral attribution *without* a rewards feature.
- **Add-to-cart icons on product cards** — Aladdin is consultation-first, explicitly **not** an
  add-to-cart / price-war marketplace. Product cards lead to *request a quote*, never a cart.
- **Supplier / technician star ratings and review counts** — no ratings or reviews model exists.
- **Paid membership / subscription card in the sidebar** — no subscription model exists.
- **"Add new supplier" / "Add new technician" / "Add new institution" buttons** — in Aladdin these are
  **directories of real registered organizations and people**, not a private address book the showroom
  types into. Creating a supplier record from the buyer side would fork business identity, which the
  account/organization model forbids.
- **Chat / messaging threads** — not implemented anywhere in the product.

### 1.2 What already exists

The `/b2b` workspace is a single **org-type-agnostic** shell (`components/layout/app-shell.tsx`) with a
flat 11-item nav filtered by capability (`lib/nav/modules.ts`).

| Existing surface | Route | State |
|---|---|---|
| Workspace home | `/b2b` | Exists, but is **sales-rep centric** (overdue follow-ups, my open leads, lead stages). A showroom owner/buyer sees nothing about purchasing. |
| Customers / Leads / Follow-ups | `/b2b/customers`, `/b2b/leads`, `/b2b/follow-ups` | Complete (Sprints 3–6). Sell-side. |
| Catalog | `/b2b/catalog` | Cross-tenant published product browse + filters. Good foundation for buying. |
| Products | `/b2b/products` | Own-org product management. Sell-side. |
| RFQs | `/b2b/rfqs` | **Ambiguous.** One page renders *both* "sent" and "received" RFQs stacked. |
| Quotations | `/b2b/quotations` | **Ambiguous.** Same problem — received and sent quotes stacked in one scroll. |
| Orders | `/b2b/orders` | Exists; buy/sell perspective not separated. |
| Projects | `/b2b/projects` | Exists (Sprint 10). Thin list. |
| Organization → People | `/b2b/organization` | Roster, invitations, capability presets, join requests (Sprints 11–13). |

**Root cause of the "طلباتي / مشترياتي" confusion:** it is not a labelling bug. `/b2b/rfqs` and
`/b2b/quotations` each mix the buy side and the sell side into a single page, so no label can be
correct for both halves. The fix is perspective separation, not renaming.

### 1.3 What is missing vs. the target coverage

| Target module | Status before this sprint |
|---|---|
| Dashboard / Home | Exists but sales-rep only — **needs a buyer surface** |
| Purchase Requests | Half-exists inside `/b2b/rfqs` — **needs separation + naming** |
| Incoming Offers | Half-exists inside `/b2b/quotations` — **needs separation + naming** |
| Suppliers | **Missing** |
| Saved Products | **Missing** (no persistence at all) |
| Technicians / الصنايعية | **Missing** |
| Sales Team / فريقي – البائعون | Exists as "Organization" — **needs renaming + reframing** |
| Projects | Exists — **needs strengthening** |
| Institutions | **Missing** |
| Reports & Analytics | **Missing** |
| Settings | **Missing** |

### 1.4 What should be renamed / reorganized

| Before | After | Why |
|---|---|---|
| Flat 11-item nav | **5 grouped sections** (Overview · Buying · Network · Selling · Business) | 11 flat peers give no hierarchy; a buyer cannot see which modules are their daily work. |
| "RFQs" | **Purchase Requests** (buy side, default) / Sales Requests (sell side, capability-gated) | "RFQ" is jargon; the two sides are different jobs. |
| "Quotations" | **Incoming Offers** (buy side, default) / Quotes Sent (sell side) | Matches what a showroom actually does with them. |
| "Orders" | **Orders & Purchases** | Absorbs "طلبياتي / مشترياتي" into one unambiguous label. |
| "Organization" | **Team** | The page is a people roster, not an organization record. Frees "Settings" for the business record. |
| "Catalog" | **Browse Products** | "Catalog" collided with own-org "Products". |

### 1.5 What should remain unchanged

- **Route paths stay as they are** (`/b2b/rfqs`, `/b2b/quotations`, `/b2b/orders`, `/b2b/organization`).
  The ambiguity is in labels and page structure, not URLs; renaming paths would churn every detail
  route, back-link and E2E spec for no user-visible gain.
- The shell itself: sidebar + top bar + mobile bottom nav, workspace/branch switchers, locale/theme
  controls, `SalesRealtime`. All correct and reused as-is.
- All sell-side sales modules (Customers, Leads, Follow-ups, Products) — untouched behaviour.
- Every existing RPC, RLS policy and server action outside the two additions below.
- The Aperture design system: semantic tokens only, no new colour/spacing/type/icon library.

### 1.6 MVP-critical now vs. later

**Now (this sprint):** sidebar IA, buyer dashboard, Purchase Requests, Incoming Offers, Suppliers,
Saved Products, Technicians, Institutions, Team, Projects strengthening, Reports & Analytics, Settings.

**Later (explicitly deferred):** supplier/technician ratings and reviews; contact-and-message threads;
CSV/PDF export; saved-product collections and notes UI beyond a single note column; per-seller target
and commission tracking (needs a targets model); geographic distribution map (needs PostGIS-backed
locality aggregates); notification preferences persistence.

---

## 2. Implementation plan

1. **IA** — rewrite `lib/nav/modules.ts` into grouped, capability-aware sections; render section
   headings in the sidebar; keep the mobile bottom bar at five items chosen by buyer priority.
2. **Shared UI** — add the table/toolbar/KPI primitives the references depend on and the codebase
   lacks, as one canonical set (`components/ui/data-table.tsx`, `stat-tiles.tsx`, `filter-bar.tsx`).
3. **Perspective separation** — rework `/b2b/rfqs` and `/b2b/quotations` around a buy/sell perspective
   with the buyer side default for a showroom.
4. **New modules** — Suppliers, Institutions (one shared directory component, two org-type filters),
   Technicians, Saved Products, Reports, Settings.
5. **Schema (minimum required)** — one migration: `saved_products` + save/unsave RPCs, and expose the
   persona column on the professional directory so Technicians can filter to `installer_technician`.
6. **Dashboard** — buyer-first home composed from the new read models.

---

## 3. Result

### 3.1 Sidebar / IA

Five capability-derived sections replace eleven flat peers
(`frontend/src/lib/nav/modules.ts`, `components/layout/workspace-nav.tsx`):

| Section | Modules |
|---|---|
| _(unlabelled)_ | Home |
| **Buying** | Purchase requests · Incoming offers · Orders & purchases · Browse products · Saved products |
| **Network** | Suppliers · Technicians · Institutions |
| **Selling** | Customers · Leads · Follow-ups · My products |
| **Business** | Projects · Team · Reports · Settings |

A section with no reachable module is dropped rather than rendered empty. Three nav keys were
renamed to match what the modules are: `rfqs` → `purchaseRequests`, `quotations` → `offers`,
`organization` → `team`. **Route paths are unchanged.**

**Mobile:** the bottom bar now carries the four highest-priority modules **plus a "More" sheet**
holding every remaining module in the same sections as the desktop rail. This was a defect the
sprint introduced and then fixed: with seventeen modules across five sections, truncating the bar
to the first five silently made Projects, Team, Reports and Settings unreachable on a phone.

### 3.2 Perspective separation

`/b2b/rfqs`, `/b2b/quotations`, `/b2b/orders` and `/b2b/projects` each now state **one**
perspective, with the opposite side as a tab that appears only for an organization that holds that
role (or has records on that side). The stacked two-section layout — the actual source of the
"طلباتي / مشترياتي" ambiguity — is gone.

### 3.3 Modules delivered

| Module | Route | Notes |
|---|---|---|
| Dashboard | `/b2b` | Rebuilt buyer-first: action-led KPI strip, "What do you want to do today?", then buying panels, then pipeline panels. Composed from capabilities, not account type. |
| Purchase requests | `/b2b/rfqs` | Renamed, buy-side default, status KPIs, table. |
| Incoming offers | `/b2b/quotations` | Renamed, received-side default, status KPIs, table. |
| Orders & purchases | `/b2b/orders` | Renamed, buy-side default, value KPI. |
| Suppliers | `/b2b/suppliers` | **New.** Public org directory (supplier/manufacturer/importer/wholesaler), own org excluded, links into that supplier's catalog. |
| Institutions | `/b2b/institutions` | **New.** Same component, contractor/design-office/peer-showroom slice. |
| Technicians | `/b2b/technicians` | **New.** Public profile directory filtered to `installer_technician`, with a consultants tab. |
| Saved products | `/b2b/saved` | **New**, incl. schema. Organization-owned shortlist; save toggle on catalog cards. |
| Projects | `/b2b/projects` | Strengthened: KPIs incl. past-target-date, perspective tab, table. |
| Team | `/b2b/organization` | Reframed from "Organization"; page itself unchanged. |
| Reports & analytics | `/b2b/reports` | **New.** Aggregates of records the caller can open — no targets, forecasts or invented trends. |
| Settings | `/b2b/settings` | **New.** Business record, preferences, branches, and which modules your access opens. |

### 3.4 Shared UI added

`components/ui/data-table.tsx` (semantic table ≥ tablet, stacked cards below — the same column
definitions rendered twice), `stat-tiles.tsx` (`StatTiles` + `TabLinks`), `filter-bar.tsx`,
`breakdown.tsx`. One canonical set; the per-feature list components were rewritten onto it rather
than kept alongside it.

### 3.5 Schema

One migration, `20260816090001_showroom_saved_products.sql`:

- `public.saved_products` (org-owned, PK `(organization_id, product_id)`) + RLS + `save_product` /
  `unsave_product` security-definer RPCs + `saved_product_list` invoker view. Not audited — a
  private shortlisting act has no lifecycle, counterparty or money attached.
- `app._profile_public_directory()` gains the `persona` column (required by Technicians). The
  signature change forces DROP + CREATE, so **the full ACL is reasserted** — a browser run caught
  the first version reasserting only the REVOKE, which made the directory unreadable to every
  caller (42501).

---

## 4. Validation

| Check | Result |
|---|---|
| `pnpm --filter frontend typecheck` | ✅ clean |
| `pnpm --filter frontend lint` | ✅ 0 errors, 0 warnings |
| `pnpm --filter frontend test` | ✅ **208 passed** (incl. rewritten `nav/modules.test.ts` and the bilingual parity gate) |
| `supabase db reset` | ✅ applies all **27** migrations from clean, both seeds |
| `supabase test db` | ✅ **729/729** across 29 files, from a clean reset |
| Playwright `showroom-mvp` + `orders-projects` | ✅ **21 passed / 0 failed / 0 retries**, desktop (1440×900) **and** Pixel 5, English **and** Arabic |

The showroom spec covers: all twelve routes render with a page title, no console errors and no
horizontal overflow; the grouped rail; the mobile bar + More sheet reaching every module;
perspective tabs; supplier → catalog hand-off; save → shortlist → unsave round trip; the language
control's RTL flip; and a no-Latin-leak assertion over the Arabic nav and the new page headings.

**Pre-existing failures, not caused by this sprint** (confirmed by running the same spec on `main`
@ `678ba32`): `sales.spec.ts` "language switch flips `<html dir>`" and "branch-limited salesperson —
out-of-scope record". A third, "customer create, edit, and clear an optional value persist", is
flaky on a cold build and passes on retry in an untouched module.

## 5. Deferred

Supplier/technician ratings and reviews · contact and messaging threads · CSV/PDF export ·
shortlist collections and a note editor · per-seller targets and commissions · geographic
distribution map · notification-preference persistence · **new pgTAP assertions for
`saved_products`** (the existing 729 pass and two were updated for the widened directory column
set, but no new RLS/RPC assertions were written for the shortlist table itself).

> **pgTAP must be run from a clean `db reset`.** Running it after a Playwright session reports two
> unrelated failures (`14_write_path_security_review` #73, `16_sales_activities_followups` bad
> plan) because the E2E run leaves extra sales rows and capability grants behind. Both pass on a
> clean cycle; neither is a defect.
