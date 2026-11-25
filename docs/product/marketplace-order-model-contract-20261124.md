# Marketplace order model contract (PRs 12-15)

| | |
|---|---|
| **Status** | Contract for four parallel PRs. Documentation only. Nothing here is implemented, applied or hosted. |
| **Version** | 1.0.0 (2026-11-24) |
| **Owner** | Marketplace buyer-order phase |
| **Depends On** | `docs/product/marketplace-requirements-walkthrough-20261119.md` (owner decisions, Parts 1-4C), `docs/product/marketplace-implementation-plan-20261121.md`, `docs/product/marketplace-returns-policy-options-20261121.md` (see note below) |
| **Related** | `docs/marketplace/checkout-and-orders.md` (the old model), migrations `20261116100012`, `20261116100014`, `20261121090003`, `20261123090001`, `20261123120001`, `20261123130001`, `20261123150001`, PR 10 (#258), PR 11 (#257) |

**Note on sources.** The three product papers above were written in the owner's working tree and are not on `main` yet. Section 1 restates every decision that matters here and cites the walkthrough part, so this contract is self-contained. Whoever lands those papers should commit them unchanged.

## 0. How to use this contract

PR 12 (new checkout and order model), PR 13 (buyer and seller order pages), PR 14 (timers, notifications, payment complaints) and PR 15 (returns and exchanges) are built **in parallel** and merged **in order 12, 13, 14, 15**. Everything a PR needs from another PR is fixed here: table names, columns, enum values, function names, signatures, return shapes, error codes, migration versions, pgTAP numbers, routes. If the code needs something this document does not say, **stop and change this document first** (small docs PR), do not improvise.

Three rules that keep four agents from colliding:

1. **One owner per object.** Every table, function, template key, route and constant has exactly one owning PR (sections 2, 4, 9). A non-owner never `create`s or `create or replace`s it. Where a later PR must change something an earlier PR owns, this contract names the **hook** (a small function whose body the later PR replaces) so no big function is rebuilt twice.
2. **Expand, then contract.** Nothing existing is dropped in this phase (`scripts/migration-policy.mjs`; the promoted application still calls the old functions). New behaviour gets new signatures (`_v2`) or new columns with defaults. The drop list for release N+1 is in section 2.9.
3. **The database is the state machine.** One internal function, `app.marketplace_order_apply` (PR 12), implements every transition of section 3. Public RPCs from any PR are thin wrappers that authorize the caller and call it. The frontend never re-implements transition rules: it renders the `actions` list the database returns inside the order document (section 4.1).

## 1. Glossary and closed decisions

### 1.1 Glossary

| Term | Meaning |
|---|---|
| Buyer | A signed-in, active account placing an order. Not a member of the selling showroom (PR 11 rule). |
| Seller / showroom | An approved, enabled organization (`org_type` showroom/dealer) selling on the Marketplace. Its order managers are active members holding `order.manage` or `org.manage` (`app.marketplace_can_manage_orders`, migration 14). |
| Marketplace open | Platform switch `marketplace_platform_settings.marketplace_open` (`app.marketplace_is_open()`, migration `20261123130001`), changed only by `admin_marketplace_set_open`. |
| Checkout session | A server-side record of one checkout attempt: the repriced quote, the chosen address / delivery / payment, and the receipt(s) uploaded **before** the order exists. Table `marketplace_checkout_sessions` (PR 12). |
| Order | One row of `marketplace_orders` per seller per checkout (`checkout_id` groups them). The pilot has one seller, so one order per checkout. |
| PENDING stock | Units held for an order that has arrived at the seller. Technically `marketplace_inventory_levels.reserved` (movement `reserve`). Nobody else can order them. |
| Deducted | Units left stock for good (`deduct`: on-hand and reserved both drop). |
| Receipt | The photo of the InstaPay transfer the buyer uploads. Stored in `marketplace_payment_proofs`, bytes in the central media system (namespace `marketplace`). |
| Disputed receipt | The seller reviewed the receipt and pressed «لم تصلني الفلوس» (money did not arrive). Order stays in its status; `payment_status = receipt_disputed`. |
| Payment complaint | A formal complaint about a disputed receipt, reviewed by an admin holding a dedicated permission (PR 14). |
| Return window | 14 days from delivery in general, 30 days from delivery for a defect. The seller may offer more, never less (PR 15). |
| Preset | A row of `marketplace_seller_message_presets` (PR 5): admin-managed, Arabic + English label and text, one `action` key. The ONE preset system. |
| Hook | A small internal function that an earlier PR creates with a safe default body and a later PR replaces (same signature). |

### 1.2 What the owner already decided (do not re-ask)

Cited by walkthrough part. "4B" and "4C" are the two blocks inside Part 4.

**Order model and stock**
- The seller no longer confirms or rejects. After the buyer confirms, the order goes to the seller to PREPARE. The old confirm/reject step is removed. (4C, "NEW order model")
- Stock: when the order reaches the seller the units become PENDING (held, no last-unit race); stock is deducted when preparation is finished. (4C)
- Cancel by the buyer is allowed only **before the order is prepared/processed**. (4C buyer decisions)
- The seller who cannot prepare (e.g. out of stock) may CANCEL with a reason picked from preset options (or custom). (4C)
- Seller actions: «بدء التجهيز» → «جاهز للشحن/الاستلام» → «تم الشحن» → «تم التسليم». Tabs: جديد · قيد التجهيز · تم الشحن · تم التسليم · ملغي. Remove «تأكيد الطلب» and the «بانتظار التأكيد» tab. (4C, seller pages)
- Seller pages show product images, the delivery address for delivery orders, print waybill/invoice, receipt review with «لم تصلني الفلوس», search and date filter. A seller can never buy from his own showroom (DB rule + hidden button). (4C; 4B)
- Buyer «طلباتي»: Noon "Orders" layout (title, product search, period filter, empty state); progress bar placed → preparing → shipped → delivered; product images, expected delivery date, shipment tracking number, full timeline with timestamps, «إعادة الطلب», an invoice, saved address and phone; no stale "5 MB" text; correct signed-in header. (4C buyer decisions)
- In-platform messages tied to an order come LATER. No seller contact element (phone, WhatsApp, e-mail, «تواصل مع المعرض») exists on any page in this phase. (owner confirmation 2026-11-24; supersedes the «تواصل مع المعرض» wish in 4C)

**Checkout**
- Checkout page layout: choose between 1) «تسليم إلى» (with edit address) and 2) pickup from the branch; «ادفع باستخدام»: cash on delivery, InstaPay, InstaPay deposit («عربون»); for InstaPay and deposit the buyer must upload the transfer receipt BEFORE the order is confirmed; then «تأكيد الطلب». (4B)
- The old checkout page is rejected. Findings to fix: no self-purchase block, free-text address, phone only format-checked, receipt uploaded only AFTER the order exists, no full-InstaPay method, thank-you inline on the checkout page, header ignored sign-in state, cart only in localStorage. (4B audit)
- After confirmation: a thank-you page greeting the buyer by name with order number, progress, address, payment method, summary. Placing the order notifies the seller (in-app). (4B)
- Verified mobile and a saved location are required before checkout (PR 10). Pressing «صفحة الدفع» as a guest opens the sign-in modal, then returns to the same cart (PR 11). (4B)
- Sold-out items stay in the cart marked «لم يعد متاحاً» and block checkout until removed or adjusted. (4B cart)
- Pilot runs with ONE selling showroom; multi-seller delivery calculation is deferred. (4B cart; "Not in this plan")
- Delivery: calendar days, **no cut-off time** (estimate = today in Africa/Cairo + preparation days + the place's duration). The estimate rules are PR 9's `app.marketplace_delivery_terms`. (owner confirmation 2026-11-24, `20261123150001`)
- Buyer place in URL only; signed-in cart is last-writer-wins. (owner confirmation 2026-11-24)

**Payment problem flow and timers** (4C)
- While preparing, if the seller reviews the receipt and the money did not arrive, the seller sends the buyer a notification to check the transfer and optionally re-upload the receipt. This also reaches the admin side as a payment complaint **only when a complaint is filed**; handling it is a permission the owner grants to chosen admins.
- Seller does not start preparing: reminder every **6 hours**, automatic cancellation after **72 hours**, stock released.
- Buyer does not re-upload a disputed receipt: reminder at **24 hours**, automatic cancellation after **48 hours**.
- Notification matrix accepted: new order → seller; reminder for an order not started → seller; buyer cancels → seller; preparing/shipped/delivered → buyer; seller cancels (preset reason) → buyer; «لم تصلني الفلوس» → buyer; payment complaint → authorised admins; low or out of stock → seller. **In-app only.**

**Returns and exchanges** (Part 4 "Returns & exchanges", paper section 7)
- 14 days general / 30 days defects (seller may offer more, never less); per-product non-returnable flag («مصنوع حسب الطلب») with disclosure before payment; unused condition; buyer evidence (48 h for visible transit damage); return shipping by the seller for defect/wrong item and by the buyer for change of mind; refund or exchange; 7-day refund deadline.
- Refund through the SAME method the buyer paid with; the seller executes, the buyer confirms.
- Seller response window 72 h; on silence NO auto-approval: the case goes to the admin returns queue, and the admin reminds the seller or decides with them. Aladdin gives no guarantee: only the workflow and the dispute record.
- Launch gated on a lawyer's review of the Terms (not yet answered).

**Platform**
- Ordering stays hidden behind `NEXT_PUBLIC_MARKETPLACE_ORDERING === "true"` and the Marketplace open/close switch (section 10).
- One preset system: PR 5's `marketplace_seller_message_presets` managed under `notification_templates.manage`. No second preset table anywhere (owner 2026-11-23/24).
- Notification texts are admin-managed templates (PR 4), rendered in both languages at write time with PR 5's per-language `app.notify_from_template`.
- Storage is R2 only; the Marketplace fails explicitly instead of falling back to Supabase. Site-wide media policy (ADR-0030): image cap 10 MB, video cap 100 MB.
- Production follows Preview: nothing goes to Production before it is verified on Acceptance, and the owner approves each hosted step.

### 1.3 What the existing code already decides (cite, do not redefine)

| Fact | Where |
|---|---|
| Order and payment are two independent state columns, every order change is an append-only event | `marketplace_orders`, `marketplace_order_events` + trigger `marketplace_order_events_append_only` (migration `20261116100014`) |
| Stock moves only through `public.marketplace_stock_apply` (`reserve` / `release` / `deduct` / `replenish`), idempotent by key, rejects a replay with different arguments | `20261116100003_marketplace_inventory.sql` |
| The per-order stock wrapper uses keys `'order:' \|\| order_id \|\| ':' \|\| movement \|\| ':' \|\| variant_id` | `app.marketplace_order_stock` (migration 14). PR 12 keeps these exact keys, so a replay can never double-move stock |
| Clients get no table grant; every read/write is a SECURITY DEFINER RPC `set search_path = ''` that re-checks the caller | all Marketplace migrations |
| Error vocabulary is `raise exception 'mp:<code>' using errcode = ...`; the frontend maps `mp:` codes (`ORDER_ERROR_CODES` in `frontend/src/features/marketplace-orders/contract.ts`) | migration 14, `server/actions/marketplace-orders.ts` |
| Own-showroom rule: trigger `trg_marketplace_orders_own_showroom` (before insert on orders) raises `mp:own_showroom` | PR 11, `20261124110001` |
| Receipts: key `proofs/<id>/<proof>.<ext>` maps to the buyer's documents folder `u/<buyer>/certificates/<proof>/original.<ext>`; verified bytes required before `confirmed` (trigger `marketplace_proof_verified_before_confirmed`) | `app.marketplace_media_storage_key`, `app.marketplace_proof_require_verified_media` (migration 14) |
| Money columns exclude VAT; `total_egp = subtotal_egp + delivery_fee_egp` | `ck_mp_orders_money` |
| Payment settings: `cod_enabled`, `instapay_enabled` (= InstaPay DEPOSIT, with `instapay_deposit_percent`), `instapay_full_enabled` (PR 8), `instapay_address`, `instapay_account_name` | `marketplace_seller_payment_settings`, `20261123120001` |
| Delivery terms for a place: fee, duration, next-day, free-shipping minimum; row = area row else governorate row, fee required | `app.marketplace_delivery_terms(seller, gov, area)`, `app.marketplace_free_shipping`, `20261123150001` |
| Seller readiness (delivery and payment complete) | `app.marketplace_seller_commerce_missing`, `marketplace_seller_commerce_readiness` (PR 8) |
| Notification writers: `app.notify`, `app.notify_org`, `app.notify_from_template` (7-arg shared vars; 9-arg with `p_vars_ar`/`p_vars_en`, PR 5). Template key pattern `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`; event type list is the CHECK `ck_notifications_event_type_known` | `20260822090001`, `20261121090003`, `20261123090001` |
| Admin permissions: rows in `admin_permissions` + `admin_role_permissions`, checked by `app.has_admin_permission(key)` / `app.marketplace_assert_admin_permission(key)` | `20260929100001`, `20261116100009` |
| Frontend flag helper `isMarketplaceOrderingEnabled()` reads only `NEXT_PUBLIC_MARKETPLACE_ORDERING` | `frontend/src/lib/env/index.ts` |

## 2. Entity model

All new tables: RLS enabled, `revoke all ... from public, anon, authenticated, service_role`, **no policy, no client grant** (the existing orders pattern), written and read only through SECURITY DEFINER RPCs. Every table that is audit-like is append-only by trigger, actor ids carry **no foreign key** (audit outlives accounts). pgTAP covers every function and an isolation test per table (buyer A cannot read buyer B, seller A cannot read seller B, admin without the permission is refused).

### 2.1 Summary: reused, altered, new

| Table | Verdict | Owner |
|---|---|---|
| `marketplace_orders` | **altered** (columns, constraints widened, nothing dropped) | PR 12 |
| `marketplace_order_items` | **altered** (snapshot columns) | PR 12 |
| `marketplace_order_events` | **altered** (`actor_role` adds `admin`, new `payload`) | PR 12 |
| `marketplace_payment_proofs` | **altered** (bound to a checkout session before the order exists) | PR 12 |
| `marketplace_checkout_sessions` | **new** | PR 12 |
| `marketplace_order_cancellations` | **new** | PR 12 |
| `marketplace_order_shipments` | **new** | PR 12 |
| `marketplace_timers` | **new** (generic, orders and returns) | PR 12 (runner: PR 14) |
| `marketplace_seller_message_presets` | **reused**; new `action` values | PR 12 (one CHECK change for all PRs) |
| `marketplace_products` | **altered** (`non_returnable boolean`) | PR 12 (setter RPC and form field: PR 15) |
| `marketplace_order_invoices` | **new** | PR 13 |
| `marketplace_payment_complaints`, `marketplace_payment_complaint_events` | **new** | PR 14 |
| `marketplace_return_requests`, `_items`, `_events`, `_evidence`, `marketplace_order_refunds`, `marketplace_seller_return_settings` | **new** | PR 15 |
| `marketplace_seller_payment_settings`, `marketplace_seller_delivery_settings`, `marketplace_delivery_rates`, `marketplace_free_shipping_products` | reused unchanged (PR 8) | - |
| `marketplace_buyer_addresses` | reused unchanged (PR 10) | - |
| `marketplace_cart_items` | reused unchanged (PR 11) | - |

### 2.2 `marketplace_orders` (altered, PR 12)

Existing columns stay exactly as in migration 14 (`id`, `order_number`, `checkout_id`, `idempotency_key`, `buyer_user_id`, `seller_organization_id`, `status`, `payment_method`, `payment_status`, `fulfilment`, `governorate_key`, `area_key`, `address_text`, `buyer_name`, `buyer_phone`, `buyer_note`, `subtotal_egp`, `delivery_fee_egp`, `total_egp`, `deposit_percent`, `deposit_egp`, `instapay_address`, `instapay_account_name`, `cancel_reason`, `created_at`, `updated_at`, `confirmed_at`, `delivered_at`, `cancelled_at`). Meaning in v2: `buyer_name` / `buyer_phone` are the **recipient** snapshot (E.164 phone); `confirmed_at` is **not used** by v2 (legacy only); `idempotency_key` carries the checkout confirm key; `cancel_reason` keeps a short text copy of the cancellation (the structured record is `marketplace_order_cancellations`).

**New columns** (all nullable or defaulted, so the promoted application keeps working):

| Column | Type | Notes |
|---|---|---|
| `checkout_session_id` | `uuid` | the session that produced the order; `unique` where not null |
| `address_id` | `uuid references marketplace_buyer_addresses(id) on delete set null` | reference only; the snapshot below is authoritative |
| `address_snapshot` | `jsonb` | `{kind, nickname, district, street, building, floor, apartment, landmark, latitude, longitude, location_source}`; null for pickup |
| `latitude`, `longitude` | `numeric(9,6)` | copied from the address; null if none |
| `delivery_speed` | `text not null default 'standard'` | `standard` or `next_day` (CHECK) |
| `delivery_estimate_earliest`, `delivery_estimate_latest` | `date` | frozen at placement from `app.marketplace_delivery_terms` (calendar days, Africa/Cairo, no cut-off); `next_day` sets both to placed date + 1 |
| `placed_at` | `timestamptz not null default now()` | the arrival time that all timers count from (equals `created_at` for v2 rows) |
| `preparing_at`, `ready_at`, `shipped_at` | `timestamptz` | stamped by the state machine |
| `paid_now_egp` | `numeric(14,2)` | what the buyer had to transfer before confirm (0 for COD) |
| `balance_due_egp` | `numeric(14,2)` | `total_egp - paid_now_egp` (collected at delivery) |
| `stock_state` | `text not null default 'none'` | `none` / `pending` / `deducted` / `released` / `restocked`; the single truth about stock, checked by pgTAP against `marketplace_stock_movements` |
| `source` | `text not null default 'legacy'` | **default is `legacy`** so existing rows and the still-promoted app are untouched; checkout v2 writes `'v2'` explicitly (PR 12 implementation note) |

**Status values** (CHECK widened, legacy kept): `new`, `preparing`, `ready`, `shipped`, `delivered`, `cancelled`, plus the existing `delivery_failed`, `returned`, and the legacy-only `pending_confirmation`, `confirmed`, `processing`, `ready_for_pickup` (never produced by v2).

**Payment method values**: `cod`, `instapay_full`, `instapay_deposit`, plus legacy `instapay`. `ck_mp_orders_payment_method`, `ck_mp_orders_payment_status` and `ck_mp_orders_deposit` are **replaced** (constraints are not data): for `instapay_full` `deposit_percent`/`deposit_egp` are null and `paid_now_egp = total_egp`; for `instapay_deposit` they are set and `paid_now_egp = deposit_egp`; for `cod` they are null and `paid_now_egp = 0`. `instapay_address` / `instapay_account_name` are snapshotted for both InstaPay methods.

**Payment status values** (CHECK widened, legacy kept):

| Method | Values (v2) |
|---|---|
| `cod` | `pending`, `collected`, `not_collected` |
| `instapay_full`, `instapay_deposit` | `receipt_submitted` (receipt on file, not yet looked at), `receipt_accepted` (seller confirmed the money arrived), `receipt_disputed` (seller pressed «لم تصلني الفلوس»), `collected` (full amount settled, or balance collected at delivery), `not_collected`, `refund_due`, `refunded` (written by PR 15) |
| legacy | `awaiting_deposit`, `deposit_submitted`, `deposit_accepted`, `deposit_rejected` stay allowed but v2 never writes them |

**Invariants checked by constraint or trigger**: v2 InstaPay orders are created already holding at least one confirmed receipt (`source = 'v2'` and method InstaPay implies a `marketplace_payment_proofs` row with `order_id = id`, enforced in the confirm RPC and pgTAP, not by a deferred trigger); `stock_state = 'pending'` iff status in (`new`, `preparing`); `deducted` iff status in (`ready`, `shipped`, `delivered`, `delivery_failed`); `cancelled` orders are `released` or `restocked`.

**Indexes added**: `(seller_organization_id, status, placed_at desc)`, `(buyer_user_id, placed_at desc)`, `(checkout_session_id) where not null`, a trigram index on `order_number` for the search box (PR 13 may add its own search indexes in its block).

**Backfill** (PR 12, mechanical, listed in its migration header): `pending_confirmation` → `new`, `confirmed` and `processing` → `preparing`, `ready_for_pickup` → `ready`; payment `instapay` → `instapay_full` when `deposit_percent = 100` else `instapay_deposit`; `deposit_submitted/accepted/rejected` → `receipt_submitted/accepted/disputed`; `source = 'legacy'` for every existing row; `placed_at = created_at`; `stock_state` derived from the old status. Ordering is hidden on Acceptance and Production, so these tables hold test data at most. If a hosted database turns out to hold real orders, **stop and ask the owner** before applying.

### 2.3 `marketplace_order_items` (altered, PR 12) - the price snapshot

Existing: `id`, `order_id`, `product_id`, `variant_id`, `location_id`, `sku`, `name_ar`, `name_en`, `selling_unit`, `unit_price_egp`, `quantity`, generated `line_total_egp`, `created_at`, unique `(order_id, variant_id)`.

New columns, all captured **at confirm time and never updated afterwards**:

| Column | Type | Notes |
|---|---|---|
| `product_slug` | `text` | for «إعادة الطلب» and the product link |
| `variant_label` | `jsonb` | `{ar, en}` readable option summary (colour, size) from the variant attributes |
| `image_id` | `uuid` | cover image id at order time (nullable; the page falls back when the image is later removed) |
| `non_returnable` | `boolean not null default false` | copy of `marketplace_products.non_returnable`; the disclosure shown before payment |
| `free_shipping` | `boolean not null default false` | whether the product flag applied |
| `quantity_returned` | `integer not null default 0` | maintained by PR 15 (never above `quantity`) |

### 2.4 `marketplace_order_events` (altered, PR 12) - status history

Existing columns stay. `ck_mp_order_events_role` is widened to `buyer`, `seller`, `system`, `admin`. New column `payload jsonb` (small, keys depend on `action`, never personal data beyond ids). The event `action` vocabulary is closed in section 3.4. Every transition writes exactly one event row in the same transaction; the timeline shown to buyer and seller is this table (internal-only actions are filtered by `app.marketplace_order_document_v2`).

### 2.5 Payments and receipts

There is no separate payment ledger: the payment lives on `marketplace_orders` (`payment_method`, `payment_status`, `paid_now_egp`, `balance_due_egp`) and its history is the events table. Receipts are rows of `marketplace_payment_proofs` (**altered, PR 12**):

| Change | Detail |
|---|---|
| `order_id` becomes **nullable** | a receipt exists before the order |
| `checkout_session_id uuid references marketplace_checkout_sessions(id) on delete cascade` | new |
| CHECK `ck_mp_proofs_owner` | `order_id is not null or checkout_session_id is not null` |
| `status` adds `superseded` | an old receipt replaced by a re-upload |
| `purpose text not null default 'initial'` | `initial` (before confirm) or `resubmission` (after a dispute) |
| `declared_amount_egp numeric(14,2)` | optional, what the buyer says he transferred (display only) |

Key format stays `proofs/<uuid>/<proof_id>.<ext>`; the first uuid is the **checkout session id** for an initial receipt and the **order id** for a resubmission (the existing `app.marketplace_media_storage_key` regex accepts any uuid there). At confirm the proof rows get `order_id` set; the key does not change. Allowed MIME stays `image/jpeg`, `image/png`, `image/webp`, cap 10 MB (ADR-0030), at most **3 confirmed receipts per session** and 10 upload tickets per hour per session/order.

### 2.6 `marketplace_checkout_sessions` (new, PR 12)

| Column | Type | Constraint / note |
|---|---|---|
| `id` | `uuid primary key default gen_random_uuid()` | |
| `buyer_user_id` | `uuid not null references users(id) on delete cascade` | |
| `state` | `text not null default 'open'` | `open`, `confirmed`, `expired`, `abandoned` |
| `seller_organization_id` | `uuid not null` | pilot: exactly one |
| `lines` | `jsonb not null` | `[{slug, sku, qty}]` as sent, at most 50 |
| `fulfilment` | `text not null` | `delivery` / `pickup` |
| `address_id` | `uuid` | required when `delivery` |
| `delivery_speed` | `text not null default 'standard'` | |
| `payment_method` | `text not null` | `cod` / `instapay_full` / `instapay_deposit` |
| `quote` | `jsonb not null` | the last repriced quote (section 4.2 shape) |
| `quote_hash` | `text not null` | sha256 of the canonical quote; the confirm call must present it |
| `idempotency_key` | `text` | set at confirm, unique per `(buyer_user_id, idempotency_key)` |
| `confirmed_checkout_id` | `uuid` | the `checkout_id` of the orders it created |
| `created_at`, `updated_at`, `expires_at` | `timestamptz` | `expires_at` = created + 2 hours, extended by each `prepare` call up to 24 hours total |

Unique partial index: one `open` session per `(buyer_user_id, seller_organization_id)` is **not** enforced (a buyer may restart); old open sessions are marked `abandoned` by the next `prepare`. A session holds **no stock**: stock becomes PENDING only when the order is created at confirm.

### 2.7 `marketplace_order_cancellations` (new, PR 12)

| Column | Type | Note |
|---|---|---|
| `id` | `uuid pk` | |
| `order_id` | `uuid not null unique references marketplace_orders(id) on delete cascade` | one cancellation per order |
| `cancelled_by_role` | `text not null` | `buyer`, `seller`, `system`, `admin` |
| `cancelled_by_user_id` | `uuid` | no FK; null for `system` |
| `reason_code` | `text not null` | `preset`, `custom`, `timeout_seller_start`, `timeout_receipt_resubmit`, `legacy` |
| `preset_id` | `uuid references marketplace_seller_message_presets(id) on delete set null` | |
| `label_ar`, `label_en` | `text` | snapshot of the preset label |
| `message_ar`, `message_en` | `text` | snapshot of what the other party reads; preset text, or the custom text (both languages, or one text copied to both when the writer typed one language only; same rule as PR 5) |
| `internal_note` | `text` | seller/admin only, never shown to the buyer, at most 300 chars |
| `stock_effect` | `text not null` | `released` or `restocked` |
| `created_at` | `timestamptz not null default now()` | |

Presets come from `marketplace_seller_message_presets` with action `order_cancel_seller` (seller cancels; text is what the buyer reads) or `order_cancel_buyer` (buyer cancels; optional; text is what the seller reads). A custom reason is allowed («أخرى»): Arabic and English texts, 3 to 300 characters each.

### 2.8 `marketplace_order_shipments` (new, PR 12)

| Column | Type | Note |
|---|---|---|
| `id` | `uuid pk` | |
| `order_id` | `uuid not null unique references marketplace_orders(id) on delete cascade` | one shipment per order (no partial shipments in this phase) |
| `carrier_name` | `text` | 2-80 chars, free text; null allowed (own delivery) |
| `tracking_number` | `text` | 3-64 chars `^[A-Za-z0-9._/-]+$` |
| `shipped_by` | `uuid` | no FK |
| `shipped_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | PR 13's correction RPC updates carrier/tracking only |

Pickup orders have no shipment row.

### 2.9 Other tables in brief

**`marketplace_timers` (new, PR 12; runner PR 14)** - one generic table so orders and returns share one runner.

| Column | Type | Note |
|---|---|---|
| `id` | `uuid pk` | |
| `subject_type` | `text not null` | `order` or `return` |
| `subject_id` | `uuid not null` | no FK (polymorphic) |
| `kind` | `text not null` | `order_seller_start`, `order_receipt_resubmit`, `return_seller_response`, `return_refund_due` (CHECK lists all four now) |
| `state` | `text not null default 'active'` | `active`, `done`, `cancelled`, `expired` |
| `started_at` | `timestamptz not null` | |
| `expires_at` | `timestamptz not null` | the deadline (72 h / 48 h / 72 h / 7 d) |
| `remind_every` | `interval` | 6 h for `order_seller_start`; null otherwise |
| `remind_offsets` | `interval[]` | fixed reminder offsets from `started_at`, e.g. `{24h}` for the receipt timer, `{24h,48h}` for return response |
| `next_remind_at` | `timestamptz` | null when no reminder is left |
| `reminders_sent` | `integer not null default 0` | |
| `closed_at`, `closed_by_action` | `timestamptz`, `text` | |

Unique partial index `(subject_type, subject_id, kind) where state = 'active'` (at most one live timer per subject and kind). Indexes for the runner: `(expires_at) where state = 'active'`, `(next_remind_at) where state = 'active' and next_remind_at is not null`.

**`marketplace_products.non_returnable`** (altered, PR 12): `boolean not null default false`. PR 12 owns the column, the public read key `non_returnable`, the snapshot in `order_items`, and the disclosure line at checkout; PR 15 owns the seller setter RPC and the product-form control (until then it is always false).

**`marketplace_order_invoices` (new, PR 13)**: `id`, `order_id unique`, `invoice_number text unique default 'INV-' || lpad(nextval('marketplace_invoice_number_seq'),6,'0')`, `issued_at`, `seller_snapshot jsonb` (name, address, commercial registration/tax id if the organization has them), `buyer_snapshot jsonb` (recipient name, address text; never the phone), `lines jsonb`, `subtotal_egp`, `delivery_fee_egp`, `total_egp`, `payment_method`, `note text`. Issued lazily and idempotently by the first `marketplace_order_invoice_get` call once the order has status `ready` or later; never changes afterwards. It is an **order invoice**, not a tax invoice (see open question 9).

**`marketplace_payment_complaints` (+ `_events`, PR 14)** and **returns tables (PR 15)**: columns are specified in sections 4.5 and 4.6 next to the RPCs that use them.

**Release N+1 drop list** (not in this phase, recorded so nobody drops early): legacy functions `marketplace_checkout_place`, `marketplace_seller_order_transition`, `marketplace_seller_proof_review`, `marketplace_buyer_proof_request_upload`, `marketplace_buyer_proof_confirm`, `marketplace_buyer_order_cancel`, `marketplace_buyer_orders`, `marketplace_buyer_order_get`, `marketplace_seller_orders_page`, `marketplace_seller_order_get`, `app.marketplace_order_document`; legacy status and payment values in the CHECKs; columns `confirmed_at`.

## 3. Order state machine

### 3.1 Statuses

```
            buyer confirms (checkout)
                     |
                     v
   +------------>   new    --(seller: start_preparing)-->  preparing --(seller: mark_ready)--> ready
   |   (stock PENDING; seller notified; timers start)       (stock PENDING)             (stock DEDUCTED)
   |                  |                                         |                              |
   |                  |                                         |             delivery: --(seller: mark_shipped)--> shipped --(seller: mark_delivered)--> delivered
   |                  |                                         |             pickup:   --(seller: mark_delivered)-------------------------------------> delivered
   |                  v                                         v                              v
   +---------------  cancelled  <-------- buyer (new only), seller (new|preparing|ready), system timeout, admin ------+
                                                                                    shipped --(seller: mark_delivery_failed)--> delivery_failed --(seller: mark_returned_to_stock)--> returned
```

`delivered`, `cancelled` and `returned` are terminal for the order itself. Returns and exchanges (PR 15) are separate records that point at a delivered order; they never move the order out of `delivered`.

The buyer progress bar maps: `new` = placed, `preparing` and `ready` = preparing, `shipped` = shipped, `delivered` = delivered (pickup orders show "ready for pickup" under `ready`). Seller tabs map: جديد = `new`, قيد التجهيز = `preparing` + `ready`, تم الشحن = `shipped`, تم التسليم = `delivered`, ملغي = `cancelled` (delivery_failed/returned appear under تم الشحن with a badge until PR 13 decides otherwise; they are rare).

### 3.2 Transitions

`apply(order, action, actor)` is the only way a status or payment status changes. "Actor" is who may trigger it. Every row also needs the caller checks of the wrapper (buyer owns the order; seller `app.marketplace_can_manage_orders`; admin permission; system = service role runner).

| # | Action | From (status / payment condition) | To | Actor | Stock effect | Other effects |
|---|---|---|---|---|---|---|
| 1 | `place` | (checkout confirm) | `new`, payment `cod`: `pending`; InstaPay: `receipt_submitted` | buyer | `reserve` every line (PENDING) | event `placed`; receipts bound to the order; timer `order_seller_start` opened (72 h, remind 6 h); notify seller |
| 2 | `start_preparing` | `new` | `preparing` | seller | none | `preparing_at`; close timer `order_seller_start`; notify buyer |
| 3 | `mark_ready` | `preparing`, and not `receipt_disputed` | `ready` | seller | **`deduct`** every line | `ready_at`; stock_state `deducted`; notify buyer only if pickup («جاهز للاستلام») |
| 4 | `mark_shipped` | `ready`, delivery orders, and not `receipt_disputed` | `shipped` | seller | none | shipment row (carrier, tracking optional); `shipped_at`; notify buyer |
| 5 | `mark_delivered` | `shipped` (delivery) or `ready` (pickup); not `receipt_disputed` | `delivered` | seller | none | `delivered_at`; payment: COD `pending` stays until `collect_payment`; notify buyer; return window starts (PR 15 reads `delivered_at`) |
| 6 | `collect_payment` | `delivered`; COD `pending`, or InstaPay deposit with a balance (`receipt_accepted` and `balance_due_egp > 0`) | same status; payment `collected` | seller | none | event; settles `balance_due_egp` |
| 7 | `accept_receipt` | `new`, `preparing`, `ready`; payment `receipt_submitted` or `receipt_disputed` | same status; payment `receipt_accepted`, or `collected` when `instapay_full` | seller (or admin via complaint decision, PR 14) | none | marks the latest receipt `accepted`; if a dispute timer was active it is closed |
| 8 | `flag_receipt_not_received` («لم تصلني الفلوس») | `preparing` or `ready`; payment `receipt_submitted` (once accepted the money is confirmed and cannot be flagged) | same status; payment `receipt_disputed` | seller | none | note required (preset action `payment_issue` or custom); timer `order_receipt_resubmit` opened (48 h, reminder at 24 h); notify buyer |
| 9 | `resubmit_receipt` | `preparing`, `ready`; payment `receipt_disputed` | same status; payment `receipt_submitted` | buyer | none | the previous receipt becomes `superseded`; close timer `order_receipt_resubmit`; notify seller |
| 10 | `cancel_by_buyer` | `new` only | `cancelled` | buyer | `release` (PENDING back) | cancellation row; close timers; notify seller |
| 11 | `cancel_by_seller` | `new`, `preparing`, `ready` | `cancelled` | seller | `release` if `stock_state = pending`, `replenish` if `deducted` | reason mandatory (preset or custom); payment: COD `not_collected`; InstaPay `refund_due` when the receipt was accepted (money received) else `not_collected`; notify buyer |
| 12 | `cancel_timeout_seller` | `new`, timer `order_seller_start` expired (72 h) | `cancelled` | system | `release` | cancellation reason `timeout_seller_start`; payment as row 11; notify buyer and seller |
| 13 | `cancel_timeout_receipt` | `preparing`/`ready`, payment `receipt_disputed`, timer `order_receipt_resubmit` expired (48 h) | `cancelled` | system | `release` or `replenish` by `stock_state` | cancellation reason `timeout_receipt_resubmit`; payment `not_collected`; notify buyer and seller |
| 14 | `mark_delivery_failed` | `shipped` or (`ready` with pickup) | `delivery_failed` | seller | none | COD unpaid → `not_collected` |
| 15 | `mark_returned_to_stock` | `delivery_failed` | `returned` | seller | `replenish` | |
| 16 | `resolve_complaint_*` | see PR 14 | none by itself | admin | none | rows 7 and 11 are reused with `actor_role = 'admin'` |

Rules that apply to every row:

- **Locking and order.** `select ... from marketplace_orders where id = ... for update`, then stock moves in `order by variant_id, location_id`. Two concurrent actions on one order serialize on the row lock; the loser sees the new status and raises `mp:invalid_transition`.
- **Idempotency of the machine.** A repeated action that already took effect is a **no-op that returns the current document** (`replayed: true` inside the document), never an error and never a second stock move or a second notification: `start_preparing` on a `preparing` order, `cancel_*` on a `cancelled` order with the same reason class, `mark_delivered` on a `delivered` order. A different action that does not fit the current status raises `mp:invalid_transition`. Stock moves additionally carry the idempotency keys of section 1.3 (`order:<id>:<movement>:<variant>`), so even a lost-update bug cannot move stock twice.
- **Reasons.** `cancel_by_seller` and `flag_receipt_not_received` need a reason: a preset id of the right action, or custom Arabic and English text of 3-300 characters (`mp:reason_required`, `mp:preset_invalid`). The buyer's cancel reason is optional.
- **Self-purchase** is blocked at insert by the PR 11 trigger; `place` needs nothing more.
- **Marketplace closed / seller suspended.** Neither blocks transitions of orders that already exist, and timers keep running (decision of this contract, see open question 6). Closing only blocks new checkouts (`mp:marketplace_closed`).
- **A disputed receipt freezes progress**: rows 3, 4, 5 refuse while payment is `receipt_disputed` (`mp:payment_dispute_open`). Cancel stays possible.
- **Legacy rows** (`source = 'legacy'`) are not touched by `apply`; the v2 wrappers refuse them with `mp:legacy_order` and the old RPCs still own them until release N+1.

### 3.3 Who sees which actions

`app.marketplace_order_actions(order, viewer)` returns the list of action keys the viewer may press **now**, evaluated with the exact predicates of section 3.2. It is embedded in the order document (`actions`). The frontend renders buttons from it and nothing else.

| Viewer | Status → actions |
|---|---|
| buyer | `new`: `cancel`; any status with `receipt_disputed`: `resubmit_receipt`, `file_complaint` (PR 14); `delivered`: `request_return`, `request_exchange` (PR 15, inside the window) |
| seller | `new`: `start_preparing`, `cancel`; `preparing`: `mark_ready`, `cancel`, `accept_receipt`, `flag_receipt_not_received`; `ready` delivery: `mark_shipped`, `cancel`; `ready` pickup: `mark_delivered`, `cancel`; `shipped`: `mark_delivered`, `mark_delivery_failed`; `delivered`: `collect_payment` when owed; `delivery_failed`: `mark_returned_to_stock` |
| admin (PR 14/15) | on a complaint or return in the admin queue only |

### 3.4 Event vocabulary (closed)

`placed`, `preparing`, `ready`, `shipped`, `delivered`, `payment_collected`, `receipt_accepted`, `receipt_disputed`, `receipt_resubmitted`, `cancelled_by_buyer`, `cancelled_by_seller`, `cancelled_timeout_seller`, `cancelled_timeout_receipt`, `delivery_failed`, `returned_to_stock`, `reminder_seller_start` (internal), `reminder_receipt_resubmit` (internal), `complaint_filed`, `complaint_resolved`, `shipment_updated`, `invoice_issued` (internal), `return_requested`, `return_closed`. Internal events are stored but hidden from the buyer timeline. The same strings are the `action` column values.

## 4. RPC contract

Naming: public functions are `public.marketplace_<area>_<verb>[_v2]`; internals are `app.marketplace_<...>`. **Each name below appears once, with exactly one owner.** All public functions are `security definer set search_path = ''`, `revoke all ... from public, anon, authenticated, service_role`, then `grant execute ... to authenticated` (admin functions the same; the service-role-only runner functions say so). Errors are `mp:<code>` (codes in 4.7). Money is `numeric` rendered as JSON numbers in EGP, dates `YYYY-MM-DD`, timestamps ISO-8601 UTC.

### 4.1 Shared shapes (PR 12 owns the code; later PRs fill reserved keys by rebuilding on the previous version)

**`app.marketplace_order_document_v2(p_order uuid, p_for text)`** (`p_for` = `buyer`, `seller`, `admin`) returns:

```
{
  id, order_number, checkout_id, status, payment_method, payment_status, fulfilment, delivery_speed,
  viewer,                                   // 'buyer' | 'seller' | 'admin'
  source,                                   // 'v2' | 'legacy'
  seller: { name },                         // no organization id, no phone, no e-mail
  recipient: { name, phone },               // phone: buyer and seller only (the delivery needs it)
  place: { governorate_key, area_key, address_text, latitude, longitude, address_snapshot },
  pickup: { address, instructions } | null,
  totals: { subtotal_egp, delivery_fee_egp, total_egp, paid_now_egp, balance_due_egp,
            deposit_percent, deposit_egp },
  payment: {
    method, status,
    instapay: { address, account_name } | null,
    receipts: [ { id, object_key, status, purpose, declared_amount_egp, review_note, created_at } ],
    dispute: { flagged_at, resubmit_due_at, message_ar, message_en, complaint_id } | null   // complaint_id null until PR 14
  },
  delivery: {
    estimate: { earliest, latest } | null,
    shipment: { carrier_name, tracking_number, shipped_at } | null
  },
  timestamps: { placed_at, preparing_at, ready_at, shipped_at, delivered_at, cancelled_at },
  cancellation: { by, label_ar, label_en, message_ar, message_en, internal_note } | null,   // internal_note: seller/admin only
  timers: { seller_start_due_at, receipt_resubmit_due_at },        // viewer-scoped, null when no active timer
  items: [ { id, slug, sku, name_ar, name_en, variant_label, selling_unit, unit_price_egp, quantity,
             line_total_egp, image_id, non_returnable, free_shipping, quantity_returned } ],
  events: [ { id, action, to_status, to_payment, actor_role, note, at } ],     // internal events filtered for buyers
  actions: [ 'cancel', ... ],               // section 3.3
  invoice: { number, issued_at } | null,    // PR 13 fills; null before
  return_window: { general_ends_at, defect_ends_at, returnable } | null,   // PR 15 fills; null before
  returns: [ { id, request_number, status, kind } ]                        // PR 15 fills; [] before
}
```

Keys never removed or renamed by later PRs; later PRs only start filling `invoice`, `return_window`, `returns` and `payment.dispute.complaint_id`.

**Order summary** (list rows): `{ id, order_number, status, payment_method, payment_status, fulfilment, total_egp, placed_at, delivered_at, estimate:{earliest,latest}|null, item_count, first_items:[{name_ar,name_en,image_id,quantity}] (at most 4), seller_name, buyer_name (seller view only), governorate_key (seller view only), has_dispute: boolean, action_needed: boolean }`.

**Quote** (checkout, section 4.2):

```
{
  lines: [ { slug, sku, name_ar, name_en, variant_label, selling_unit, unit_price_egp, quantity, line_total_egp,
             image_id, available, status: 'ok' | 'unavailable' | 'insufficient_stock', non_returnable, free_shipping } ],
  seller: { name, pickup_available },
  fulfilment, delivery_speed,
  delivery: { status: 'available' | 'not_available' | 'pickup', fee_egp, free: boolean,
              estimate: { earliest, latest } | null, next_day: { fee_egp, arrival } | null },
  subtotal_egp, delivery_fee_egp, total_egp,
  payment: { method, methods_enabled: { cod, instapay_full, instapay_deposit: { deposit_percent } | null },
             pay_now_egp, balance_due_egp, instapay: { address, account_name } | null },
  receipt_required: boolean,
  non_returnable_lines: [ sku ],            // must be shown before payment
  warnings: [ 'price_changed', ... ]
}
```

### 4.2 PR 12 - checkout and the order core (owner: PR 12)

| # | Function | Signature | Returns |
|---|---|---|---|
| 1 | `public.marketplace_checkout_prepare` | `(p_lines jsonb, p_fulfilment text, p_address_id uuid, p_delivery_speed text, p_payment_method text, p_session_id uuid)` | `{ session_id, expires_at, quote, quote_hash, ready: boolean, missing: [codes] }` |
| 2 | `public.marketplace_checkout_receipt_request_upload` | `(p_session_id uuid, p_content_type text)` | `{ proof_id, object_key }` |
| 3 | `public.marketplace_checkout_receipt_confirm` | `(p_proof_id uuid)` | `{ session_id, receipts: [ { id, status, created_at } ], receipt_ok: boolean }` |
| 4 | `public.marketplace_checkout_receipt_remove` | `(p_proof_id uuid)` | `{ session_id, receipts: [...] }` (buyer removes an attached receipt before confirm; marks it for the central cleanup) |
| 5 | `public.marketplace_checkout_confirm` | `(p_session_id uuid, p_quote_hash text, p_idempotency_key text, p_buyer_note text)` | `{ checkout_id, replayed: boolean, orders: [ { id, order_number, status, total_egp, paid_now_egp, payment_method, estimate: { earliest, latest } } ] }` |
| 6 | `public.marketplace_buyer_order_cancel_v2` | `(p_order_id uuid, p_preset_id uuid, p_note text)` | order document (buyer) |
| 7 | `public.marketplace_buyer_receipt_resubmit_request_upload` | `(p_order_id uuid, p_content_type text)` | `{ proof_id, object_key }` |
| 8 | `public.marketplace_buyer_receipt_resubmit_confirm` | `(p_proof_id uuid)` | order document (buyer); runs transition 9 |
| 9 | `public.marketplace_seller_order_action` | `(p_order_id uuid, p_action text, p_payload jsonb)` | order document (seller) |
| 10 | `public.marketplace_order_reason_presets` | `(p_action text)` | `[ { id, label_ar, label_en, text_ar, text_en } ]` active presets for one of `order_cancel_seller`, `order_cancel_buyer`, `payment_issue`; any signed-in caller (the text is the shared message) |
| 11 | `public.marketplace_seller_proof_review_v2` | **not created.** Receipt review is `marketplace_seller_order_action` with `accept_receipt` / `flag_receipt_not_received`. The legacy `marketplace_seller_proof_review` stays for legacy rows. | - |
| 12 | `app.marketplace_order_apply` | `(p_order uuid, p_action text, p_actor_role text, p_actor uuid, p_payload jsonb)` returns `jsonb` (the document for `p_actor_role`) | internal; the whole machine of section 3.2 |
| 13 | `app.marketplace_order_document_v2` | `(p_order uuid, p_for text)` | section 4.1 |
| 14 | `app.marketplace_order_actions` | `(p_order uuid, p_for text)` returns `text[]` | section 3.3 |
| 15 | `app.marketplace_order_notify` | `(p_order uuid, p_event text, p_vars jsonb)` returns `void` | PR 12 implements the events it emits (section 6); calls PR 5's 9-arg `app.notify_from_template` |
| 16 | `app.marketplace_notify_order_managers` | `(p_order uuid, p_template_key text, p_vars jsonb, p_vars_ar jsonb, p_vars_en jsonb)` | fan-out to active members holding `order.manage` or `org.manage` of the seller (same predicate as `app.marketplace_can_manage_orders`) |
| 17 | `app.marketplace_timer_open` / `_close` | `(p_subject_type text, p_subject_id uuid, p_kind text, p_started timestamptz)` / `(p_subject_type text, p_subject_id uuid, p_kind text, p_action text)` | idempotent: open on an existing active timer returns it; close on none is a no-op |
| 18 | `app.marketplace_checkout_quote` | `(p_buyer uuid, p_lines jsonb, p_fulfilment text, p_address_id uuid, p_delivery_speed text, p_payment_method text)` returns `jsonb` | the single repricing function, called by `prepare` and again inside `confirm` |
| 19 | `public.marketplace_checkout_sessions_purge` | `(p_retention interval default '7 days', p_limit integer default 200)` returns `integer` | **service role only**; expires old sessions and retires their unattached receipts into the media cleanup lifecycle |
| 20 | `app.marketplace_complaint_admin_can_read(p_order uuid)`, `app.marketplace_return_evidence_can_read(p_key text)`, `app.marketplace_return_evidence_metadata(p_key text)`, `app.marketplace_order_stock_alert(p_order uuid)` | hooks, default body `false` / `false` / `null` / no-op | PR 14 and PR 15 replace these bodies (section 4.6): complaint read and stock alert = PR 14, evidence hooks = PR 15 |

**Checkout behaviour (fixed here):**

- `prepare` is **idempotent** and re-quotes: same `p_session_id` updates the open session; null creates one. It never reserves stock. It checks, in order: signed in and `app.account_is_active` (`mp:auth_required`, `mp:account_inactive`); `app.marketplace_is_open()` (`mp:marketplace_closed`); every line resolves to a live variant (published, `app.marketplace_seller_is_public`, active) else `mp:cart_changed`; **one seller only** (`mp:multi_seller_unsupported`; the pilot rule; lifting it later is code only because orders are already per seller); **own showroom** via `app.marketplace_user_belongs_to_seller` (`mp:own_showroom`, same code as the PR 11 trigger); the seller's delivery and payment configuration is complete (`app.marketplace_seller_commerce_missing`, else `mp:seller_not_ready`); quantities 1..9999, no duplicate variant, availability (`mp:insufficient_stock:<sku>` is reported as a line status in the quote, not raised, so the page can show it; `confirm` raises it).
- **Server-side repricing.** The browser sends only `{slug, sku, qty}`. Prices come from `marketplace_product_variants.price_egp`. Delivery uses `app.marketplace_delivery_terms(seller, gov, area)` of the saved address (PR 10 keys): fee, duration, next-day. Free delivery for a cart: fee is 0 when the place's fee is 0, **or** the subtotal reaches the place's (else the showroom-wide) `free_shipping_min_egp`, **or every line's product is flagged free-shipping**; a cart mixing flagged and unflagged products pays the fee (open question 7). `next_day` is only allowed when the place row has `next_day_available`; it adds `next_day_fee_egp` to the fee. Pickup: fee 0, needs an active `supports_pickup` location (`mp:pickup_not_available`).
- **Address and phone from PR 10.** Delivery needs `p_address_id` owned by the caller and `marketplace_buyer_checkout_readiness(p_address_id).ready = true` (internally the same predicate: `app.marketplace_buyer_phone_is_verified`). Missing codes returned in `missing`: `address_missing`, `phone_unverified`, `delivery_not_available`. Pickup needs the account's own phone verified (`marketplace_buyer_phone_status().verified`), recipient name from the profile. `confirm` re-checks everything; a phone changed in between fails with `mp:phone_unverified`.
- **Payment methods from PR 8.** Allowed only if the seller's settings enable them: `cod` (`cod_enabled`), `instapay_full` (`instapay_full_enabled`), `instapay_deposit` (`instapay_enabled`, percent from `instapay_deposit_percent`). `pay_now_egp` is 0 / total / `round(total * percent / 100, 2)`. The quote carries the seller's `instapay_address` and `instapay_account_name` so the buyer knows where to transfer.
- **Receipt BEFORE confirm, bound to the session.** For both InstaPay methods `confirm` raises `mp:receipt_required` unless the session holds at least one `confirmed` proof (verified bytes). Uploads go through `marketplace_checkout_receipt_request_upload` (key `proofs/<session_id>/<proof_id>.<ext>`), the central media layer (`authorizeMediaUpload`, `verifyPendingMedia`), then `marketplace_checkout_receipt_confirm`. Only the session's buyer can upload, confirm, remove or read those keys (`app.marketplace_media_can_upload/read/delete` extended in PR 12).
- **Confirm is atomic and idempotent.** In one transaction: lock the session (`for update`); if `state = 'confirmed'` return the same orders with `replayed: true` (any key); if the key is already used by this buyer on another session, `mp:idempotency_conflict`; recompute the quote with `app.marketplace_checkout_quote` and compare its hash with `p_quote_hash`: different means `mp:quote_changed` and the new quote is returned in the error detail so the page can show it (receipts stay attached); insert the order(s) and lines (snapshots, section 2.3); pick the stock location per line as migration 14 does (main location first, then largest availability); `reserve` stock; bind receipts to the order; stamp `placed_at`, estimate, `stock_state = 'pending'`; write event `placed`; open timer `order_seller_start`; notify the seller; mark the session `confirmed`. Any failure rolls everything back (the receipts remain on the open session for a retry).
- **Concurrency.** Stock lines are processed `order by variant_id, location_id` (consistent lock order, no deadlock). PR 12 ships `supabase/tests/marketplace_checkout_concurrency_test.sh` (two buyers, last unit; same buyer, same key twice) next to `marketplace_stock_concurrency_test.sh`.
- `marketplace_seller_order_action` payload keys: `start_preparing {}`; `mark_ready {}`; `mark_shipped {carrier_name?, tracking_number?}`; `mark_delivered {}`; `collect_payment {}`; `accept_receipt {proof_id?}` (default: the latest submitted); `flag_receipt_not_received {preset_id? | message_ar, message_en}`; `cancel {preset_id? | message_ar, message_en, internal_note?}`; `mark_delivery_failed {note?}`; `mark_returned_to_stock {}`. Unknown action `mp:invalid_action`.

### 4.3 PR 13 - buyer and seller order pages (owner: PR 13)

PR 13 owns **reads, documents, search and the invoice**; it does not add any state change (those are PR 12's).

| Function | Signature | Returns |
|---|---|---|
| `public.marketplace_buyer_orders_v2` | `(p_search text, p_period text, p_status text, p_limit integer, p_offset integer)` | `{ total, items: [order summary] }`. `p_period` in `3m`, `6m`, `1y`, `all` (default `3m`, Noon style); `p_search` matches order number, product name (Arabic/English), SKU; `p_status` is one of the buyer groups `active`, `delivered`, `cancelled`, null = all. Own orders only. |
| `public.marketplace_buyer_order_get_v2` | `(p_order_id uuid)` | order document (`buyer`) |
| `public.marketplace_seller_orders_page_v2` | `(p_organization_id uuid, p_tab text, p_search text, p_from date, p_to date, p_limit integer, p_offset integer)` | `{ total, counts: { new, in_preparation, shipped, delivered, cancelled }, needs_attention: integer, items: [order summary] }`. `p_tab` in `new`, `in_preparation`, `shipped`, `delivered`, `cancelled`, null = all. `needs_attention` = orders with `receipt_submitted` not yet looked at, or `receipt_disputed`. |
| `public.marketplace_seller_order_get_v2` | `(p_order_id uuid)` | order document (`seller`) |
| `public.marketplace_order_invoice_get` | `(p_order_id uuid)` | `{ invoice_number, issued_at, seller, buyer, lines, subtotal_egp, delivery_fee_egp, total_egp, payment_method, paid_now_egp, balance_due_egp }`; buyer or seller of the order; issues idempotently (section 2.9) |
| `public.marketplace_order_waybill_get` | `(p_order_id uuid)` | seller only: `{ order_number, recipient: {name, phone}, address_text, governorate_key, area_key, latitude, longitude, items: [{name, sku, quantity}], payment: { method, collect_on_delivery_egp }, tracking_number, notes }` for the printable waybill; delivery orders only (`mp:not_a_delivery_order`) |
| `public.marketplace_seller_order_shipment_update` | `(p_order_id uuid, p_carrier_name text, p_tracking_number text)` | order document (`seller`); allowed in `shipped` (and `ready` for pre-filling); writes event `shipment_updated` |
| `app.marketplace_order_document_v2` | rebuilt by PR 13 on PR 12's body | adds the `invoice` key only; nothing else changes |

«إعادة الطلب» (reorder) needs **no new RPC**: the page reads the order document items (`slug`, `sku`, `quantity`) and calls PR 11's `marketplace_cart_merge`, which already applies own-showroom, availability and last-writer-wins rules.

### 4.4 PR 14 - timers, notifications, payment complaints (owner: PR 14)

| Function | Signature | Returns |
|---|---|---|
| `public.marketplace_timers_run` | `(p_limit integer default 200, p_now timestamptz default now())` | `{ processed, reminders, cancelled, errors }`; **service role only** (section 5) |
| `app.marketplace_timer_handle` | `(p_timer public.marketplace_timers, p_now timestamptz)` returns `text` | dispatches by `kind`; `order_*` kinds implemented by PR 14; `return_*` kinds call hook `app.marketplace_return_timer_tick(p_timer, p_now)` (default no-op, PR 15 replaces) |
| `app.marketplace_notify_admins` | `(p_permission text, p_template_key text, p_subject_type text, p_subject_id uuid, p_deep_link text, p_vars jsonb)` | one notification per admin holding the permission (self-notification suppressed) |
| `public.marketplace_payment_complaint_file` | `(p_order_id uuid, p_reason text, p_note text)` | `{ complaint_id, state }`; buyer or the seller's order managers; `p_reason` in `transfer_made`, `amount_mismatch`, `receipt_unreadable`, `other`; allowed only while payment is `receipt_disputed`; one open complaint per order (`mp:complaint_exists`) |
| `public.admin_marketplace_payment_complaints` | `(p_state text, p_limit integer, p_offset integer)` | `{ total, counts, items: [ { id, order_number, order_id, state, reason, filed_by_role, seller_name, buyer_name, total_egp, paid_now_egp, filed_at, receipts_count } ] }`; permission `marketplace_payment_complaints.review` |
| `public.admin_marketplace_payment_complaint_get` | `(p_complaint_id uuid)` | `{ complaint, order: order document (admin), events }` |
| `public.admin_marketplace_payment_complaint_decide` | `(p_complaint_id uuid, p_decision text, p_note text)` | complaint row; `p_decision` in `payment_valid` (runs `accept_receipt` with `actor_role = 'admin'`, closes the dispute timer, seller continues), `payment_not_received` (order stays disputed, the buyer's 48 h clock is **not** restarted; the timer keeps running), `dismissed`; note 3-500 chars required |
| `public.admin_marketplace_payment_complaint_take` | `(p_complaint_id uuid)` | marks `under_review` by this admin (so two admins do not duplicate) |

`marketplace_payment_complaints`: `id uuid pk`, `order_id uuid not null references marketplace_orders(id) on delete cascade`, `filed_by_user_id uuid`, `filed_by_role text` (`buyer`/`seller`), `reason text`, `note text` (3-500), `state text` (`open`, `under_review`, `resolved`, `dismissed`), `decision text`, `decision_note text`, `decided_by uuid`, `decided_at timestamptz`, `taken_by uuid`, `created_at`, `updated_at`; unique partial index on `(order_id) where state in ('open','under_review')`. `marketplace_payment_complaint_events`: append-only (`complaint_id`, `action`, `actor_id` no FK, `actor_role`, `note`, `at`). PR 14 also rebuilds `app.marketplace_order_notify` (adds the timer and complaint events) and the hook `app.marketplace_complaint_admin_can_read` (an admin holding the permission may read the receipts of an order that has a complaint, nothing else).

### 4.5 PR 15 - returns and exchanges (owner: PR 15)

| Function | Signature | Returns |
|---|---|---|
| `public.marketplace_buyer_return_eligibility` | `(p_order_id uuid)` | `{ eligible, window: { general_ends_at, defect_ends_at }, lines: [ { item_id, name_ar, name_en, quantity, returnable_quantity, non_returnable } ], reasons: [ { id, label_ar, label_en, claim_type, requires_evidence } ] }` |
| `public.marketplace_buyer_return_request_upload` | `(p_order_id uuid, p_content_type text)` | `{ evidence_id, object_key }` (images only in this phase, 10 MB each, at most 6 per request; key `returns/<order_id>/<evidence_id>.<ext>`) |
| `public.marketplace_buyer_return_evidence_confirm` | `(p_evidence_id uuid)` | `{ evidence: [...] }` |
| `public.marketplace_buyer_return_create` | `(p_order_id uuid, p_kind text, p_lines jsonb, p_reason_preset_id uuid, p_note text, p_evidence_ids uuid[], p_remedy text, p_idempotency_key text)` | return document (buyer); `p_kind` `return`/`exchange`; `p_remedy` `refund`/`exchange`; `p_lines` `[ {item_id, quantity} ]` |
| `public.marketplace_buyer_return_cancel` | `(p_return_id uuid)` | return document; only while `requested` |
| `public.marketplace_buyer_return_mark_shipped` | `(p_return_id uuid, p_tracking text)` | return document; buyer-pays returns |
| `public.marketplace_buyer_refund_confirm` | `(p_return_id uuid)` | return document; buyer confirms he received the refund |
| `public.marketplace_buyer_returns` / `marketplace_buyer_return_get` | `(p_limit, p_offset)` / `(p_return_id)` | list / document |
| `public.marketplace_seller_returns_page` / `marketplace_seller_return_get` | `(p_organization_id, p_state, p_limit, p_offset)` / `(p_return_id)` | list / document |
| `public.marketplace_seller_return_decide` | `(p_return_id uuid, p_decision text, p_preset_id uuid, p_message_ar text, p_message_en text, p_partial_refund_egp numeric)` | return document; `p_decision` `approve`, `reject` (reason preset action `return_reject` or custom), `propose_partial` |
| `public.marketplace_seller_return_receive` | `(p_return_id uuid, p_sellable jsonb)` | return document; marks «تم استلام المرتجع»; `p_sellable` `[ {item_id, sellable: boolean} ]`; sellable units go back to stock (`replenish`, key `return:<id>:<item>`) only when the seller says so |
| `public.marketplace_seller_refund_record` | `(p_return_id uuid, p_amount_egp numeric, p_reference_note text)` | return document; the seller executes the refund through the buyer's ORIGINAL method (InstaPay transfer for InstaPay orders; cash for COD) and records it |
| `public.marketplace_seller_exchange_fulfil` | `(p_return_id uuid, p_note text)` | return document; closes an exchange after the replacement was handed over (replacement is the same variant or an equal-price variant; see open question 8) |
| `public.marketplace_seller_return_settings_get` / `_save` | `(p_organization_id)` / `(p_organization_id, p_settings jsonb)` | `{ general_days (>= 14), defect_days (>= 30) }`, never below the legal floor |
| `public.marketplace_seller_product_returnability_set` | `(p_organization_id uuid, p_product_id uuid, p_non_returnable boolean)` | boolean |
| `public.admin_marketplace_returns` / `admin_marketplace_return_get` | `(p_state, p_queue, p_limit, p_offset)` / `(p_return_id)` | permission `marketplace_returns.review`; `p_queue` `escalated` (silence or complaint) or `all` |
| `public.admin_marketplace_return_remind_seller` | `(p_return_id uuid)` | return document; notifies the seller again |
| `public.admin_marketplace_return_decide` | `(p_return_id uuid, p_decision text, p_note text, p_message_ar text, p_message_en text)` | return document; `approve`/`reject`, with `actor_role = 'admin'` |
| `public.marketplace_return_complaint_file` | `(p_return_id uuid, p_note text)` | return document; buyer or seller escalates to the admin queue |
| `app.marketplace_return_timer_tick` | hook body | handles `return_seller_response` (reminders at 24 h and 48 h, at 72 h escalate: set `in_admin_queue`, notify authorised admins, **no auto-approval**) and `return_refund_due` (7 days after receipt: remind seller, then escalate) |
| `app.marketplace_return_evidence_can_read` / `app.marketplace_return_evidence_metadata` | hook bodies | buyer and seller of the order, admins holding `marketplace_returns.review` for an escalated return |

Tables (PR 15): `marketplace_return_requests` (`id uuid pk`, `request_number text unique` like `RT-000001`, `order_id`, `buyer_user_id`, `seller_organization_id`, `kind` `return`/`exchange`, `claim_type` `general`/`defect`, `status` `requested`, `approved`, `rejected`, `in_transit`, `received`, `refunded`, `exchanged`, `closed`, `cancelled`; `reason_preset_id`, `reason_label_ar/en`, `buyer_note`, `remedy` `refund`/`exchange`, `partial_refund_egp`, `return_shipping_payer` `seller`/`buyer` (derived: defect, wrong item, damaged in transit = seller; change of mind = buyer), `in_admin_queue boolean`, `escalated_reason` `seller_silent`/`complaint`, `decision_message_ar/en`, `seller_due_at`, `refund_due_at`, `received_at`, `closed_at`, timestamps; unique `(buyer_user_id, idempotency_key)`), `marketplace_return_items` (`return_id`, `order_item_id`, `quantity`, `sellable boolean`, unique `(return_id, order_item_id)`; trigger keeps `order_items.quantity_returned <= quantity`), `marketplace_return_events` (append-only), `marketplace_return_evidence` (`id`, `return_id` nullable until the request is created, `order_id`, `object_key unique`, `mime_type`, `created_by`, `upload_state`, `byte_size`, `checksum_sha256`), `marketplace_order_refunds` (`id`, `return_id`, `order_id`, `amount_egp`, `method` copy of the order payment method, `state` `pending`, `sent`, `confirmed`, `disputed`, `sent_by`, `sent_at`, `confirmed_by`, `confirmed_at`, `reference_note`), `marketplace_seller_return_settings` (`seller_organization_id pk`, `general_days smallint check (>= 14)`, `defect_days smallint check (>= 30)`).

Window rules: general = `delivered_at + general_days` (default 14, calendar days counted from the delivery instant in Africa/Cairo, ends at 23:59:59 of the last day); defect = `delivered_at + defect_days` (default 30); a line with `non_returnable = true` accepts only `claim_type = 'defect'` claims; visible transit damage must be reported with evidence within 48 hours of `delivered_at`; evidence is required for every `defect` and transit-damage claim; the condition rule (unused, original packaging) is a buyer declaration plus the seller's inspection at `receive`. The return window never extends because of an open return.

### 4.6 Hooks and one-time redefinitions (collision control)

Some shared objects must change in more than one PR. Their rule:

| Shared object | Owner of the **single** redefinition | How later PRs extend it |
|---|---|---|
| `notifications` CHECK `ck_notifications_event_type_known` | PR 12 adds **all** order, payment-complaint and return event types in one statement (vocabulary only, using the `pg_temp.extend_in_check` pattern of `20261123130001`), so no later PR rebuilds that constraint | PR 14 / PR 15 only insert their template rows |
| `marketplace_seller_message_presets` CHECK `ck_marketplace_seller_presets_action` **and** the action list inside `admin_marketplace_seller_preset_save` / `admin_marketplace_seller_presets` | PR 12 adds **all** new actions at once: `order_cancel_seller`, `order_cancel_buyer`, `payment_issue`, `return_reason`, `return_reject`, and re-declares the two admin preset functions with the longer list | PR 13/14/15 only insert seed rows for their actions (INSERT, no function change). `return_reason` rows are buyer-facing reason choices (label shown to the buyer, text shown to the seller). |
| Media functions `app.marketplace_media_metadata`, `_storage_key`, `_cleanup_rows`, `_retire`, `_can_upload`, `_can_read`, `_can_delete` | PR 12 rebuilds all seven once: receipts bound to a session, hook branches for complaint-admin reads and return evidence, and the storage-key regex for `returns/<id>/<evidence>.<ext>` | PR 14 replaces only `app.marketplace_complaint_admin_can_read`; PR 15 only the two `app.marketplace_return_evidence_*` hooks |
| `app.marketplace_order_notify` | PR 12 (events from its transitions) | PR 14 rebuilds it with the timer and complaint events; PR 15 rebuilds it again with return events (merge order guarantees each builds on the previous body) |
| `app.marketplace_order_document_v2` | PR 12 | PR 13 adds `invoice`; PR 14 fills `payment.dispute.complaint_id`; PR 15 fills `return_window` and `returns` (each rebuilds the previous body; keys never removed) |
| `app.marketplace_order_actions` | PR 12 | PR 14 adds `file_complaint`; PR 15 adds `request_return` / `request_exchange` |
| `supabase/permissions/<version>.json` | each PR regenerates the **full snapshot** on the tree that already contains the previous PR (section 8) | |

### 4.7 Error codes (frontend `ORDER_ERROR_CODES` additions)

New `mp:` codes, owned by PR 12 and added to `contract.ts` there: `marketplace_closed`, `multi_seller_unsupported`, `seller_not_ready`, `receipt_required`, `quote_changed`, `idempotency_conflict`, `phone_unverified`, `address_missing`, `own_showroom`, `legacy_order`, `invalid_action`, `payment_dispute_open`, `preset_invalid`, `session_expired`, `session_not_found`. PR 14 adds `complaint_exists`, `complaint_not_allowed`. PR 15 adds `return_window_closed`, `return_not_eligible`, `evidence_required`, `return_exists`, `quantity_exceeds_order`. PR 13 adds `not_a_delivery_order`. Each PR edits only its own lines of that set (merge conflicts on that file are trivial: one-line additions).

## 5. Timers

### 5.1 The job mechanism the repo already uses

There is **no `pg_cron`** and no queue worker in this repo for Marketplace work. The existing pattern, used by the media cleanup (`marketplace_rejected_images_purge`, a service-role-only RPC run by the media cleanup tool `scripts/media-storage.mjs cleanup`) and by the two Cloudflare cron Workers (`backend/cloudflare/transcode`, cron `*/10 * * * *`, holds `SUPABASE_SERVICE_ROLE_KEY`; `edge/whatsapp-otp-worker`, cron `* * * * *`, holds no database credential and posts a signed event to an internal app route), is:

1. **All logic lives in Postgres** as a bounded, idempotent, service-role-only function (Postgres is the only job authority; no job state anywhere else).
2. **A scheduler outside Postgres only calls it**: a Cloudflare Worker cron trigger (the stack's host, ADR-0021/0022), or a manual script until a Worker is approved.

Decision for PR 14: SQL = `public.marketplace_timers_run(p_limit, p_now)` (granted to `service_role` only, like `marketplace_rejected_images_purge`). Runner = a small new Worker `edge/marketplace-timers-worker` with `"triggers": { "crons": ["*/5 * * * *"] }` that calls that one RPC through PostgREST with the service-role key from the Workers secrets store (the transcode Worker precedent; a bounded RPC needs no signed app route). The same Worker also calls `marketplace_checkout_sessions_purge`; the existing media cleanup is left alone. Until the owner approves deploying that Worker, `scripts/marketplace-timers.mjs run` (PR 14, modelled on `scripts/media-storage.mjs`) runs the same RPC by hand; Acceptance verification uses `p_now` to simulate time (pgTAP and the script both accept it). **Deploying the Worker, its secret binding and enabling it on any hosted environment need the owner's approval; the PR ships code and a runbook, nothing hosted.**

### 5.2 Timers and the data each one needs

| Timer kind | Subject | Opens | Remind | Deadline | On expiry | Closes on |
|---|---|---|---|---|---|---|
| `order_seller_start` | order | transition 1 (`place`) | every **6 hours** while `status = 'new'` (`remind_every`) | **72 hours** after `placed_at` | transition 12 `cancel_timeout_seller`: stock `release`, buyer and seller notified | `start_preparing` (2), `cancel_by_buyer` (10), `cancel_by_seller` (11) |
| `order_receipt_resubmit` | order | transition 8 (`flag_receipt_not_received`) | once, at **24 hours** (`remind_offsets = {24h}`) | **48 hours** after the flag | transition 13 `cancel_timeout_receipt` | `resubmit_receipt` (9), `accept_receipt` (7, also by the admin), any cancel |
| `return_seller_response` | return | PR 15 `return_create` | at 24 h and 48 h (`remind_offsets = {24h, 48h}`) | **72 hours**, then escalate (no auto-approval) | hook `app.marketplace_return_timer_tick`: `in_admin_queue = true`, notify authorised admins | seller decision, buyer cancel, admin decision |
| `return_refund_due` | return | PR 15 `received` | at 5 days (`remind_offsets = {5d}`) | **7 days** after the seller received the item | hook: notify seller once more, escalate to the admin queue | refund recorded |

Elapsed clock time is used (72 h means 72 hours, not business days); delivery estimates use calendar days (a different rule, section 1.2). Timers keep running while the Marketplace is closed or the seller suspended.

### 5.3 Runner semantics (`marketplace_timers_run`)

- Select due timers: `state = 'active' and (expires_at <= p_now or next_remind_at <= p_now) order by least(expires_at, next_remind_at) for update skip locked limit p_limit`. Two overlapping runs never process the same timer.
- **Expiry before reminder.** If `expires_at <= p_now` the timer expires (`state = 'expired'`); no reminder is sent for a timer that is expiring.
- **One reminder per run, no burst.** If the Worker was down for 20 hours, the seller gets one reminder, and `next_remind_at` becomes `p_now + remind_every` (or the next offset still in the future), never three catch-up messages.
- **Each timer is its own subtransaction.** The reminder notification, `reminders_sent + 1` and the new `next_remind_at` commit together. A failure in one timer (counted in the returned `errors`) never blocks the rest.
- **Expiry goes through the core** (`app.marketplace_order_apply(..., 'cancel_timeout_seller', 'system', null, ...)`), which re-checks the current status under the order lock: an order that was started a second ago is a no-op and the timer is closed `done`. Stock effects and notifications therefore happen exactly once, by the machine's own idempotency rules (section 3.2).
- Closing a timer is idempotent. A timer never reopens; a new dispute opens a new `order_receipt_resubmit` row.
- The function returns counts only; the Worker logs them (numbers only, no ids), as the WhatsApp worker does.
- Tests (PR 14, pgTAP): time travel with `p_now`; reminder cadence 6 h; catch-up produces one reminder; expiry at 72 h releases stock; started-just-before race; dispute timer 24 h / 48 h; overlap safety (second call finds nothing).

## 6. Notification matrix (in-app only)

Channel is **in-app for every row** (owner, 4C). Template key = `notifications.event_type` (same string), pattern `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`, seeded in both languages with declared variables by the PR named in the last column, rendered with PR 5's 9-argument `app.notify_from_template`, edited in the existing admin editor under `notification_templates.manage`. Seller recipients are `app.marketplace_notify_order_managers` (active members holding `order.manage` or `org.manage`); self-notification is suppressed by `app.notify`. Deep links are relative paths. **Standard variables** (all templates that mention them): `order_number`, `showroom_name`, `message` (the seller/preset/custom text, per language), `delivery_date`; extra variables are listed per row. PR 12 adds **every key below** to `ck_notifications_event_type_known` in its single statement (section 4.6); template rows are inserted only by the seeding PR.

| # | Event | Recipient | Template key | Extra variables | Deep link | Emitted by (transition) / seeded by |
|---|---|---|---|---|---|---|
| 1 | New order arrived (the "sale from the store" message) | seller managers | `marketplace.order.placed` | `buyer_name`, `total` | `/showroom/marketplace/orders/<id>` | 1 / PR 12 |
| 2 | Preparing started | buyer | `marketplace.order.preparing` | - | `/market/orders/<id>` | 2 / PR 12 |
| 3 | Ready for pickup (pickup orders only) | buyer | `marketplace.order.ready_pickup` | - | same | 3 / PR 12 (not in the owner's list, open question 1) |
| 4 | Shipped | buyer | `marketplace.order.shipped` | `tracking_number` | same | 4 / PR 12 |
| 5 | Delivered | buyer | `marketplace.order.delivered` | - | same | 5 / PR 12 |
| 6 | Buyer cancelled | seller managers | `marketplace.order.cancelled_by_buyer` | - | seller order page | 10 / PR 12 |
| 7 | Seller cancelled (preset or custom reason) | buyer | `marketplace.order.cancelled_by_seller` | - | buyer order page | 11 / PR 12 |
| 8 | «لم تصلني الفلوس» | buyer | `marketplace.order.receipt_disputed` | `hours_left` (48) | buyer order page | 8 / PR 12 |
| 9 | Buyer re-uploaded the receipt | seller managers | `marketplace.order.receipt_resubmitted` | - | seller order page | 9 / PR 12 (added by this contract, open question 10) |
| 10 | Order not started, reminder every 6 h | seller managers | `marketplace.order.reminder_seller_start` | `hours_waiting`, `hours_left` | seller order page | timer / PR 14 |
| 11 | Auto-cancelled, seller did not start (72 h) | buyer **and** seller managers | `marketplace.order.cancelled_timeout_seller` | - | order page of each side | 12 / PR 14 |
| 12 | Disputed receipt not re-uploaded, reminder at 24 h | buyer | `marketplace.order.reminder_receipt_resubmit` | `hours_left` (24) | buyer order page | timer / PR 14 |
| 13 | Auto-cancelled, receipt not re-uploaded (48 h) | buyer and seller managers | `marketplace.order.cancelled_timeout_receipt` | - | order page of each side | 13 / PR 14 |
| 14 | Payment complaint filed | admins holding `marketplace_payment_complaints.review` | `marketplace.order.payment_complaint_filed` | `filed_by` (buyer/seller), `reason` | `/admin/marketplace/payment-complaints` | `payment_complaint_file` / PR 14 |
| 15 | Payment complaint decided | buyer and seller managers | `marketplace.order.payment_complaint_resolved` | - | order pages | `..._decide` / PR 14 (added by this contract, open question 10) |
| 16 | Low stock / out of stock | seller managers | `marketplace.stock.low`, `marketplace.stock.out` | `product_name`, `available`, `threshold` | `/showroom/marketplace/products/<id>/edit` | hook `app.marketplace_order_stock_alert` (PR 12 calls it after `reserve`; default no-op) / PR 14. Fires once when `available` crosses the product's `low_stock_threshold` (PR 7) downward, and once at 0 |
| 17 | Return requested | seller managers | `marketplace.return.requested` | `request_number` | `/showroom/marketplace/returns/<id>` | PR 15 |
| 18 | Return approved / rejected (with message) | buyer | `marketplace.return.approved`, `marketplace.return.rejected` | `request_number` | `/market/returns/<id>` | PR 15 |
| 19 | Seller reminders (24 h, 48 h) | seller managers | `marketplace.return.seller_reminder` | `request_number`, `hours_left` | seller return page | PR 15 |
| 20 | Escalated to the admin queue (72 h silence, or complaint) | admins holding `marketplace_returns.review` | `marketplace.return.escalated` | `request_number`, `reason` | `/admin/marketplace/returns` | PR 15 |
| 21 | Admin reminded the seller / admin decided | seller managers / buyer and seller managers | `marketplace.return.admin_reminder`, `marketplace.return.admin_decided` | `request_number` | return pages | PR 15 |
| 22 | Return received, refund sent, refund confirmed | buyer / buyer / seller managers | `marketplace.return.received`, `marketplace.return.refund_sent`, `marketplace.return.refund_confirmed` | `request_number`, `amount` | return pages | PR 15 |

Variables hold plain text; money is formatted by the writer per language (`p_vars_ar` / `p_vars_en`); `delivery_date` is the order's estimate range ("12-14 Dec"). Notification bodies never contain a phone number, an address or a receipt link.

## 7. Permissions and admin queues

| Permission key | Resource / action | Default holders | Owner PR | Guards |
|---|---|---|---|---|
| `marketplace_payment_complaints.review` | `marketplace_payment_complaints` / `review` | Super Admin, **locked**; the owner grants it to chosen admins through the existing admin role editor (a grantable permission, like `marketplace_media.moderate`) | PR 14 | `admin_marketplace_payment_complaints`, `_get`, `_take`, `_decide`; reading the receipts of an order that has a complaint; recipient set of notification 14 |
| `marketplace_returns.review` | `marketplace_returns` / `review` | Super Admin, locked; grantable | PR 15 | `admin_marketplace_returns`, `_get`, `_remind_seller`, `_decide`; reading return evidence of an escalated return; recipient set of notification 20 |

Rules:

- Inserted exactly like `notification_templates.view/manage` in `20261121090003` and `marketplace_platform.manage` in `20261123130001` (`admin_permissions` row with a `sort_order`, `admin_role_permissions` row `is_locked = true` for `super_admin`, `on conflict do nothing`). New `sort_order` values: payment complaints 114, returns 115.
- The two permissions are **separate** from `marketplace_sellers.manage`, `marketplace_media.moderate`, `marketplace_platform.manage` and `notification_templates.*`. An admin without the permission gets `mp:not_permitted` (errcode 42501) from every admin function and is never a notification recipient; the admin pages answer the usual not-found.
- **Seller-side authority is unchanged**: `order.manage` or `org.manage` (`app.marketplace_can_manage_orders`). No new membership capability is introduced in this phase.
- **Buyer-side**: every buyer RPC is bound to `auth.uid()` and the order's `buyer_user_id`; an id is never trusted from the payload.
- Presets (`order_cancel_seller`, `order_cancel_buyer`, `payment_issue`, `return_reason`, `return_reject`) are edited only under `notification_templates.manage`, with PR 5's reason and event trail; they are deactivated, never deleted.
- **Permission contract files** (`supabase/permissions/<version>.json`, generated by `node supabase/tests/b1/permission_contract.mjs <container> generate`, checked by `scripts/migration-permission-gate.mjs`): each file is a **full snapshot** of every function's effective grants. Therefore: merge order is 12, 13, 14, 15; each PR copies the previous PR's last file as its base, applies its own migrations on a tree that already contains the previous PR, regenerates its own file named after its **last** migration version, and reviews that the diff contains only its own functions. Later PRs rebase onto `main` after the earlier PR merges and regenerate again. Never hand-edit a snapshot; never regenerate on a tree missing the previous PR.

## 8. Migration and pgTAP blocks

Versions are 14-digit timestamps; a PR may use any version inside its block, in order, and must not use another PR's block. Numbers are reserved even if unused.

| PR | Migration block | pgTAP block | Concurrency scripts (`supabase/tests/`) | Last permission snapshot |
|---|---|---|---|---|
| 10 | `20261125090001` (renumbered from `20261124100001`) | `240` | none | named after its last migration |
| 11 | `20261125090002` (renumbered from `20261124110001`) | `260` | none | same rule |
| 12 | `20261125100001` - `20261125109999` (`20261124120001` is on `main`, applied) | `300` - `329` | `marketplace_checkout_concurrency_test.sh` | named after its last migration |
| 13 | `20261125110001` - `20261125119999` | `330` - `359` | none | same rule |
| 14 | `20261125120001` - `20261125129999` | `360` - `389` | `marketplace_timers_concurrency_test.sh` | same rule |
| 15 | `20261125130001` - `20261125139999` | `390` - `419` | `marketplace_returns_concurrency_test.sh` | same rule |

Existing numbers for orientation: PR 8 `203`, PR 9 `220`-`222`, PR 10 `240`, PR 11 `260`. File naming follows `<number>_marketplace_<topic>_test.sql`. PR 12's first migration is `20261125100001_marketplace_checkout_order_model.sql` (renumbered on 2026-11-25: `main` applied `20261124090001` and `20261124120001` to Acceptance and Production, so every PR 10-15 migration moved after them).

Suggested internal split (not binding on the version digits):

- **PR 12** `120002` orders/items/events/proofs/products alters + CHECK widening + backfill + new tables; further files for shared vocabularies (notification event types, preset actions + admin preset functions + seeds for `order_cancel_seller`, `order_cancel_buyer`, `payment_issue`, media function rebuild, templates 1-9), the state machine/document/actions/notify helpers, the checkout RPCs, the wrappers, grants and the purge function.
- **PR 13** `130001` invoices + sequence; `130002` read RPCs v2, waybill, shipment update; document rebuild.
- **PR 14** `140001` permission + complaints tables; `140002` timer runner, handlers, stock alert hook body, notify rebuild; `140003` complaint and admin RPCs, templates 10-16; document/actions rebuild.
- **PR 15** `150001` permission + returns tables + return settings; `150002` return RPCs, hooks, templates 17-22, `return_reason`/`return_reject` seed rows; `150003` order document/actions/notify rebuild.

Every migration states in its header: what it adds, which earlier PR it needs, that nothing is dropped, and the security model (RLS on, no client grant). Each PR's pgTAP covers: every function (happy path, each `mp:` error), isolation per table, the stock invariant (`stock_state` agrees with `marketplace_stock_movements`), idempotent replay, and the permission gate (an admin without the key is refused). `scripts/migration-policy.mjs` must pass (no drops, no signature changes of promoted functions).

## 9. Frontend ownership (routes and components)

Existing routes today: `/market/cart`, `/market/checkout`, `/market/orders`, `/market/orders/[orderId]`, `/showroom/marketplace/orders`, `/showroom/marketplace/orders/[orderId]`, `/showroom/marketplace/payments` (payment settings), admin `/admin/marketplace`, `/admin/marketplace/media`, `/admin/marketplace/videos`; existing code `frontend/src/features/marketplace-orders/*` and `frontend/src/server/actions/marketplace-orders.ts`.

| Owner | Routes | Components / modules |
|---|---|---|
| **PR 12** | `/market/checkout` (rewritten: delivery or pickup, payment choice, receipt upload before confirm, quote, non-returnable disclosure, «تأكيد الطلب»); `/market/checkout/confirmed/[checkoutId]` (thank-you: greeting by name, order number, progress, address, payment method, summary) | New folder `features/marketplace-checkout/*`; new `server/actions/marketplace-checkout.ts` (prepare, receipt upload and confirm, confirm). PR 12 is the **only** PR that edits `features/marketplace-orders/contract.ts` for the new statuses, payment values, error codes and `OrderDocumentV2` types, and it makes the legacy order views compile (type adaptation only, no redesign). It edits `server/actions/marketplace-orders.ts` only to add the seller-action, buyer-cancel-v2 and receipt-resubmit actions |
| **PR 13** | `/market/orders` and `/market/orders/[orderId]` (Noon layout, progress bar, timeline, tracking, reorder, invoice); `/market/orders/[orderId]/invoice`; `/showroom/marketplace/orders` (tabs, search, date filter); `/showroom/marketplace/orders/[orderId]` (actions from `document.actions`, cancel dialog with presets, receipt review with «لم تصلني الفلوس», buyer receipt re-upload panel); `/showroom/marketplace/orders/[orderId]/waybill` and `/invoice` (print views) | Owns the `features/marketplace-orders/*` views and copy (`buyer-copy.ts`, seller copy) and `server/queries` for the v2 reads; renders actions through a **registry keyed by action name that ignores unknown names**, so PR 14 and PR 15 add buttons without touching the page shell |
| **PR 14** | `/admin/marketplace/payment-complaints` (+ detail); small slots inside PR 13's order pages: the complaint dialog (`file_complaint` action) and the dispute countdown copy | New folder `features/marketplace-admin-complaints/*`; `edge/marketplace-timers-worker/*`; `scripts/marketplace-timers.mjs`; admin nav entry gated by the permission |
| **PR 15** | `/market/orders/[orderId]/return` (request wizard with evidence upload), `/market/returns`, `/market/returns/[id]`, `/showroom/marketplace/returns`, `/showroom/marketplace/returns/[id]`, `/showroom/marketplace/return-policy` (seller return settings), `/admin/marketplace/returns`; the non-returnable control inside the seller product form; the disclosure badge on product page and cart (data comes from PR 12's `non_returnable` key) | New folders `features/marketplace-returns/*` and `features/marketplace-admin-returns/*`; one-line addition to the product form (PR 7 file) |

PR 10 owns `/settings/addresses`, PR 11 owns `/market/cart` and the sign-in modal; PR 12 only links to them. Design: Craftsman system and semantic tokens only (root `AGENTS.md`, Design System authority); copy in Arabic and English via the existing i18n message files; no technical wording in the UI.

## 10. The flag and the switch

- **Ordering stays hidden** behind `NEXT_PUBLIC_MARKETPLACE_ORDERING === "true"` (`isMarketplaceOrderingEnabled()` in `frontend/src/lib/env/index.ts`; `.env.example` documents it as empty = browse-only). Every new buyer route (`/market/checkout*`, `/market/orders*`, `/market/returns*`) and every add-to-cart/checkout entry point is guarded by it exactly like the existing buttons; with the flag off they redirect to `/market` (or answer not-found for order and return detail routes). Seller and admin pages for orders, returns and complaints are **not** behind the flag (a seller must always be able to see and finish orders that exist), and show nothing when no orders exist.
- **PR 12 normalizes the checkout guard**: today `/market/checkout` checks only `isMarketplacePreviewEnabled()`; the rewritten page must check **both** `isMarketplacePreviewEnabled()` and `isMarketplaceOrderingEnabled()`. No new environment variable is introduced by PRs 12-15.
- **Server side**: every checkout RPC refuses with `mp:marketplace_closed` when `app.marketplace_is_open()` is false, and `app.marketplace_seller_is_public(seller)` must hold at `prepare` and `confirm`. The flag is a **frontend** gate only; the database never reads it, so the Marketplace open/close switch is the server-side kill switch and the flag the release switch. Orders that already exist continue through the machine whatever the switch says (section 3.2).
- Production follows Acceptance: flags and the switch are enabled on Production only after verification on Acceptance, with the owner's approval of each hosted step.

## 11. Open questions for the owner (plain language)

None of these re-opens a closed decision. Each has a recommendation; the contract already assumes the recommendation so coding is not blocked, and a different answer is a small change.

1. **Pickup orders: tell the buyer when the order is ready to collect?** Your notification list says preparing, shipped and delivered. A pickup customer has no "shipped". *Recommendation:* send one extra message "ready for pickup" for pickup orders only (template `marketplace.order.ready_pickup`; one more text, nothing else changes). The contract includes it; say so if you want it removed.
2. **When a payment complaint is decided, what exactly happens?** *Recommendation:* the admin picks one of three outcomes. "Payment is valid": the order's payment counts as received and the seller carries on. "Money not received": nothing changes, the buyer's 48 hours keep running. "Dismissed": no action. The admin never moves money, and every decision keeps a written note.
3. **Who may file a payment complaint?** *Recommendation:* the buyer (he says he paid) or the showroom (the buyer keeps not answering), only while the receipt is marked "money not received".
4. **Can the seller still cancel after the order is marked ready (stock already taken out)?** The old system allowed it. *Recommendation:* yes until it is shipped, with a reason, and the units return to stock automatically. After shipping he uses "delivery failed".
5. **Return evidence: photos only, or also video?** Video needs the heavy video pipeline and is slow for a buyer on mobile data. *Recommendation:* photos only for now (up to 6, 10 MB each); add video later if disputes show a need.
6. **If a showroom is suspended or the Marketplace is closed, what happens to orders already placed?** *Recommendation:* they carry on as normal (the seller can still prepare, timers still run, so an ignored order still auto-cancels after 72 hours). Only new purchases stop. An admin tool to cancel an order by hand is not included; say if you want one.
7. **Free shipping in a cart that mixes products.** If only some products are marked "free shipping", does the whole order ship free? *Recommendation:* no. The delivery fee is waived only when every product in the order is marked free, when the delivery area is priced free, or when the order reaches the showroom's free-shipping minimum.
8. **Exchange for a different product or price.** *Recommendation:* in this version an exchange is only for the same product or a same-price variant (the showroom hands over the replacement). Anything with a price difference is handled as a return plus a new order.
9. **Invoice.** What the buyer and seller print is an order invoice with the showroom's and buyer's details and the totals (prices exclude VAT, as today). It is **not** an official tax invoice and does not connect to the tax authority's e-invoicing system. *Recommendation:* label it "order invoice" now, and ask your accountant or lawyer, together with the Terms review, whether e-invoicing is required before launch.
10. **Two extra messages added.** "The buyer sent a new receipt" (to the showroom) and "complaint decided" (to buyer and showroom). *Recommendation:* keep both; without them the other side never learns the outcome.
11. **New Cloudflare timer service.** The 6-hour reminders and 72-hour cancellations need a small scheduled service. *Recommendation:* approve building it and deploying it first on Acceptance only; until then a manual script does the same job for testing. Nothing is deployed without your approval.

Already closed and **not** asked again: calendar-day delivery with no cut-off; buyer place travels in the URL only; no contact element for the showroom on any page (in-platform messages tied to the order come later); one preset system (PR 5's `marketplace_seller_message_presets`); signed-in cart is last-writer-wins; seller cannot buy from his own showroom; pilot with one selling showroom.

## 12. Implementation notes recorded from PR 12 (2026-11-24)

Deviations the PR 12 agent reported while building; they refine, not replace, the sections above.

- `marketplace_orders.source` defaults to `legacy`; checkout v2 sets `v2` (section 2.2).
- Extra no-op hooks for PR 14/15: `app.marketplace_order_complaint_id(p_order uuid)` (fills `payment.dispute.complaint_id`, PR 14) and `app.marketplace_order_extra_actions(p_order uuid, p_for text)` (adds `file_complaint`, `request_return`, `request_exchange` to `actions`, PR 14/15). PR 14 and PR 15 replace these bodies instead of rebuilding `app.marketplace_order_actions` / the document.
- The legacy `app.marketplace_order_document` was patched additively (source, delivery_speed, placed_at, estimate dates, paid_now_egp, balance_due_egp) so old pages keep working.
- **Correction to section 4.6:** the media functions have hooks only for read and metadata, not for evidence upload or delete. PR 15 therefore redefines `app.marketplace_media_can_upload` and `app.marketplace_media_can_delete` itself (rebuilding PR 12's body and adding its evidence branch); PR 15 must not touch any other media function.
- The `return_refund_due` timer carries the 5-day reminder offset (as in section 5.2).
- **Media rules PR 15 must keep when it rebuilds `can_upload` / `can_delete` (and any later media change):** (1) `app.marketplace_media_metadata` returns `organization = null` for buyer receipts, so the per-organization upload rate and quota in `media_storage_reserve` is never charged to the seller organization; (2) `public.organization_media_resolve` is redefined by PR 12: a marketplace key whose metadata has no organization skips the organization liveness check; (3) `app.marketplace_media_can_read`: the order-manager branch requires the seller organization to be live (`deleted_at is null`), so members of a soft-deleted showroom cannot read receipts; the buyer branch is unchanged. PR 12's pgTAP 300 asserts these (D9b, D9c, I10a-d).
- `marketplace_checkout_prepare` additionally returns `receipts`: the session's confirmed receipts `[ {id, status, created_at} ]` (additive; no signature change), so the page can show attached receipts after a reload.
- **Renumbering:** `main` already owns `20261124120001` (stock notify), so PR 12's first migration is `20261125100001_marketplace_checkout_order_model.sql` and its permission snapshot is `supabase/permissions/20261125100001.json`. PR 10 = `20261125090001`, PR 11 = `20261125090002`, PR 13 = `20261125110001`-`3`, PR 14 = `20261125120001`-`3`, PR 15 = `20261125130001`-`3` (all renumbered on 2026-11-25).

## 13. Owner decisions of 2026-11-25 (they override any earlier text above)

- All the recommendations of section 11 are accepted. The tax e-invoice (question 9) is **not** needed in this version: the printed document is an order invoice.
- **Unchecked receipt on a cancelled order** (overrides rows 10-12 of section 3.2): when an InstaPay order (full or deposit) is cancelled by the buyer, by the showroom or by the 72 h timeout while the receipt is `receipt_submitted`, the payment becomes `refund_due`, not `not_collected`. Admins holding `marketplace_payment_complaints.review` are notified (`marketplace.order.refund_check`) and the buyer or the showroom may file one payment complaint on the cancelled order: `payment_valid` keeps `refund_due`, `payment_not_received` sets `not_collected`. The same applies when the showroom cancels after rejecting the receipt (`receipt_disputed`). Cash on delivery and the 48 h disputed-receipt timeout are unchanged.
- **`payment_not_received` on a disputed receipt** (overrides section 4.4): the receipt timer ends no sooner than 24 hours after the ruling.
- **Delivery fee in refunds** (PR 15): refunded only when one return takes back the whole order for a showroom fault (the reason makes the showroom pay the return shipping). Partial returns and changes of mind never include it.
- **Refund of a cancelled order** (follow-up PR after the stack merges): the showroom records that it paid the `refund_due` amount back and the buyer confirms; only then the payment becomes `refunded`. Money is never moved by the platform.
