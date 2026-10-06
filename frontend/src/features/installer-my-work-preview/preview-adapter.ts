import type { Locale } from "@/lib/i18n/locales";
import { formatEgp } from "@/lib/ui/egp-format";
import { ACTIVE_WORK, WORK_ROWS, WORK_TABS, pick, type WorkRow, type WorkStatus } from "./preview-data";
import type { ActiveWorkVM, WorkPreviewFeatures, WorkRowVM, WorkTabVM, WorkTone } from "./view-model";

/**
 * THE PREVIEW SIDE OF THE DATA-ADAPTER BOUNDARY.
 *
 * Fixtures -> view models. Only the preview wrapper imports this file (and so only
 * the preview wrapper reaches `preview-data.ts`); production builds the same shapes
 * from real assignment rows in `features/home/installer-work-data.ts`.
 */

/** Everything the demo can show — the production route passes none of this. */
export const PREVIEW_WORK_FEATURES: WorkPreviewFeatures = {
  contact: true,
  savedSearches: true,
  exportReport: true,
  rating: true,
};

const STATUS_LABELS: Record<WorkStatus, { ar: string; en: string }> = {
  accepted: { ar: "مقبول", en: "Accepted" },
  in_progress: { ar: "في التنفيذ", en: "In progress" },
  paused: { ar: "معلّق", en: "Paused" },
  review: { ar: "في المراجعة", en: "In review" },
  completed: { ar: "مكتمل", en: "Completed" },
  cancelled: { ar: "ملغي / مرفوض", en: "Cancelled / rejected" },
  archived: { ar: "مؤرشف", en: "Archived" },
};

function statusTone(status: WorkStatus): WorkTone {
  if (status === "in_progress") return "success";
  if (status === "accepted") return "info";
  if (status === "review" || status === "paused") return "warning";
  if (status === "cancelled") return "danger";
  return "neutral";
}

/** Demo ordering only: fixture order stands in for "recently added", status for "last action". */
const BASE_MS = Date.UTC(2025, 4, 1);
const DAY_MS = 86_400_000;
const ACTION_PRIORITY: Record<WorkStatus, number> = { in_progress: 0, review: 1, accepted: 2, paused: 3, completed: 4, cancelled: 5, archived: 6 };

export function toPreviewWorkRow(row: WorkRow, index: number, locale: Locale): WorkRowVM {
  return {
    id: row.id,
    image: row.image,
    tradeKey: null,
    title: pick(locale, row.title),
    location: pick(locale, row.location),
    company: row.company,
    companyInitials: row.companyInitials,
    contact: row.contact,
    rating: row.rating ?? null,
    value: row.value,
    status: row.status,
    statusLabel: pick(locale, STATUS_LABELS[row.status]),
    statusTone: statusTone(row.status),
    startsOn: null,
    endsBy: row.deliveryDateIso,
    deliveryDateLabel: pick(locale, row.deliveryDate),
    deliveryHint: pick(locale, row.deliveryHint),
    createdAtMs: BASE_MS - index * DAY_MS,
    lastActionMs: BASE_MS - ACTION_PRIORITY[row.status] * 30 * DAY_MS - index * 1000,
    action: { label: row.reviewAvailable ? (locale === "ar" ? "عرض التقييم" : "View review") : locale === "ar" ? "عرض" : "View", href: null },
  };
}

export function previewWorkRows(locale: Locale): WorkRowVM[] {
  return WORK_ROWS.map((row, index) => toPreviewWorkRow(row, index, locale));
}

export function previewWorkTabs(locale: Locale): WorkTabVM[] {
  return WORK_TABS.map((tab) => ({
    key: tab.key,
    label: pick(locale, tab.label),
    count: tab.count,
    // "Current" is every status except the one still awaiting review.
    statuses: tab.key === "current" ? (Object.keys(STATUS_LABELS) as WorkStatus[]).filter((s) => s !== "review") : [tab.key],
  }));
}

export function previewActiveWork(locale: Locale, progress: number): ActiveWorkVM {
  const ar = locale === "ar";
  return {
    image: ACTIVE_WORK.image,
    tradeKey: null,
    title: pick(locale, ACTIVE_WORK.title),
    company: ACTIVE_WORK.company,
    location: pick(locale, ACTIVE_WORK.location),
    details: [
      { label: ar ? "قيمة العمل" : "Work value", value: formatEgp(ACTIVE_WORK.value, locale) },
      { label: ar ? "وقت التسليم" : "Delivery time", value: pick(locale, ACTIVE_WORK.deliveryTime) },
      { label: ar ? "تاريخ التسليم" : "Delivery date", value: pick(locale, ACTIVE_WORK.deliveryDate) },
    ],
    progress,
    progressEmptyLabel: "",
    lastUpdate: pick(locale, ACTIVE_WORK.lastUpdate),
    currentStage: pick(locale, ACTIVE_WORK.currentStage),
    nextStage: pick(locale, ACTIVE_WORK.nextStage),
    badgeLabel: ar ? "جاري الآن" : "Live now",
    detailsAction: { label: ar ? "عرض التفاصيل" : "View details", href: null },
    updateAction: { label: ar ? "تحديث التقدم" : "Update progress", href: null },
  };
}
