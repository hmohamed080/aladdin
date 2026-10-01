export type AccountCopy = { ar: string; en: string };
export type Specialty = AccountCopy & { value: string };
export type { LocationOption } from "@/lib/installer/location-data";
export { CITIES_BY_GOVERNORATE, GOVERNORATE_OPTIONS } from "@/lib/installer/location-data";

export const PROFILE_STEPS = [
  { id: "basic", number: 1, label: { ar: "المعلومات الأساسية", en: "Basic information" } },
  { id: "availability", number: 2, label: { ar: "إتاحة العمل", en: "Work availability" } },
  { id: "portfolio", number: 3, label: { ar: "سابقة الأعمال", en: "Work history" } },
  { id: "coverage", number: 4, label: { ar: "نطاق العمل", en: "Work coverage" } },
] as const;

// Persistence contract for the future portfolio backend.
export const MAX_PORTFOLIO_PROJECTS = 10;
export const MAX_PORTFOLIO_IMAGES = 8;

export const SPECIALTIES: Specialty[] = [
  { value: "wallpaper-installation", en: "Wallpaper installation", ar: "تركيب ورق حائط" },
  { value: "gypsum-board-installation", en: "Gypsum board installation", ar: "تركيب جبس بورد" },
  { value: "wood-alternative-installation", en: "Wood-alternative installation", ar: "تركيب بديل الخشب" },
  { value: "marble-alternative-installation", en: "Marble-alternative installation", ar: "تركيب بديل الرخام" },
  { value: "vinyl-flooring-installation", en: "Vinyl flooring installation", ar: "تركيب أرضيات فينيل" },
  { value: "hdf-flooring-installation", en: "HDF flooring installation", ar: "تركيب أرضيات HDF" },
  { value: "painter-decorator", en: "Painter / decorator", ar: "نقاش ودهانات" },
  { value: "spray-painting", en: "Spray painting & surface prep", ar: "رش دوكو وتأسيس دهانات" },
  { value: "decorative-finishes", en: "Decorative finishes", ar: "تشطيبات ودهانات ديكورية" },
  { value: "wood-finishing", en: "Wood finishing & polishing (Astarji)", ar: "أسترجي وتشطيب أخشاب" },
  { value: "plastering-gypsum", en: "Plastering & gypsum", ar: "محارة وجبس" },
  { value: "epoxy-flooring", en: "Epoxy flooring", ar: "أرضيات إيبوكسي" },
  { value: "door-installation", en: "Door installation", ar: "تركيب أبواب" },
  { value: "futec-installation", en: "Futec installation", ar: "تركيب فيوتك" },
];

export const DEFAULT_SPECIALTIES = [
  "painter-decorator",
  "hdf-flooring-installation",
  "marble-alternative-installation",
] as const;

export const AVAILABILITY_OPTIONS = [
  { id: "week", label: { ar: "خلال أسبوع", en: "Within a week" } },
  { id: "month", label: { ar: "خلال شهر", en: "Within a month" } },
  { id: "on-demand", label: { ar: "حسب الطلب", en: "On demand" } },
] as const;

export const PORTFOLIO_PROJECTS = [
  {
    id: "wood-flooring",
    title: { ar: "تركيب أرضيات خشبية", en: "Wood flooring installation" },
    location: { ar: "الجيزة · الشيخ زايد", en: "Giza · Sheikh Zayed" },
    description: {
      ar: "تركيب أرضيات خشبية لشقة ٢٠٠ متر مع تسليم التشطيب كاملًا.",
      en: "Installed wood flooring in a 200 m² apartment with complete finishing.",
    },
    cover: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    thumbnails: [
      "/assets/installer-dashboard/jobs/spc-flooring.jpg",
      "/assets/installer-dashboard/jobs/decorative-wall.png",
      "/assets/installer-dashboard/jobs/marble-alt.jpg",
    ],
    extraCount: 3,
  },
  {
    id: "villa-finishing",
    title: { ar: "تشطيب فيلا خاصة", en: "Private villa finishing" },
    location: { ar: "القاهرة · التجمع الخامس", en: "Cairo · Fifth Settlement" },
    description: {
      ar: "تنفيذ التشطيب الكامل للفيلا، بما يشمل الدهانات والديكورات الداخلية.",
      en: "Completed the villa finishing, including paintwork and interior detailing.",
    },
    cover: "/assets/installer-dashboard/jobs/interior-painting.png",
    thumbnails: [
      "/assets/installer-dashboard/jobs/interior-painting.png",
      "/assets/installer-dashboard/jobs/gypsum-ceiling.png",
      "/assets/installer-dashboard/jobs/marble-alt.jpg",
    ],
    extraCount: 4,
  },
] as const;

export const COVERAGE_AREAS = [
  { ar: "القاهرة", en: "Cairo" },
  { ar: "الجيزة", en: "Giza" },
  { ar: "القليوبية", en: "Qalyubia" },
] as const;

export const QUICK_TIPS = [
  { ar: "أضف صورة واضحة لمشاريعك", en: "Add clear photos of your projects" },
  { ar: "اكتب نبذة مختصرة عن كل مشروع", en: "Write a short summary for each project" },
  { ar: "اختر تخصصات دقيقة", en: "Choose precise specialties" },
  { ar: "كلما زادت التفاصيل زادت فرصك", en: "More detail improves your opportunities" },
] as const;
