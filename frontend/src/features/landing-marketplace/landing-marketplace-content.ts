/**
 * Landing "Aladdin Marketplace" section — copy and PREVIEW product data.
 *
 * Everything in `previewProducts` is clearly isolated sample data. The section
 * renders a visible "preview" label while it is the source, so none of these
 * prices or offers can be read as live commercial offers. When the Marketplace
 * backend exists this module's data is replaced by the public Marketplace
 * projection; the components only depend on the `LandingProduct` shape.
 */

export type MarketplaceTypeKey =
  | "wallpaper"
  | "wood_alternative"
  | "marble_alternative"
  | "sheeboard"
  | "cornice"
  | "corner_trim";

export type CategoryFilter = "all" | MarketplaceTypeKey;

export type SaleUnit = "roll" | "board" | "bar" | "piece" | "square_meter";

export type LandingOffer = {
  kind: "regular" | "flash";
  /** A real prior price. A struck-through price is rendered only from this field. */
  referencePriceEgp: number;
  /** Flash only. Epoch ms. The countdown is derived from it; past values are expired. */
  endsAt?: number | null;
};

export type LandingProduct = {
  id: string;
  type: MarketplaceTypeKey;
  image: string;
  unit: SaleUnit;
  /** Selling price in EGP, EXCLUSIVE of taxes (D-15). */
  priceEgp: number;
  offer?: LandingOffer;
  /** Shown in the "All" view (one per type); the rest appear under their type tab. */
  featured?: boolean;
  copy: Record<"ar" | "en", { title: string; description: string }>;
};

export const categoryOrder: MarketplaceTypeKey[] = [
  "wallpaper",
  "wood_alternative",
  "marble_alternative",
  "sheeboard",
  "cornice",
  "corner_trim",
];

type Copy = {
  eyebrow: string;
  headingLead: string;
  headingAccent: string;
  description: string;
  preview: string;
  previewNote: string;
  filterLabel: string;
  categories: Record<CategoryFilter, string>;
  units: Record<SaleUnit, string>;
  currency: string;
  addToCart: string;
  flash: string;
  special: string;
  was: string;
  hours: string;
  minutes: string;
  seconds: string;
  moreProducts: string;
  resultsCount: (n: number) => string;
  empty: string;
};

export const landingMarketplaceContent = {
  ar: {
    eyebrow: "سوق علاء الدين",
    headingLead: "اكتشف",
    headingAccent: "سوق علاء الدين",
    description: "منتجات مختارة بعناية لكل ما تحتاجه في أعمال التشطيبات والديكور",
    preview: "معاينة — بيانات تجريبية",
    previewNote: "الأسعار والعروض في هذا القسم للعرض التجريبي فقط وليست عروضًا فعلية.",
    filterLabel: "تصفية المنتجات حسب النوع",
    categories: {
      all: "الكل",
      wallpaper: "ورق حائط",
      wood_alternative: "بديل خشب",
      marble_alternative: "بديل رخام",
      sheeboard: "شيبورد",
      cornice: "كرانيش",
      corner_trim: "زوايا",
    },
    units: { roll: "للرول", board: "للوح", bar: "للعود", piece: "للقطعة", square_meter: "للمتر المربع" },
    currency: "ج.م",
    addToCart: "أضف للسلة",
    flash: "عروض خاطفة",
    special: "عرض خاص",
    was: "السعر السابق",
    hours: "ساعة",
    minutes: "دقيقة",
    seconds: "ثانية",
    moreProducts: "عرض المزيد من المنتجات",
    resultsCount: (n) => `${n} منتجات معروضة`,
    empty: "لا توجد منتجات في هذا القسم حاليًا.",
  },
  en: {
    eyebrow: "Aladdin Marketplace",
    headingLead: "Discover the",
    headingAccent: "Aladdin Marketplace",
    description: "Carefully selected products for everything you need in finishing and decoration",
    preview: "Preview — sample data",
    previewNote: "Prices and offers in this section are sample data for preview only, not live offers.",
    filterLabel: "Filter products by type",
    categories: {
      all: "All",
      wallpaper: "Wallpaper",
      wood_alternative: "Wood alternative",
      marble_alternative: "Marble alternative",
      sheeboard: "Sheeboard",
      cornice: "Cornices",
      corner_trim: "Corner trims",
    },
    units: { roll: "per roll", board: "per board", bar: "per bar", piece: "per piece", square_meter: "per m²" },
    currency: "EGP",
    addToCart: "Add to cart",
    flash: "Flash sale",
    special: "Special offer",
    was: "Previous price",
    hours: "hours",
    minutes: "min",
    seconds: "sec",
    moreProducts: "Explore More Products",
    resultsCount: (n) => `${n} products shown`,
    empty: "There are no products in this category right now.",
  },
} satisfies Record<"ar" | "en", Copy>;

