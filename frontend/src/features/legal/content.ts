import type { Locale } from "@/lib/i18n/locales";

/**
 * Published Privacy Policy and Data Deletion Instructions
 * (docs/frontend/legal-pages.md). Every statement here describes what the
 * product actually does today — the data the registration, profile, business,
 * catalogue, jobs, chat and sign-in flows store, the providers that process it
 * (Supabase, Vercel, Cloudflare Turnstile, Google, Meta), the cookies the app
 * sets, and the request-based deletion process. Change the copy when the
 * behaviour changes, and bump LEGAL_UPDATED_AT.
 */

/** The inbox privacy and deletion requests go to. Must be a real, monitored mailbox. */
export const PRIVACY_CONTACT_EMAIL = "info@aladdindecore.com";
export const SITE_URL = "https://aladdindecore.com";
export const LEGAL_UPDATED_AT = "2026-10-17";

export type LegalBlock = { kind: "p"; text: string } | { kind: "list"; items: string[] } | { kind: "steps"; items: string[] };
export type LegalSection = { id: string; heading: string; blocks: LegalBlock[] };
export type LegalDocument = {
  title: string;
  intro: string;
  updatedLabel: string;
  contentsLabel: string;
  /** "Email us at" / "راسلنا على" — label above the contact address in the closing band. */
  writeToUs: string;
  /** Label of the closing band's contact button. */
  contactLabel: string;
  /** ISO date of this document's last update; defaults to LEGAL_UPDATED_AT. */
  updatedAt?: string;
  /** Shown as a pill under the intro (a draft that is not final legal text). */
  notice?: string;
  /** A short line shown over the photo card beside the contents. */
  aside?: string;
  sections: LegalSection[];
};

const p = (text: string): LegalBlock => ({ kind: "p", text });
const list = (...items: string[]): LegalBlock => ({ kind: "list", items });
const steps = (...items: string[]): LegalBlock => ({ kind: "steps", items });

const privacyEn: LegalDocument = {
  title: "Privacy Policy",
  updatedLabel: "Last updated",
  contentsLabel: "On this page",
  writeToUs: "Email us at",
  contactLabel: "Contact us",
  intro:
    "Aladdin (aladdindecore.com) is a platform that connects showrooms, suppliers, manufacturers, importers, contractors, engineers, installers and their customers in Egypt's finishing, construction and interior-design sector. This policy explains what personal data we collect, why, who processes it for us, how long we keep it and the choices you have.",
  sections: [
    {
      id: "who-we-are",
      heading: "1. Who we are",
      blocks: [
        p(`Aladdin operates the website and web application at ${SITE_URL} and is responsible for the personal data described here. For any privacy question or request, email ${PRIVACY_CONTACT_EMAIL}.`),
      ],
    },
    {
      id: "data-we-collect",
      heading: "2. Data we collect",
      blocks: [
        p("Data you give us when you create and use an account:"),
        list(
          "Account details: full name, email address and/or mobile phone number, username, the account type you choose (for example Showroom or Installer) and your password. Passwords are stored only as a secure hash by our authentication provider; we never see or store them in plain text.",
          "Profile details you add: display name, profile photo, trade and specialties, service areas, availability, portfolio images and certificates.",
          "Business details if you register a business: business name and legal name, business type, branches and their addresses and phone numbers, business photo and description, and verification information you submit.",
          "Content you create: products, prices, offers, purchase requests, quotations, job posts and applications, reviews, saved items and searches, and messages you send to other users.",
          "Consent records: which version of our Terms and this policy you accepted, and when.",
        ),
        p("Data we receive when you sign in with Google or Facebook:"),
        list(
          "Your name, email address and the provider's account identifier (and, where the provider sends it, your profile picture link). We use these only to create or sign in to your Aladdin account. We do not post to your Google or Facebook account and we do not receive your friends list or your password.",
        ),
        p("Data collected automatically:"),
        list(
          "Security and abuse-prevention data: your IP address and browser details are checked by Cloudflare Turnstile when you create an account or request a code, and sign-in attempts are rate-limited using one-way hashed keys (not raw phone numbers or IP addresses) that are deleted after one day.",
          "Activity records: actions such as account, business and permission changes are written to an audit log to keep the platform secure.",
          "Cookies, described in section 7.",
        ),
      ],
    },
    {
      id: "how-we-use",
      heading: "3. How we use your data",
      blocks: [
        list(
          "To create your account, verify your email with a one-time code, sign you in and keep your account secure.",
          "To run the features you use: your profile and business page, the catalogue, offers, purchase requests and quotations, jobs, messages, reviews, points and notifications.",
          "To show your public profile or business information to other users where the feature is designed to be public (for example a business listing or a professional profile).",
          "To verify businesses and professionals, and to prevent fraud, spam and abuse.",
          "To send service messages about your account, such as verification codes and security notices.",
          "To meet legal obligations and resolve disputes.",
        ),
        p("We do not sell your personal data, and we do not use it for third-party advertising."),
      ],
    },
    {
      id: "legal-bases",
      heading: "4. Why we are allowed to use it",
      blocks: [
        p("We process your data because it is necessary to provide the service you signed up for, because you consented (for example when you accept these terms at sign-up), because we have a legitimate interest in keeping the platform safe, or because the law requires it. We follow Egypt's Personal Data Protection Law (Law No. 151 of 2020) and other laws that apply to you."),
      ],
    },
    {
      id: "sharing",
      heading: "5. Who we share it with",
      blocks: [
        p("Only with the service providers that run Aladdin for us, under their data-processing terms, and only for the purposes above:"),
        list(
          "Supabase — database, authentication, file storage and email codes. Our database is hosted in the European Union (Paris region).",
          "Vercel — hosting and delivery of the website and application.",
          "Cloudflare (Turnstile) — bot protection on sign-up and code requests.",
          "Google and Meta (Facebook) — only if you choose to sign in with them.",
        ),
        p("Other Aladdin users see the information you choose to publish or send to them. We may also disclose data when required by law or to protect the rights and safety of our users."),
      ],
    },
    {
      id: "retention",
      heading: "6. How long we keep it",
      blocks: [
        list(
          "Account, profile and content data: for as long as your account exists. When you delete your account, it is removed as described on our Data Deletion page.",
          "Rate-limiting keys: up to one day.",
          "Audit records: kept for platform security; once your account is deleted they no longer identify you.",
          "Data we must keep by law: only for the period the law requires.",
        ),
      ],
    },
    {
      id: "cookies",
      heading: "7. Cookies",
      blocks: [
        p("We use only cookies that the service needs to work:"),
        list(
          "Sign-in session cookies that keep you signed in.",
          "A language cookie that remembers whether you use Arabic or English.",
          "Short-lived cookies used during password recovery, which expire within minutes.",
          "Cloudflare Turnstile may set cookies needed for bot protection.",
        ),
        p("We do not use advertising or third-party analytics cookies."),
      ],
    },
    {
      id: "security",
      heading: "8. Security",
      blocks: [
        p("Data is encrypted in transit (HTTPS). Database access is restricted by row-level security so each user and business can reach only their own data. Passwords are hashed, and staff access to administration tools is limited and logged. No system is perfectly secure, so please use a strong, unique password."),
      ],
    },
    {
      id: "your-rights",
      heading: "9. Your rights",
      blocks: [
        p(`You can ask to access, correct, export or delete your personal data, object to or restrict certain processing, and withdraw consent at any time. Many details can be edited directly in your account settings. For anything else, email ${PRIVACY_CONTACT_EMAIL} from the email linked to your account (or include your registered phone number). We answer within 30 days. You may also complain to Egypt's Personal Data Protection Center.`),
      ],
    },
    {
      id: "deletion",
      heading: "10. Deleting your account and data",
      blocks: [p(`See the Data Deletion Instructions at ${SITE_URL}/legal/data-deletion for the steps and what is removed.`)],
    },
    {
      id: "children",
      heading: "11. Children",
      blocks: [p("Aladdin is a professional service for adults. It is not intended for anyone under 18, and we do not knowingly collect data from children.")],
    },
    {
      id: "transfers",
      heading: "12. International transfers",
      blocks: [p("Our providers may process data outside Egypt, including in the European Union and the United States. We rely on providers that apply recognised safeguards to protect that data.")],
    },
    {
      id: "changes",
      heading: "13. Changes to this policy",
      blocks: [p("If we change this policy we will update the date at the top of this page, and tell you in the app or by email before material changes take effect.")],
    },
    {
      id: "contact",
      heading: "14. Contact us",
      blocks: [p(`Email ${PRIVACY_CONTACT_EMAIL} for any question about this policy or your data.`)],
    },
  ],
};

