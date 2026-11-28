# Marketplace requirements walkthrough — owner decisions (2026-11-19)

Status: **decisions only. Nothing below is implemented.** Each item needs its own migration + PR and the owner's explicit approval before it is applied to Acceptance or Production. Collected part by part in conversation with the owner; Part 4 (purchase journey) is still in progress.

## Part 1 — Seller approval (`/admin/marketplace`, renamed "المتجر" / "Marketplace")

- Hovering «مؤهل = لا» shows what is missing (organization not active, wrong type, deleted).
- A reason is required only for suspend, revoke («سحب», the button formerly «إلغاء») and reinstate; approve reason is optional.
- New status «مرفوض» with a reason; the admin can approve it later.
- Revoke is **not terminal**: after «سحب» an «اعتماد» button appears.
- The showroom owner can submit «طلب اعتماد» himself, also after a rejection.
- Two texts per transition: an internal admin reason (admins only) and an owner-facing message chosen from admin-managed presets (each with owner text) or a custom «أخرى» message.
- Notifications: in-app only, to the owner only. One base template per transition (approve, reject, suspend, reinstate, revoke), AR + EN, with variables such as {اسم_المعرض} {السبب}, managed by a NEW permission (not `marketplace_sellers.manage`).

## Part 2 — Product review (`/admin/marketplace/media`, renamed "مراجعة المنتجات" / "Product review")

- Review per product with its images inside, shown side by side in a scrollable strip so the admin sees all images before approving.
- ✓ on a product approves all its pending images; ✗ rejects all pending with one reason. Per-image ✓/✗ too. ✗ requires a reason (admin internal + owner message from presets/custom, same system as Part 1).
- No final rejection: a rejected image/product can be reconsidered and approved.
- Rejected images are kept 2 days, then purged from R2.
- Image replacement: the old image stays live until the new one is approved; if rejected the old one stays; when approved the old one is deleted (DB + R2).
- Remove the «عرض الصور للعامة» card (`media_verification_ready`); image verification is ALWAYS mandatory.
- The owner is notified ONLY on image/product rejection (not on approval).
- Remove admin banners (e.g. «مخطط واجهة الإدارة — معاينة») everywhere EXCEPT pages that still show demo data (analytics, points, settings …).

## Part 3 — Publication gate, product page, media

Gate and flags
- Remove the «فحص جاهزية النشر» button and the blockers box/table. Once the admin approves a product, publishing is available to the seller automatically.
- Every missing publish condition becomes a required field (payment method enabled, delivery areas or pickup configured, stock, main image …), mostly collectable on `/showroom/marketplace/products/new`. Missing required fields are highlighted red; the text banner «حقول مطلوبة للنشر لم تُملأ بعد…» is removed.
- The products list (`/showroom/marketplace/products`) shows a status record beside the price (approved / pending review / …).
- Admin on/off switch to open or close the public Marketplace, audited with the acting admin.
- Production follows the same process as Preview (enable on Production only after verifying on Preview).
- Seller suspended: products are automatically UNPUBLISHED («غير منشور») and disappear at once. After reinstatement they stay unpublished and the seller republishes manually.
- Stock out: the product is withdrawn from the storefront. Showroom notifications: on each sale from the store, low-stock reminder, and out-of-stock. The low-stock threshold is set by each seller per product.
- Storage is **R2 only**: the Marketplace fails explicitly instead of falling back to Supabase; every Supabase Storage upload/read path is removed.

Product page
- Product name before product type; product type is freely changeable and the category follows automatically.
- SKU shown beside its field in a faint colour; Arabic label «كود المنتج» (not SKU).
- Review the Arabic copy and the spacing above and below the page.
- Buttons: «حفظ» (replaces «حفظ والعودة للمنتجات»), «حفظ كمسودة», «معاينة». «حفظ كمسودة» saves as draft and returns to `/showroom/marketplace/products`, validating all required fields.

Media (site-wide policy — applies to the WHOLE website, portfolio included)
- Up to 5 slots: 1 video + 4 images, or 5 images; the seller picks the main storefront image. Caps: image 10 MB, video 100 MB. Rejection is per file: only the oversize file is refused, the rest of the batch (images + video) still uploads. Drag & drop uploads everything together.
- Images: stored original is re-encoded (target quality ~90, long edge ≤ 2560 px, no upscaling). Size reduction is an estimate, not a guarantee. Colour fidelity is critical (marble/wood/decor swatches): convert non-sRGB to sRGB, keep the ICC profile when needed, full chroma (4:4:4), strip personal EXIF (GPS, device) while keeping orientation. Acceptance test: ΔE comparison on real samples before the numbers are final. Variants thumb 320 / card 768 / full 1600 stay.
- Video: delete the original only after the whole processing is verified (HLS playlists and segments, audio, poster, playability). H.264 CRF ~22, max 1080p/30fps, AAC 128k, plus an extra 720p HLS rendition for weak connections, short segments (~4 s) so playback and seeking do not stall. Acceptance test: throttled-network playback.

## Part 4 — Purchase journey and cart (stage 4A in progress; 4B cart + checkout and 4C post-order pending)

