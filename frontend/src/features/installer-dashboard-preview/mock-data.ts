import type { Locale } from "@/lib/i18n/locales";

/**
 * MOCK, FRONTEND-ONLY DEMO DATA — Phase 1 of the craftsman/technician dashboard
 * redesign (`/preview/installer-dashboard`).
 *
 * Nothing here reads Supabase, and nothing here is wired to the real
 * `job_opportunities` / `points_ledger` / `reviews` tables the live `/home`
 * dashboard reads. Every figure is authored, typed, and realistic for the
 * sector this product serves (see `docs/product/mvp-scope.md`'s trade list) so
 * the preview reads as a believable product rather than a wireframe. Phase 2
 * replaces this whole file with the real query layer — see the route's own
 * doc comment.
 */

/** A bilingual string pair. The product is Arabic-first; English is a first-class switch — never a string that only exists in one. */
export type Bi = { ar: string; en: string };

export function pick(locale: Locale, bi: Bi): string {
  return locale === "ar" ? bi.ar : bi.en;
}

export type TradeKey = "spc" | "ac" | "marble_alt" | "paint" | "wallpaper" | "wood_alt";

export const TRADE_LABEL: Record<TradeKey, Bi> = {
  spc: { ar: "أرضيات SPC", en: "SPC flooring" },
  ac: { ar: "تكييف", en: "Air conditioning" },
  marble_alt: { ar: "بديل رخام", en: "Marble alternative" },
  paint: { ar: "دهانات", en: "Paint" },
  wallpaper: { ar: "ورق حائط", en: "Wallpaper" },
  wood_alt: { ar: "بديل خشب", en: "Wood alternative" },
};

export type JobOpportunity = {
  id: string;
  trade: TradeKey;
  /** Path under `public/`, served by `next/image`. Real photography (sourced,
   *  see `public/assets/installer-dashboard/jobs/PROVENANCE.md`), replaced in
   *  Phase 2 by the craftsman's own portfolio image. */
  image: string;
  title: Bi;
  org: Bi;
  area: Bi;
  city: Bi;
  distanceKm: number;
  matchPercent: number;
  paymentEGP: number;
  durationDays: number;
  publishedAgo: Bi;
};

export const JOB_OPPORTUNITIES: JobOpportunity[] = [
  {
    id: "job-spc-zayed-villa",
    trade: "spc",
    image: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    title: { ar: "تركيب أرضيات SPC – فيلا سكنية", en: "SPC flooring install – residential villa" },
    org: { ar: "معرض المستقبل للأرضيات", en: "Al Mostakbal Flooring Showroom" },
    area: { ar: "الشيخ زايد", en: "Sheikh Zayed" },
    city: { ar: "الجيزة", en: "Giza" },
    distanceKm: 4.2,
    matchPercent: 96,
    paymentEGP: 12500,
    durationDays: 3,
    publishedAgo: { ar: "منذ يومين", en: "2 days ago" },
  },
  {
    id: "job-ac-tagamoa-office",
    trade: "ac",
    image: "/assets/installer-dashboard/jobs/ac-install.jpg",
    title: { ar: "صيانة وتركيب تكييف مركزي – مكتب إداري", en: "Central AC install & maintenance – office fit-out" },
    org: { ar: "كولد بريز للتكييف والتبريد", en: "Cold Breeze AC & Cooling" },
    area: { ar: "التجمع الخامس", en: "Fifth Settlement" },
    city: { ar: "القاهرة الجديدة", en: "New Cairo" },
    distanceKm: 7.8,
    matchPercent: 88,
    paymentEGP: 8200,
    durationDays: 1,
    publishedAgo: { ar: "منذ يوم واحد", en: "1 day ago" },
  },
  {
    id: "job-marble-madinaty-apartment",
    trade: "marble_alt",
    image: "/assets/installer-dashboard/jobs/marble-alt.jpg",
    title: { ar: "تركيب بديل رخام للحوائط – شقة عائلية", en: "Marble-alternative wall cladding – family apartment" },
    org: { ar: "معرض ماربل إكس", en: "MarbleX Showroom" },
    area: { ar: "مدينتي", en: "Madinaty" },
    city: { ar: "القاهرة الجديدة", en: "New Cairo" },
    distanceKm: 11.6,
    matchPercent: 81,
    paymentEGP: 6000,
    durationDays: 2,
    publishedAgo: { ar: "منذ ٥ ساعات", en: "5 hours ago" },
  },
];

export type ActionRequiredItem = {
  id: string;
  icon: "appointment" | "message" | "upload";
  title: Bi;
  subtitle: Bi;
  meta: Bi;
  ctaLabel: Bi;
};

export const ACTION_REQUIRED_ITEMS: ActionRequiredItem[] = [
  {
    id: "action-confirm-visit",
    icon: "appointment",
    title: { ar: "تأكيد موعد المعاينة", en: "Confirm the site visit" },
    subtitle: { ar: "تركيب SPC – معرض Modern Floors", en: "SPC install – Modern Floors Showroom" },
    meta: { ar: "اليوم، ١١:٠٠ ص", en: "Today, 11:00 AM" },
    ctaLabel: { ar: "تأكيد", en: "Confirm" },
  },
  {
    id: "action-new-message",
    icon: "message",
    title: { ar: "رسالة جديدة", en: "New message" },
    subtitle: { ar: "من معرض Marble Pro", en: "From Marble Pro Showroom" },
    meta: { ar: "منذ ١٠ دقائق", en: "10 minutes ago" },
    ctaLabel: { ar: "رد", en: "Reply" },
  },
  {
    id: "action-upload-photos",
    icon: "upload",
    title: { ar: "رفع صور الشغل", en: "Upload work photos" },
    subtitle: { ar: "بانتظار الصور", en: "Waiting on photos" },
    meta: { ar: "بديل رخام – مدينتي", en: "Marble alternative – Madinaty" },
    ctaLabel: { ar: "رفع", en: "Upload" },
  },
];

