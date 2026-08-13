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

_Filled in as the sprint completes — see §4 Validation._