Stage 4A — store grid card (`/market`)
- Use Amazon card dimensions; the grid view is the only layout (remove the list/grid toggle and the sort dropdown).
- Remove the «متوفر» label and «يباع من …». Show "Only N left in stock – order soon" (AR) from 3 units or fewer.
- Show an estimated delivery window, a free-shipping badge, and rating + rating count (ratings are deferred, see below).
- Filters: remove «المتوفر فقط»; update the filters to match the new card information.
- Out-of-stock and no-image states do not appear on the main page; stock state is visible on the seller page. The seller is named on the product page, with a link to a seller storefront page listing all their products (design later).
- Remove «الأسعار غير شاملة الضريبة ·».
- Delivery estimate: the seller sets preparation days and, per area, the delivery fee and duration; the site shows "arrives in X–Y days".
- Free shipping: the seller sets a minimum order value above which shipping is free (per area or for all areas), or marks individual products as free-shipping.
- Ratings: only after delivery of the buyer's order, tied to a real purchase; moderation, seller replies and removal of abusive reviews form a separate system, postponed until the current edits are done.
- A seller with missing delivery data cannot publish a product.

Stage 4A — product page (`/market/products/[slug]`)
- Breadcrumb separated by a "‹" icon; the root label «الماركت» becomes «المتجر».
- Gallery like Amazon/Noon: large preview image with a vertical thumbnail strip (images and video).
- Remove the sentence «الشراء عبر الإنترنت غير متاح بعد. تواصل مع المعرض للطلب والاستفسار.»
- Remove the small line «كرانيش · يباع من Nile Interiors»; the seller appears as a link above the product name (like "سامسونج ›"), opening the seller page.
- Official Store: a showroom approved AND holding the blue (verification) badge shows an «المتجر الرسمي» / "Official Store" label on the product page, clickable to the seller page listing all its products (Noon-style).
- Fix the dimension values (Length / Height / Width currently render as «II»).
- Add a delivery-details block (Noon/Amazon reference): "get it by <date>", order-within countdown cut-off, and an expandable "faster delivery options" (e.g. next day for an extra fee, chosen at checkout).
- Variant products get selectors for their options (colour, size …).
- The blue badge IS the existing business-verification state. Each seller sets, per area, an optional next-day option and its extra fee; each seller sets a daily order cut-off time (e.g. "until 2 pm") that drives the "order within" countdown (new seller settings). Discounts, "lowest price in 30 days", best-seller rank and coupons are OUT of scope. Stage 4A is closed.

Stage 4B — cart (`/market/cart`)
- Redesign like Noon's cart: seller-grouped item card (image, title, variant chip such as colour, delivery date + order-within countdown, "only N left in stock", quantity stepper with delete) on one side; order summary (subtotal, shipping fee or "free", total), a prominent checkout button, and a promo/coupon area on the other. Reference design supplied by the owner (Noon).
- Delivery details UI to be reviewed, including every defect in the dropdown (select) styling (province / area selects render dark with grey text).
- Remove the trust strip (four reassurance cards).
- Reservation/stock-holding rules are NOT approved: deferred until their UI stage; the owner wants a workflow like Amazon/Noon.
- Sign-in is requested when the buyer presses the checkout button («صفحة الدفع»), not afterwards.
- Per-cart delivery calculation for multi-seller carts is deferred: the pilot runs with ONE selling showroom.
- Guest cart stays with the visitor before sign-in and migrates to the account after sign-in. An item that sells out while in the cart stays visible marked «لم يعد متاحاً» (Noon-style) and checkout is blocked until it is removed or its quantity is adjusted.

