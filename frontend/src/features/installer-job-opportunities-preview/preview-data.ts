import type { Locale } from "@/lib/i18n/locales";

export type Bi = { ar: string; en: string };
export type TradeKey = "spc" | "painting" | "marble" | "wpc" | "gypsum" | "decorative" | "ac";
export type SortKey = "newest" | "nearest" | "highest" | "demanded";
export type DurationKey = "all" | "short" | "medium";

export type PreviewOpportunity = {
  id: string;
  image: string;
  title: Bi;
  company: Bi;
  location: Bi;
  trade: TradeKey;
  tradeLabel: Bi;
  durationDays: number;
  budget: number;
  distanceKm: number;
  matchPercent: number;
  postedHoursAgo: number;
  postedLabel: Bi;
  initiallySaved: boolean;
};

export const TRADE_OPTIONS: ReadonlyArray<{ key: TradeKey; label: Bi }> = [
  { key: "spc", label: { ar: "تركيب SPC", en: "SPC installation" } },
  { key: "painting", label: { ar: "دهانات داخلية", en: "Interior painting" } },
  { key: "marble", label: { ar: "بديل رخام", en: "Marble alternative" } },
  { key: "wpc", label: { ar: "WPC", en: "WPC" } },
  { key: "gypsum", label: { ar: "جبس بورد", en: "Gypsum board" } },
  { key: "decorative", label: { ar: "تشطيب ديكوري", en: "Decorative finishing" } },
];

export const PREVIEW_OPPORTUNITIES: readonly PreviewOpportunity[] = [
  {
    id: "spc-villa",
    image: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    title: { ar: "تركيب SPC – فيلا", en: "SPC installation – villa" },
    company: { ar: "معرض Modern Floors", en: "Modern Floors Showroom" },
    location: { ar: "التجمع الخامس – القاهرة الجديدة", en: "Fifth Settlement – New Cairo" },
    trade: "spc",
    tradeLabel: { ar: "تركيب SPC", en: "SPC installation" },
    durationDays: 3,
    budget: 4500,
    distanceKm: 2.3,
    matchPercent: 96,
    postedHoursAgo: 1,
    postedLabel: { ar: "نُشر منذ ساعة", en: "Posted 1 hour ago" },
    initiallySaved: false,
  },
  {
    id: "painting-apartment",
    image: "/assets/installer-dashboard/jobs/interior-painting.png",
    title: { ar: "دهانات داخلية – شقة", en: "Interior painting – apartment" },
    company: { ar: "معرض الألوان", en: "Al Alwan Showroom" },
    location: { ar: "القاهرة الجديدة – البنفسج", en: "New Cairo – Al Banafseg" },
    trade: "painting",
    tradeLabel: { ar: "دهانات داخلية", en: "Interior painting" },
    durationDays: 2,
    budget: 3200,
    distanceKm: 4.1,
    matchPercent: 92,
    postedHoursAgo: 2,
    postedLabel: { ar: "نُشر منذ ساعتين", en: "Posted 2 hours ago" },
    initiallySaved: true,
  },
  {
    id: "marble-bathroom",
    image: "/assets/installer-dashboard/jobs/marble-alt.jpg",
    title: { ar: "بديل رخام – حمام", en: "Marble alternative – bathroom" },
    company: { ar: "معرض Marble Pro", en: "Marble Pro Showroom" },
    location: { ar: "القاهرة الجديدة – النرجس", en: "New Cairo – Al Narges" },
    trade: "marble",
    tradeLabel: { ar: "بديل رخام", en: "Marble alternative" },
    durationDays: 4,
    budget: 3000,
    distanceKm: 3.6,
    matchPercent: 90,
    postedHoursAgo: 3,
    postedLabel: { ar: "نُشر منذ ٣ ساعات", en: "Posted 3 hours ago" },
    initiallySaved: false,
  },
  {
    id: "wpc-terrace",
    image: "/assets/installer-dashboard/jobs/wpc-terrace.png",
    title: { ar: "تركيب WPC – تراس وحديقة", en: "WPC installation – terrace & garden" },
    company: { ar: "WPC Factory", en: "WPC Factory" },
    location: { ar: "الشروق – القاهرة", en: "El Shorouk – Cairo" },
    trade: "wpc",
    tradeLabel: { ar: "WPC خارجي", en: "Exterior WPC" },
    durationDays: 3,
    budget: 4000,
    distanceKm: 5.2,
    matchPercent: 88,
    postedHoursAgo: 4,
    postedLabel: { ar: "نُشر منذ ٤ ساعات", en: "Posted 4 hours ago" },
    initiallySaved: false,
  },
  {
    id: "gypsum-ceiling",
    image: "/assets/installer-dashboard/jobs/gypsum-ceiling.png",
    title: { ar: "جبس بورد – سقف معلق", en: "Gypsum board – suspended ceiling" },
    company: { ar: "معرض Elegant Décor", en: "Elegant Décor Showroom" },
    location: { ar: "مدينتي – القاهرة الجديدة", en: "Madinaty – New Cairo" },
    trade: "gypsum",
    tradeLabel: { ar: "جبس بورد", en: "Gypsum board" },
    durationDays: 5,
    budget: 6000,
    distanceKm: 6.8,
    matchPercent: 85,
    postedHoursAgo: 5,
    postedLabel: { ar: "نُشر منذ ٥ ساعات", en: "Posted 5 hours ago" },
    initiallySaved: true,
  },
  {
    id: "decorative-wall",
    image: "/assets/installer-dashboard/jobs/decorative-wall.png",
    title: { ar: "تشطيب ديكوري – جدار", en: "Decorative finish – feature wall" },
    company: { ar: "معرض Stone Art", en: "Stone Art Showroom" },
    location: { ar: "التجمع الثالث – القاهرة الجديدة", en: "Third Settlement – New Cairo" },
    trade: "decorative",
    tradeLabel: { ar: "تشطيب ديكوري", en: "Decorative finishing" },
    durationDays: 2,
    budget: 2800,
    distanceKm: 7.1,
    matchPercent: 83,
    postedHoursAgo: 6,
    postedLabel: { ar: "نُشر منذ ٦ ساعات", en: "Posted 6 hours ago" },
    initiallySaved: false,
  },
  {
    id: "ac-clinic",
    image: "/assets/installer-dashboard/jobs/ac-install.jpg",
    title: { ar: "تركيب تكييف – عيادة", en: "AC installation – clinic" },
    company: { ar: "كولد بريز للتكييف", en: "Cold Breeze AC" },
    location: { ar: "الرحاب – القاهرة الجديدة", en: "Al Rehab – New Cairo" },
    trade: "ac",
    tradeLabel: { ar: "تكييف", en: "Air conditioning" },
    durationDays: 1,
    budget: 5200,
    distanceKm: 8.4,
    matchPercent: 81,
    postedHoursAgo: 9,
    postedLabel: { ar: "نُشر منذ ٩ ساعات", en: "Posted 9 hours ago" },
    initiallySaved: false,
  },
];

