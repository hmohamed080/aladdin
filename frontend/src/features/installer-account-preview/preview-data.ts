export type AccountCopy = { ar: string; en: string };

export type AccountModuleId = "network" | "skills" | "learning" | "settings" | "reviews" | "rewards";

export type AccountModule = {
  id: AccountModuleId;
  title: AccountCopy;
  description: AccountCopy;
  metric: string;
  metricLabel: AccountCopy;
  image: string;
  href: string;
  tone: "info" | "success" | "iris" | "neutral" | "danger" | "warning";
};

export const ACCOUNT_PROFILE = {
  name: { ar: "أحمد محمود", en: "Ahmed Mahmoud" },
  profession: { ar: "صنايعي دهانات وتشطيبات", en: "Painter and finishing specialist" },
  location: { ar: "القاهرة الجديدة", en: "New Cairo" },
  availability: { ar: "متاح للشغل", en: "Available for work" },
  portrait: "/assets/installer-account/profile-ahmed.png",
} as const;

export const ACCOUNT_STATS = [
  { id: "points", value: "4,850", label: { ar: "نقطة", en: "points" } },
  { id: "jobs", value: "18", label: { ar: "شغل مكتمل", en: "completed jobs" } },
  { id: "rating", value: "4.8", label: { ar: "متوسط التقييم", en: "average rating" } },
  { id: "reviews", value: "128", label: { ar: "تقييم", en: "reviews" } },
] as const;

export const ACCOUNT_MODULES: AccountModule[] = [
  {
    id: "network",
    title: { ar: "معارفي من المعارض", en: "My showroom network" },
    description: { ar: "المعارض والمحلات التي تعرفها وتساهم في توثيقها", en: "Showrooms and stores you know and help verify" },
    metric: "12",
    metricLabel: { ar: "معرضًا أعرفهم", en: "known showrooms" },
    image: "/assets/installer-account/showroom.png",
    href: "/preview/installer-network",
    tone: "info",
  },
  {
    id: "skills",
    title: { ar: "مهاراتي وشهاداتي", en: "My skills & certificates" },
    description: { ar: "عرض مهاراتك وشهاداتك المعتمدة من المصانع والجهات", en: "Show verified skills and certificates from trusted partners" },
    metric: "6",
    metricLabel: { ar: "شهادات موثقة", en: "verified certificates" },
    image: "/assets/installer-account/certificates.png",
    href: "#skills",
    tone: "success",
  },
  {
    id: "learning",
    title: { ar: "تعلم وتدريب", en: "Learning & training" },
    description: { ar: "طوّر مهاراتك من خلال تدريبات المصانع والفيديوهات والدورات", en: "Grow through manufacturer training, videos, and workshops" },
    metric: "3",
    metricLabel: { ar: "تدريبات جديدة موصى بها لك", en: "new training picks for you" },
    image: "/assets/installer-account/learning.png",
    href: "#learning",
    tone: "iris",
  },
  {
    id: "settings",
    title: { ar: "الإعدادات", en: "Settings" },
    description: { ar: "إدارة حسابك وبياناتك الشخصية والإشعارات والخصوصية", en: "Manage your account, personal data, notifications, and privacy" },
    metric: "",
    metricLabel: { ar: "", en: "" },
    image: "/assets/installer-account/settings.png",
    href: "#settings",
    tone: "neutral",
  },
  {
    id: "reviews",
    title: { ar: "تقييماتي", en: "My reviews" },
    description: { ar: "تقييمات العملاء لأعمالك وجودة خدماتك", en: "Client feedback on your work and service quality" },
    metric: "4.8 / 5",
    metricLabel: { ar: "128 تقييمًا من العملاء", en: "128 client reviews" },
    image: "/assets/installer-account/reviews.png",
    href: "/preview/installer-reviews",
    tone: "danger",
  },
  {
    id: "rewards",
    title: { ar: "نقاطي ومكافآتي", en: "My points & rewards" },
    description: { ar: "تابع نقاطك ومستوى المكافآت واستبدل نقاطك", en: "Track your points, reward level, and redemptions" },
    metric: "4,850",
    metricLabel: { ar: "نقطة · باقي 150 للمستوى التالي", en: "points · 150 to the next level" },
    image: "/assets/installer-account/rewards.png",
    href: "#rewards",
    tone: "warning",
  },
];

export const SETTINGS_ROWS = [
  { ar: "البيانات الشخصية", en: "Personal details" },
  { ar: "الخصوصية والأمان", en: "Privacy & security" },
  { ar: "الإشعارات", en: "Notifications" },
  { ar: "إعدادات الحساب", en: "Account settings" },
] as const;