Stage 4B — buyer journey from the cart to the thank-you page (owner decisions, 2026-11-21; references: Noon sign-in modal, address modal, checkout and Noon/Amazon order-confirmed page)
- Guest cart: a seller can never buy from his own showroom (enforced in the database at placement, and the add-to-cart button is hidden/blocked on his own products).
- Pressing «صفحة الدفع» as a guest opens a Noon-style "هيا لنبدأ" modal with «تسجيل الدخول | اشترك الآن». Sign-up fields: mobile number or email, password, name, account type. After sign-in/sign-up the buyer returns to the SAME cart page and presses «صفحة الدفع» again.
- No saved location: a «تسليم إلى» step opens: (1) smart location search with recommendations (must be genuinely helpful and tolerant: Arabic/English, typos, neighbourhood and landmark names); (2) a Google map to confirm the place, move the pin and confirm; (3) address details form (tabs Home / Work / Other with apartment-floor, building, street, nickname, directions, recipient first/last name, mobile number); save and return to the cart.
- No verified mobile: the number given with the location must be verified (code) before checkout.
- Location + verified mobile present: «صفحة الدفع» opens the checkout page (the current checkout page is rejected). Noon-style layout with these changes: choose between 1) «تسليم إلى» (with edit address) and 2) pickup from the branch; «ادفع باستخدام»: cash on delivery, InstaPay, InstaPay deposit («عربون»); for InstaPay / deposit the buyer must upload the transfer receipt BEFORE the order is confirmed; then «تأكيد الطلب».
- After confirmation: a thank-you page greeting the buyer by name ("شكراً على طلبك يا أحمد!") with Noon/Amazon patterns (order number, progress, address, payment method, summary); the order reaches the seller to prepare; then order-tracking and preparation stages up to delivery (stage 4C).
- Self-purchase rule, extended: if a seller added items to the cart as a guest and then signs in, checkout cannot continue for his own products (blocked at checkout and in the database). Placing/confirming an order notifies the seller (in-app notification).
- Maps: Google Maps (map + Places search) is accepted; needs a Google Cloud billing account with a card; since 2025-03 free usage is per SKU per month (Essentials SKUs 10,000 calls) — set budget alerts and API quotas before enabling.
- Stage 4C (buyer pages) shown 2026-11-21: «طلباتي» list and order detail (items, delivery/pickup, InstaPay deposit box with receipt upload, history log, cancel button). Edits pending from the owner.
- 4C buyer decisions: «طلباتي» uses the Noon "Orders" page layout (title, product search, period filter such as "last 3 months", Noon-style empty state). Visual progress bar: placed → preparing → shipped → delivered (Noon/Amazon style). Cancel is allowed only before the order is prepared/processed. Orders show product images, expected delivery date, shipment tracking number, the full timeline with timestamps, no stale "5 MB" text, correct signed-in header, «إعادة الطلب», «تواصل مع المعرض» and an invoice, and use the saved address/phone.
- NEW order model: after the buyer confirms, the order goes to the seller to PREPARE — the seller no longer confirms/approves or rejects it (the old confirm/reject step is removed).
- InstaPay problem flow: while preparing, if the seller reviews the receipt and the money did not arrive, the seller sends the buyer a notification to check the transfer and optionally re-upload the receipt; this also reaches the ADMIN, who reviews the case (new admin review queue) in case of any problem.
- Payment-dispute admin review: the admin does NOT enter every case; only when a complaint is filed. Handling it is a PERMISSION the owner grants to chosen admins.
- Seller cannot prepare an order (e.g. out of stock): may CANCEL it with a reason picked from preset options (or custom) so the buyer notification stays mostly uniform.
- Stock timing: when the order reaches the seller the units become PENDING (held, nobody else can order them, no last-unit race); stock is deducted when preparation is finished.
- Open: auto-cancel timeouts under the new model (seller does not start preparing; buyer does not re-upload a disputed receipt); returns and exchanges policy (to be studied); seller order pages and notifications being reviewed.
- Timeouts (owner, 2026-11-21): seller does not start preparing → reminder every 6 hours, automatic cancellation after 72 hours (stock released); buyer does not re-upload a disputed InstaPay receipt → automatic cancellation after 48 hours with a reminder at 24 hours.
- Seller order pages redesign (accepted proposals): remove «تأكيد الطلب» and the «بانتظار التأكيد» tab; actions become «بدء التجهيز» → «جاهز للشحن/الاستلام» → «تم الشحن» → «تم التسليم»; tabs: جديد · قيد التجهيز · تم الشحن · تم التسليم · ملغي; product images, delivery address for delivery orders, print waybill/invoice; receipt review + «لم تصلني الفلوس» button; search and date filter; the self-purchase case is blocked.
- Notification matrix accepted: new order → seller; reminder for an order not started → seller; buyer cancels → seller; preparing/shipped/delivered → buyer; seller cancels (preset reason) → buyer; «لم تصلني الفلوس» → buyer; payment complaint → authorised admins; low or out of stock → seller. In-app only.
- Returns & exchanges: separate options paper — docs/product/marketplace-returns-policy-options-20261121.md.
- Owner asked for an AUDIT of the previous checkout implementation, which he dislikes (findings in the session report; key points: no self-purchase block, free-text address with static governorate/area lists and no map, phone only format-checked, receipt uploaded only AFTER the order exists, no full-InstaPay method, thank-you shown inline on the checkout page, marketplace header ignores sign-in state, cart only in the browser's localStorage).

## Deferred
- Other gates until after the purchase journey and cart stage.
- Ratings/reviews system and the seller storefront page design.
- Open: pending-order reservation timeout, cart behaviour for guests and for items that sell out, buyer notifications.

## Returns & exchanges — owner decisions (2026-11-21)

Full paper: `marketplace-returns-policy-options-20261121.md`.
- Policy table accepted as recommended: 14 days general / 30 days defects (seller may offer more, never less); per-product non-returnable flag («مصنوع حسب الطلب») with disclosure before payment; unused condition; buyer evidence (48 h for visible transit damage); return shipping by seller for defect/wrong item and by buyer for change of mind; refund or exchange; 7-day refund deadline.
- Refund method: through the SAME method the buyer paid with (more payment methods will be added later); seller executes, buyer confirms.
- Seller response window 72 h; on silence NO auto-approval: the case goes to the admin returns queue, and the admin reminds the seller or decides with them.
- Aladdin guarantee: none; only the workflow and the dispute record.
- Open: lawyer review of the Terms before launch.