/** Real product photography supplied for the preview (`public/preview/landing/marketplace`). */
const img = (type: MarketplaceTypeKey, n: 1 | 2) => `/preview/landing/marketplace/${type}-${n}.png`;

/**
 * Every entry has its own photograph — a product without an image is never
 * listed. Types that have a single supplied photo therefore have one product.
 */
export const previewProducts: LandingProduct[] = [
  {
    id: "wp-1", featured: true, type: "wallpaper", image: img("wallpaper", 1), unit: "roll", priceEgp: 550,
    offer: { kind: "flash", referencePriceEgp: 750 },
    copy: {
      ar: { title: "ورق حائط فاخر", description: "تصاميم عصرية تناسب جميع المساحات" },
      en: { title: "Premium wallpaper", description: "Modern designs for every space" },
    },
  },
  {
    id: "wd-1", featured: true, type: "wood_alternative", image: img("wood_alternative", 1), unit: "board", priceEgp: 680,
    offer: { kind: "regular", referencePriceEgp: 850 },
    copy: {
      ar: { title: "بديل خشب جداري", description: "مظهر خشبي فاخر وسهل التركيب" },
      en: { title: "Wall wood alternative", description: "A premium wood look, easy to install" },
    },
  },
  {
    id: "mb-1", featured: true, type: "marble_alternative", image: img("marble_alternative", 1), unit: "board", priceEgp: 720,
    copy: {
      ar: { title: "بديل رخام PVC", description: "حل عصري وأنيق للحوائط والديكور" },
      en: { title: "PVC marble alternative", description: "A modern, elegant solution for walls and decor" },
    },
  },
  {
    id: "sb-1", featured: true, type: "sheeboard", image: img("sheeboard", 1), unit: "board", priceEgp: 420,
    copy: {
      ar: { title: "شيبورد ديكوري", description: "ألواح ديكورية متعددة الاستخدامات" },
      en: { title: "Decorative sheeboard", description: "Versatile decorative boards" },
    },
  },
  {
    id: "co-1", featured: true, type: "cornice", image: img("cornice", 1), unit: "bar", priceEgp: 280,
    copy: {
      ar: { title: "كرانيش فيوتك", description: "تصاميم كلاسيكية وعصرية للمساحات" },
      en: { title: "Futec cornices", description: "Classic and modern designs for spaces" },
    },
  },
  {
    id: "ct-1", featured: true, type: "corner_trim", image: img("corner_trim", 1), unit: "bar", priceEgp: 180,
    copy: {
      ar: { title: "زوايا وحليات ديكور", description: "تشطيبات دقيقة ولمسة جمالية متكاملة" },
      en: { title: "Decor corners and trims", description: "Precise finishes and a complete aesthetic touch" },
    },
  },
  {
    id: "wd-2", type: "wood_alternative", image: img("wood_alternative", 2), unit: "board", priceEgp: 610,
    copy: {
      ar: { title: "ألواح بديل خشب", description: "مقاومة للرطوبة وسهلة التنظيف" },
      en: { title: "Wood alternative boards", description: "Moisture resistant and easy to clean" },
    },
  },
  {
    id: "mb-2", type: "marble_alternative", image: img("marble_alternative", 2), unit: "board", priceEgp: 790,
    copy: {
      ar: { title: "بديل رخام لامع", description: "سطح لامع بعروق طبيعية المظهر" },
      en: { title: "Glossy marble alternative", description: "A glossy surface with natural-looking veins" },
    },
  },
];