const privacyAr: LegalDocument = {
  title: "سياسة الخصوصية",
  updatedLabel: "آخر تحديث",
  contentsLabel: "محتويات الصفحة",
  writeToUs: "راسلنا على",
  contactLabel: "تواصل معنا",
  intro:
    "علاء الدين (aladdindecore.com) منصة تربط المعارض والموردين والمصنّعين والمستوردين والمقاولين والمهندسين والصنايعية وعملاءهم في قطاع التشطيبات والبناء والتصميم الداخلي في مصر. توضح هذه السياسة البيانات الشخصية التي نجمعها، ولماذا، ومن يعالجها لصالحنا، ومدة الاحتفاظ بها، والخيارات المتاحة لك.",
  sections: [
    {
      id: "who-we-are",
      heading: "١. من نحن",
      blocks: [p(`تدير علاء الدين الموقع والتطبيق على ${SITE_URL}، وهي المسؤولة عن البيانات الشخصية الموضحة هنا. لأي سؤال أو طلب يخص الخصوصية راسلنا على ${PRIVACY_CONTACT_EMAIL}.`)],
    },
    {
      id: "data-we-collect",
      heading: "٢. البيانات التي نجمعها",
      blocks: [
        p("بيانات تقدّمها لنا عند إنشاء حسابك واستخدامه:"),
        list(
          "بيانات الحساب: الاسم الكامل، والبريد الإلكتروني و/أو رقم الموبايل، واسم المستخدم، ونوع الحساب الذي تختاره (مثل معرض أو صنايعي)، وكلمة المرور. تُحفظ كلمات المرور مشفّرة تشفيرًا أحادي الاتجاه لدى مزوّد خدمة الدخول، ولا نراها أو نحفظها كنص واضح أبدًا.",
          "بيانات الملف الشخصي التي تضيفها: الاسم الظاهر، وصورة الملف، والحرفة والتخصصات، ومناطق الخدمة، وأوقات التوفر، وصور الأعمال والشهادات.",
          "بيانات النشاط التجاري إذا سجّلت نشاطًا: الاسم التجاري والاسم القانوني، ونوع النشاط، والفروع وعناوينها وأرقام هواتفها، وصورة النشاط ووصفه، وبيانات التوثيق التي ترسلها.",
          "المحتوى الذي تنشئه: المنتجات والأسعار والعروض وطلبات الشراء وعروض الأسعار وإعلانات الوظائف والتقديمات والتقييمات والعناصر وعمليات البحث المحفوظة والرسائل التي ترسلها للمستخدمين الآخرين.",
          "سجلات الموافقة: أي نسخة من الشروط وهذه السياسة وافقت عليها ومتى.",
        ),
        p("بيانات نستلمها عند الدخول باستخدام Google أو Facebook:"),
        list(
          "اسمك وبريدك الإلكتروني ومعرّف حسابك لدى المزوّد (ورابط صورة ملفك إن أرسله المزوّد). نستخدمها فقط لإنشاء حسابك في علاء الدين أو الدخول إليه. لا ننشر أي شيء على حسابك في Google أو Facebook، ولا نستلم قائمة أصدقائك أو كلمة مرورك.",
        ),
        p("بيانات تُجمع تلقائيًا:"),
        list(
          "بيانات الأمان ومنع إساءة الاستخدام: يتحقق Cloudflare Turnstile من عنوان IP وبيانات المتصفح عند إنشاء حساب أو طلب رمز، وتُحدّ محاولات الدخول باستخدام مفاتيح مشفّرة أحادية الاتجاه (وليس أرقام الهواتف أو عناوين IP نفسها) تُحذف بعد يوم واحد.",
          "سجلات النشاط: تُسجَّل إجراءات مثل تغييرات الحساب والنشاط التجاري والصلاحيات في سجل تدقيق للحفاظ على أمان المنصة.",
          "ملفات تعريف الارتباط (الكوكيز)، الموضحة في البند ٧.",
        ),
      ],
    },
    {
      id: "how-we-use",
      heading: "٣. كيف نستخدم بياناتك",
      blocks: [
        list(
          "لإنشاء حسابك، وتأكيد بريدك برمز لمرة واحدة، وتسجيل دخولك، والحفاظ على أمان حسابك.",
          "لتشغيل الخصائص التي تستخدمها: ملفك وصفحة نشاطك، والكتالوج، والعروض، وطلبات الشراء وعروض الأسعار، والوظائف، والرسائل، والتقييمات، والنقاط، والإشعارات.",
          "لعرض ملفك العام أو بيانات نشاطك للمستخدمين الآخرين حيث تكون الخاصية مصممة لتكون عامة (مثل صفحة النشاط أو الملف المهني).",
          "لتوثيق الأنشطة التجارية والمهنيين، ومنع الاحتيال والرسائل المزعجة وإساءة الاستخدام.",
          "لإرسال رسائل الخدمة الخاصة بحسابك، مثل رموز التحقق وتنبيهات الأمان.",
          "للوفاء بالالتزامات القانونية وحل النزاعات.",
        ),
        p("لا نبيع بياناتك الشخصية، ولا نستخدمها لإعلانات جهات أخرى."),
      ],
    },
    {
      id: "legal-bases",
      heading: "٤. الأساس القانوني لاستخدامها",
      blocks: [p("نعالج بياناتك لأن ذلك ضروري لتقديم الخدمة التي سجّلت فيها، أو لأنك وافقت (مثلًا عند قبول الشروط عند التسجيل)، أو لمصلحتنا المشروعة في الحفاظ على أمان المنصة، أو لأن القانون يتطلب ذلك. نلتزم بقانون حماية البيانات الشخصية المصري (القانون رقم ١٥١ لسنة ٢٠٢٠) وأي قوانين أخرى تنطبق عليك.")],
    },
    {
      id: "sharing",
      heading: "٥. مع من نشاركها",
      blocks: [
        p("فقط مع مزوّدي الخدمات الذين يشغّلون علاء الدين لصالحنا، وفق شروط معالجة البيانات الخاصة بهم، وللأغراض المذكورة أعلاه فقط:"),
        list(
          "Supabase — قاعدة البيانات وخدمة الدخول وتخزين الملفات ورموز البريد. قاعدة بياناتنا مستضافة في الاتحاد الأوروبي (منطقة باريس).",
          "Vercel — استضافة الموقع والتطبيق وتوصيلهما.",
          "Cloudflare (Turnstile) — الحماية من البرامج الآلية عند التسجيل وطلب الرموز.",
          "Google وMeta (Facebook) — فقط إذا اخترت الدخول من خلالهما.",
        ),
        p("يرى مستخدمو علاء الدين الآخرون المعلومات التي تختار نشرها أو إرسالها إليهم. وقد نفصح عن البيانات إذا تطلّب القانون ذلك أو لحماية حقوق مستخدمينا وسلامتهم."),
      ],
    },
    {
      id: "retention",
      heading: "٦. مدة الاحتفاظ بها",
      blocks: [
        list(
          "بيانات الحساب والملف والمحتوى: طوال وجود حسابك. عند حذف حسابك تُزال كما هو موضح في صفحة حذف البيانات.",
          "مفاتيح الحد من المحاولات: حتى يوم واحد.",
          "سجلات التدقيق: تُحفظ لأمان المنصة، وبعد حذف حسابك لا تعود تحدد هويتك.",
          "البيانات التي يُلزمنا القانون بحفظها: للمدة التي يحددها القانون فقط.",
        ),
      ],
    },
    {
      id: "cookies",
      heading: "٧. ملفات تعريف الارتباط (الكوكيز)",
      blocks: [
        p("نستخدم فقط الكوكيز التي تحتاجها الخدمة لتعمل:"),
        list(
          "كوكيز جلسة الدخول التي تُبقيك مسجّلًا.",
          "كوكي اللغة الذي يتذكر استخدامك للعربية أو الإنجليزية.",
          "كوكيز قصيرة العمر تُستخدم أثناء استعادة كلمة المرور وتنتهي خلال دقائق.",
          "قد يضع Cloudflare Turnstile كوكيز لازمة للحماية من البرامج الآلية.",
        ),
        p("لا نستخدم كوكيز إعلانية أو كوكيز تحليلات من جهات أخرى."),
      ],
    },
    {
      id: "security",
      heading: "٨. الأمان",
      blocks: [p("تُشفّر البيانات أثناء نقلها (HTTPS). ويُقيَّد الوصول إلى قاعدة البيانات بأمان على مستوى الصفوف بحيث لا يصل كل مستخدم أو نشاط إلا إلى بياناته. كلمات المرور مشفّرة، ووصول فريق العمل إلى أدوات الإدارة محدود ومُسجَّل. لا يوجد نظام آمن تمامًا، لذا استخدم كلمة مرور قوية وخاصة بهذا الحساب.")],
    },
    {
      id: "your-rights",
      heading: "٩. حقوقك",
      blocks: [p(`يحق لك طلب الاطلاع على بياناتك الشخصية أو تصحيحها أو الحصول على نسخة منها أو حذفها، والاعتراض على بعض أنواع المعالجة أو تقييدها، وسحب موافقتك في أي وقت. يمكن تعديل كثير من البيانات مباشرة من إعدادات حسابك. ولأي طلب آخر راسلنا على ${PRIVACY_CONTACT_EMAIL} من البريد المرتبط بحسابك (أو اذكر رقم الهاتف المسجّل). نرد خلال ٣٠ يومًا. ويمكنك أيضًا تقديم شكوى إلى مركز حماية البيانات الشخصية في مصر.`)],
    },
    {
      id: "deletion",
      heading: "١٠. حذف حسابك وبياناتك",
      blocks: [p(`راجع تعليمات حذف البيانات على ${SITE_URL}/legal/data-deletion لمعرفة الخطوات وما يتم حذفه.`)],
    },
    {
      id: "children",
      heading: "١١. الأطفال",
      blocks: [p("علاء الدين خدمة مهنية للبالغين، وغير موجهة لمن هم دون ١٨ عامًا، ولا نجمع عن قصد بيانات الأطفال.")],
    },
    {
      id: "transfers",
      heading: "١٢. نقل البيانات خارج مصر",
      blocks: [p("قد يعالج مزوّدونا البيانات خارج مصر، بما في ذلك الاتحاد الأوروبي والولايات المتحدة. ونعتمد على مزوّدين يطبقون ضمانات معترفًا بها لحماية هذه البيانات.")],
    },
    {
      id: "changes",
      heading: "١٣. التغييرات على هذه السياسة",
      blocks: [p("إذا غيّرنا هذه السياسة سنحدّث التاريخ أعلى الصفحة، وسنبلغك داخل التطبيق أو بالبريد قبل سريان أي تغيير جوهري.")],
    },
    {
      id: "contact",
      heading: "١٤. تواصل معنا",
      blocks: [p(`راسلنا على ${PRIVACY_CONTACT_EMAIL} لأي سؤال عن هذه السياسة أو بياناتك.`)],
    },
  ],
};

