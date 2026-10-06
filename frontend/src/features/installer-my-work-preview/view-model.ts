/**
 * THE MY WORK VIEW MODEL — the boundary between presentation and source.
 *
 * `InstallerMyWorkView` renders these shapes and knows nothing about where they
 * came from. Exactly two call sites build them:
 *   - the preview wrapper, from `preview-data.ts` fixtures (`preview-adapter.ts`);
 *   - the real `/home/work` route, from `my_job_assignments` rows
 *     (`features/home/installer-work-data.ts`).
 *
 * Statuses are carried as opaque strings with a finished label and a tone, so the
 * View has no status vocabulary of its own: production says exactly the four real
 * assignment states (and the composite "current" tab), the preview keeps its demo
 * ones. A field with no real source (contact details, a client rating, a next
 * stage) is typed nullable so production can only leave it null.
 */

export type WorkTone = "success" | "info" | "warning" | "danger" | "neutral";

export type WorkRowVM = {
  id: string;
  /** A photograph that genuinely belongs to the job, or null (production: always
   *  null today; the row then draws the generic trade illustration). */
  image: string | null;
  tradeKey: string | null;
  title: string;
  location: string | null;
  company: string | null;
  companyInitials: string;
  /** Preview only — no contact data is exposed to the installer in production. */
  contact: { phone: string; fullPhone: string; email?: string } | null;
  /** Preview only — there is no client rating on an assignment row. */
  rating: number | null;
  /** Agreed amount in EGP. */
  value: number | null;
  status: string;
  statusLabel: string;
  statusTone: WorkTone;
  /** ISO `YYYY-MM-DD`. The planned work window is `startsOn` -> `endsBy`. */
  startsOn: string | null;
  endsBy: string | null;
  /** The finished delivery-date text, or null when no end date is stated. */
  deliveryDateLabel: string | null;
  deliveryHint: string | null;
  /** Epoch ms used only for ordering; null sorts last. */
  createdAtMs: number | null;
  lastActionMs: number | null;
  /** The row's one action. `href` null = the preview's demo notice. */
  action: { label: string; href: string | null };
};

export type WorkTabVM = {
  key: string;
  label: string;
  count: number;
  /** The row statuses this tab shows; null = every row. */
  statuses: readonly string[] | null;
};

export type ActiveWorkVM = {
  image: string | null;
  tradeKey: string | null;
  title: string;
  company: string | null;
  location: string | null;
  /** Label/value pairs under the title (value, duration, delivery date …). */
  details: readonly { label: string; value: string }[];
  /** Null before any progress has been reported. */
  progress: number | null;
  progressEmptyLabel: string;
  lastUpdate: string | null;
  currentStage: string | null;
  /** Preview only — no stage plan exists, so production never supplies one. */
  nextStage: string | null;
  badgeLabel: string;
  detailsAction: { label: string; href: string | null };
  /** Null when the server would not authorise reporting progress. */
  updateAction: { label: string; href: string | null } | null;
};

export type WorkSort = "default" | "last-added" | "recent-added" | "last-action" | "oldest-first";

/** Which preview-only features the View should draw. Absent in production. */
export type WorkPreviewFeatures = {
  /** The contact column and the contact filter. */
  contact: boolean;
  /** "Save search", saved-search menu and "New search". */
  savedSearches: boolean;
  /** "Export report". */
  exportReport: boolean;
  /** The per-row client rating. */
  rating: boolean;
};

export function rowMatchesTab(row: Pick<WorkRowVM, "status">, tab: WorkTabVM | undefined): boolean {
  if (!tab || tab.statuses === null) return true;
  return tab.statuses.includes(row.status);
}
