export type LocalizedText = { ar: string; en: string };

export type NetworkShowroom = {
  id: string;
  name: LocalizedText;
  mark: string;
  location: LocalizedText;
  area: "new-cairo" | "fifth-settlement" | "nasr-city" | "el-shorouk";
  rating: number;
  reviews: number;
  relationship: "verified" | "active";
  phone: string;
};

export type PendingInvitation = {
  id: string;
  name: LocalizedText;
  phone: string;
};

export const NETWORK_SHOWROOMS: readonly NetworkShowroom[] = [
  {
    id: "elite",
    name: { ar: "معرض النخبة للديكور", en: "Elite Decor Showroom" },
    mark: "Elite",
    location: { ar: "القاهرة الجديدة – النرجس", en: "New Cairo – Al Narges" },
    area: "new-cairo",
    rating: 4.7,
    reviews: 35,
    relationship: "verified",
    phone: "010 2468 1357",
  },
  {
    id: "modern-floors",
    name: { ar: "Modern Floors", en: "Modern Floors" },
    mark: "MF",
    location: { ar: "التجمع الخامس – محور محمد نجيب", en: "Fifth Settlement – Mohamed Naguib Axis" },
    area: "fifth-settlement",
    rating: 4.8,
    reviews: 42,
    relationship: "active",
    phone: "011 3579 2468",
  },
  {
    id: "marble-pro",
    name: { ar: "Marble Pro", en: "Marble Pro" },
    mark: "MP",
    location: { ar: "القاهرة الجديدة – الحي الثاني", en: "New Cairo – Second District" },
    area: "new-cairo",
    rating: 4.6,
    reviews: 28,
    relationship: "verified",
    phone: "012 8642 9753",
  },
  {
    id: "ahram",
    name: { ar: "معرض الأهرام للديكور", en: "Al Ahram Decor Showroom" },
    mark: "AD",
    location: { ar: "مدينة نصر – مكرم عبيد", en: "Nasr City – Makram Ebeid" },
    area: "nasr-city",
    rating: 4.5,
    reviews: 21,
    relationship: "active",
    phone: "010 9753 1864",
  },
  {
    id: "woodline",
    name: { ar: "وود لاين للأرضيات", en: "Woodline Flooring" },
    mark: "WL",
    location: { ar: "الشروق – طريق السويس", en: "El Shorouk – Suez Road" },
    area: "el-shorouk",
    rating: 4.9,
    reviews: 31,
    relationship: "verified",
    phone: "011 6428 3579",
  },
  {
    id: "home-craft",
    name: { ar: "هوم كرافت للتشطيبات", en: "Home Craft Finishes" },
    mark: "HC",
    location: { ar: "التجمع الخامس – شارع التسعين", en: "Fifth Settlement – 90th Street" },
    area: "fifth-settlement",
    rating: 4.7,
    reviews: 19,
    relationship: "active",
    phone: "012 7531 8642",
  },
  {
    id: "stone-house",
    name: { ar: "ستون هاوس", en: "Stone House" },
    mark: "SH",
    location: { ar: "مدينة نصر – عباس العقاد", en: "Nasr City – Abbas El Akkad" },
    area: "nasr-city",
    rating: 4.6,
    reviews: 24,
    relationship: "verified",
    phone: "010 5319 7426",
  },
  {
    id: "design-hub",
    name: { ar: "ديزاين هب", en: "Design Hub" },
    mark: "DH",
    location: { ar: "القاهرة الجديدة – جنوب الأكاديمية", en: "New Cairo – South Academy" },
    area: "new-cairo",
    rating: 4.8,
    reviews: 37,
    relationship: "active",
    phone: "011 2846 7395",
  },
  {
    id: "royal-stone",
    name: { ar: "رويال ستون", en: "Royal Stone" },
    mark: "RS",
    location: { ar: "مدينة نصر – مصطفى النحاس", en: "Nasr City – Mostafa El Nahas" },
    area: "nasr-city",
    rating: 4.7,
    reviews: 26,
    relationship: "verified",
    phone: "012 6481 3579",
  },
  {
    id: "living-lines",
    name: { ar: "ليفنج لاينز", en: "Living Lines" },
    mark: "LL",
    location: { ar: "التجمع الخامس – حي المستثمرين", en: "Fifth Settlement – Investors District" },
    area: "fifth-settlement",
    rating: 4.9,
    reviews: 44,
    relationship: "active",
    phone: "010 8642 3197",
  },
] as const;

export const PENDING_INVITATIONS: readonly PendingInvitation[] = [
  { id: "andalus", name: { ar: "معرض الأندلس للديكور", en: "Al Andalus Decor" }, phone: "010 1234 5678" },
  { id: "decor-house", name: { ar: "Decor House", en: "Decor House" }, phone: "012 9876 5432" },
  { id: "casa", name: { ar: "كازا للأثاث", en: "Casa Furniture" }, phone: "011 4567 8910" },
  { id: "urban", name: { ar: "Urban Living", en: "Urban Living" }, phone: "010 7531 2468" },
  { id: "royal", name: { ar: "رويال هوم", en: "Royal Home" }, phone: "012 3698 1475" },
  { id: "art-house", name: { ar: "آرت هاوس", en: "Art House" }, phone: "010 4682 9137" },
  { id: "urban-wood", name: { ar: "أوربان وود", en: "Urban Wood" }, phone: "011 7931 6248" },
] as const;

export const AREA_OPTIONS = ["all", "new-cairo", "fifth-settlement", "nasr-city", "el-shorouk"] as const;
export type AreaFilter = (typeof AREA_OPTIONS)[number];
