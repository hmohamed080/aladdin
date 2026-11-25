# Marketplace — consolidated implementation plan (2026-11-21)

> **Status note (2026-11-25):** the line above is the 2026-11-21 state. Since then PRs 1-9 and the seller slug and stock-notification fixes are merged; Marketplace v2 is applied on Acceptance and Production (246 migrations); the public Marketplace is still "coming soon" on Production and ordering is off. PRs 10-15 (addresses, cart, checkout, order pages, timers, returns) are open drafts; see `marketplace-order-model-contract-20261124.md` (PR #260) and `docs/operations/RUNTIME_STATE.md`.

Status: **proposal for owner approval. Nothing is implemented.** Source of requirements: `marketplace-requirements-walkthrough-20261119.md` (Parts 1–4C) and `marketplace-returns-policy-options-20261121.md`.

Rules for every PR below: one PR = its own migration (if any) + code + tests; verified on the local isolated stack first; applied to Acceptance only after the owner approves that PR; Production only after Acceptance is verified, following the same process. No PR touches Production on its own.

## Phase 0 — independent foundations (no product decisions pending)

| PR | Scope | Migration |
|---|---|---|
| 1. R2 only | Remove the Supabase Storage fallback and read branch for marketplace; fail explicitly when R2 is off; delete the `R2_STORAGE_ENABLED` fallback paths. | none |
| 2. Media policy (site-wide) | Original kept but re-encoded: sRGB/ICC colour fidelity, strip personal metadata (EXIF GPS); per-file caps 10 MB image / 100 MB video, only the oversize file rejected; parallel multi-file drag-and-drop; video: delete original only after full verification (playlists, segments, audio, poster, playability), extra 720p rendition; rejected-image purge after 2 days. | small (retention/purge bookkeeping) |
| 3. Public/admin UI cleanup | Remove preview banners (except demo-data pages), sort dropdown + list/grid toggle, «II» dimension bug, wrong sentences, Arabic copy, breadcrumb «‹» + root «المتجر», rename «بيع/تأكيد» labels already agreed. | none |

## Phase 1 — admin (Parts 1–2)

| PR | Scope | Migration |
|---|---|---|
| 4. Notification templates | In-app templates stored AR+EN with variables, new managing permission; needed by later PRs (4, 5, 13, 14). | yes |
| 5. Seller approval v2 | «مرفوض» status; revoke («سحب») non-terminal then «اعتماد»; owner can send «طلب اعتماد»; reason required only for suspend/revoke/reinstate; internal reason + owner message (presets or custom); hover on «مؤهل = لا»; page renamed «المتجر». | yes |
| 6. Product review | Per-product review with image strip; tick/cross with reason; exclude single images; replacement keeps old live until new approved; no final rejection; owner notified only on rejection; remove `media_verification_ready` (verification always mandatory); page «مراجعة المنتجات». | yes |

## Phase 2 — publication gate and seller settings

| PR | Scope | Migration |
|---|---|---|
| 7. Publication gate v2 + product form | Remove readiness button and blockers table; missing conditions become required fields (red highlight only); name before type, type changeable with category following; «كود المنتج»; up to 5 media (1 video + 4 images or 5 images) with main-image choice; buttons «حفظ» / «حفظ كمسودة» / «معاينة»; suspended seller ⇒ auto-unpublish (manual republish after reinstatement); stock-out ⇒ withdrawn; per-product low-stock threshold; admin on/off switch for the public Marketplace, audited. | yes |
| 8. Seller delivery and payment settings | Preparation days, per-area fee + duration, per-area next-day option + fee, daily order cut-off time, free-shipping threshold or per-product flag, pickup/branch config; missing data blocks publishing. | yes |
| 9. Public catalog and product page v2 | Amazon-sized card: delivery estimate, free-shipping badge, «Only N left» from 3, no «متوفر»; filters updated (free shipping, delivery speed); product page gallery (large + vertical thumbnails, video), seller link, «المتجر الرسمي» for business-verified (blue badge), delivery-details block, variants; seller storefront page. Ratings postponed. | yes (catalog RPCs) |

## Phase 3 — buyer journey

| PR | Scope | Migration |
|---|---|---|
| 10. Addresses + phone verification | Saved addresses (smart search, Google map pin, Home/Work/Other tabs, recipient, verified mobile); reuse the existing WhatsApp phone authority; Google Maps billing account with budget alerts and quotas. | yes |
| 11. Cart and sign-in | Noon-style cart, guest cart persisted and merged after login, sign-in/sign-up modal back to the same cart, sold-out items marked and blocking, seller cannot buy from own showroom (DB rule + hidden button). | yes (self-purchase rule) |
| 12. New checkout and order model | Remove seller confirm/reject; delivery or branch pickup; COD / InstaPay / InstaPay deposit; receipt required BEFORE confirm (temporary upload bound to the checkout session); stock PENDING on arrival and deducted at end of preparation; thank-you page; checkout RPC v2 (idempotent, repriced). **Largest and riskiest PR; gets the heaviest testing.** | yes |

## Phase 4 — orders, timers, returns

| PR | Scope | Migration |
|---|---|---|
| 13. Order pages (buyer + seller) | Buyer «طلباتي» (search, period filter, progress bar, cancel before preparation, ETA, tracking number, timeline, reorder, contact seller, invoice); seller tabs (new, preparing, shipped, delivered, cancelled), «بدء التجهيز» flow, cancel with preset reasons, waybill/invoice printing, receipt review with «لم تصلني الفلوس». | yes (preset reasons, tracking) |
| 14. Timers, notifications, payment complaints | Seller reminder every 6 h and auto-cancel at 72 h (stock released); buyer disputed-receipt re-upload 48 h with reminder at 24 h; full in-app notification matrix; admin payment-complaint queue behind a grantable permission. | yes |
| 15. Returns and exchanges | Return tables, per-product non-returnable flag, evidence in R2, 14/30-day windows, seller 72 h then admin queue, refund via the buyer's original method confirmed by the buyer, admin returns permission, dispute record. **Launch gated on lawyer review of the Terms.** | yes |

## Dependencies

- PR 4 before 5, 6, 14, 15 (templates). PR 7 and 8 before 9 (data shown on cards). PR 10 and 11 before 12. PR 12 before 13, 14, 15.
- PRs 1–3 can start immediately and in parallel; 5/6 can run in parallel with 7/8.

## Not in this plan (deferred by the owner)

Ratings/reviews, discounts/coupons, best-seller ranking, multi-seller delivery calculation (pilot = one showroom), stock reservation timing beyond the pending-hold rule, seller storefront details beyond the basic page.

## Owner decisions still needed

1. Approve the order of phases (or reorder).
2. Google Maps billing account and monthly budget cap before PR 10.
3. Lawyer for the Terms before PR 15 launches.
4. Pilot showroom to enable first on Acceptance, then Production.