export type BrandEcosystemKind = "training" | "product" | "video" | "contest";

export type BrandEcosystemItem = {
  id: string;
  brand: string;
  /** Path under `public/`, the brand's own supplied logo — never recreated as text. */
  logo: string;
  kind: BrandEcosystemKind;
  kindLabel: Bi;
  title: Bi;
  tag?: Bi;
};

export const BRAND_ECOSYSTEM_ITEMS: BrandEcosystemItem[] = [
  {
    id: "brand-jotun",
    brand: "Jotun",
    logo: "/assets/installer-dashboard/brands/jotun.png",
    kind: "training",
    kindLabel: { ar: "تدريب جديد", en: "New training" },
    title: { ar: "دهانات داخلية احترافية", en: "Professional interior painting" },
  },
  {
    id: "brand-wpc",
    brand: "WPC Factory",
    logo: "/assets/installer-dashboard/brands/wpc-factory.png",
    kind: "product",
    kindLabel: { ar: "منتج جديد", en: "New product" },
    title: { ar: "ألواح بديل خشب مقاومة للماء", en: "Water-resistant WPC cladding boards" },
    tag: { ar: "+٣٠٠ نقطة", en: "+300 pts" },
  },
  {
    id: "brand-spc-academy",
    brand: "SPC Academy",
    logo: "/assets/installer-dashboard/brands/spc-academy.png",
    kind: "video",
    kindLabel: { ar: "فيديو تعليمي", en: "Tutorial video" },
    title: { ar: "شهادة معتمدة بعد الاختبار", en: "Certified badge after the quiz" },
  },
  {
    id: "brand-marblex",
    brand: "MarbleX",
    logo: "/assets/installer-dashboard/brands/marblex.webp",
    kind: "contest",
    kindLabel: { ar: "مسابقة أفضل تركيب", en: "Best-install contest" },
    title: { ar: "جوائز للفائزين هذا الشهر", en: "Prizes for this month's winners" },
  },
];

export type LearningItem = {
  id: string;
  kindLabel: Bi;
  title: Bi;
  icon: "training" | "video" | "workshop";
};

export const FEATURED_LEARNING = {
  title: { ar: "٣ أخطاء شائعة في تركيب أرضيات SPC", en: "3 common mistakes in SPC flooring installation" },
  source: { ar: "أكاديمية علاء الدين", en: "Aladdin Academy" },
  duration: { ar: "١٢ دقيقة", en: "12 min" },
} satisfies { title: Bi; source: Bi; duration: Bi };

export const LEARNING_ITEMS: LearningItem[] = [
  {
    id: "learn-spc-basics",
    kindLabel: { ar: "تدريب", en: "Training" },
    title: { ar: "تركيب أرضيات SPC للمبتدئين", en: "SPC flooring installation for beginners" },
    icon: "training",
  },
  {
    id: "learn-paint-video",
    kindLabel: { ar: "فيديو", en: "Video" },
    title: { ar: "دهانات داخلية احترافية خطوة بخطوة", en: "Professional interior painting, step by step" },
    icon: "video",
  },
  {
    id: "learn-marble-workshop",
    kindLabel: { ar: "ورشة عمل", en: "Workshop" },
    title: { ar: "بديل الرخام: من القياس للتركيب", en: "Marble alternative: from measuring to install" },
    icon: "workshop",
  },
];

export const REWARDS = {
  points: 4850,
  nextLevelAt: 5000,
  levelLabel: { ar: "محترف فضي", en: "Silver Pro" },
  nextLevelLabel: { ar: "محترف ذهبي", en: "Gold Pro" },
  recentReward: { ar: "قسيمة شراء بقيمة ٢٠٠ جنيه", en: "EGP 200 purchase voucher" },
  recentRewardAgo: { ar: "منذ ٣ أيام", en: "3 days ago" },
} satisfies {
  points: number;
  nextLevelAt: number;
  levelLabel: Bi;
  nextLevelLabel: Bi;
  recentReward: Bi;
  recentRewardAgo: Bi;
};

export const PROFILE = {
  name: { ar: "أحمد سعيد", en: "Ahmed Saeed" },
  persona: { ar: "فني تركيب أرضيات وتشطيبات", en: "Flooring & finishing installer" },
  /** Demo state for `ProfileCompletionBanner`: renders while < 100, never once complete. */
  completionPercent: 80,
  completionHint: { ar: "أضف ٣ صور أعمال لزيادة ظهورك للمعارض", en: "Add 3 portfolio photos to appear more to showrooms" },
  verified: true,
  verifiedHint: { ar: "تم توثيق رقم الهاتف والهوية", en: "Phone number and ID verified" },
  rating: 4.8,
  ratingCount: 126,
  completedJobs: 214,
} satisfies {
  name: Bi;
  persona: Bi;
  completionPercent: number;
  completionHint: Bi;
  verified: boolean;
  verifiedHint: Bi;
  rating: number;
  ratingCount: number;
  completedJobs: number;
};

export const NEARBY_OPPORTUNITIES_COUNT = 3;
