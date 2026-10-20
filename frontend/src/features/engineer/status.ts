import type { Locale } from "@/lib/i18n/locales";
export function requestStatusLabel(
  status: "draft" | "published" | "closed" | "cancelled",
  locale: Locale,
) {
  const labels = {
    draft: ["مسودة", "Draft"],
    published: ["بانتظار العروض", "Awaiting responses"],
    closed: ["مغلق", "Closed"],
    cancelled: ["ملغى", "Cancelled"],
  };
  return labels[status][locale === "ar" ? 0 : 1]!;
}
