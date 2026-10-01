import type { Locale } from "@/lib/i18n/locales";

export type Bi = { ar: string; en: string };

export function pick(locale: Locale, value: Bi) {
  return locale === "ar" ? value.ar : value.en;
}

export type WorkTabKey =
  | "current"
  | "accepted"
  | "in_progress"
  | "paused"
  | "review"
  | "completed"
  | "cancelled"
  | "archived";

export type WorkStatus = Exclude<WorkTabKey, "current">;

export type WorkTab = {
  key: WorkTabKey;
  label: Bi;
  count: number;
};

export type WorkRow = {
  id: string;
  image: string;
  title: Bi;
  location: Bi;
  company: string;
  companyInitials: string;
  contact: { phone: string; fullPhone: string; email?: string };
  rating?: number;
  value: number;
  status: WorkStatus;
  deliveryDateIso: string;
  deliveryDate: Bi;
  deliveryHint: Bi;
  reviewAvailable?: boolean;
};

export const WORK_TABS: readonly WorkTab[] = [
  { key: "current", label: { ar: "الحالي", en: "Current" }, count: 3 },
  { key: "accepted", label: { ar: "المقبول", en: "Accepted" }, count: 2 },
  { key: "in_progress", label: { ar: "في التنفيذ", en: "In progress" }, count: 2 },
  { key: "paused", label: { ar: "معلّق", en: "Paused" }, count: 1 },
  { key: "review", label: { ar: "في المراجعة", en: "In review" }, count: 1 },
  { key: "completed", label: { ar: "مكتمل", en: "Completed" }, count: 18 },
  { key: "cancelled", label: { ar: "ملغي / مرفوض", en: "Cancelled / rejected" }, count: 2 },
  { key: "archived", label: { ar: "الأرشيف", en: "Archive" }, count: 5 },
];

export const ACTIVE_WORK = {
  image: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
  title: { ar: "تركيب SPC – فيلا", en: "SPC installation – villa" },
  company: "Modern Floors",
  location: { ar: "التجمع الخامس – القاهرة الجديدة", en: "Fifth Settlement – New Cairo" },
  value: 4500,
  deliveryTime: { ar: "وقت التسليم: 18 يومًا", en: "Delivery time: 18 days" },
  deliveryDate: { ar: "15 مايو 2025", en: "15 May 2025" },
  progress: 60,
  currentStage: { ar: "تركيب الأرضيات", en: "Floor installation" },
  nextStage: { ar: "تركيب الحواف", en: "Edge finishing" },
  lastUpdate: { ar: "آخر تحديث: اليوم، 10:35 ص", en: "Last update: today, 10:35 AM" },
} as const;