const deletionEn: LegalDocument = {
  title: "Data Deletion Instructions",
  updatedLabel: "Last updated",
  contentsLabel: "On this page",
  writeToUs: "Email us at",
  contactLabel: "Contact us",
  intro:
    "You can ask us to delete your Aladdin account and the personal data linked to it at any time, whether you signed up with email, phone number, Google or Facebook. This page explains how, what is deleted and how long it takes.",
  sections: [
    {
      id: "request",
      heading: "1. Request deletion",
      blocks: [
        steps(
          `Send an email to ${PRIVACY_CONTACT_EMAIL} with the subject "Delete my account".`,
          "Send it from the email address linked to your Aladdin account. If you signed up with a phone number, include that number. If you signed in with Facebook or Google, include the email address of that Facebook or Google account.",
          "We reply to confirm the request. To protect your account we may ask you to confirm that you own it, for example with a one-time code sent to your email or phone.",
        ),
        p("If you can no longer reach that email or phone number, tell us in your message and we will agree another way to verify you."),
      ],
    },
    {
      id: "facebook",
      heading: "2. If you used Facebook to sign in",
      blocks: [
        p("Removing Aladdin from Facebook stops Facebook from sharing your information with us in the future:"),
        steps(
          "On Facebook, open Settings & privacy, then Settings.",
          "Open Apps and websites (under Security or Your activity, depending on your version).",
          "Find Aladdin and choose Remove.",
        ),
        p(`Removing the app on Facebook does not delete the data already stored in your Aladdin account. To delete it, also send the request in step 1.`),
      ],
    },
    {
      id: "google",
      heading: "3. If you used Google to sign in",
      blocks: [
        p("You can remove Aladdin's access at myaccount.google.com, under Security, then Your connections to third-party apps & services. As with Facebook, send the request in step 1 to delete the data stored with us."),
      ],
    },
    {
      id: "what-is-deleted",
      heading: "4. What we delete",
      blocks: [
        list(
          "Your sign-in account and every sign-in method linked to it (email, phone number, Google, Facebook).",
          "Your profile: name, username, contact details, profile photo, trade, service areas, availability, portfolio and certificates.",
          "Your saved items and searches, notifications, points, job applications, reviews you wrote, consent records and messages you sent.",
          "Files you uploaded, such as profile, portfolio, certificate, product and business images.",
          "Businesses where you are the only member, with their branches, products and offers.",
        ),
      ],
    },
    {
      id: "what-we-keep",
      heading: "5. What we may keep",
      blocks: [
        list(
          "Security audit records: the record of an action stays, but it no longer identifies you.",
          "Records of a business that has other active members (for example its products, quotations or orders) stay with that business; your personal link to them is removed.",
          "Information we must keep by law, for example to resolve a dispute or meet a tax obligation, only for as long as the law requires.",
        ),
      ],
    },
    {
      id: "timeline",
      heading: "6. How long it takes",
      blocks: [p("We complete deletion within 30 days of confirming your request, and email you when it is done. Deleted data is removed from backups as they expire. Deletion cannot be undone; to use Aladdin again you would create a new account.")],
    },
    {
      id: "contact",
      heading: "7. Questions",
      blocks: [p(`Email ${PRIVACY_CONTACT_EMAIL}. Our Privacy Policy at ${SITE_URL}/legal/privacy explains how we handle your data.`)],
    },
  ],
};

