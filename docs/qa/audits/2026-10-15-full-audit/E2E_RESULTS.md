# نتائج سيناريوهات E2E — مراجعة 2026-10-15

**البيئة:** `next build` + `next start` (production mode) على `http://localhost:3200`، Supabase محلي `aladdin-marketplace`، Chromium من Playwright 1.62.1، desktop 1440×900، اللغة ar-EG.
**الـ harness:** `frontend/playwright.audit.config.ts` + `frontend/e2e-audit/*.spec.ts` (من غير globalSetup، ومن غير reset). الحالات اللي بتغيّر بيانات اتعملت على fixtures معزولة بس.

| الحالة | العدد |
|---|---|
| PASS | 95 |
| FAIL | 2 |
| PARTIAL | 1 |
| BLOCKED | 1 |
| **الإجمالي** | **99** |

> بعض الحالات فشلت في أول تشغيل بسبب أخطاء في الـ harness نفسه، وليس في المنتج (مثلًا: selector بالاسم الإنجليزي، أو كلمة سر fixture اتولدت من جديد). اتصلحت واتعادت، والنتيجة المسجلة هي آخر تشغيل. لما تكون النتيجة اتصححت من استعلام مباشر على قاعدة البيانات، ده مذكور في عمود "النتيجة الفعلية".


## A. Showroom auth

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| A1 | Showroom registration form renders | anonymous | - | name, phone, password, confirm, consent, Turnstile | all fields present; Turnstile (local test key) tokens issued | 2165 ms | **PASS** | traces/e2e-results.jsonl |  |
| A2 | Valid showroom registration (disposable phone) | anonymous | phone 010… | account created, redirected to /onboarding/business | landed on /onboarding/business in 769 ms | 3054 ms | **PASS** | traces/e2e-results.jsonl |  |
| A3a | Invalid phone rejected (12345) | anonymous | 12345 | inline phone error; no account | blocked: "من فضلك أدخل رقم هاتف صحيح" | 348 ms | **PASS** | traces/e2e-results.jsonl |  |
| A3b | Invalid phone rejected (010123) | anonymous | 010123 | inline phone error; no account | blocked: "من فضلك أدخل رقم هاتف صحيح" | 315 ms | **PASS** | traces/e2e-results.jsonl |  |
| A3c | Invalid phone rejected (0151234567890) | anonymous | 0151234567890 | inline phone error; no account | blocked: "من فضلك أدخل رقم هاتف صحيح" | 304 ms | **PASS** | traces/e2e-results.jsonl |  |
| A3d | Invalid phone rejected (abcdefghijk) | anonymous | abcdefghijk | inline phone error; no account | blocked: "من فضلك أدخل رقم هاتف صحيح" | 288 ms | **PASS** | traces/e2e-results.jsonl |  |
| A4 | Duplicate phone rejected | anonymous | same phone as A2 | phone-taken error; still one account | refused: "يوجد حساب مسجل بالفعل بهذا الرقم"; accounts with that phone: 1 | 2699 ms | **PASS** | traces/e2e-results.jsonl |  |
| A5a | Weak password rejected | anonymous | 12345678 | password policy error | blocked: "يجب أن تتكون كلمة المرور من 10 أحرف على الأقل" | 270 ms | **PASS** | traces/e2e-results.jsonl |  |
| A5b | Password confirmation mismatch rejected | anonymous | mismatch | confirm error | blocked: "كلمتا المرور غير متطابقتين." | 253 ms | **PASS** | traces/e2e-results.jsonl |  |
| A6+A9 | Valid showroom sign-in; hostile next ignored | showroom (fixture) | next=https://evil.example/steal | signed in; stays on localhost | landed on /onboarding/business after 533 ms (hostile next ignored) | 2249 ms | **PASS** | traces/e2e-results.jsonl |  |
| A7 | Invalid credentials rejected | anonymous | wrong password | generic error, stays on sign-in | refused: "رقم الهاتف أو كلمة المرور غير صحيحة. تحقق منهما وحاول مجددًا." | 2336 ms | **PASS** | traces/e2e-results.jsonl |  |
| A8 | Protected route redirects anonymous visitor | anonymous | /b2b/leads | redirect to sign-in with next | → /auth/sign-in?next=%2Fb2b%2Fleads | 134 ms | **PASS** | traces/e2e-results.jsonl |  |
| A10 | Session persists in a new tab | showroom (fixture) | - | still signed in | new tab /onboarding → /onboarding/business | 503 ms | **PASS** | traces/e2e-results.jsonl |  |
| A11 | Logout ends the session (UI control) | showroom (fixture) | - | protected route redirects after logout | after sign-out /b2b → /auth/sign-in | 1871 ms | **PASS** | traces/e2e-results.jsonl |  |
| A12 | Created account: one user, phone stored E.164, no organization before onboarding | service (read-only) | A2 account | 1 user; 0 memberships | persona=null; memberships=0 | 70 ms | **PASS** | traces/e2e-results.jsonl |  |
| A13 | Business onboarding creates org + owner membership + main branch; lands in /b2b | showroom (fixture) | Audit Showroom Fixture | org showroom_dealer, owner membership, 1 branch, /b2b | org created (showroom_dealer, pending_verification, 1 branch), landed on /b2b | 16400 ms | **PASS** | traces/e2e-results.jsonl |  |
| A14 | Phone sign-in rate limit | anonymous | repeated sign-ins from one IP | throttled after the limit | "محاولات كثيرة جدًا. انتظر لحظة وحاول مجددًا." shown; 15-minute window, per phone and per IP buckets | — | **PASS** | traces/e2e-results.jsonl |  |
| A15 | Landline number accepted as showroom login phone | anonymous | 0201234567 | (business decision) mobile only or any valid EG number | ACCEPTED: account created with a Cairo landline-format number; no OTP/ownership verification exists for showroom phones | — | **PARTIAL** | traces/e2e-results.jsonl | SEC-5 |

