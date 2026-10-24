# الأمان ومنطق الأعمال — مراجعة 2026-10-15

**النطاق:** branch `feat/public-marketplace-20261011` عند `d9d5612` (يشمل merge `f7aae0b` لـ PR #84)، على stack محلي معزول `aladdin-marketplace` + stack مؤقت `aladdin-audit-tmp` اتشال بعد الاختبار. لا production ولا staging.
**قواعد التصنيف:** "مؤكَّد" = اتعاد إنتاجه بدليل؛ "خطر محتمل" = مبني على قراءة الكود أو توثيق أو اختلاف بيئة، ومحتاج تأكيد على البيئة المستضافة.
**الحسابات:** كل اختبار بيغيّر حالة اتعمل على fixtures معزولة (`Audit Showroom Fixture` + حساب sales + حساب probe). بيانات Decore Store اتقرت بس، ومحدش غيّرها.

---

## 1. نتائج مؤكَّدة

### SEC-1 — تجاوز حد محاولات تسجيل الدخول عن طريق GoTrue مباشرة (P0 قبل أي إطلاق عام لحسابات الموبايل)
- **الدليل:** بعد ما الـ limiter بتاع التطبيق قفل حساب الـ fixture (`app.phone_auth_attempts`: sign-in phone=11، ip=11، والحد اتعدّى)، 6 محاولات بكلمة سر غلط مباشرة على `POST /auth/v1/token?grant_type=password` رجعت `400 invalid_credentials` كلها، ومفيش ولا `429`. يعني الـ throttle بتاع التطبيق مش بيحمي الـ endpoint الأصلي.
- **مرجع:** نفس الثغرة موثقة في `docs/frontend/showroom-business-onboarding.md` كـ "Critical merge/deployment blocker" وكان المكتوب إن PR #84 يفضل draft. رغم كده اتعمله merge على main (`84a747d`).
- **الأثر:** تخمين كلمات السر (brute force / credential stuffing) لحسابات المعارض والصنايعية بالموبايل، من غير الحد اللي التطبيق بيفرضه. الحسابات دي بتستخدم alias معروف الشكل (`p<e164>@craftsman-login.aladdin.invalid`).
- **ملاحظة:** حدود GoTrue الأصلية حسب الـ IP موجودة لكنها مش لكل حساب، ومتفحصتش على البيئة المستضافة.
- **العلاج المقترح:** حماية على مستوى المزوّد قبل النشر. الخيارات: Auth Hook للتحقق من كلمة السر (محتاج plan Teams/Enterprise)، أو تقليل `sign_in_sign_ups` rate limit، أو تمرير تسجيل الدخول كله من خلال proxy مع منع الوصول المباشر لـ `/auth/v1/token`. المسار التاني مش متاح مباشرة مع Supabase Auth.
- **خطوات الاختبار:** `frontend/e2e-audit/gotrue-probe.mjs` (على حساب fixture بس).

### SEC-2 — الصلاحيات الافتراضية بتختلف حسب نسخة Postgres المستضافة (P1، ممكن تبقى P0)
- **الدليل:** نفس الـ migrations الـ 121 اتطبقت على صورتين:
  - `postgres:17.6.1.143` (نفس الـ QA): `anon` يقدر ينفّذ **7** functions في `public`، و102 ملف / 4,648 اختبار pgTAP **PASS**.
  - `postgres:17.11.0.004` (الصورة اللي الـ CLI بيجيبها افتراضيًا لو مفيش pin): `anon` يقدر ينفّذ **106**. يعني 99 function زيادة، منها `create_order_from_quotation` و`apply_organization_verification` و`create_customer` و`assign_lead` و`business_submit`. ونفس pgTAP بيطلع **10 failures** في الملفات 14 و19 و39 و52 و55 (كلهم "anon may NOT execute …" و"service_role gains no browser authority …" و"direct table UPDATE is still refused").
- **السبب:** على 17.6، الـ default ACL لدوال الـ role `postgres` في `public` هو `{postgres=X/postgres}`. على 17.11 بقى `{postgres, anon, authenticated, service_role}`. ومفيش migration في الريبو بتعمل `alter default privileges`. يعني الأمان بيعتمد على الإعداد الافتراضي للصورة، مش على الكود.
- **الأثر:** الـ functions اللي جربناها بترفض `anon` جواها (`not a member of this organization`)، فالخطر الفعلي أقل. لكن طبقة الحماية التانية (defense-in-depth) بتختفي، وأي function مفيهاش فحص داخلي هتبقى مكشوفة. نسخة Postgres في الـ production متفحصتش (ممنوع الوصول).
- **العلاج:** migration تعمل `alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role` + `revoke` صريح على كل function موجودة + إعادة grant مقصودة. وكمان pin لنسخة الصورة في `supabase/config.toml`، وتشغيل pgTAP في CI على أحدث صورة.
- **الأدلة:** `traces/pgtap-clean-stack.log` (17.11)، `traces/pgtap-clean-stack-17.6.log` (17.6).

### SEC-3 — الـ Marketplace بيتجاهل قواعد تفعيل المعارض بتاعة PR #84 (P1)
- **الدليل:** `app.marketplace_seller_is_eligible` بيتأكد بس من `status='active'` و`org_type='showroom_dealer'` و`deleted_at is null`. أما `app.showroom_seller_ready` (PR #84) فبيطلب approval ساري (غير منتهي) + ملف معرض مكتمل (عنوان، اسم قانوني، هاتف، نشاط).

  | المعرض | `showroom_seller_ready` | `marketplace_seller_is_eligible` |
  |---|---|---|
  | Decore Store | **false** (`is_verified=false`، الملف ناقص، مفيش verification) | **true** |
  | Zayed Home | **false** | **true** |
  | Cairo Ceramics | true | true |
- **الأثر:**
  1. ADR-0015 بيقول إن العنوان إلزامي "before approval, activation **and new Marketplace selling**"، وده مش متطبق على الماركت.
  2. معرض انتهى approval بتاعه أو ملفه ناقص يقدر يبيع في الماركت، والعكس، فالسلوك مش متسق.
  3. **Decore Store نفسه مش جاهز يبيع B2B** بعد PR #84: عروض الأسعار والطلبات الجديدة ونشر منتجات B2B ممنوعة بالـ triggers.
- **العلاج:** اعتماد شرط واحد مشترك، مثلًا `marketplace_seller_is_eligible := showroom_seller_ready(...)`، مع خطة migration لـ Decore (استكمال العنوان والبيانات + verification). ده قرار business.

### BL-1 — تجميع المنتجات في الاستيراد بيدمج منتجات مختلفة (P1)
- **الدليل (D14):** الملف فيه `AUD-IMP-3..7`، وكلها بتنتهي بـ `-N`، فاتجمعت تحت base واحد `AUD-IMP`. `AUD-IMP-6` ("ورق اختبار ٦"، 500) و`AUD-IMP-7` ("ورق اختبار ٧"، 800) اتحطوا في **منتج واحد** اسمه "ورق اختبار ٦". الـ server بيدي warning `product_field_conflict` بس، و"first row wins".
- **في بيانات Decore الحقيقية:** 177 مجموعة، ومفيش ولا واحدة فيها ألبوم مختلف أو سعر مختلف. لكن فيه مجموعتين كبار مشكوك فيهم: **Jaguar 160 (12 اختيار)** و**Jaguar 161 (24 اختيار)**، بأرقام متفرقة (003…105). ممكن يكونوا تصاميم مختلفة مش ألوان. وكمان 71 مجموعة أسماء صفوفها مختلفة (بسبب الـ template اللي فيه الكود).
- **العلاج:** التجميع يبقى افتراضيًا "معطّل" أو "مقترح" بس، مع شاشة تأكيد بتعرض المجموعات اللي فيها اختلاف في الاسم أو السعر. وتحويل `product_field_conflict` من warning لـ error لما الأسعار تختلف.

### BL-2 — مفيش مسار في المنتج لطلب توثيق معرض جديد (P1)
- **الدليل:**
  - `business_draft_submit_v2` بيعمل المنظمة `pending_verification` من غير صف في `verifications` (الـ fixture كان عنده 0).
  - مفيش RPC أو واجهة لصاحب المعرض يقدّم طلب توثيق منظمة.
  - صفحة `/admin/verifications` بتراجع الطلبات اللي متقدمة بس.
  - الـ trigger بيمنع `status='active'` لمعرض من غير verification approved.
- **الأثر:** معرض جديد مقدرش يتفعّل من خلال المنتج، يعني مقدرش يبيع B2B ولا في الماركت. الحسابات التاريخية بس (legacy) هي اللي متفعّلة.
- **في المراجعة:** صف verification اتعمل بـ psql للـ fixture (موثق)، والأدمن وافق عليه عن طريق الـ RPCs الحقيقية (`review_start` → `review_approve` → `apply_organization_verification`) ونجح.

### BL-3 — رفع صور الاستيراد من ZIP بايظ في المتصفح (P1)
- **الدليل (D11z):**
  - كل upload رجع `400 {statusCode:415, invalid_mime_type, "mime type application/octet-stream is not supported"}`.
  - السبب إن `import-wizard.tsx` بيلف محتوى الـ ZIP في `new Blob([bytes])` من غير type، و supabase-js بيبعته multipart بـ `application/octet-stream` ومش بياخد `contentType` في الاعتبار.
  - الـ job بيفضل `created` بـ 0 صفوف، والواجهة بتعرض رسالة عامة بس: "حدث خطأ. حاول مرة أخرى.".
- **ليه اختبار القبول القديم ماكشفهوش:** كان بيرفع Buffers من Node، مش Blobs من المتصفح.
- **البديل المؤقت:** رفع الصور كملفات منفصلة بيشتغل (D11 PASS).
- **العلاج:** `new Blob([bytes], { type: MIME[ext] })` + اختبار متصفح للـ ZIP + رسالة خطأ محددة.

### SEC-4 — تأكيد رفع الصورة عن طريق RPC مباشرة بيتخطى فحص الـ magic bytes (P2، الطبقة التالية بتغطي)
- **الدليل (F3):** ملف HTML معلَن كـ `image/jpeg` اتأكد بنجاح عن طريق `marketplace_seller_image_confirm_upload` المباشر وبقى `pending`. فحص التوقيع موجود في server action التطبيق بس.
- **الطبقة التالية نجحت:** فحص البايتات عند الأدمن علّمه `invalid`، والاعتماد اترفض، والصورة اترفضت بسبب (F2/F4/F6).
- **الأثر:** محدود. ممكن يملا طابور المراجعة بملفات مزيفة، لكن عمرها ما توصل للعامة.
- **العلاج:** فحص التوقيع جوه الـ RPC (مثلًا بعد قراءة metadata) أو من خلال storage trigger.

### SEC-5 — هاتف المعرض من غير تحقق ملكية، ومقبول أرضي (P2، قرار business)
- **الدليل (A15):** `0201234567` (صيغة أرضي القاهرة) اتقبل وحساب اتعمل. مفيش OTP لحسابات المعارض (ADR-0014). أي حد يقدر يسجل معرض على رقم شخص تاني (number squatting).
- **العلاج:** قرار: mobile فقط و/أو تحقق ملكية بالـ OTP قبل التفعيل.

### DOC-1 — CAPTCHA على تسجيل الدخول بالإيميل عكس الدليل الرسمي (P2)
- PR #84 (`05c4eec`) ضاف Turnstile على `/auth/sign-in`. لكن `PRODUCT_DIRECTION_GUIDE.md` و`CLAUDE.md` بيقولوا "no CAPTCHA on Sign In". لازم نحدد: التوثيق قديم ولا التغيير ماكانش متوافق عليه.

---

## 2. ضوابط اتختبرت ونجحت

| المجال | الاختبار | النتيجة |
|---|---|---|
| Auth | redirect لصفحة الدخول من 4 مسارات محمية (B1) | PASS |
| Auth | Open redirect: `next=https://evil.example` اتجاهل (A6+A9) | PASS |
| Auth | phone rate limit في التطبيق (A14) | PASS (لكن شوف SEC-1) |
| Auth | logout بيقفل الجلسة، والجلسة بتكمل في تاب جديد (A10/A11) | PASS |
| Tenant | قراءة منتجات/صور تاجر تاني عن طريق RLS: 0 صفوف (B2e) | PASS |
| Tenant | `marketplace_seller_products_page(Decore)` من مستأجر تاني: مرفوض (B2d) | PASS |
| Tenant | حفظ منتج في منظمة تانية: مرفوض (B2f) | PASS |
| Tenant | تنزيل بايتات صورة تاجر تاني مباشرة من storage: مرفوض (B2g) | PASS |
| Tenant | صفحة تعديل منتج تاجر تاني: 404 (B2h) | PASS |
| RBAC | صلاحيات B2B (org.manage/catalog.*) مابتديش بيع في الماركت (B2c) | PASS |
| RBAC | عضو sales فقط: مفيش منطقة بائع ومفيش كتابة (B3a) | PASS |
| RBAC | البائع والأدمن مايقدروش ينفّذوا RPCs بعض (B4c, B6, E7a/b, F14) | PASS |
| Admin | سبب إلزامي للاعتماد/الإيقاف، وسجل فيه actor + reason (E4a, E6) | PASS |
| Media | منتج draft صورته مش عامة حتى لو معتمدة (F9) | PASS |
| Media | الإيقاف بيخفي فورًا، والإرجاع بيرجعه (E8) | PASS |
| Media | رفض بعد الاعتماد بيلغي النشر ويسحب الصورة (F12) | PASS |
| Media | تزامن رفض + حذف: حالة متسقة و404 (F13) | PASS |
| Media | كل ردود `/marketplace/media` بـ `no-store, private` | PASS |
| Logic | SKU مكرر مرفوض، سعر 0 أو سالب مرفوض (C12, C12b) | PASS |
| Logic | idempotency للمخزون، رفض التحديث القديم (stale)، منع السالب (C15–C17b) | PASS |
| Logic | النشر مرفوض طول ما فيه blockers (C20b) | PASS |
| Logic | الأسعار معروضة "غير شاملة الضريبة" (G2) | PASS |

## 3. مخاطر محتملة (محتاجة تأكيد)
- **R1:** نسخة Postgres/GoTrue على البيئة المستضافة غير معروفة. لازم نتأكد من SEC-1 وSEC-2 هناك قبل أي deploy.
- **R2:** صفحات `/preview/installer-*` (11 صفحة) مفتوحة لأي حد ببيانات تجريبية، ومحمية بـ `noindex` بس. قديمة ومش جزء من الماركت.
- **R3:** مسار الصور العام بيستخدم service-role لكل طلب. مفيش تسريب للمفتاح (اتفحص)، لكن أي bug في `marketplace_public_image_ref` هيبقى أثره كبير. حاليًا مغطى بـ 13 اختبار في pgTAP 98.

## 4. حدود المراجعة
- مفيش اختبار على production أو staging أو GoTrue المستضاف.
- مفيش fuzzing ولا اختبار حمل حقيقي على الـ Auth.
- تنظيم الصلاحيات بعد تبديل المنظمة (organization switching) **مااتختبرش** (NOT_TESTED): مفيش حساب fixture عنده أكتر من منظمة.
