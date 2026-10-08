import type { Locale } from "@/lib/i18n/locales";
import type { TranslateFn } from "@/lib/i18n/translate";
import { formatDate, formatRelativeTime } from "@/lib/ui/format";
import { formatEgp } from "@/lib/ui/egp-format";
import type { ActiveWorkVM, WorkRowVM, WorkSearchState, WorkTabVM, WorkTone } from "@/features/installer-my-work-preview/view-model";
import {
  CURRENT_STATUSES,
  canReportProgress,
  canStart,
  type JobAssignmentStatus,
} from "@/lib/work/assignment-state";
import { ALL_TAB, CURRENT_TAB, WORK_LIST_STATUSES, sanitizeWorkState } from "@/lib/installer/work-board-params";
import type { MyAssignmentRow, WorkPageRow } from "@/server/queries/job-assignments";

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

// The tab vocabulary and the meaning of "All your work" live with the URL state they belong to.
export { ALL_TAB, CURRENT_TAB, WORK_LIST_STATUSES, tabFromState } from "@/lib/installer/work-board-params";

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

/** The review the installer received for a completed assignment, as read from `job_reviews`. */
export type AssignmentReview = { rating: number };

/** How to reach the organization behind an assignment, as read from `my_assignment_contacts`. */
export type AssignmentContact = { org_name: string | null; contact_name: string | null; phone: string | null; email: string | null };

/**
 * The three-dot menu: every action that genuinely applies to this row, each a link
 * to the assignment's own page — which owns the real start / progress dialogs and
 * shows the review. Nothing is offered that the server would refuse:
 *   View details     always
 *   Start work       only when `canStart` (scheduled)
 *   Update progress  only when `canReportProgress` (in progress)
 *   View rating      only when a REAL review of this completed work exists
 */
export function rowMoreActions(
  a: MyAssignmentRow,
  locale: Locale,
  review: AssignmentReview | null,
): { key: string; label: string; href: string }[] {
  const ar = locale === "ar";
  const href = `/home/work/${a.id}`;
  return [
    { key: "details", label: ar ? "عرض التفاصيل" : "View details", href },
    ...(canStart(a) ? [{ key: "start", label: ar ? "ابدأ الشغل" : "Start work", href }] : []),
    ...(canReportProgress(a) ? [{ key: "update", label: ar ? "تحديث التقدم" : "Update progress", href }] : []),
    ...(a.status === "completed" && review ? [{ key: "rating", label: ar ? "عرض التقييم" : "View rating", href }] : []),
  ];
}

export function toWorkRowVM(
  a: MyAssignmentRow,
  t: TranslateFn,
  locale: Locale,
  now: Date = new Date(),
  review: AssignmentReview | null = null,
  contact: AssignmentContact | null = null,
): WorkRowVM | null {
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
    // Real, or null: only when the database released a contact for this assignment.
    contact: contact && (contact.phone || contact.email)
      ? { name: contact.contact_name, phone: contact.phone, fullPhone: contact.phone, email: contact.email }
      : null,
    // Real, from `job_reviews` — and only for a completed assignment that has one.
    rating: review?.rating ?? null,
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
    moreActions: rowMoreActions(a, locale, review),
  };
}

export function toWorkRowVMs(
  rows: readonly MyAssignmentRow[],
  t: TranslateFn,
  locale: Locale,
  now: Date = new Date(),
  reviews: ReadonlyMap<string, AssignmentReview> = new Map(),
  contacts: ReadonlyMap<string, AssignmentContact> = new Map(),
): WorkRowVM[] {
  return rows.flatMap((row) => {
    const vm = toWorkRowVM(row, t, locale, now, row.id ? (reviews.get(row.id) ?? null) : null, row.id ? (contacts.get(row.id) ?? null) : null);
    return vm ? [vm] : [];
  });
}

/**
 * The views, with the SAME counts the summary rail shows — both come from the rows.
 *
 * "All" is the in-progress + completed work the list is about. The filter drawer
 * offers only `all`, in progress and completed; the composite "current" and the
 * scheduled / cancelled views stay reachable by URL (the summary rail links to
 * them) so no record is hidden, but they are not mixed into "All your work".
 */
export function toWorkTabs(counts: Record<JobAssignmentStatus, number>, t: TranslateFn): WorkTabVM[] {
  const label = (s: JobAssignmentStatus) => t(`jobs.assignmentStatus.${s}` as never);
  const single = (s: JobAssignmentStatus, inFilter: boolean): WorkTabVM => ({ key: s, label: label(s), count: counts[s], statuses: [s], inFilter });
  return [
    { key: ALL_TAB, label: t("work.tab.all"), count: counts.in_progress + counts.completed, statuses: WORK_LIST_STATUSES, inFilter: true },
    single("in_progress", true),
    single("completed", true),
    { key: CURRENT_TAB, label: t("work.tab.current"), count: counts.scheduled + counts.in_progress, statuses: CURRENT_STATUSES, inFilter: false },
    single("scheduled", false),
    single("cancelled", false),
  ];
}

/** The results card's heading: "All your work", or which other view the URL asked for. */
export function workResultsTitle(activeTab: string, tabs: readonly WorkTabVM[], locale: Locale): string | undefined {
  const tab = tabs.find((x) => x.key === activeTab);
  if (!tab || tab.inFilter !== false) return undefined;
  return locale === "ar" ? `أعمالك — ${tab.label}` : `Your work — ${tab.label}`;
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

/** A saved search's state as the flat string map the database stores (blank values are simply not stored). */
export function stateToFilters(state: WorkSearchState): Record<string, string> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== ""));
}

/** …and back, with every missing or no-longer-offered value at its default. */
export function filtersToState(filters: Record<string, string>): WorkSearchState {
  return sanitizeWorkState(filters);
}

/**
 * The work contacts the database released with a page of assignments, keyed by assignment id.
 * `my_work_page` fills them only for in-progress / completed work that has a recorded contact,
 * so an absent entry simply means "no contact".
 */
export function contactsOf(rows: readonly WorkPageRow[]): Map<string, AssignmentContact> {
  const out = new Map<string, AssignmentContact>();
  for (const r of rows) {
    if (r.contact_phone || r.contact_email) {
      out.set(r.id, { org_name: r.poster_org_name, contact_name: r.contact_name, phone: r.contact_phone, email: r.contact_email });
    }
  }
  return out;
}
