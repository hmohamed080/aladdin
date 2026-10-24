# Marketplace cart and delivery prices by area — Migration 12 + UI

**Status:** built and verified locally on the branch `feat/public-marketplace-20261011`; nothing pushed or deployed. **Checkout is not built** — the button on the cart says "Place order — Coming soon" and is disabled.

## Purpose

Let a buyer collect real, published Marketplace products in a cart, see what delivery costs **for the place they choose**, and see the order total the way the approved reference (`Layout/cart products.png`) shows it — while each showroom decides what it charges to deliver, per governorate and per area (DL-12, DL-16).

## Current decisions (agreed with the product owner)

| Topic | Decision |
|---|---|
| Delivery setup | Two steps, each its own page in the showroom's **Marketplace** menu group: **المناطق / Delivery areas** — choose WHERE it delivers (whole governorates and/or single areas) — then **توصيل المناطق / Delivery prices** — set WHAT it charges at each of those places. Each showroom sets its own; a governorate price is the default for all its areas and one area may have its own price. |
| No price | A place that is not added, or is added but **not priced yet**, is **not deliverable**: the buyer cannot choose delivery there. It is never silently priced at zero; free delivery is an explicit `0`. |
| Resolution | The area's own price, else the governorate's default, else "not available". |
| Several showrooms in one cart | **Each showroom has its own delivery price** for the chosen area; the page shows them per showroom and **sums** them. If one showroom does not deliver to the area, delivery is blocked and that showroom is named. |
| Pickup | A showroom turns "pick up from the showroom" on or off (its main stock location supports pickup). The buyer can choose pickup (no delivery fee) only when **every** showroom in the cart offers it. |
| VAT | Marketplace prices exclude VAT (DL-16). The cart shows **no tax line**: the total is **products + delivery**, and the product page keeps its "prices exclude tax" label. (An earlier build added 14 % on products + delivery as its own line, matching the reference image; the owner asked on 2026-10-19 to remove it.) Tax handling stays a decision for checkout. |
| Checkout | **Disabled, labelled "Coming soon"**; online payment is owned by the Kashier integration (another engineer). |
| Prices in the browser | The browser stores only `{slug, sku, qty}`. Every price, stock number and delivery fee is read from the database each time the cart is shown. |

## What was built

**Database** — `supabase/migrations/20261019090002_marketplace_delivery_and_cart.sql`