export type PreviewFilters = {
  sort: SortKey;
  trades: ReadonlySet<TradeKey>;
  maxBudget: number;
  duration: DurationKey;
  radiusKm: number;
  savedOnly: boolean;
  savedIds: ReadonlySet<string>;
};

export function pick(locale: Locale, value: Bi): string {
  return locale === "ar" ? value.ar : value.en;
}

export function filterPreviewOpportunities(
  opportunities: readonly PreviewOpportunity[],
  filters: PreviewFilters,
): PreviewOpportunity[] {
  const filtered = opportunities.filter((opportunity) => {
    const tradeMatches = filters.trades.size === 0 || filters.trades.has(opportunity.trade);
    const durationMatches =
      filters.duration === "all" ||
      (filters.duration === "short" && opportunity.durationDays <= 2) ||
      (filters.duration === "medium" && opportunity.durationDays >= 3 && opportunity.durationDays <= 5);
    return (
      tradeMatches &&
      opportunity.budget <= filters.maxBudget &&
      opportunity.distanceKm <= filters.radiusKm &&
      durationMatches &&
      (!filters.savedOnly || filters.savedIds.has(opportunity.id))
    );
  });

  return [...filtered].sort((a, b) => {
    if (filters.sort === "nearest") return a.distanceKm - b.distanceKm;
    if (filters.sort === "highest") return b.budget - a.budget;
    if (filters.sort === "demanded") return b.matchPercent - a.matchPercent;
    return a.postedHoursAgo - b.postedHoursAgo;
  });
}