const deletionAr: LegalDocument = {
  title: "تعليمات حذف البيانات",
  updatedLabel: "آخر تحديث",
  contentsLabel: "محتويات الصفحة",
  writeToUs: "راسلنا على",
  contactLabel: "تواصل معنا",
  intro:
    "يمكنك أن تطلب منا حذف حسابك في علاء الدين والبيانات الشخصية المرتبطة به في أي وقت، سواء سجّلت بالبريد الإلكتروني أو رقم الهاتف أو Google أو Facebook. توضح هذه الصفحة الطريقة، وما يتم حذفه، والمدة المطلوبة.",
  sections: [
    {
      id: "request",
      heading: "١. اطلب الحذف",
      blocks: [
        steps(
          `أرسل بريدًا إلى ${PRIVACY_CONTACT_EMAIL} بعنوان "حذف حسابي".`,
          "أرسله من البريد الإلكتروني المرتبط بحسابك في علاء الدين. وإذا سجّلت برقم هاتف فاذكر الرقم. وإذا دخلت باستخدام Facebook أو Google فاذكر البريد الإلكتروني لذلك الحساب.",
          "نرد لتأكيد الطلب. ولحماية حسابك قد نطلب منك تأكيد ملكيتك له، مثلًا برمز لمرة واحدة يُرسل إلى بريدك أو هاتفك.",
        ),
        p("إذا لم تعد تستطيع الوصول إلى ذلك البريد أو الرقم، اذكر ذلك في رسالتك وسنتفق معك على طريقة أخرى للتحقق."),
      ],
    },
    {
      id: "facebook",
      heading: "٢. إذا استخدمت Facebook للدخول",
      blocks: [
        p("إزالة علاء الدين من Facebook توقف مشاركة Facebook لمعلوماتك معنا مستقبلًا:"),
        steps(
          "في Facebook افتح الإعدادات والخصوصية، ثم الإعدادات.",
          "افتح التطبيقات ومواقع الويب (ضمن الأمان أو نشاطك حسب إصدار التطبيق).",
          "ابحث عن علاء الدين (Aladdin) واختر إزالة.",
        ),
        p("إزالة التطبيق من Facebook لا تحذف البيانات المحفوظة بالفعل في حسابك لدى علاء الدين. لحذفها أرسل أيضًا الطلب الموضح في الخطوة ١."),
      ],
    },
    {
      id: "google",
      heading: "٣. إذا استخدمت Google للدخول",
      blocks: [p("يمكنك إزالة وصول علاء الدين من myaccount.google.com ضمن الأمان، ثم اتصالاتك بتطبيقات وخدمات الجهات الخارجية. وكما في Facebook، أرسل الطلب في الخطوة ١ لحذف البيانات المحفوظة لدينا.")],
    },
    {
      id: "what-is-deleted",
      heading: "٤. ما الذي نحذفه",
      blocks: [
        list(
          "حساب الدخول وكل طرق الدخول المرتبطة به (البريد، رقم الهاتف، Google، Facebook).",
          "ملفك الشخصي: الاسم واسم المستخدم وبيانات التواصل وصورة الملف والحرفة ومناطق الخدمة وأوقات التوفر وصور الأعمال والشهادات.",
          "العناصر وعمليات البحث المحفوظة، والإشعارات، والنقاط، والتقديم على الوظائف، والتقييمات التي كتبتها، وسجلات الموافقة، والرسائل التي أرسلتها.",
          "الملفات التي رفعتها، مثل صور الملف والأعمال والشهادات والمنتجات والنشاط التجاري.",
          "الأنشطة التجارية التي تكون أنت عضوها الوحيد، مع فروعها ومنتجاتها وعروضها.",
        ),
      ],
    },
    {
      id: "what-we-keep",
      heading: "٥. ما قد نحتفظ به",
      blocks: [
        list(
          "سجلات التدقيق الأمني: يبقى سجل الإجراء لكنه لا يعود يحدد هويتك.",
          "سجلات نشاط تجاري له أعضاء آخرون نشطون (مثل منتجاته وعروض أسعاره وطلباته) تبقى لدى ذلك النشاط، مع إزالة ارتباطك الشخصي بها.",
          "المعلومات التي يُلزمنا القانون بحفظها، مثل ما يلزم لحل نزاع أو الوفاء بالتزام ضريبي، وللمدة التي يحددها القانون فقط.",
        ),
      ],
    },
    {
      id: "timeline",
      heading: "٦. المدة المطلوبة",
      blocks: [p("نُكمل الحذف خلال ٣٠ يومًا من تأكيد طلبك، ونراسلك عند الانتهاء. وتُزال البيانات المحذوفة من النسخ الاحتياطية عند انتهاء صلاحيتها. لا يمكن التراجع عن الحذف؛ ولاستخدام علاء الدين مجددًا ستحتاج إلى إنشاء حساب جديد.")],
    },
    {
      id: "contact",
      heading: "٧. أسئلة",
      blocks: [p(`راسلنا على ${PRIVACY_CONTACT_EMAIL}. وتوضح سياسة الخصوصية على ${SITE_URL}/legal/privacy كيف نتعامل مع بياناتك.`)],
    },
  ],
};

