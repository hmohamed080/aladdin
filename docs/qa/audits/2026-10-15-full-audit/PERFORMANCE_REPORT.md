# تقرير الأداء — مراجعة 2026-10-15

كل رقم هنا متقاس فعلًا، ومصدره الملفات الخام في `traces/`. الجدول الكامل (113 صف) في `PERFORMANCE_RESULTS.csv`، واتولّد بـ `scripts/build-perf-csv.cjs` من الملفات الخام من غير ما حد يكتب أرقام بإيده.

## 1. المنهجية

| البند | القيمة |
|---|---|
| Build | `next build` + `next start -p 3200` (production mode)، Next.js 15. البناء نجح في 86 ثانية (`traces/next-build.log`). الـ JS المشترك في First Load = 103 kB |
| الجهاز | 16 core، 32 GB RAM، Windows 11، Node 24. كل حاجة على نفس الجهاز (app + Supabase في Docker) |
| المتصفح | Chromium من Playwright 1.62.1 |
| Desktop | 1440×900، من غير throttling |
| Mobile | 393×851، DPR 2.75، touch. الشبكة ≈ Fast-4G (150 ms RTT، 1.6 Mbps down، 750 kbps up). الـ CPU أبطأ 4× (CDP) |
| Cold / Warm | Cold = cache متقفل عن طريق CDP، والـ cookies فاضلة. Warm = reload والـ cache شغال |
| العينات | Desktop 5 cold + 5 warm. Mobile 3 cold + 3 warm. RPC n=30 على QA، و n=15/5 على stack الـ scale |
| المقاييس | TTFB/FCP/LCP/CLS من `PerformanceObserver`، والـ load من Navigation Timing، والأحجام من Resource Timing |
| البيانات | QA DB `aladdin-marketplace`: منتج واحد منشور، و795 منتج لـ Decore (794 مسودة). الـ scale اتقاس على stack مؤقت `aladdin-audit-tmp` فيه 5,000 ثم 15,000 منتج صناعي منشور، واتشال بعد كده |

**حدود لازم تتقري مع الأرقام:**
- دي **قياسات lab** على localhost، **مش** field data (CrUX/RUM). على البيئة المستضافة الـ TTFB هيزيد بقيمة الـ RTT للـ region.
- **INP مااتقاسش.** أي تفاعل مكتوب بسكريبت مش عينة INP صحيحة. بدله اتقاس "زمن الأكشن" من الإدخال لحد ما الحالة الجديدة تظهر (قسم 4).
- **الـ cold الحقيقي هو run 1 بس.** في runs 2–5 الـ JS اتنقل بـ 0 bytes، يعني الـ memory cache بتاع Chromium فضل شغال رغم `Network.setCacheDisabled`. علشان كده قيم p50 للـ "cold" أقرب للـ warm، والأحجام في الجداول تحت مأخوذة من run 1.
- **الصور اللي جاية من Supabase Storage** (origin مختلف من غير `Timing-Allow-Origin`) بتظهر بـ `transferSize = 0`. علشان كده حجم الصور في صفحات البائع **مش متقاس** من المتصفح. أحجام صور المنتج اتقاست من الـ DB والـ Storage مباشرة (قسم 5).
- أول تشغيل للأداء اتلغى لأنه اتعمل وفيه تحميل تاني على الجهاز. الأرقام هنا من تشغيل تاني وهادي (18.4 دقيقة).
- طلبات "failed" في الـ desktop طلعت **كلها** RSC prefetch اتعملها abort (`net::ERR_ABORTED`)، زي `/b2b/orders?_rsc=…`. **مش أخطاء** (`traces/request-classification.json`).

## 2. الصفحات — LCP p50 (ms)

| الصفحة | الدور | Desktop warm | Desktop cold | Mobile warm | Mobile cold | TTFB p50 desktop | Mobile cold run 1: load / النقل |
|---|---|---|---|---|---|---|---|
| Homepage | anonymous | 156 | 172 | 340 | 604 (p95 2,116) | 19 | **15.4 s / 3.0 MB** |
| Marketplace listing | anonymous | 316 | 356 | 324 | 292 | 18 | **29.3 s / 5.9 MB** |
| Product detail (Suzuki 518) | anonymous | 460 | 456 | **14,428** | **14,332** | 20 | **25.6 s / 5.2 MB** |
| Sign In | anonymous | 52 | 60 | 264 | 268 | 7 | 1.0 s / 67 KB |
| Showroom registration | anonymous | 52 | 60 | 424 | 524 (p95 13,372) | 11 | 13.4 s / 2.4 MB |
| B2B dashboard | Decore | 256 | 256 | 296 | 544 | ~151 | 1.3 s |
| Seller product list (795) | Decore | 292 | 280 | 560 | 532 | ~153 | 1.5 s |
| Add product | Decore | 412 | 420 | 572 | 680 | ~300 | 1.5 s |
| Edit product (7 variants، 9 صور) | Decore | 516 | 564 (run 1) | **TIMEOUT** | **TIMEOUT** | ~305 | **6/6 timeout على 60 s** |
| Bulk import | Decore | 224 | 212 | 484 | 452 | ~132 | 1.3 s |
| Admin dashboard | Admin | 168 | 172 | 296 | 284 | ~111 | 0.9 s |
| Admin seller management | Admin | 172 | 164 | 280 | 436 | ~109 | 0.9 s |
| Admin media moderation | Admin | 212 | 204 | 368 | 308 (p95 2,820) | ~109 | 2.8 s |

