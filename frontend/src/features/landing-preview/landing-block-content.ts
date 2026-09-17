type Copy = {
  how: string; flow: { title: string; text: string }[]; rolesTitle: string;
  roles: { title: string; bullets: string[] }[]; learn: string;
  videos: string; videoAction: string; videoCategories: string[];
  videoPending: string; videoDescription: string; durationPending: string;
  brands: string; brandNote: string; partnerAction: string; stories: string; quotePending: string;
  namePending: string; rolePending: string; cta: string; ctaText: string;
  register: string; contact: string; footerDescription: string; quickLinks: string;
  account: string; support: string; signIn: string; privacy: string;
  terms: string; help: string; supportText: string; copyright: string;
};

export const landingBlockContent = {
  ar: {
    how: "كيف يعمل Aladdin؟",
    flow: [
      { title: "المصنّعون والمستوردون", text: "يعرضون المنتجات والمواصفات لتصل إلى السوق" },
      { title: "الموزعون", text: "يربطون المنتجات باحتياجات المعارض" },
      { title: "المعارض", text: "تعرض الخيارات وتستقبل طلبات العملاء" },
      { title: "فريق المبيعات", text: "يحوّل الاحتياج إلى عرض ومتابعة" },
      { title: "الصنايعية والفنيون", text: "يعرضون خبراتهم ويتابعون أعمال التنفيذ" },
      { title: "العميل النهائي", text: "يستكشف الخيارات ويختار ما يناسب مشروعه" },
    ],
    rolesTitle: "لأن كل دور مهم",
    roles: [
      { title: "للمصنّعين والمستوردين", bullets: ["كتالوج المنتجات والمواصفات", "استقبال طلبات عروض الأسعار", "إعداد العروض ومتابعة الطلبات", "إدارة فريق العمل"] },
      { title: "للموزعين", bullets: ["تنظيم كتالوج المنتجات", "متابعة طلبات العملاء", "إعداد عروض الأسعار", "التواصل حول الطلبات"] },
      { title: "للمعارض", bullets: ["اكتشاف المنتجات والموزعين", "إرسال طلبات عروض الأسعار", "مراجعة العروض واتخاذ القرار", "متابعة الطلبات والعملاء"] },
      { title: "لفريق المبيعات", bullets: ["تنظيم العملاء والفرص", "تسجيل احتياجات العميل", "متابعة العروض والمهام", "العمل ضمن فريق المعرض"] },
      { title: "للصنايعية والفنيين", bullets: ["عرض الأعمال والخبرات", "اكتشاف فرص التنفيذ", "التقدّم للأعمال المناسبة", "متابعة التنفيذ والتقييمات"] },
    ],
    learn: "اعرف المزيد", videos: "شاهد وتعرّف على المنتجات وتجربة المنصة", videoAction: "عرض كل الفيديوهات",
    videoCategories: ["عن Aladdin", "المنتجات", "التنفيذ", "من القطاع", "تجارب المستخدمين"],
    videoPending: "الفيديو بانتظار النشر", videoDescription: "يُضاف العنوان والوصف بعد اعتماد المحتوى.", durationPending: "المدة غير متاحة",
    brands: "علامات وشركات في قطاع التشطيبات", partnerAction: "عرض جميع الشركاء", brandNote: "الشعارات للعرض؛ لا تعني شراكة مع Aladdin",
    stories: "تجارب من مجتمع Aladdin", quotePending: "مساحة لشهادة عميل موثّقة. تُنشر التجربة بعد اعتماد النص وموافقة صاحبها.",
    namePending: "الاسم بانتظار الاعتماد", rolePending: "الصفة والشركة بانتظار الاعتماد",
    cta: "انضم إلى مجتمع التشطيبات على Aladdin", ctaText: "ابدأ بحساب واحد واربط احتياجاتك بأعمالك.",
    register: "إنشاء حساب", contact: "تواصل معنا",
    footerDescription: "منصة تجمع الشركات والمبيعات والمحترفين وأصحاب المشاريع، من الاحتياج إلى القرار والتنفيذ.",
    quickLinks: "روابط سريعة", account: "حسابك", support: "تواصل معنا", signIn: "تسجيل الدخول",
    privacy: "الخصوصية", terms: "الشروط", help: "المساعدة والدعم",
    supportText: "للاستفسارات والمساعدة في الوصول إلى حسابك، زر صفحة الدعم.", copyright: "© Aladdin. جميع الحقوق محفوظة.",
  },
  en: {
    how: "How Aladdin works",
    flow: [
      { title: "Manufacturers & importers", text: "Bring products and specifications to the market" },
      { title: "Distributors", text: "Connect products with showroom needs" },
      { title: "Showrooms", text: "Present options and receive customer requests" },
      { title: "Sales teams", text: "Turn a need into a quote and follow-up" },
      { title: "Installers & technicians", text: "Show expertise and follow execution work" },
      { title: "End consumers", text: "Explore options and choose for their project" },
    ],
    rolesTitle: "Every role matters",
    roles: [
      { title: "Manufacturers & importers", bullets: ["Product and specification catalogue", "Receive requests for quotations", "Prepare quotes and track orders", "Manage your team"] },
      { title: "Distributors", bullets: ["Organize your product catalogue", "Follow customer requests", "Prepare quotations", "Discuss orders in context"] },
      { title: "Showrooms", bullets: ["Discover products and distributors", "Request quotations", "Review offers and decide", "Follow orders and customers"] },
      { title: "Sales teams", bullets: ["Organize customers and opportunities", "Capture customer needs", "Follow quotations and tasks", "Work with your showroom team"] },
      { title: "Installers & technicians", bullets: ["Show your work and expertise", "Discover execution opportunities", "Apply for suitable work", "Track execution and reviews"] },
    ],
    learn: "Learn more", videos: "Discover products and the platform in action", videoAction: "View all videos",
    videoCategories: ["About Aladdin", "Products", "Execution", "From the sector", "User experiences"],
    videoPending: "Video awaiting publication", videoDescription: "Title and description will follow content approval.", durationPending: "Duration unavailable",
    brands: "Brands and businesses in finishing", partnerAction: "View all partners", brandNote: "Logos are a showcase, not an Aladdin partnership claim",
    stories: "Stories from the Aladdin community", quotePending: "Reserved for a verified customer story. Published after the quote is approved and its author consents.",
    namePending: "Name awaiting approval", rolePending: "Role and company awaiting approval",
    cta: "Join the finishing community on Aladdin", ctaText: "Start with one account. Connect your needs and your work.",
    register: "Create account", contact: "Contact us",
    footerDescription: "Connecting businesses, sales teams, professionals and project owners, from a need to a decision and execution.",
    quickLinks: "Quick links", account: "Your account", support: "Contact us", signIn: "Sign in",
    privacy: "Privacy", terms: "Terms", help: "Help and support",
    supportText: "For questions and help accessing your account, visit our support page.", copyright: "© Aladdin. All rights reserved.",
  },
} satisfies Record<"ar" | "en", Copy>;

export const landingLogos = [
  { file: "venecia.png", name: "Venecia" },
  { file: "shbab.png", name: "Shabana Stores" },
  { file: "ahmed-el-sallab.png", name: "Ahmed El Sallab" },
  { file: "elsalam.png", name: "Elsalam for Trading and Import" },
  { file: "konouz.png", name: "Konouz Decoration" },
  { file: "jazeerah.png", name: "Jazeera Paints" },
  { file: "glc.png", name: "GLC Paints" },
  { file: "jotun.png", name: "Jotun" },
  { file: "scib.png", name: "SCIB Paints" },
] as const;