/**
 * Terms of Service: the published text (PR #90). The page layout fields (aside photo line, closing contact band) follow the
 * approved layout in D:projectsLayoutpages.
 */
const termsEn: LegalDocument = {
  title: "Terms of Service",
  updatedLabel: "Last updated",
  contentsLabel: "On this page",
  writeToUs: "Email us at",
  contactLabel: "Contact us",
  updatedAt: "2026-10-18",
  aside: "We are building a more trusted, more professional environment for interior design and décor.",
  intro:
    "These Terms govern your use of Aladdin, the website and web application at aladdindecore.com that connects showrooms, suppliers, manufacturers, importers, contractors, engineers, installers and their customers in Egypt's finishing, construction and interior-design sector. By creating an account or using Aladdin you agree to these Terms and to our Privacy Policy.",
  sections: [
    {
      id: "about",
      heading: "1. About Aladdin",
      blocks: [
        p("Aladdin helps people and businesses find each other, share needs and requests, exchange quotations and follow up on projects. Aladdin is a platform that connects users. Unless we clearly say otherwise, we do not sell, supply, install or guarantee the products and services that users offer, and we are not a party to agreements made between users."),
        p("Aladdin is currently offered as a pilot release. Features may be added, changed or removed as the service develops."),
      ],
    },
    {
      id: "eligibility",
      heading: "2. Who can use Aladdin",
      blocks: [
        list(
          "You must be at least 18 years old and able to enter into a binding agreement.",
          "If you register or act for a business, you confirm that you are authorised to act for it, and the business is also bound by these Terms.",
          "You may not use Aladdin if we have previously suspended or removed your account, unless we agree otherwise.",
        ),
      ],
    },
    {
      id: "accounts",
      heading: "3. Your account",
      blocks: [
        list(
          "One person has one Aladdin account. You can sign in with email and password, phone and password, or Google or Facebook; these all lead to the same account.",
          "Give accurate information and keep it up to date, including your name, contact details, account type and any business details.",
          "Keep your password private and do not share your account. You are responsible for activity on your account. Tell us at once at " + PRIVACY_CONTACT_EMAIL + " if you think someone else has accessed it.",
          "A business account is a business you create or join. People in a business act within the role and permissions the business gives them.",
        ),
      ],
    },
    {
      id: "verification",
      heading: "4. Verification and reviews of businesses",
      blocks: [
        p("We may ask businesses and professionals for information to verify them, and we may approve, limit or decline a business or profile. A verified badge means we checked the information we asked for at that time. It is not an endorsement or a guarantee of the quality of anyone's work, products or prices."),
      ],
    },
    {
      id: "dealings",
      heading: "5. Dealings between users",
      blocks: [
        list(
          "Requests, quotations, offers, prices and job posts are made by users, not by Aladdin. Check details, prices, quality, licences and delivery terms directly with the other party before you agree to anything.",
          "Any purchase, contract, payment, delivery, installation or warranty is between you and the other user. Aladdin does not process payments between users.",
          "If you have a dispute with another user, try to resolve it with them first. You may report it to us and we may help where we reasonably can, but we are not obliged to resolve it.",
        ),
      ],
    },
    {
      id: "content",
      heading: "6. Your content",
      blocks: [
        p("You keep ownership of the content you add, such as profile and business details, photos, products, prices, offers, requests, quotations, reviews and messages. You give Aladdin a non-exclusive, royalty-free licence to host, store, display, reproduce and adapt that content only as needed to run, show and improve the service, for as long as it is on Aladdin."),
        p("You are responsible for your content. You confirm that you have the right to share it and that it is accurate, lawful and does not infringe anyone's rights. Reviews must reflect your real experience."),
      ],
    },
    {
      id: "acceptable-use",
      heading: "7. Acceptable use",
      blocks: [
        p("You must not:"),
        list(
          "post false, misleading or fraudulent information, prices, reviews or business details, or pretend to be another person or business;",
          "post illegal, offensive, harassing or discriminatory content, or content you do not have the rights to;",
          "send spam or unsolicited advertising, or use other users' contact details for anything other than the dealing they were shared for;",
          "collect data from Aladdin by scraping, bots or other automated means without our written permission;",
          "try to access accounts or data that are not yours, interfere with the security or operation of Aladdin, or get around limits or protections we use;",
          "use Aladdin in breach of any applicable law.",
        ),
      ],
    },
    {
      id: "fees",
      heading: "8. Fees",
      blocks: [
        p("Creating an account and using Aladdin's current features is free. If we introduce paid plans or features, we will show the price and terms before you choose them, and you will not be charged unless you agree."),
      ],
    },
    {
      id: "our-rights",
      heading: "9. Aladdin's intellectual property",
      blocks: [
        p("The Aladdin name, logo, design and software belong to Aladdin or its licensors. You may use them only to use the service as these Terms allow."),
      ],
    },
    {
      id: "suspension",
      heading: "10. Suspension and ending your account",
      blocks: [
        p(`You can stop using Aladdin at any time and ask us to delete your account as described at ${SITE_URL}/legal/data-deletion.`),
        p("We may remove content, limit features, or suspend or close an account if we reasonably believe these Terms or the law have been broken, to protect users or the platform, or if we are required to. Where appropriate we will tell you why and how to contact us about it."),
      ],
    },
    {
      id: "disclaimers",
      heading: "11. Disclaimers and limitation of liability",
      blocks: [
        p("We work to keep Aladdin available, accurate and secure, but it is provided as it is and as available. We do not guarantee that it will always be uninterrupted or error-free, or that information posted by users is correct."),
        p("To the extent the law allows, Aladdin is not liable for indirect or consequential losses, lost profits, or losses arising from dealings between users or from content posted by users. Nothing in these Terms limits any liability that cannot be limited under Egyptian law."),
      ],
    },
    {
      id: "changes",
      heading: "12. Changes to these Terms",
      blocks: [
        p("We may update these Terms. We will change the date at the top of this page, and tell you in the app or by email before an important change takes effect. If you keep using Aladdin after that, the updated Terms apply."),
      ],
    },
    {
      id: "law",
      heading: "13. Governing law",
      blocks: [
        p("These Terms are governed by the laws of the Arab Republic of Egypt. Disputes that cannot be settled amicably will be decided by the competent courts of Cairo, Egypt."),
      ],
    },
    {
      id: "contact",
      heading: "14. Contact us",
      blocks: [p(`Email ${PRIVACY_CONTACT_EMAIL} with any question about these Terms. Our Privacy Policy at ${SITE_URL}/legal/privacy explains how we handle your data.`)],
    },
  ],
};

