# Design Idea — Founder Brief (original)

**Status:** Source document (verbatim) · captured 2026-07-29

> This is the original founder design brief for Aladdin, preserved in the
> author's Arabic. It records the Q&A that fixed early scope, journeys, roles,
> branding direction, and responsive/RTL/dark-mode decisions. The distilled,
> English product scope derived from it lives in [`mvp-scope.md`](./mvp-scope.md).
> Treat this file as the historical source of intent; where it and `mvp-scope.md`
> differ, `mvp-scope.md` is the current working scope.

---

1. هنصمم أنهي Scope؟

A — MVP فقط

Authentication
Onboarding & Profiles
Roles
Portfolio
Product Catalog
Smart Search
AI Assistant
Notifications
Subscription
Advertisement
Admin Dashboard

B — Full Aladdin Platform

بالإضافة إلى الـ MVP:

Installation & Service Marketplace
Industrial Requests / RFQ
Supplier and Technician Matching
Project Execution Workflow
Learning & Training
Business Opportunities
Supply Chain Workflow
Payments, milestones and disputes

C — التصميم الكامل، والتنفيذ على مراحل

نعمل الـ Information Architecture والـ Design System لكل المنصة، لكن نصمم Screens الـ MVP بالتفصيل أولًا.

ترشيحي: C.

2. إيه أول User Journey نبدأ به؟

A
Authentication → Onboarding → Home

B
Public Home → Search → Provider/Product Details → Authentication

C
Authentication → Role Selection → Role-specific Dashboard

D
نبدأ بتجربة العميل:

Discover → Consult → Quote → Execute → Review

الـ Consultation-first journey معتمدة حاليًا بدل تجربة Add to Cart → Checkout.

ترشيحي:

Design System
Authentication
Role Selection & Onboarding
Public Discovery Home
Search
Professional/Product Profile
Consultation Request
3. أنهي Roles تدخل الـ MVP؟

المعلومات الموجودة حاليًا تشمل:

End Consumer
Installer / Technician
Engineer / Interior Designer
Showroom / Dealer
Supplier / Manufacturer / Importer
wholesalers
Sales
Contractor
Administrator

والحساب الواحد يقدر يمتلك أكثر من Role ويعمل Active Profile Switching بدون إنشاء حساب جديد.

أكد الآتي:

هل Supplier + Manufacturer + Importer يظهروا كـ Business Profile واحد؟
- لا خليهم عادي منفصلين حتي لو هيبقي ادوارهم متشاببهة وبيعملوا نفس الحاجه بس ده عشان يسهل عليا التحليل وال search بعدين 

هل Engineer + Interior Designer يظهروا كـ Role واحد؟
- لا بردو نفس الفكره اللي قولتلم عليها خليهم ادوار منفصه وده ينطبق علي كل الادوار ولو قدام حبينا ندمجهم او نعدل حاجه فيهم ما فيش مشكله بس دي الخطه الحاليه

هل Installer + Technician + Skilled Worker يظهروا كـ Role واحد؟
- لا نفس السبب السابق

هل نضيف Trainer وTrainee من البداية؟
- ايوا ضيفهم

هل Company / Contractor ليهم Account Type مستقل؟
- ايوا

4. شكل المنصة الأساسي يكون إزاي؟

A — Marketplace Discovery

Top navigation، search بار كبير، categories، products، projects، professionals.

B — SaaS Workspace

Sidebar، dashboard، tasks، requests، quotations، notifications.

C — Hybrid

الزائر والعميل يشوفوا Marketplace-style public experience.
مقدم الخدمة أو الشركة يشوفوا Dashboard / Workspace.
نفس الحساب يبدّل بين الـ Profiles.

ترشيحي: C.

5. الـ Authentication اللي كنا بنتكلم عليه

أكد نبدأ بالصفحات دي:

Sign In
Create Account
Forgot Password
Reset Password
Email / Phone Verification
Choose Account Type
Create First Profile
Business or Professional Verification
Complete Profile
Profile Switcher

وبالنسبة للجزء المرئي بجوار الفورم:
مؤقتًا 3D-style static artwork داخل Pencil، ثم يتم تحويله لاحقًا إلى فيديو أو WebGL او نحط مكانها فيديو بعدين

6. الـ Branding

Logo: not yet
Brand colors: not yet 
Font: not yet 
Existing brand guide: not yet 
أي Screens أو UI قديمة: not yet 
مواقع أو تطبيقات بتحب أسلوبها: not yet 

ولو مفيش Branding نهائي، اختار اتجاه:

A — Premium architectural

Warm white, charcoal, sand, bronze.

B — Modern technology

Deep navy, electric blue, violet, clean white.

C — Construction and trust

Dark green, stone gray, warm beige.

D — Pencil يقترح 3 Visual Directions بدون رسم Screens كاملة.

ترشيحي: A, B, D

7. اللغة واتجاه التصميم

أول Release هيكون English first.
نصمم Components من البداية بحيث تدعم Arabic RTL؟
هنستخدم بيانات مصرية واقعية مثل Cairo, New Cairo, Sheikh Zayed وEGP؟
النسخة العربية جزء من الـ MVP.

8. Responsive Scope

اختار المطلوب في Pencil:
Desktop + Tablet + Mobile

9. هل مطلوب Dark Mode؟
Light + Dark من أول Design System

10. مستوى التصميم الأول

A — مباشرة High-fidelity UI

أسرع في الشكل، لكن احتمالية إعادة التصميم أكبر.

B — User Flow + Wireframes ثم High-fidelity

أفضل لتثبيت تجربة المنصة المعقدة.

C — Sitemap + User Flows + Component Inventory + High-fidelity لأول Journey فقط

ترشيحي: C.

11. ملف Pencil
نبدا ملف جديد
الـ agent عنده وصول مباشر لـ Pencil MCP / Pencil tool

12. الهدف من أول جلسة تصميم

A

Design System foundation فقط.

B

Authentication وOnboarding كاملين.

C

Sitemap وUser flows فقط.

D

Sitemap + Design System + Authentication أول Screen.

ترشيحي: D، لكن من غير ما يرسم باقي المنصة قبل ما نراجع أول Screen.