- `public.marketplace_delivery_rates (seller_organization_id, governorate_key, area_key null = governorate default, fee_egp null | 0…100000)`; unique per `(showroom, governorate, area)`; RLS on, member + staff `SELECT` only, **no client write grant**. Keys are validated against `app.place_governorates` / `app.place_cities` (the same catalogue as the rest of the platform).
- `marketplace_seller_delivery_get(org)` → `{rates, pickup_available}` (reader; a rate's `fee_egp` is null until priced), `marketplace_seller_delivery_areas_save(org, places)` (WHERE: replaces the set of places, atomic; a place that stays keeps its price, a new one starts unpriced, one left out is removed), `marketplace_seller_delivery_prices_save(org, prices)` (WHAT: sets prices only for places already covered, null clears one, unlisted places keep theirs, atomic; a place that is not covered is refused `mp:delivery_area_unknown`), `marketplace_seller_pickup_set(org, enabled)` — all writers; refusals `mp:delivery_invalid | _too_many | _fee_invalid:<row> | _location_invalid:<place> | _duplicate:<place> | _area_unknown:<place>`. Authenticated only, `SECURITY DEFINER`, empty `search_path`, same standing checks as every seller write (member with catalogue authority, enabled seller).
- `marketplace_public_cart(lines [{slug, sku}] ≤ 50, governorate, area)` — granted to **anon**: resolves each line against the **live** catalogue (published product, enabled showroom, active variant) and returns price, availability (capped at 9,999), a `seller` index and per showroom `{name, pickup_available, delivery: available(fee) | not_available | needs_area}`. A product that is no longer sold comes back as `unavailable` with nothing else. No organization id and no stock count above the cap ever leaves the database; no image id while the media pipeline is off.
- `supabase/tests/100_marketplace_delivery_and_cart_test.sql` (91 tests): shape/grants, areas + prices validation and atomicity, authorisation (other showroom, sales-only member, outsider, anon, suspended showroom), cart resolution, per-showroom fees, pickup switch, privacy. `95_…` seller-RPC counts raised to 18.

**Frontend**

- `/marketplace/cart` — real cart (replaces the former 404). Behind `NEXT_PUBLIC_MARKETPLACE_PREVIEW` like the rest of the Marketplace. Files: `features/marketplace/live/` (`live-cart-page.tsx`, `live-cart-store.ts`, `cart-math.ts`, `live-cart-copy.ts`, `live-format.ts`), `server/actions/marketplace-cart.ts` (read-only quote action), styles reused from `marketplace-cart.module.css`.
- Product page: **Add to cart** (was a disabled "ordering soon" button); the header cart icon counts the live cart.
- Showroom menu: the **الماركت / Marketplace** group holds three items, in this order — Marketplace products, **المناطق** (`/b2c/seller/areas`) and **توصيل المناطق** (`/b2c/seller/delivery`) — all behind the admin-granted `marketplace.sell` entitlement (never unlocked by `org.manage`). A showroom works inside the **Showroom account shell** (`features/showroom-shell`: `navigation.ts` group "Marketplace" after Products; `frame.tsx` adds the entitlement when the organization is an approved seller), so the group lives there. The older B2B workspace sidebar (`lib/nav/modules.ts`, keys `marketplaceProducts`, `marketplaceAreas`, `marketplaceDelivery`, group renamed from "الماركت — B2C") carries the same three items for non-showroom shells.
- `/b2c/seller/areas` — tick governorates, add single areas, save. `/b2c/seller/delivery` — one line per covered place with a price box (blank = not set), unpriced count, and the pickup switch; with no places yet it sends the showroom to the areas page. Files: `features/marketplace-seller/areas-editor.tsx`, `delivery-editor.tsx`, `delivery-model.ts`, `place-label.ts`; actions `saveSellerAreasAction`, `saveSellerPricesAction`, `setSellerPickupAction`. The seller products page keeps a toolbar link to the prices page.
- The preview (sample-data) cart components stay in the tree unchanged.

## Deviations from the written product docs — decide before release

- DL-01 / DL-07 say opening the cart requires sign-in and the guest cart stores `{variantId, qty}`. The approved design opens the cart **without sign-in** (as the earlier preview did), and the public API deliberately exposes **no variant ids**, so the cart stores slug + SKU. Sign-in is expected at the checkout step, which does not exist yet.
- The trust strip under the products is worded for what the platform does ("delivery by your area", "approved showrooms") rather than the reference's generic claims ("fast delivery to all governorates", "original, certified products").

## Verification

- pgTAP `100_marketplace_delivery_and_cart_test.sql`: 91/91 on the local QA database; the **whole suite on a clean stack built from all 184 migrations: 134 files, 6,345 tests, PASS** (after raising the seller-RPC count in `95_…` to 18 and adding the cart read to the anon-readable list in `93_…`).
- Vitest: whole frontend suite green (new: `cart-math`, `live-cart`, `delivery-model`, `delivery-editor`, `areas-editor` tests; the real showroom sidebar and both nav models are rendered/tested with and without the seller entitlement); `tsc` clean; ESLint 0 errors.
- Browser (QA data, Decore Store): add to cart, per-area delivery (Cairo default 80 / Nasr City 60 / Giza 120 / Alexandria not delivered), totals (products + delivery), quantity capped to stock, vanished product flagged, desktop + mobile layout. **The showroom pages (menu group, Areas, Delivery prices) need a showroom login and were covered by component and nav tests only, not opened in a browser.**

## Not done / deferred

- Checkout, orders, payment, stock reservation, sign-in/merge of the guest cart (DL-01).
- Delivery time estimates; bulk helpers in the price editor (one line per price today).
- The header cart badge counts every stored piece, including a line the showroom has since withdrawn.

## Related files

[`MARKETPLACE.md`](MARKETPLACE.md) (DL-01, DL-12, DL-16) · [`catalog-launch.md`](catalog-launch.md) · [`../database/marketplace-product-database.md`](../database/marketplace-product-database.md)
