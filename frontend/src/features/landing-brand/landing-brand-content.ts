import type { Locale } from "@/lib/i18n/locales";

export type IconName =
  | "grid" | "user-plus" | "play" | "users" | "building" | "layers" | "home" | "compass" | "wrench" | "cart" | "tag"
  | "shield" | "star" | "bolt" | "headset" | "search" | "check" | "monitor" | "phone" | "clock" | "arrow" | "bag"
  | "chart" | "diamond" | "sofa" | "heart" | "chevron";

type Copy = {
  nav: { label: string; items: [string, string][]; signIn: string; register: string; registerTitle: string; soon: string; menu: string };
  hero: { title: string; accent: string; titleTail: string; body: string; discover: string; create: string; video: string; stats: { users: string; orgs: string; products: string } };
  roles: { eyebrow: string; title: string; more: string; items: { icon: IconName; img: string; title: string; body: string }[] };
  services: { eyebrow: string; title: string; body: string; items: { icon: IconName; title: string; body: string }[] };
  market: { eyebrow: string; title: string; body: string; all: string; browse: string; sample: string; currency: string };
  how: { eyebrow: string; title: string; steps: { icon: IconName; title: string; body: string }[] };
  why: { eyebrow: string; title: string; items: { icon: IconName; title: string; body: string }[] };
  experience: { eyebrow: string; title: string; body: string; items: { icon: IconName; label: string }[]; alt: string };
  partners: { title: string; body: string };
  faq: { title: string; body: string; items: [string, string][] };
  cta: { title: string; accent: string; body: string; discover: string; create: string };
  footer: { tagline: string; about: string; quick: string; platform: string; support: string; follow: string; rights: string; quickLinks: string[]; platformLinks: string[]; supportLinks: string[] };
};