- **CLS ≤ 0.04 في كل الصفحات**، وده كويس.
- **الـ JS بعد فك الضغط:** ‏0.8–1.6 MB لكل صفحة. أتقلها صفحات البائع: `seller/products/new` و`edit` و`imports`، كل واحدة ≈ 1.6 MB.
- **الـ TTFB في صفحات البائع والأدمن** 110–325 ms على localhost. ده كله server rendering + RPC، وأعلى قيمة في add/edit (≈ 300 ms).

### أسباب اللي باظ (متقاسة)
1. **Product detail على الموبايل: LCP ≈ 14.3 s.** الصفحة بتنزّل 4,195 KB صور. الـ cover المعروض في الكارت حجمه 956 KB بأبعاد 1890×1890، وبيتعرض في مساحة ≈ 270×200 px. الصور بتتقدّم بحجمها الأصلي من `/marketplace/media/…`، ومفيش resize ولا WebP/AVIF.
2. **Marketplace listing على الموبايل: الـ load بيوصل 29 s مع إن الـ LCP كويس (≈ 0.3–0.6 s).** صور شريط الأنواع `/preview/landing/marketplace/*.png` بتتحمّل بحجمها الأصلي:
   - كل صورة من 755 لـ 861 KB، بأبعاد 1200×900، وبتتعرض في مساحة 128×244.
   - **مش** بتعدّي على `next/image`.
   - المجموع 5.8 MB، والسوق فيه منتج واحد بس.
3. **Homepage على الموبايل cold: الـ load وصل 15.4 s** (الـ LCP ≈ 0.6 s، والـ p95 2.1 s). أكبر صورة `role-atlas-transparent.png` بحجم 1,312 KB، وكمان cover المنتج في قسم الماركت (956 KB).
4. **Edit product على الموبايل: 6 من 6 timeout.** على الـ desktop نفس الصفحة بتفتح في 0.5–0.8 s. **السبب المرجّح (استنتاج، مش قياس مباشر):** الـ 9 صور بتاعة Suzuki 518 بحجمها الأصلي، مجموعها **19.21 MB** (أكبر صورة 3,002 KB، وأبعاد لحد 4169×2520، متقاسة من الـ Storage). 19.2 MB على 1.6 Mbps محتاجة أكتر من 90 ثانية. حجم الصور ده مش ظاهر في Resource Timing لأنها cross-origin.
5. **Showroom registration على الموبايل:** run cold واحد LCP بتاعه 13.4 s. صورة الخلفية حجمها 2.25 MB في run 1، وده outlier. الـ p50 كان 524 ms.

## 3. الـ RPC وقاعدة البيانات — QA DB (n=30، round-trip من supabase-js على localhost)

| RPC | الدور | p50 | p95 |
|---|---|---|---|
| `marketplace_public_catalog_page` (default / filters / search) | anon | 6.6–8.4 | 7.5–23.4 |
| `marketplace_public_facets` | anon | 5.8–6.1 | 7.4 |
| `marketplace_public_product` | anon | 6.5 | 8.7 |
| `marketplace_seller_products_page` (795، page 1 / page 40 / search) | seller | 18.9–21.3 | 23.7–28.9 |
| `marketplace_seller_product_get` (7 variants) | seller | 8.0 | 9.7 |
| `marketplace_seller_product_readiness` | seller | 6.1 | 6.9 |
| Admin overview / media queue / settings | admin | 5.2–6.4 | 6.9–8.3 |
| Writes: product_save / stock_adjust / publish (عينة واحدة) | seller | 23 / 13 / 15 | — |

على حجم البيانات الحالي كله كويس، **بس الحجم الحالي مش هو الخطر**. الخطر في الجدول اللي جاي.

## 4. الـ Scale — stack مؤقت (منتجات منشورة صناعية، كل منتج بـ 2 variants)