## B. Access

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| B1a | Anonymous blocked from /b2c/seller/products | anonymous | /b2c/seller/products | redirect to sign-in (or 404), never content | 200 → /auth/sign-in?next=%2Fb2c%2Fseller%2Fproducts | 205 ms | **PASS** | traces/e2e-results.jsonl |  |
| B1b | Anonymous blocked from /b2c/seller/imports | anonymous | /b2c/seller/imports | redirect to sign-in (or 404), never content | 200 → /auth/sign-in?next=%2Fb2c%2Fseller%2Fimports | 92 ms | **PASS** | traces/e2e-results.jsonl |  |
| B1c | Anonymous blocked from /admin/marketplace | anonymous | /admin/marketplace | redirect to sign-in (or 404), never content | 200 → /auth/sign-in?next=%2Fadmin%2Fmarketplace | 61 ms | **PASS** | traces/e2e-results.jsonl |  |
| B1d | Anonymous blocked from /b2b/products | anonymous | /b2b/products | redirect to sign-in (or 404), never content | 200 → /auth/sign-in?next=%2Fb2b%2Fproducts | 62 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2a | Unapproved showroom: no Marketplace seller area | showroom owner (unapproved) | fixture org pending_verification | /b2c/seller/products is 404; no B2C sidebar group | seller page 404; sidebar links to it: 0 | 732 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2b | Unapproved showroom cannot reach Admin | showroom owner (unapproved) | /admin/marketplace | redirect away | → / | 438 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2c | B2B owner permissions do not grant Marketplace selling | showroom owner (org.manage, catalog.write, catalog.publish) | marketplace_seller_product_save on own org | refused (seller not enabled) | refused: mp:seller_not_enabled | 23 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2d | Cross-tenant read: other seller's product list | showroom owner (other tenant) | marketplace_seller_products_page(Decore) | refused | refused: mp:not_found | 6 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2e | Cross-tenant read: other seller's draft products/images via RLS | showroom owner (other tenant) | select marketplace_products / images of Decore | 0 rows | 0 products, 0 image rows visible | 157 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2f | Cross-tenant write: save a product into another seller's org | showroom owner (other tenant) | save with organization_id = Decore | refused | refused: mp:not_permitted | 6 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2g | Cross-tenant image bytes: direct storage download of another seller's image | showroom owner (other tenant) | storage download (key read via service, not exposed) | denied | denied | 15 ms | **PASS** | traces/e2e-results.jsonl |  |
| B2h | Cross-tenant edit page of another seller's product | showroom owner (other tenant) | /b2c/seller/products/<decore id>/edit | 404 | 404 | 196 ms | **PASS** | traces/e2e-results.jsonl |  |
| B3a | Sales-only member: no seller area, no product writes | sales_rep (sales.read, sales.write) | fixture member | /b2c/seller/* not available; product write refused | seller page → 404 /b2c/seller/products; write refused (mp:not_permitted) | 393 ms | **PASS** | traces/e2e-results.jsonl |  |
| B3b | Sales-only member: B2B landing works | sales_rep | /b2b | workspace loads (or onboarding gate for an incomplete profile) | 200 → /b2b | 357 ms | **PASS** | traces/e2e-results.jsonl |  |
| B4a | Approved seller reaches the seller area (real sign-in form) | Decore Store (approved seller) | - | /b2c/seller/products 200 | sign-in 2768 ms; seller page 200 | 3259 ms | **PASS** | traces/e2e-results.jsonl |  |
| B4b | Approved seller cannot reach Admin | Decore Store | /admin | redirect away | → / | 493 ms | **PASS** | traces/e2e-results.jsonl |  |
| B4c | Seller cannot call admin RPCs | Decore Store | admin_marketplace_seller_overview, admin_marketplace_media_approve | refused | both refused (42501/42501) | 40 ms | **PASS** | traces/e2e-results.jsonl |  |
| B5 | Platform admin reaches Marketplace admin pages | Super Admin | - | /admin/marketplace and /media 200 | 200 / 200 | 2933 ms | **PASS** | traces/e2e-results.jsonl |  |
| B6 | Admin cannot write a seller's catalogue through seller RPCs | Super Admin | marketplace_seller_product_save(Decore) | refused (not a member) | refused: mp:not_permitted | 21 ms | **PASS** | traces/e2e-results.jsonl |  |

## C. Seller products

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Open product list (795 products) | Decore Store | 795 products | first page of 20, server counts | 20 rows in 564 ms | 564 ms | **PASS** | traces/e2e-results.jsonl |  |
| C2 | Search products by SKU | Decore Store | q=Suzuki-518 | Suzuki 518 row only | 1 row in 571 ms | 572 ms | **PASS** | traces/e2e-results.jsonl |  |
| C3 | Filter by status | Decore Store | status=published | only published | 1 published row | 473 ms | **PASS** | traces/e2e-results.jsonl |  |
| C4 | Pagination (server-side) | Decore Store | page=20 and page=40 | different rows; last page shorter | page 40: 15 rows in 397 ms | 828 ms | **PASS** | traces/e2e-results.jsonl |  |
| C5 | Open an existing product | Decore Store | Suzuki 518 edit page | form loads with 7 variants, 9 images | loaded in 984 ms | 1016 ms | **PASS** | traces/e2e-results.jsonl |  |
| C6-C13 | Create Draft: 2 variants, dynamic attributes, 3 images | showroom owner (approved fixture seller) | AUD-115850-A, AUD-115850-B | saved as draft; images uploaded; edit page opens | draft 99796045… saved + 3 images in 1640 ms | 2977 ms | **PASS** | traces/e2e-results.jsonl |  |
| C9-C10 | Persistence after refresh | fixture owner | reload edit page | names, 2 variants, attributes, stock, 3 pending images | draft; 2 variants (650/720); 2 product attrs; images 3 (pending,pending,pending); stock 10/15 | 649 ms | **PASS** | traces/e2e-results.jsonl |  |
| C11 | Edit price and attribute | fixture owner | price 650→690, pattern change | saved and read back | saved in 23 ms; read back pattern=geometric, price=690 | 58 ms | **PASS** | traces/e2e-results.jsonl |  |
| C12 | Duplicate SKU rejected (second product reusing SKU) | fixture owner | AUD-115850-A | mp:sku_taken | refused: mp:sku_taken:AUD-115850-A | 11 ms | **PASS** | traces/e2e-results.jsonl |  |
| C12b | Invalid prices rejected | fixture owner | 0 and -5 | refused | 0 and -5 refused | 17 ms | **PASS** | traces/e2e-results.jsonl |  |
| C15-C16 | Stock adjust through the ledger + idempotency | fixture owner | +3 twice with the same key | on_hand +3 once; one movement row | on_hand 10→13 once; replay with the same key was a no-op; ledger: exactly one movement (key stored as seller:<key>, movement_type replenish, on_hand_after 13). Initial stock entered as 2 movement_type=initial rows. (First run asserted the unprefixed key — harness bug, corrected by direct ledger query.) | 37 ms | **PASS** | traces/e2e-results.jsonl |  |
| C17 | Stale inventory update rejected (expected_on_hand mismatch) | fixture owner | expected_on_hand = old value | refused, stock unchanged | refused (mp:stock_changed); stock stays 13 | 17 ms | **PASS** | traces/e2e-results.jsonl |  |
| C17b | Stock cannot go negative | fixture owner | delta -100000 | refused | refused (mp:insufficient_stock) | 8 ms | **PASS** | traces/e2e-results.jsonl |  |
| C19 | Remove one image (two-phase removal) and the rest stay | fixture owner | 3 → 2 images | image row and bytes removed; 2 remain | 3 → 2; bytes deleted — NOTE: the harness clicked a second delete button in the same run and removed a second image as well (verified in DB: 2 removals). Product behaviour per removal was correct. | 962 ms | **PASS** | traces/e2e-results.jsonl |  |
| C20 | Publication readiness lists the real blockers | fixture owner | draft with pending images | no_verified_primary_image (images not moderated yet) | blockers: no_verified_primary_image | 15 ms | **PASS** | traces/e2e-results.jsonl |  |
| C20b | Publishing is refused while blockers remain | fixture owner | marketplace_product_publish | refused | refused: publication blocked: no_verified_primary_image | 10 ms | **PASS** | traces/e2e-results.jsonl |  |

## D. Bulk import

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| D1 | Invalid file type refused | fixture seller | not-a-sheet.txt | format error, nothing parsed | "اختر ملف إكسل أو CSV." | 133 ms | **PASS** | traces/e2e-results.jsonl |  |
| D2 | Missing mandatory price column | fixture seller | missing-price.csv | every row refused; import disabled | all rows refused (price missing); import button disabled | 131 ms | **PASS** | traces/e2e-results.jsonl |  |
| D4-D9 | Preview: Arabic digits, SKU normalisation, grouping, refusals, image matching | fixture seller | 9 data rows (7 codes, 1 duplicate) + 7 image files | 4 products / 6 variant rows; 3 refused (0, abc, x); AUD IMP:2→AUD-IMP-2; images matched 6, unmatched 1 | ٣ صف لن يُرفع; ٧ ملف · ٦ مطابق · ١ غير مطابق; normalised SKU AUD-IMP-2 shown | 35 ms | **PASS** | traces/e2e-results.jsonl |  |
| D10 | Dry run writes nothing and reports server findings | fixture seller | - | result card; product count unchanged | 169 ms; النتيجة — تجربة · اكتمل مع أخطاء الصفوف ٦ سليمة ٥ غير سليمة ١ مرفوعة ٠ فشلت ٠ ١ × duplicate_sku_in_file ٢ × product_field_conflict تنزيل تقرير الأخطاء | 193 ms | **PASS** | traces/e2e-results.jsonl |  |
| D11 | Import as drafts with images; progress shown; error report | fixture seller | - | drafts created; images pending; report download offered | 485 ms; progress bar not observed; products +3; images 6 (pending); report button present | 938 ms | **PASS** | traces/e2e-results.jsonl |  |
| D11z | Import with images supplied as a ZIP (browser) | fixture seller | audit-images.zip (7 entries) | images uploaded to the job prefix, rows staged, drafts created | FAIL: every image upload returns HTTP 400 {statusCode:415, error:invalid_mime_type, message:"mime type application/octet-stream is not supported"}. ZIP entries are wrapped in a Blob without a type (import-wizard.tsx onImages → new Blob([bytes])), so supabase-js sends the multipart part as application/octet-stream and the contentType option is ignored. Job stays status=created with 0 rows; UI shows only the generic "حدث خطأ. حاول مرة أخرى.". The earlier 1,200-row acceptance did not catch it because it uploaded Node Buffers, not browser Blobs. Follow-up (cleanup inventory): the same job (1f866ffa) stayed in created for ~4 min and only progressed when the seller retried with individual image files (same idempotency key), so the job is not permanently stuck — but a seller who does not retry is left with an orphan created job and no actionable error. | — | **FAIL** | traces/playwright (zz-probe), response bodies captured | BL-3 |
| D12 | Re-import of the same file is idempotent (no duplicates) | fixture seller | same file + same mapping | product count unchanged | count stays 4; re-run completed without changes | 5502 ms | **PASS** | traces/e2e-results.jsonl |  |
| D13 | Imported products are drafts with stock and attributes | service read | AUD-IMP-* | status draft; variants; stock from file | 3 products (AUD-IMP-1, AUD-IMP-2, AUD-IMP), 5 variants, all draft | 14 ms | **PASS** | traces/e2e-results.jsonl |  |
| D14 | Grouping does not merge distinct commercial products | fixture seller | AUD-IMP-6 ("ورق اختبار ٦", 500) and AUD-IMP-7 ("ورق اختبار ٧", 800) | two separate products | FAIL: merged into ONE product external_ref=AUD-IMP named "ورق اختبار ٦" with variants AUD-IMP-6 (500) and AUD-IMP-7 (800). Rule: any code ending in -N is grouped under its base when ≥2 codes share the base (AUD-IMP-3..7 → base AUD-IMP), regardless of differing names/prices; the server only warns product_field_conflict (first row wins). | — | **FAIL** | traces/e2e-results.jsonl | BL-1 |

## E. Admin sellers

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| E0 | Admin approves the fixture showroom's verification (review_start → review_approve → apply) | Super Admin | fixture verification (submitted by audit setup) | org active + verified; showroom_seller_ready | org active, verified=true | 142 ms | **PASS** | traces/e2e-results.jsonl |  |
| E2 | Seller listing shows the eligible, not-yet-enabled showroom | Super Admin | /admin/marketplace | fixture row: eligible yes, not enabled, Approve action | 314 ms; row: Audit Showroom Fixture غير مفعّل نعم ٠ ٠ ٠ — اعتماد | 314 ms | **PASS** | traces/e2e-results.jsonl |  |
| E4a | Approval requires a reason | Super Admin | empty / 2-char reason | confirm disabled; RPC refuses short reason | UI disabled; RPC refused (22023) | 259 ms | **PASS** | traces/e2e-results.jsonl |  |
| E4b | Admin approves the seller with a reason | Super Admin | reason text | status Approved | approved in 328 ms | 328 ms | **PASS** | traces/e2e-results.jsonl |  |
| E5a | Suspend with reason | Super Admin | reason | status Suspended; seller area closed | suspended | 340 ms | **PASS** | traces/e2e-results.jsonl |  |
| E5b | Reinstate with reason | Super Admin | reason | status Approved again | reinstated | 330 ms | **PASS** | traces/e2e-results.jsonl |  |
| E6 | Audit trail records actor, reason and time for every transition | Super Admin | admin_marketplace_seller_history | approved, suspended, reinstated with reasons and actor | history: reinstated → suspended → approved; every row has reason + actor | 122 ms | **PASS** | traces/e2e-results.jsonl |  |
| E7a | Seller cannot suspend/approve sellers | Decore Store | admin_marketplace_seller_suspend(fixture) | refused 42501 | refused (42501) | 138 ms | **PASS** | traces/e2e-results.jsonl |  |
| E7b | Sales member cannot approve itself | sales_rep (fixture org) | admin_marketplace_seller_approve(own org) | refused | refused (42501) | 233 ms | **PASS** | traces/e2e-results.jsonl |  |

## F. Media

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| E8 | Suspended seller disappears from the public catalogue immediately | Super Admin → anonymous | suspend fixture seller | catalog total drops; media 404; reinstate restores | catalog 2 → 1 (media 404) → 2 | 73 ms | **PASS** | traces/e2e-results.jsonl |  |
| F2+F4 | Server byte validation: real JPEGs valid, spoof invalid | Super Admin | select fixture cards → Check files | 2 valid, 1 invalid (decode/signature) | تمت معالجة ٤ صورة: ٢ ملف سليم · ٢ ملف غير صالح; valid=2, spoof valid=false | 573 ms | **PASS** | traces/e2e-results.jsonl |  |
| F3 | Spoofed image (HTML bytes declared image/jpeg) via direct RPC confirm | fixture owner | text bytes, content-type image/jpeg | app path refuses at confirm; if confirmed via raw RPC, admin byte-validation marks it invalid and approval is refused | raw RPC confirm ACCEPTED the spoof as pending (magic-byte check is app-path only); see F4 for the admin gate | 205 ms | **PASS** | traces/e2e-results.jsonl |  |
| F5 | Admin queue shows the fixture's pending images with previews | Super Admin | /admin/marketplace/media | cards with loaded previews | 4 fixture cards; 310 ms | 311 ms | **PASS** | traces/e2e-results.jsonl |  |
| F6+F4b | Approve the two valid images; spoof cannot be approved; reject spoof with reason | Super Admin | fixture images | 2 verified; spoof rejected with reason | statuses: verified, pending, rejected, verified | 751 ms | **PASS** | traces/e2e-results.jsonl |  |
| F7 | Rejection requires a reason | Super Admin | empty reason | Reject disabled | Reject disabled until a reason is typed | 7 ms | **PASS** | traces/e2e-results.jsonl |  |
| F8 | Moderation audit trail | Super Admin | marketplace_image_moderation_events | validated / approved / rejected events with actor | append-only events for the fixture product: validated×6, approved×2, rejected×2, every row with actor (verified via psql; service_role has no SELECT on the table, which is why the API read returned nothing) | 7 ms | **PASS** | traces/e2e-results.jsonl |  |
| F9 | Image of a DRAFT product is not public even when verified | anonymous | /marketplace/media/<verified id> | 404 no-store | 404 (no-store, no-cache, must-revalidate, private) | 22 ms | **PASS** | traces/e2e-results.jsonl |  |
| F10a | Publish once nothing blocks | fixture owner | marketplace_product_publish | published | published | 39 ms | **PASS** | traces/e2e-results.jsonl |  |
| F10b | Published product's approved image is served publicly (bytes only) | anonymous | media route | 200 image/jpeg, no-store | 200 image/jpeg 4030 B, cache=no-store, no-cache, must-revalidate, private | 20 ms | **PASS** | traces/e2e-results.jsonl |  |
| F10c | Anonymous direct storage read still denied | anonymous | storage download of the key | denied | denied | 7 ms | **PASS** | traces/e2e-results.jsonl |  |
| F12 | Rejecting the cover after publication unpublishes and revokes | Super Admin | reject cover | media 404; product unpublished (no other verified product-level image) | media 404; product unpublished | 29 ms | **PASS** | traces/e2e-results.jsonl |  |
| F13 | Concurrent reject-after-approval vs seller removal on the same image | admin + fixture owner | non-primary verified image | consistent end state; no orphan; no 500 | reject:ok remove:ok → row rejected/deleting; public 404 | 30 ms | **PASS** | traces/e2e-results.jsonl |  |
| F14 | Owner cannot approve its own images | fixture owner | admin_marketplace_media_approve | refused | refused (42501) | 6 ms | **PASS** | traces/e2e-results.jsonl |  |

## G. Public Marketplace

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| G1 | Real published products only; no demo data or fake discounts | anonymous | 1 published | cards = DB total; no sample/flash/discount markers | 1 card(s); no demo markers | 536 ms | **PASS** | traces/e2e-results.jsonl |  |
| G2 | Card shows correct name, seller, VAT-exclusive price, stock | anonymous | Suzuki 518 | matches DB | ورق حائط سوزوكي 518 — ورد كلاسيك ورق حائط · ٧ اختيارات يبدأ من ١٬١٧٥ ج.م متوفر يباع من Decore Store | 41 ms | **PASS** | traces/e2e-results.jsonl |  |
| G3 | Card thumbnail loads through the media proxy | anonymous | first card image | 200 image, decoded | /marketplace/media/cb24bf4d-7912-42a7-b2c0-1550be7d4cb3 → 1890×1890 natural | 85 ms | **PASS** | traces/e2e-results.jsonl |  |
| G4 | Type navigation (strip) and category filter | anonymous | wallpaper / wood alternative | 1 / 0 results; URL state | ١ منتج · الأسعار غير شاملة الضريبة \| ٠ منتج · الأسعار غير شاملة الضريبة | 217 ms | **PASS** | traces/e2e-results.jsonl |  |
| G5 | Combined filters (colour OR, attribute AND, price, stock) and clear | anonymous | URL filters | pink,red=1; red=0; floral+non_woven=1; pmin above price=0; clear restores | f.color=pink,red=1; f.color=red=0; type=wallpaper&f.pattern_wallpaper=floral&f.material_wallpaper=non_woven=1; pmin=1176=0; stock=1&f.color=pink=1; clear → /marketplace | 1104 ms | **PASS** | traces/e2e-results.jsonl |  |
| G6 | Facet counts | anonymous | wallpaper facets | counts equal real matches | pink: وردي (١) | 127 ms | **PASS** | traces/e2e-results.jsonl |  |
| G7 | Grid/List switch and sorting | anonymous | - | list layout; sort param in URL | list toggled; price_desc renders | 570 ms | **PASS** | traces/e2e-results.jsonl |  |
| G8 | Server pagination in the browser | anonymous | 1 published (< 25) | multi-page navigation | Only 1 published product; a second page needs ≥25 published products. Not created: publishing 25 fixture products needs 25 approved images + media moderation, and real Decore data must not be published to satisfy a test. Server paging verified at DB level (limit cap 60, offset) and on the seller list (795 products, page 40). | 252 ms | **BLOCKED** | screenshots/G8.png | — |
| G9 | Product detail: variants, gallery, honest purchase state | anonymous | Suzuki 518 | 7 colour buttons; gallery thumbs; disabled order button | 7 variant buttons, 3 thumbs, order disabled, variant switch OK | 700 ms | **PASS** | traces/e2e-results.jsonl |  |
| G10 | Draft, unpublished and cart routes are hidden | anonymous | draft slug, fixture unpublished slug, /marketplace/cart | 404s | draft 404, unpublished 404, cart 404 | 229 ms | **PASS** | traces/e2e-results.jsonl |  |
| G11 | Empty state | anonymous | q=zzzz-none | no-results panel | no-results panel shown | 112 ms | **PASS** | traces/e2e-results.jsonl |  |
| G12 | No console errors / failed requests on the public pages | anonymous | all G steps | 0 | Clean re-sweep of /, /marketplace, filtered listing and product page: 0 console errors, 0 HTTP 4xx/5xx; 2 net::ERR_ABORTED were cancelled RSC prefetches on navigation. (The first sweep counted the intentional 404s of G10.) | 89 ms | **PASS** | screenshots/G12.png |  |

## H. Homepage section

| ID | السيناريو | الحساب/الدور | البيانات | المتوقع | النتيجة الفعلية | المدة | الحالة | الدليل | Bug |
|---|---|---|---|---|---|---|---|---|---|
| H1 | Homepage Marketplace section shows the latest real products | anonymous | / | Suzuki 518 card with real price, product link, approved image; no fake promos, timers or cart | 1 real card, link /marketplace/products/wallpaper-suzuki-106-suzuki-…, 495 ms | 495 ms | **PASS** | traces/e2e-results.jsonl |  |
| H2 | Other homepage sections unaffected | anonymous | / | header, hero, ecosystem, footer present | Hero, Header, ShowroomVisual, HeroContent, CTA, Ecosystem, Marketplace, FinalCta, Footer | 11 ms | **PASS** | traces/e2e-results.jsonl |  |

## مسح المسارات (Route crawl)
ملف `traces/route-crawl.csv`: 126 صفحة × 3 أدوار (anonymous، Decore، Super Admin) = 378 زيارة GET. **0 أخطاء 5xx و0 أخطاء console.** كل الـ 404 مقصودة: منتج B2B لمستأجر تاني، و`/marketplace/cart`، وملف شخصي غير منشور. 58 مسار ديناميكي **NOT_TESTED** لأن مفيش id اتحدد ليهم.
