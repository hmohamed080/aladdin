import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatDate, formatRelativeTime } from "@/lib/ui/format";
import { formatEgp } from "@/lib/ui/egp-format";
import type { ActiveWorkVM, WorkRowVM, WorkTabVM, WorkTone } from "@/features/installer-my-work-preview/view-model";
import {
  ASSIGNMENT_STATUSES,
  CURRENT_STATUSES,
  canReportProgress,
  canStart,
  type JobAssignmentStatus,
} from "@/lib/work/assignment-state";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";

/**
 * THE REAL SIDE OF THE MY WORK DATA-ADAPTER BOUNDARY.
 *
 * `my_job_assignments` rows -> `WorkRowVM` / `ActiveWorkVM` / `WorkTabVM`, the same
 * shapes the preview builds from fixtures in
 * `installer-my-work-preview/preview-adapter.ts`, so both feed one
 * `InstallerMyWorkView`.
 *
 * The vocabulary is the REAL one and nothing else: `scheduled`, `in_progress`,
 * `completed`, `cancelled`, plus the presentation tabs "all" and "current" (a
 * composite of the first two, stored nowhere). There is no paused / in-review /
 * archived state because the backend has none.
 *
 * Fields the data cannot supply are null and the View draws an honest state:
 *   - contact details and a client rating: not on the row, never invented;
 *   - a "next stage": there is no stage plan, so only the CURRENT stage (the latest
 *     real progress update) is ever shown;
 *   - an image: no job carries media, so the generic trade illustration is drawn.
 *
 * Actions are offered only where the server would authorise them, using the same
 * predicates the RPCs mirror (`canStart`, `canReportProgress`), and they LINK to the
 * real detail page — the dialogs that call the real actions live there.
 *
 * Not `server-only`: a pure transform of rows already fetched.
 */

export const ALL_TAB = "all";
export const CURRENT_TAB = "current";

const TONES: Record<JobAssignmentStatus, WorkTone> = {
  scheduled: "info",
  in_progress: "success",
  completed: "neutral",
  cancelled: "danger",
};

function statusLabel(status: string | null, t: TranslateFn): string {
  return status && status in TONES ? t(`jobs.assignmentStatus.${status}` as never) : "";
}

function place(a: MyAssignmentRow): string | null {
  return [a.city, a.governorate].filter(Boolean).join("، ") || null;
}

/** "AB" from the first letters of the first two words; "" when there is no name. */
export function initialsOf(name: string | null): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join("");
}

function ms(iso: string | null): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
}

const DAY_MS = 86_400_000;

/**
 * "5 days left" / "Due today" / "2 days overdue" — only for work still ahead of
 * the installer and only when an end date is stated. Whole calendar days, taken
 * from the date parts so the viewer's clock zone cannot shift the answer.
 */