| RPC | 5,000 منتج p50 / p95 | 15,000 منتج p50 / p95 |
|---|---|---|
| public catalog page 1 | **1,951 / 2,211** | **FAIL: statement timeout على 3 s** (5/5) |
| public catalog last page | 1,985 / 2,157 | **FAIL timeout** |
| public catalog colour filter | 2,157 / 2,410 | **FAIL timeout** |
| public catalog price+stock+sort | 1,416 / 1,520 | **FAIL timeout** |
| public catalog search | 822 / 959 | 1,268 / 1,306 |
| public facets() / (wallpaper) | 418 / 473 | 1,198 / 1,261 |
| public product detail | 6 / 8 | 8 / 9 |
| seller products page 1 / deep / search | 115 / 117 / 141 | 341 / 362 / 388 |
| seller product readiness | 9 | 9 |

**تحليل الخطة (EXPLAIN ANALYZE على 5,000، الإجمالي 2.23 s):**
- فحص `exists (active variant)` اتنفذ كـ **Nested Loop Semi Join** فوق **Materialize + Seq Scan** على الـ variants، وشال **12,497,500 صف**.
- `app.marketplace_seller_is_enabled()` بتتنادى لكل صف، وأخدت ≈ 438 ms.
- Index مفقود على FK واحد بس: `marketplace_import_assets.image_id`.

**الخلاصة:** الكتالوج العام بيكبر بشكل غير خطي. الوقت ≈ 2 s عند 5k، وبيعدّي الـ timeout (3 s) **قبل** 15k. حد الأمان التقريبي ≈ 7–8 آلاف منتج منشور (استقراء من نقطتين بس، مش قياس مباشر). Decore لوحدها عندها 795 منتج، و1,200 variant.

## 5. الصور — Suzuki 518 (المنتج المنشور الوحيد)
- **9 صور verified، مجموعها 19.21 MB.** أكبر صورة 3,002 KB، والأبعاد لحد 4169×2520.
- **الـ cover في الكارت:** 956 KB بأبعاد 1890×1890، وبيتعرض في ≈ 270×200 px.
- **صفحة المنتج:** بتنقل ≈ 4,195 KB صور، و5,161 KB إجمالي.
- **مفيش pipeline للـ thumbnails** (resize / WebP / AVIF / srcset) للصور اللي بتتقدّم من `/marketplace/media`.

## 6. أزمنة الأكشن (desktop، warm، من الإدخال لحد ما الحالة الجديدة تظهر)

| الأكشن | n | p50 | p95 |
|---|---|---|---|
| تغيير نوع المنتج من الشريط | 5 | 87 | 205 |
| فلتر اللون | 5 | 71 | 95 |
| فلتر السعر (Enter) | 5 | 55 | 75 |
| مسح كل الفلاتر | 5 | 69 | 100 |
| تغيير الترتيب | 5 | 98 | 99 |
| فتح المنتج من الكارت | 5 | 89 | 95 |
| تبديل الـ variant | 5 | 252 | 291 |
| Seller list open (795) / الصفحة 40 | 1 | 564 / 397 | — |
| Seller edit open | 1 | 984 | — |
| حفظ مسودة (2 variants + مخزون + رفع 3 صور) | 1 | 1,640 | — |
| Admin media: byte-validate 3 / approve 2 | 1 | 268 / 258 | — |
| Import dry run 6 صفوف / apply 6 صفوف + 6 صور | 1–2 | 169–343 / 485 | — |
| **Import dry run 50 صف / apply 50 صف (25 منتج × 2 variant)** | 1 | **477 / 1,134** | — |

**تحذير:** أكشنز الماركت العام اتقاست ومفيش غير منتج واحد منشور. على حجم بيانات حقيقي، زمنها هيمشي ورا أرقام الـ scale في قسم 4.

## 7. ترتيب أولويات الأداء
1. **P1:** إصلاح استعلام الكتالوج العام قبل ما يعدّي ≈ 5k منتج منشور. المطلوب:
   - semi-join مفهرس / lateral؛
   - حذف استدعاء `marketplace_seller_is_enabled()` لكل صف؛
   - تجربة ده على بيانات 15k ومعاه اختبار regression.
2. **P1:** pipeline لصور المنتج: thumbnails للكارت والمعرض، وWebP/AVIF، و`srcset`. بيأثر على الموبايل في صفحة المنتج وصفحة التعديل.
3. **P2:** صور شريط الأنواع وصور الـ homepage تعدّي على `next/image` أو تتصغّر. المكسب ≈ 5.8 MB في صفحة السوق.
4. **P3:** تقليل الـ RSC prefetch لكل لينكات الـ sidebar (≈ 9 لكل صفحة).
5. **P3:** حجم الـ JS في صفحات البائع (≈ 1.6 MB بعد فك الضغط).
