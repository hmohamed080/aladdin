# الملخص التنفيذي — مراجعة علاء الدين الشاملة (E2E + أداء + جاهزية إطلاق)

**التاريخ:** 2026-10-15
**الفرع:** `feat/public-marketplace-20261011` (`d9d5612`، ومعاه merge لـ PR #84)
**البيئة:** محلية فقط.

**قواعد الأمان اتطبقت كلها:**
- مفيش production ولا staging.
- مفيش reset ولا push.
- بيانات Decore اتقرت بس، ومحدش غيّرها.
- كل حاجة بتغيّر بيانات اتعملت على fixtures معزولة، واتنضفت ونتيجة التنضيف اتأكدت (قسم H).
- **مفيش ولا إصلاح اتعمل، ومفيش أي commit.**

---

## A. عدد الحالات (FEATURE_MATRIX.csv — ‏141 بند)

| الحالة | العدد |
|---|---|
| PASS | 105 |
| FAIL | 11 |
| PARTIAL | 8 |
| BLOCKED | 2 |
| NOT_IMPLEMENTED | 13 |
| NOT_TESTED | 2 |
| NOT_APPLICABLE | 0 |

**سيناريوهات E2E اللي اتنفذت فعلًا: 99**
- 95 PASS، و2 FAIL (D11z، D14)، و1 PARTIAL (A15)، و1 BLOCKED (G8).
- التفاصيل في `E2E_RESULTS.md`.

## B. أهم 10 أزمنة (متقاسة)

| # | القياس | النتيجة |
|---|---|---|
| 1 | كتالوج عام بـ 15,000 منتج منشور | **statement timeout على 3 s** في 4 من 5 أشكال استعلام |
| 2 | كتالوج عام بـ 5,000 منتج منشور | p50 = **1,951 ms**، وp95 = 2,211 ms |
| 3 | صفحة المنتج على الموبايل (4G + CPU ×4) | LCP p50 = **14.3 s**، والـ load ≈ 25.6 s |
| 4 | صفحة تعديل المنتج على الموبايل | **6 من 6 timeout على 60 s** (على الـ desktop 0.5–0.8 s) |
| 5 | صفحة السوق على الموبايل (cold) | LCP ≈ 0.3–0.6 s، **لكن الـ load ≈ 29 s** بسبب 5.8 MB صور |
| 6 | Facets عند 15,000 منتج | p50 = 1,198 ms |
| 7 | قائمة منتجات البائع عند 15,000 منتج | p50 = 341–388 ms (عند 795 منتج: 19–21 ms) |
| 8 | حفظ مسودة (2 variants + مخزون + 3 صور) | 1,640 ms |
| 9 | استيراد 50 صف: dry run / apply | 477 ms / 1,134 ms |
| 10 | صفحات الـ desktop (13 صفحة، warm) | LCP p50 من 52 لـ 516 ms، وCLS ≤ 0.04، وأكشنز الفلترة 55–252 ms |

## C. أهم 10 مشاكل

| # | المشكلة | الأولوية |
|---|---|---|
| 1 | **SEC-1:** حد محاولات الدخول بالموبايل بيتعدّى بنداء GoTrue مباشر (من غير 429 خالص) | P0 |
| 2 | **SEC-2:** على Postgres 17.11 الـ `anon` بيقدر ينفّذ 106 function (على 17.6: 7 بس). نسخة البيئة المستضافة مش معروفة | P1، وممكن تبقى P0 |
| 3 | **SEC-3:** أهلية بائع الماركت بتتجاهل `showroom_seller_ready` بتاع PR #84. Decore وZayed مؤهلين رغم إنهم مش جاهزين | P1 |
| 4 | **DATA:** كل مسودات Decore (794) blocked. الكتالوج العام فيه منتج واحد بس | P1 |
| 5 | **BL-1:** تجميع الاستيراد دمج منتجين مختلفين في الاسم والسعر (D14) | P1 |
| 6 | **BL-3:** استيراد الصور من ZIP بايظ في المتصفح (415) والرسالة عامة (D11z) | P1 |
| 7 | **BL-2:** مفيش مسار لمعرض جديد يطلب التوثيق. المعارض الجديدة مش هتوصل للماركت | P1 |
| 8 | **PERF:** استعلام الكتالوج مش بيكبر بشكل خطي. حد الأمان ≈ 5–8 آلاف منتج منشور | P1 |
| 9 | **PERF:** الصور بتتقدم بحجمها الأصلي (cover ‏956 KB، وصور المنتج 19.2 MB). الموبايل مش صالح للاستخدام | P1 |
| 10 | **A11y:** contrast بتاع `text-accent` بين 2.81 و3.19:1، وfile input من غير label (axe critical) | P2 |

## D. أرقام Decore Store — من استعلام read-only في transaction اتعملها rollback
مصدر الـ blockers هو نفس منطق النشر (`app.marketplace_publication_blockers`، STABLE)، **ومفيش أي نشر اتعمل**.

**الأرقام الأساسية**

| البند | العدد |
|---|---|
| المنتجات | **795** |
| الـ variants | **1,210** (كلها active) |
| المنتجات اللي فيها أكتر من variant | 178 |
| المسودات (draft) | **794** |
| المنشور (published) | **1** (Suzuki 518) |
| الصور | **10**، على منتجين بس |
| الصور المعتمدة (verified) | **9** |
| الصور pending | 1 |
| المسودات blocked عن النشر | **794 من 794** |
| المسودات الجاهزة للنشر | 0 |

**أسباب الـ blocking**
- العدد بيتحسب **مرة لكل ظهور**، فالـ variant الواحد ممكن يتحسب أكتر من مرة.

| السبب | العدد |
|---|---|
| مفيش صورة أساسية verified | 794 |
| `material_wallpaper` ناقصة | 787 |
| لون الـ variant ناقص | 1,200 |
| `roll_width` ناقص | 1,195 |
| `roll_length` ناقص | 1,195 |
| `variant_without_option_combination` | 176 |
| أسباب تانية | ≤ 6 لكل سبب |

**مشاكل جودة البيانات**

| البند | النتيجة |
|---|---|
| سعر صفر أو فاضي | 0 |
| SKU فاضي | 0 |
| SKU مكرر | 0 |
| منتج من غير نوع | 0 |
| `option_signature` فاضي | **1,201** variant |
| تجميع ملتبس (Jaguar 160/161) | تحليل التجميع: 177 مجموعة، و0 مجموعات مختلطة الألبوم أو السعر |

## E. القرار
- **Verdict A — كتالوج فقط: NO-GO.** بيتحوّل لـ CONDITIONAL GO بعد P0-1 وP1-1 وP1-2 وP1-4 وP1-5 وP1-7، وبعد ما يبقى فيه محتوى قابل للنشر (P1-8).
- **Verdict B — Commerce كامل: NO-GO.** journey J كله NOT_IMPLEMENTED.
- التفاصيل في `RELEASE_READINESS.md`.

## F. الخطوات اللي جاية بالترتيب
1. **P0-1:** قفل تجاوز GoTrue، والتأكد على البيئة المستضافة.
2. **التحقق من البيئة المستضافة (read-only):** نسخة Postgres، وتطبيق migration للـ grants (**P1-1**).
3. **P1-2:** أهلية البائع تحترم readiness، وقرار مكتوب عن Decore.
4. **P1-4** و**P1-5:** إصلاح الاستيراد (التجميع + ZIP).
5. **P1-8:** Decore تكمّل الصور والخصائص عن طريق الاستيراد، وبعدها مراجعة الأدمن.
6. **P1-7:** pipeline لصور المنتجات.
7. **P1-6:** إصلاح استعلام الكتالوج قبل 5k منتج منشور.
8. **P1-3:** مسار توثيق المعرض.
9. **P2:** a11y، والإشعارات، وفصل الـ E2E suite، وB7 وG8.
10. **Commerce (journey J):** ADR وبعدين تنفيذ، لـ Verdict B.

## G. الملفات والأوامر

**التقارير:** `docs/qa/audits/2026-10-15-full-audit/`
- `EXECUTIVE_SUMMARY.md`
- `FEATURE_MATRIX.csv`
- `E2E_RESULTS.md`
- `PERFORMANCE_REPORT.md`
- `PERFORMANCE_RESULTS.csv`
- `SECURITY_AND_LOGIC.md`
- `ACTION_PLAN.md`
- `RELEASE_READINESS.md`

**ملفات تانية:**
- `traces/`: الخام. فيه JSONL وJSON وCSV واللوجات، و`traces/playwright/` (screenshots + error-context للحالات الفاشلة؛ ملفات trace.zip اتمسحت لأنها فيها cookies الجلسة).
- `screenshots/`
- `scripts/`:
  - `build-e2e-report.cjs`
  - `build-perf-csv.cjs`
  - `build-feature-matrix.cjs`
  - `scale-seed.sql` (للـ stack المؤقت بس)
  - `decore-counts.sql` (read-only)
  - `mkexplain.cjs`
  - `import-fixture/`
- الـ harness:
  - `frontend/playwright.audit.config.ts`
  - `frontend/e2e-audit/*.spec.ts`
  - `gotrue-probe.mjs`، و`rpc-bench.mjs`، و`scale-bench.mjs`

**الأوامر (من `frontend/`، والسيرفر لازم يكون شغال: `pnpm build && pnpm start -p 3200`):**
```bash
npx playwright test -c playwright.audit.config.ts a-showroom-auth b-access c-seller-products d-import e-admin-sellers f-media g-public r-routes
npx playwright test -c playwright.audit.config.ts p-perf x-actions v-requests
AXE_PATH=<path>/axe.min.js npx playwright test -c playwright.audit.config.ts u-ui-a11y
node ../docs/qa/audits/2026-10-15-full-audit/scripts/build-e2e-report.cjs
node ../docs/qa/audits/2026-10-15-full-audit/scripts/build-perf-csv.cjs
node ../docs/qa/audits/2026-10-15-full-audit/scripts/build-feature-matrix.cjs
```
**تحذير:** الـ specs اللي بتغيّر بيانات (a، c، d، e، f) بتعمل fixtures جديدة. لو اتشغلت تاني، لازم تتنضف بعدها.

**الحاجات اللي ماتنفذتش، وسببها (ولا واحدة فيهم اتحسبت PASS):**
- **الـ E2E suite الأصلية (45 spec): BLOCKED.** الـ globalSetup بتاعها بيعمل truncate لجداول ويغيّر كلمات سر، وده ممنوع على QA DB.
- **G8 (pagination في المتصفح): BLOCKED.** فيه منتج منشور واحد بس، ومش هننشر بيانات Decore علشان الاختبار.
- **B7 (تبديل المنظمة): NOT_TESTED.** مفيش fixture عنده أكتر من منظمة.
- **58 مسار ديناميكي: NOT_TESTED.** مفيش ids.
- **INP:** مااتقاسش.
- **حمل متزامن:** مااتعملش.
- **production/staging:** مااتلمسوش، بالقصد.
- **journey J:** NOT_IMPLEMENTED، فمفيش حاجة تتختبر.

## H. سجل تنضيف الـ fixtures (اتأكد منه)

| البند | الإجراء | النتيجة بعد التحقق |
|---|---|---|
| منظمة `Audit Showroom Fixture` (`29eb0224…`) | `status=suspended` + `deleted_at` | ✔ |
| حساب البائع بتاعها | revoke عن طريق `admin_marketplace_seller_revoke` الحقيقي | `revoked` |
| منتجات الـ fixture (29) | `archived` | 29 / 29 |
| الـ memberships (2) | `revoked` | 2 / 2 |
| مستخدمين الـ fixture (المعرض، والـ sales، والـ probe `0201234567`) | ban عن طريق Admin API | 3 / 3 banned |
| storage objects (صور المنتج + `imports/…`) | اتمسحت عن طريق Storage API | 10 ← 0 |
| import jobs | كلها في حالة نهائية (completed / completed_with_errors) | مفيش ولا job `created` |
| الـ stack المؤقت `aladdin-audit-tmp` | `supabase stop --no-backup` | 0 containers، و0 volumes |
| Decore Store | مااتلمستش | 794 draft / 1 published، **نفس اللي كان قبل كده** |

**صفوف فاضلة append-only ومش ممكن تتمسح بالتصميم:**
- `audit_log`
- `marketplace_stock_movements` (58)
- `marketplace_*_events`
- `marketplace_import_jobs/rows/errors/assets`
- `marketplace_image_moderation_events`
- `verifications`
- `consent_receipts`

الصفوف دي بتاعة الـ fixture بس. وفيه كمان صفوف `marketplace_product_images` لمنتج متأرشف، والـ objects بتاعتها اتمسحت.