const termsAr: LegalDocument = {
  title: "شروط الخدمة",
  updatedLabel: "آخر تحديث",
  contentsLabel: "محتويات الصفحة",
  writeToUs: "راسلنا على",
  contactLabel: "تواصل معنا",
  updatedAt: "2026-10-18",
  aside: "نبني بيئة أكثر موثوقية واحترافية لقطاع التصميم الداخلي والديكور.",
  intro:
    "تنظّم هذه الشروط استخدامك لعلاء الدين، الموقع والتطبيق على aladdindecore.com الذي يربط المعارض والموردين والمصنّعين والمستوردين والمقاولين والمهندسين والصنايعية وعملاءهم في قطاع التشطيبات والبناء والتصميم الداخلي في مصر. بإنشاء حساب أو استخدام علاء الدين فإنك توافق على هذه الشروط وعلى سياسة الخصوصية.",
  sections: [
    {
      id: "about",
      heading: "١. عن علاء الدين",
      blocks: [
        p("يساعد علاء الدين الأفراد والأنشطة التجارية على الوصول إلى بعضهم، وعرض الاحتياجات والطلبات، وتبادل عروض الأسعار، ومتابعة المشروعات. علاء الدين منصة تربط بين المستخدمين؛ وما لم نذكر غير ذلك صراحةً فنحن لا نبيع أو نورّد أو نركّب أو نضمن المنتجات والخدمات التي يقدّمها المستخدمون، ولسنا طرفًا في الاتفاقات التي تتم بينهم."),
        p("يُقدَّم علاء الدين حاليًا كإصدار تجريبي، وقد تُضاف خصائص أو تتغير أو تُزال مع تطور الخدمة."),
      ],
    },
    {
      id: "eligibility",
      heading: "٢. من يمكنه استخدام علاء الدين",
      blocks: [
        list(
          "يجب ألا يقل عمرك عن ١٨ عامًا وأن تكون أهلًا لإبرام اتفاق ملزم.",
          "إذا سجّلت نشاطًا تجاريًا أو تصرفت نيابةً عنه فأنت تؤكد أنك مخوّل بذلك، ويلتزم النشاط أيضًا بهذه الشروط.",
          "لا يجوز لك استخدام علاء الدين إذا سبق أن أوقفنا حسابك أو أزلناه، إلا إذا وافقنا على غير ذلك.",
        ),
      ],
    },
    {
      id: "accounts",
      heading: "٣. حسابك",
      blocks: [
        list(
          "لكل شخص حساب واحد في علاء الدين. يمكنك الدخول بالبريد الإلكتروني وكلمة المرور، أو رقم الهاتف وكلمة المرور، أو Google أو Facebook، وكلها تؤدي إلى الحساب نفسه.",
          "قدّم معلومات صحيحة وحدّثها باستمرار، بما فيها اسمك وبيانات التواصل ونوع الحساب وبيانات النشاط التجاري.",
          "حافظ على سرية كلمة المرور ولا تشارك حسابك مع غيرك؛ فأنت مسؤول عن النشاط الذي يتم من خلاله. أبلغنا فورًا على " + PRIVACY_CONTACT_EMAIL + " إذا شككت أن أحدًا دخل إلى حسابك.",
          "حساب النشاط التجاري هو نشاط تنشئه أو تنضم إليه، ويتصرف أعضاؤه في حدود الدور والصلاحيات التي يمنحها لهم النشاط.",
        ),
      ],
    },
    {
      id: "verification",
      heading: "٤. توثيق الأنشطة التجارية ومراجعتها",
      blocks: [
        p("قد نطلب من الأنشطة التجارية والمهنيين معلومات لتوثيقهم، وقد نقبل نشاطًا أو ملفًا أو نقيّده أو نرفضه. شارة التوثيق تعني أننا تحققنا من المعلومات التي طلبناها في ذلك الوقت، ولا تعني تزكية أو ضمانًا لجودة عمل أي أحد أو منتجاته أو أسعاره."),
      ],
    },
    {
      id: "dealings",
      heading: "٥. التعامل بين المستخدمين",
      blocks: [
        list(
          "الطلبات وعروض الأسعار والعروض والأسعار وإعلانات الوظائف يقدّمها المستخدمون وليس علاء الدين. تحقق من التفاصيل والأسعار والجودة والتراخيص وشروط التسليم مباشرةً مع الطرف الآخر قبل الاتفاق على أي شيء.",
          "أي شراء أو تعاقد أو دفع أو تسليم أو تركيب أو ضمان يكون بينك وبين المستخدم الآخر. لا يتولى علاء الدين تحصيل المدفوعات بين المستخدمين.",
          "إذا نشأ خلاف مع مستخدم آخر فحاول حله معه أولًا. يمكنك إبلاغنا به، وقد نساعد قدر استطاعتنا، لكننا غير ملزمين بحله.",
        ),
      ],
    },
    {
      id: "content",
      heading: "٦. المحتوى الخاص بك",
      blocks: [
        p("تظل مالكًا للمحتوى الذي تضيفه، مثل بيانات الملف والنشاط والصور والمنتجات والأسعار والعروض والطلبات وعروض الأسعار والتقييمات والرسائل. وتمنح علاء الدين ترخيصًا غير حصري وبدون مقابل لاستضافة هذا المحتوى وتخزينه وعرضه ونسخه وتعديل شكله فقط بالقدر اللازم لتشغيل الخدمة وعرضها وتحسينها، طوال وجوده على علاء الدين."),
        p("أنت مسؤول عن المحتوى الخاص بك، وتؤكد أن لك الحق في نشره وأنه صحيح وقانوني ولا يعتدي على حقوق أحد. ويجب أن تعكس التقييمات تجربتك الحقيقية."),
      ],
    },
    {
      id: "acceptable-use",
      heading: "٧. الاستخدام المقبول",
      blocks: [
        p("لا يجوز لك:"),
        list(
          "نشر معلومات أو أسعار أو تقييمات أو بيانات نشاط كاذبة أو مضللة أو احتيالية، أو انتحال صفة شخص أو نشاط آخر؛",
          "نشر محتوى غير قانوني أو مسيء أو فيه تحرش أو تمييز، أو محتوى لا تملك حقوقه؛",
          "إرسال رسائل مزعجة أو إعلانات غير مطلوبة، أو استخدام بيانات تواصل المستخدمين الآخرين لغير التعامل الذي شاركوها من أجله؛",
          "جمع البيانات من علاء الدين بالنسخ الآلي أو البرامج الآلية أو أي وسيلة آلية دون إذن كتابي منا؛",
          "محاولة الوصول إلى حسابات أو بيانات ليست لك، أو التأثير على أمان علاء الدين أو تشغيله، أو التحايل على الحدود أو وسائل الحماية التي نستخدمها؛",
          "استخدام علاء الدين بما يخالف أي قانون معمول به.",
        ),
      ],
    },
    {
      id: "fees",
      heading: "٨. الرسوم",
      blocks: [
        p("إنشاء الحساب واستخدام خصائص علاء الدين الحالية مجاني. وإذا أضفنا باقات أو خصائص مدفوعة فسنعرض السعر والشروط قبل أن تختارها، ولن يُخصم منك أي مبلغ دون موافقتك."),
      ],
    },
    {
      id: "our-rights",
      heading: "٩. الملكية الفكرية لعلاء الدين",
      blocks: [
        p("اسم علاء الدين وشعاره وتصميمه وبرمجياته مملوكة لعلاء الدين أو للجهات المرخِّصة لها، ولا يجوز لك استخدامها إلا لاستخدام الخدمة كما تسمح هذه الشروط."),
      ],
    },
    {
      id: "suspension",
      heading: "١٠. إيقاف الحساب وإنهاؤه",
      blocks: [
        p(`يمكنك التوقف عن استخدام علاء الدين في أي وقت وطلب حذف حسابك كما هو موضح على ${SITE_URL}/legal/data-deletion.`),
        p("قد نزيل محتوى أو نقيّد خصائص أو نوقف حسابًا أو نغلقه إذا اعتقدنا بشكل معقول أن هذه الشروط أو القانون قد خولفت، أو لحماية المستخدمين أو المنصة، أو إذا أُلزمنا بذلك. وعند الاقتضاء سنوضح لك السبب وكيف تتواصل معنا بشأنه."),
      ],
    },
    {
      id: "disclaimers",
      heading: "١١. إخلاء المسؤولية وحدودها",
      blocks: [
        p("نعمل على أن يكون علاء الدين متاحًا ودقيقًا وآمنًا، لكنه يُقدَّم بحالته وحسب إتاحته، ولا نضمن أن يعمل دائمًا دون انقطاع أو أخطاء، أو أن تكون المعلومات التي ينشرها المستخدمون صحيحة."),
        p("في الحدود التي يسمح بها القانون، لا يتحمل علاء الدين المسؤولية عن الخسائر غير المباشرة أو التبعية أو فوات الأرباح، أو الخسائر الناتجة عن التعامل بين المستخدمين أو عن المحتوى الذي ينشرونه. ولا يحدّ أي شيء في هذه الشروط من مسؤولية لا يجوز الحد منها وفق القانون المصري."),
      ],
    },
    {
      id: "changes",
      heading: "١٢. التغييرات على هذه الشروط",
      blocks: [
        p("قد نحدّث هذه الشروط، وعندها سنغيّر التاريخ أعلى الصفحة ونبلغك داخل التطبيق أو بالبريد قبل سريان أي تغيير جوهري. واستمرارك في استخدام علاء الدين بعد ذلك يعني سريان الشروط المحدّثة."),
      ],
    },
    {
      id: "law",
      heading: "١٣. القانون الواجب التطبيق",
      blocks: [
        p("تخضع هذه الشروط لقوانين جمهورية مصر العربية، وتختص محاكم القاهرة المختصة بنظر أي نزاع لا يُحل وديًا."),
      ],
    },
    {
      id: "contact",
      heading: "١٤. تواصل معنا",
      blocks: [p(`راسلنا على ${PRIVACY_CONTACT_EMAIL} لأي سؤال عن هذه الشروط. وتوضح سياسة الخصوصية على ${SITE_URL}/legal/privacy كيف نتعامل مع بياناتك.`)],
    },
  ],
};
const DOCUMENTS = {
  privacy: { en: privacyEn, ar: privacyAr },
  dataDeletion: { en: deletionEn, ar: deletionAr },
  terms: { en: termsEn, ar: termsAr },
} as const;

export type LegalDocumentKey = keyof typeof DOCUMENTS;

export function legalDocument(key: LegalDocumentKey, locale: Locale): LegalDocument {
  return DOCUMENTS[key][locale === "en" ? "en" : "ar"];
}
