export type IconName =
  | "grid" | "user-plus" | "play" | "users" | "building" | "layers" | "home" | "compass" | "wrench" | "cart" | "tag"
  | "shield" | "star" | "bolt" | "headset" | "search" | "check" | "monitor" | "phone" | "clock" | "arrow" | "bag"
  | "chart" | "diamond" | "sofa" | "heart" | "chevron";

type Copy = {
  nav: { label: string; items: [string, string][]; signIn: string; register: string; registerTitle: string; soon: string; menu: string };
  hero: { title: string; accent: string; titleTail: string; body: string; discover: string; create: string; video: string; stats: { users: string; orgs: string; products: string } };
  roles: { eyebrow: string; title: string; more: string; items: { icon: IconName; img: string; title: string; body: string }[] };
  services: { eyebrow: string; title: string; body: string; items: { icon: IconName; title: string; body: string }[] };
  market: { eyebrow: string; title: string; body: string; all: string; browse: string; currency: string };
  how: { eyebrow: string; title: string; steps: { icon: IconName; title: string; body: string }[] };
  why: { eyebrow: string; title: string; items: { icon: IconName; title: string; body: string }[] };
  experience: { eyebrow: string; title: string; body: string; items: { icon: IconName; label: string }[]; alt: string };
  partners: { title: string; body: string };
  faq: { title: string; body: string; items: [string, string][] };
  cta: { title: string; accent: string; body: string; discover: string; create: string };
  footer: { tagline: string; about: string; quick: string; platform: string; support: string; follow: string; rights: string; quickLinks: string[]; platformLinks: string[]; supportLinks: string[] };
};

export const brandContent: Copy = {
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
  market: { eyebrow: "سوق المنتجات", title: "اكتشف أحدث منتجات التشطيب والديكور", body: "تشكيلة واسعة من المنتجات عالية الجودة لتلبية جميع احتياجات مشروعك، من الأرضيات والحوائط إلى الإضاءة والأثاث والإكسسوارات.", all: "الكل", browse: "تصفح كل المنتجات", currency: "ج.م" },
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

export const PARTNER_NAMES = ["JOTUN", "GROHE", "Roca", "KOHLER", "PORCELANOSA"] as const;