export function deliveryHint(status: string | null, endsBy: string | null, locale: Locale, now: Date): string | null {
  if (!endsBy || !status || !CURRENT_STATUSES.includes(status as JobAssignmentStatus)) return null;
  const end = Date.parse(`${endsBy.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(end)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((end - today) / DAY_MS);
  const n = new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en-EG").format(Math.abs(days));
  if (days === 0) return locale === "ar" ? "مستحق اليوم" : "Due today";
  if (days > 0) return locale === "ar" ? `متبقي ${n} يوم` : `${n} ${days === 1 ? "day" : "days"} left`;
  return locale === "ar" ? `متأخر ${n} يوم` : `${n} ${days === -1 ? "day" : "days"} overdue`;
}

/** The one action a row offers, and ONLY when the server would authorise it. */
export function rowAction(a: MyAssignmentRow, locale: Locale): { label: string; href: string } {
  const href = `/home/work/${a.id}`;
  if (canStart(a)) return { label: locale === "ar" ? "ابدأ الشغل" : "Start work", href };
  if (canReportProgress(a)) return { label: locale === "ar" ? "تحديث التقدم" : "Update progress", href };
  return { label: locale === "ar" ? "عرض" : "View", href };
}

export function toWorkRowVM(a: MyAssignmentRow, t: TranslateFn, locale: Locale, now: Date = new Date()): WorkRowVM | null {
  // Every view column is nullable to the type generator — a row without an id or a
  // title is skipped rather than drawn half blank.
  if (!a.id || !a.job_title) return null;
  return {
    id: a.id,
    image: null,
    tradeKey: a.trade_key,
    title: a.job_title,
    location: place(a),
    company: a.poster_org_name || null,
    companyInitials: initialsOf(a.poster_org_name),
    contact: null,
    rating: null,
    value: a.agreed_amount,
    status: a.status ?? "",
    statusLabel: statusLabel(a.status, t),
    statusTone: a.status && a.status in TONES ? TONES[a.status] : "neutral",
    startsOn: a.starts_on,
    endsBy: a.ends_by,
    deliveryDateLabel: a.ends_by ? formatDate(a.ends_by, locale) : null,
    deliveryHint: deliveryHint(a.status, a.ends_by, locale, now),
    createdAtMs: ms(a.created_at),
    lastActionMs: ms(a.last_progress_at),
    action: rowAction(a, locale),
  };
}

export function toWorkRowVMs(rows: readonly MyAssignmentRow[], t: TranslateFn, locale: Locale, now: Date = new Date()): WorkRowVM[] {
  return rows.flatMap((row) => {
    const vm = toWorkRowVM(row, t, locale, now);
    return vm ? [vm] : [];
  });
}

/** The tabs, with the SAME counts the summary rail shows — both come from the rows. */
export function toWorkTabs(counts: Record<JobAssignmentStatus, number>, t: TranslateFn): WorkTabVM[] {
  const total = ASSIGNMENT_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  return [
    { key: ALL_TAB, label: t("work.tab.all"), count: total, statuses: null },
    { key: CURRENT_TAB, label: t("work.tab.current"), count: counts.scheduled + counts.in_progress, statuses: CURRENT_STATUSES },
    ...ASSIGNMENT_STATUSES.map((s) => ({
      key: s,
      // The SAME four labels every badge on the page uses.
      label: t(`jobs.assignmentStatus.${s}` as never),
      count: counts[s],
      statuses: [s] as readonly string[],
    })),
  ];
}

/** `?state=` -> a tab key. Anything that is not a real tab is "all". */
export function tabFromState(state: string | undefined): string {
  if (state === CURRENT_TAB) return CURRENT_TAB;
  return state && (ASSIGNMENT_STATUSES as readonly string[]).includes(state) ? state : ALL_TAB;
}

/**
 * The featured current assignment. `latestStage` is the `stage` of its most recent
 * real progress update (or null) — the only source of a "current stage".
 */
export function toActiveWorkVM(
  a: MyAssignmentRow,
  latestStage: string | null,
  t: TranslateFn,
  locale: Locale,
  now: Date = new Date(),
): ActiveWorkVM | null {
  if (!a.id || !a.job_title) return null;
  const ar = locale === "ar";
  const href = `/home/work/${a.id}`;
  const live = a.status === "in_progress";
  const hint = deliveryHint(a.status, a.ends_by, locale, now);
  const notStated = ar ? "غير محدد" : "Not specified";
  const duration = a.expected_duration_days;
  return {
    image: null,
    tradeKey: a.trade_key,
    title: a.job_title,
    company: a.poster_org_name || null,
    location: place(a),
    details: [
      { label: ar ? "قيمة العمل" : "Work value", value: a.agreed_amount !== null ? formatEgp(a.agreed_amount, locale) : notStated },
      {
        label: ar ? "المدة المخططة" : "Planned duration",
        value:
          duration === null
            ? notStated
            : ar
              ? `${new Intl.NumberFormat("ar-EG").format(duration)} ${duration === 1 ? "يوم" : duration === 2 ? "يومان" : "أيام"}`
              : `${duration} ${duration === 1 ? "day" : "days"}`,
      },
      {
        label: ar ? "تاريخ التسليم" : "Delivery date",
        value: a.ends_by ? `${formatDate(a.ends_by, locale)}${hint ? ` · ${hint}` : ""}` : notStated,
      },
    ],
    progress: live ? (a.latest_progress_percent ?? 0) : null,
    progressEmptyLabel: ar ? "لم يبدأ بعد" : "Not started yet",
    lastUpdate: a.last_progress_at ? (ar ? `آخر تحديث: ${formatRelativeTime(a.last_progress_at, locale, now)}` : `Last update: ${formatRelativeTime(a.last_progress_at, locale, now)}`) : null,
    currentStage: live ? latestStage : null,
    // No stage plan exists, so there is no "next stage" to show.
    nextStage: null,
    badgeLabel: live ? (ar ? "جاري الآن" : "Live now") : statusLabel(a.status, t),
    detailsAction: { label: ar ? "عرض التفاصيل" : "View details", href },
    updateAction: canStart(a)
      ? { label: ar ? "ابدأ الشغل" : "Start work", href }
      : canReportProgress(a)
        ? { label: ar ? "تحديث التقدم" : "Update progress", href }
        : null,
  };
}