export const WORK_ROWS: readonly WorkRow[] = [
  {
    id: "paint-apartment",
    image: "/assets/installer-dashboard/jobs/interior-painting.png",
    title: { ar: "دهانات داخلية – شقة", en: "Interior painting – apartment" },
    location: { ar: "مدينتي – B12", en: "Madinaty – B12" },
    company: "البيت الراقي",
    companyInitials: "B",
    contact: { phone: "010 •••• 1201", fullPhone: "010 4827 1201", email: "projects@example.com" },
    rating: 4.8,
    value: 3200,
    status: "in_progress",
    deliveryDateIso: "2025-05-20",
    deliveryDate: { ar: "20 مايو 2025", en: "20 May 2025" },
    deliveryHint: { ar: "5 أيام متبقية", en: "5 days left" },
  },
  {
    id: "marble-bathroom",
    image: "/assets/installer-dashboard/jobs/marble-alt.jpg",
    title: { ar: "بديل رخام – حمام", en: "Marble alternative – bathroom" },
    location: { ar: "القاهرة الجديدة", en: "New Cairo" },
    company: "Marble Pro",
    companyInitials: "MP",
    contact: { phone: "011 •••• 1202", fullPhone: "011 5634 1202" },
    rating: 4.9,
    value: 5000,
    status: "accepted",
    deliveryDateIso: "2025-05-22",
    deliveryDate: { ar: "22 مايو 2025", en: "22 May 2025" },
    deliveryHint: { ar: "7 أيام", en: "7 days" },
  },
  {
    id: "wpc-terrace",
    image: "/assets/installer-dashboard/jobs/wpc-terrace.png",
    title: { ar: "تركيب WPC – تراس", en: "WPC installation – terrace" },
    location: { ar: "الشروق", en: "El Shorouk" },
    company: "WPC Factory",
    companyInitials: "W",
    contact: { phone: "012 •••• 1203", fullPhone: "012 6941 1203", email: "work@example.com" },
    rating: 4.7,
    value: 4000,
    status: "in_progress",
    deliveryDateIso: "2025-05-25",
    deliveryDate: { ar: "25 مايو 2025", en: "25 May 2025" },
    deliveryHint: { ar: "10 أيام", en: "10 days" },
  },
  {
    id: "exterior-paint-villa",
    image: "/assets/installer-dashboard/jobs/decorative-wall.png",
    title: { ar: "دهانات خارجية – فيلا", en: "Exterior painting – villa" },
    location: { ar: "التجمع الخامس", en: "Fifth Settlement" },
    company: "اللمسة الذهبية",
    companyInitials: "M",
    contact: { phone: "010 •••• 1204", fullPhone: "010 7358 1204", email: "hello@example.com" },
    rating: 4.6,
    value: 7500,
    status: "completed",
    deliveryDateIso: "2025-04-30",
    deliveryDate: { ar: "30 أبريل 2025", en: "30 Apr 2025" },
    deliveryHint: { ar: "تم التسليم", en: "Delivered" },
    reviewAvailable: true,
  },
  {
    id: "spc-apartment",
    image: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    title: { ar: "تركيب SPC – شقة", en: "SPC installation – apartment" },
    location: { ar: "مدينتي", en: "Madinaty" },
    company: "Floor Design",
    companyInitials: "F",
    contact: { phone: "015 •••• 1205", fullPhone: "015 8264 1205" },
    rating: 4.8,
    value: 4200,
    status: "completed",
    deliveryDateIso: "2025-04-25",
    deliveryDate: { ar: "25 أبريل 2025", en: "25 Apr 2025" },
    deliveryHint: { ar: "تم التسليم", en: "Delivered" },
    reviewAvailable: true,
  },
  {
    id: "gypsum-ceiling",
    image: "/assets/installer-dashboard/jobs/gypsum-ceiling.png",
    title: { ar: "جبس بورد – سقف معلق", en: "Gypsum board – suspended ceiling" },
    location: { ar: "مدينة نصر", en: "Nasr City" },
    company: "Elegant Décor",
    companyInitials: "ED",
    contact: { phone: "011 •••• 1206", fullPhone: "011 9472 1206", email: "team@example.com" },
    value: 6800,
    status: "review",
    deliveryDateIso: "2025-05-28",
    deliveryDate: { ar: "28 مايو 2025", en: "28 May 2025" },
    deliveryHint: { ar: "بانتظار المراجعة", en: "Awaiting review" },
  },
  {
    id: "kitchen-wall-panels",
    image: "/assets/installer-dashboard/jobs/marble-alt.jpg",
    title: { ar: "بديل رخام – مطبخ", en: "Marble alternative – kitchen" },
    location: { ar: "الرحاب", en: "El Rehab" },
    company: "Marble House",
    companyInitials: "MH",
    contact: { phone: "010 •••• 1207", fullPhone: "010 3186 1207" },
    rating: 4.7,
    value: 5800,
    status: "accepted",
    deliveryDateIso: "2025-06-02",
    deliveryDate: { ar: "2 يونيو 2025", en: "2 Jun 2025" },
    deliveryHint: { ar: "12 يومًا", en: "12 days" },
  },
  {
    id: "garden-wpc-fence",
    image: "/assets/installer-dashboard/jobs/wpc-terrace.png",
    title: { ar: "تركيب WPC – سور حديقة", en: "WPC installation – garden fence" },
    location: { ar: "الشيخ زايد", en: "Sheikh Zayed" },
    company: "WPC Factory",
    companyInitials: "W",
    contact: { phone: "012 •••• 1208", fullPhone: "012 4593 1208", email: "garden@example.com" },
    rating: 4.8,
    value: 9200,
    status: "in_progress",
    deliveryDateIso: "2025-06-06",
    deliveryDate: { ar: "6 يونيو 2025", en: "6 Jun 2025" },
    deliveryHint: { ar: "16 يومًا", en: "16 days" },
  },
  {
    id: "office-air-conditioning",
    image: "/assets/installer-dashboard/jobs/ac-install.jpg",
    title: { ar: "تركيب تكييف – مكتب", en: "Air conditioning – office" },
    location: { ar: "القاهرة الجديدة", en: "New Cairo" },
    company: "Cool Air",
    companyInitials: "CA",
    contact: { phone: "015 •••• 1209", fullPhone: "015 5719 1209", email: "service@example.com" },
    rating: 4.9,
    value: 8400,
    status: "paused",
    deliveryDateIso: "2025-06-08",
    deliveryDate: { ar: "8 يونيو 2025", en: "8 Jun 2025" },
    deliveryHint: { ar: "بانتظار المواد", en: "Waiting for materials" },
  },
  {
    id: "reception-decorative-wall",
    image: "/assets/installer-dashboard/jobs/decorative-wall.png",
    title: { ar: "تشطيب ديكوري – ريسبشن", en: "Decorative finish – reception" },
    location: { ar: "مدينة نصر", en: "Nasr City" },
    company: "Stone Art",
    companyInitials: "SA",
    contact: { phone: "011 •••• 1210", fullPhone: "011 6825 1210" },
    rating: 4.6,
    value: 7100,
    status: "completed",
    deliveryDateIso: "2025-04-18",
    deliveryDate: { ar: "18 أبريل 2025", en: "18 Apr 2025" },
    deliveryHint: { ar: "تم التسليم", en: "Delivered" },
    reviewAvailable: true,
  },
  {
    id: "bedroom-spc-flooring",
    image: "/assets/installer-dashboard/jobs/spc-flooring.jpg",
    title: { ar: "أرضيات SPC – غرفة نوم", en: "SPC flooring – bedroom" },
    location: { ar: "المعادي", en: "Maadi" },
    company: "Modern Floors",
    companyInitials: "MF",
    contact: { phone: "010 •••• 1211", fullPhone: "010 7931 1211", email: "install@example.com" },
    rating: 4.8,
    value: 3600,
    status: "completed",
    deliveryDateIso: "2025-04-12",
    deliveryDate: { ar: "12 أبريل 2025", en: "12 Apr 2025" },
    deliveryHint: { ar: "تم التسليم", en: "Delivered" },
    reviewAvailable: true,
  },
  {
    id: "villa-exterior-coating",
    image: "/assets/installer-dashboard/jobs/interior-painting.png",
    title: { ar: "دهانات واجهات – فيلا", en: "Exterior coating – villa" },
    location: { ar: "أكتوبر", en: "6th of October" },
    company: "Color Mix",
    companyInitials: "CM",
    contact: { phone: "012 •••• 1212", fullPhone: "012 8147 1212" },
    rating: 4.5,
    value: 10500,
    status: "archived",
    deliveryDateIso: "2025-03-28",
    deliveryDate: { ar: "28 مارس 2025", en: "28 Mar 2025" },
    deliveryHint: { ar: "مؤرشف", en: "Archived" },
  },
];

export const SUMMARY_ROWS = [
  { label: { ar: "شغل جاري", en: "Current work" }, value: 1, tone: "info" },
  { label: { ar: "شغل في التنفيذ", en: "Work in progress" }, value: 2, tone: "success" },
  { label: { ar: "مقبول وينتظر التنفيذ", en: "Accepted, awaiting start" }, value: 2, tone: "warning" },
  { label: { ar: "مكتمل هذا الشهر", en: "Completed this month" }, value: 3, tone: "neutral" },
] as const;

export const DOCUMENT_ROWS = [
  { label: { ar: "صور قبل التنفيذ", en: "Before-work photos" }, count: 16 },
  { label: { ar: "صور أثناء التنفيذ", en: "In-progress photos" }, count: 24 },
  { label: { ar: "صور بعد التنفيذ", en: "After-work photos" }, count: 18 },
  { label: { ar: "المستندات والفواتير", en: "Documents and invoices" }, count: 5 },
] as const;