const ar: Copy = {
  nav: { label: "التنقل الرئيسي", items: [["الرئيسية", "#top"], ["المنتجات", "#market"], ["الشركات والمعارض", "#roles"], ["المحترفون", "#roles"], ["عن علاء الدين", "#why"], ["تواصل معنا", "#footer"]], signIn: "دخول", register: "أنشئ حسابك", registerTitle: "اختر نوع حسابك", soon: "قريبًا", menu: "القائمة" },
  hero: { title: "ارتقِ بمشروعك مع منصة", accent: "علاء الدين", titleTail: "للتشطيبات والديكور", body: "منصة متكاملة تساعدك على اكتشاف المنتجات، والتواصل مع أهم الشركات والمعارض، والوصول إلى نخبة من المحترفين في مجال التشطيبات والديكور، كل ذلك في مكان واحد.", discover: "اكتشف المنتجات", create: "أنشئ حسابك", video: "شاهد الفيديو", stats: { users: "مستخدم", orgs: "شركة ومعرض", products: "منتج" } },
  roles: { eyebrow: "لمن صُممت منصة علاء الدين؟", title: "حلول متكاملة لكل من يعمل في عالم التشطيبات والديكور", more: "اكتشف المزيد", items: [
    { icon: "home", img: "role_home", title: "الأفراد وأصحاب المشاريع", body: "اكتشف المنتجات، واستلهم الأفكار، وتواصل مع أفضل الشركات والمحترفين لتنفيذ مشروعك." },
    { icon: "building", img: "role_company", title: "الشركات والمعارض", body: "اعرض منتجاتك وخدماتك أمام آلاف العملاء، ووسّع نطاق وصولك في السوق." },
    { icon: "compass", img: "role_design", title: "المصممون والمهندسون", body: "اعثر على أحدث الخامات والمنتجات، وتواصل مع موردين موثوقين لتنفيذ تصاميمك باحترافية." },
    { icon: "wrench", img: "role_tech", title: "الفنيون والمقاولون", body: "اكتشف فرص عمل ومشاريع جديدة، وتواصل مباشرة مع العملاء والشركات في مجالك." },
  ] },
  services: { eyebrow: "خدمات المنصة", title: "كل ما تحتاجه لمشروع تشطيب وديكور متكامل", body: "تجمع منصة علاء الدين بين سوق منتجات متنوع، ودليل شامل للشركات والمعارض، وشبكة واسعة من الخبراء والمحترفين، لتمنحك تجربة متكاملة من البحث والمقارنة والتواصل وحتى التنفيذ.", items: [
    { icon: "cart", title: "سوق المنتجات", body: "آلاف المنتجات من أفضل العلامات التجارية" },
    { icon: "building", title: "دليل الشركات", body: "معارض وشركات موثوقة في مكان واحد" },
    { icon: "users", title: "شبكة المحترفين", body: "مصممون، مهندسون، ومقاولون بخبرات متنوعة" },
    { icon: "layers", title: "أدوات ذكية", body: "بحث متقدم، مقارنة، وعروض مخصصة" },
  ] },
  market: { eyebrow: "سوق المنتجات", title: "اكتشف أحدث منتجات التشطيب والديكور", body: "تشكيلة من المنتجات لتلبية احتياجات مشروعك، من ورق الحائط وبدائل الخشب والرخام إلى الكرانيش وزوايا التشطيب.", all: "الكل", browse: "تصفح كل المنتجات", sample: "عينة للمعاينة — الأسعار والمنتجات إرشادية", currency: "ج.م" },
  how: { eyebrow: "كيف تعمل المنصة؟", title: "ثلاث خطوات بسيطة للانطلاق", steps: [
    { icon: "user-plus", title: "أنشئ حسابك", body: "سجّل كفرد أو شركة أو محترف في دقائق." },
    { icon: "search", title: "اكتشف وتواصل", body: "ابحث عن المنتجات، الشركات أو المحترفين المناسبين." },
    { icon: "check", title: "نفّذ مشروعك", body: "قارن العروض، اختر الأفضل، وابدأ تنفيذ مشروعك بثقة." },
  ] },
  why: { eyebrow: "لماذا علاء الدين؟", title: "مزايا تمنحك تجربة أفضل ونتائج أكثر احترافية", items: [
    { icon: "shield", title: "موثوقية أعلى", body: "شركات ومحترفون معتمدون ومقيّمون" },
    { icon: "star", title: "خيارات أوسع", body: "آلاف المنتجات والحلول في مكان واحد" },
    { icon: "bolt", title: "توفير الوقت والجهد", body: "بحث ذكي وتجربة سهلة وسريعة" },
    { icon: "headset", title: "دعم مستمر", body: "فريق متخصص لمساعدتك في كل خطوة" },
  ] },
  experience: { eyebrow: "تجربة المنصة", title: "منصة متكاملة .. في كل مكان", body: "استمتع بتجربة سلسة وعصرية على جميع أجهزتك، واطّلع على المنتجات، واكتشف الشركات والمحترفين، وتابع مشروعك بسهولة أينما كنت.", items: [{ icon: "monitor", label: "تصميم عصري وسهل الاستخدام" }, { icon: "phone", label: "متوافق مع جميع الأجهزة" }, { icon: "clock", label: "تجربة سريعة ومستقرة" }], alt: "المنصة على اللابتوب والموبايل" },
  partners: { title: "شركاؤنا في النجاح", body: "نفخر بالتعاون مع نخبة من العلامات والشركات الرائدة في مجال التشطيبات والديكور." },
  faq: { title: "الأسئلة الشائعة", body: "أهم الإجابات التي قد تحتاجها عن منصة علاء الدين", items: [
    ["ما هي منصة علاء الدين؟", "منصة تجمع المنتجات والشركات والمعارض والمحترفين في مجال التشطيبات والديكور في مكان واحد."],
    ["هل يمكنني التسجيل كفرد أو شركة؟", "نعم. عند إنشاء حسابك تختار نوعه: معرض أو مورّد أو مصنّع أو مستورد أو حِرفيون أو فريق مبيعات، ويتوفر قريبًا حساب للمقاولين والمهندسين والأفراد."],
    ["كيف يمكنني عرض منتجاتي على المنصة؟", "أنشئ حسابًا بنوع نشاطك (معرض أو مورّد أو مصنّع أو مستورد)، وأكمل بيانات نشاطك، ثم أضف منتجاتك بصورها وأسعارها ومواصفاتها لتظهر للعملاء في سوق المنتجات."],
    ["هل التواصل مع الشركات والمحترفين يتم من خلال المنصة؟", "نعم، من صفحة أي منتج أو شركة يمكنك مراسلة صاحبها مباشرة وطلب عرض سعر، وتتابع الرد من حسابك دون الحاجة لوسيط."],
  ] },
  cta: { title: "ابدأ مشروعك الآن مع", accent: "علاء الدين", body: "اكتشف المنتجات، وتواصل مع الشركات والمحترفين، وحوّل أفكارك إلى واقع.", discover: "اكتشف المنتجات", create: "أنشئ حسابك مجانًا" },
  footer: { tagline: "منصة التشطيبات والديكور", about: "منصة متكاملة تجمع بين المنتجات، الشركات، والمحترفين في عالم التشطيبات والديكور.", quick: "روابط سريعة", platform: "عن المنصة", support: "الدعم", follow: "تابعنا على", rights: "© 2026 منصة علاء الدين. جميع الحقوق محفوظة", quickLinks: ["الرئيسية", "المنتجات", "الشركات والمعارض", "المحترفون"], platformLinks: ["عن علاء الدين", "مزايا المنصة", "كيف تعمل المنصة", "الأسئلة الشائعة"], supportLinks: ["تواصل معنا", "مركز المساعدة", "سياسة الخصوصية", "شروط الاستخدام"] },
};

const en: Copy = {
  nav: { label: "Primary navigation", items: [["Home", "#top"], ["Products", "#market"], ["Companies & showrooms", "#roles"], ["Professionals", "#roles"], ["About Aladdin", "#why"], ["Contact us", "#footer"]], signIn: "Sign in", register: "Create account", registerTitle: "Choose your account type", soon: "Coming soon", menu: "Menu" },
  hero: { title: "Elevate your project with the", accent: "Aladdin", titleTail: "finishing & décor platform", body: "One platform to discover products, connect with leading companies and showrooms, and reach top professionals in finishing and interior design — all in one place.", discover: "Discover products", create: "Create account", video: "Watch the video", stats: { users: "users", orgs: "companies & showrooms", products: "products" } },
  roles: { eyebrow: "Who is Aladdin built for?", title: "Complete solutions for everyone in finishing and interior design", more: "Learn more", items: [
    { icon: "home", img: "role_home", title: "Individuals & project owners", body: "Discover products, find inspiration, and connect with the best companies and professionals to deliver your project." },
    { icon: "building", img: "role_company", title: "Companies & showrooms", body: "Showcase your products and services to thousands of customers and widen your reach in the market." },
    { icon: "compass", img: "role_design", title: "Designers & engineers", body: "Find the latest materials and products and connect with trusted suppliers to deliver your designs professionally." },
    { icon: "wrench", img: "role_tech", title: "Technicians & contractors", body: "Discover new jobs and projects, and connect directly with customers and companies in your field." },
  ] },
  services: { eyebrow: "Platform services", title: "Everything you need for a complete finishing and décor project", body: "Aladdin brings together a diverse product market, a complete directory of companies and showrooms, and a wide network of experts and professionals — from search and comparison to contact and delivery.", items: [
    { icon: "cart", title: "Product market", body: "Products from leading brands" },
    { icon: "building", title: "Company directory", body: "Trusted showrooms and companies in one place" },
    { icon: "users", title: "Professional network", body: "Designers, engineers and contractors with diverse expertise" },
    { icon: "layers", title: "Smart tools", body: "Advanced search, comparison and tailored offers" },
  ] },
  market: { eyebrow: "Product market", title: "Discover the latest finishing and décor products", body: "A range of products for your project, from wallpaper and wood- and marble-look boards to cornices and corner trims.", all: "All", browse: "Browse all products", sample: "Preview sample — products and prices are indicative", currency: "EGP" },
  how: { eyebrow: "How does it work?", title: "Three simple steps to get started", steps: [
    { icon: "user-plus", title: "Create your account", body: "Sign up as an individual, company or professional in minutes." },
    { icon: "search", title: "Discover and connect", body: "Search for the right products, companies or professionals." },
    { icon: "check", title: "Deliver your project", body: "Compare offers, choose the best, and start your project with confidence." },
  ] },
  why: { eyebrow: "Why Aladdin?", title: "Benefits that give you a better experience and more professional results", items: [
    { icon: "shield", title: "Greater trust", body: "Verified and rated companies and professionals" },
    { icon: "star", title: "More choice", body: "Products and solutions in one place" },
    { icon: "bolt", title: "Save time and effort", body: "Smart search and a fast, easy experience" },
    { icon: "headset", title: "Ongoing support", body: "A dedicated team to help at every step" },
  ] },
  experience: { eyebrow: "The experience", title: "One platform .. everywhere", body: "Enjoy a smooth, modern experience on all your devices — browse products, discover companies and professionals, and follow your project wherever you are.", items: [{ icon: "monitor", label: "Modern, easy-to-use design" }, { icon: "phone", label: "Works on every device" }, { icon: "clock", label: "Fast and stable" }], alt: "The platform on laptop and mobile" },
  partners: { title: "Our partners in success", body: "We are proud to work with leading brands and companies in finishing and interior design." },
  faq: { title: "Frequently asked questions", body: "The answers you are most likely to need about Aladdin", items: [
    ["What is Aladdin?", "A platform that brings products, companies, showrooms and professionals in finishing and interior design together in one place."],
    ["Can I sign up as an individual or a company?", "Yes. When you create your account you choose its type: showroom, supplier, manufacturer, importer, craftsman or sales team. Accounts for contractors, engineers and individuals are coming soon."],
    ["How can I list my products on the platform?", "Create an account for your business type (showroom, supplier, manufacturer or importer), complete your business details, then add your products with photos, prices and specifications so customers can find them in the product market."],
    ["Can I contact companies and professionals through the platform?", "Yes. From any product or company page you can message its owner directly and request a quote, and follow the reply from your account without an intermediary."],
  ] },
  cta: { title: "Start your project now with", accent: "Aladdin", body: "Discover products, connect with companies and professionals, and turn your ideas into reality.", discover: "Discover products", create: "Create your free account" },
  footer: { tagline: "The finishing & décor platform", about: "A complete platform bringing products, companies and professionals together in finishing and interior design.", quick: "Quick links", platform: "About the platform", support: "Support", follow: "Follow us", rights: "© 2026 Aladdin. All rights reserved", quickLinks: ["Home", "Products", "Companies & showrooms", "Professionals"], platformLinks: ["About Aladdin", "Platform benefits", "How it works", "FAQ"], supportLinks: ["Contact us", "Help centre", "Privacy policy", "Terms of use"] },
};

export const brandContent: Record<Locale, Copy> = { ar, en };
export const PARTNER_NAMES = ["JOTUN", "GROHE", "Roca", "KOHLER", "PORCELANOSA"] as const;
