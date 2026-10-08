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
  /**
   * How to reach the organization behind this work. Preview: demo values. Production:
   * the real contact from `my_assignment_contacts` (only the assigned installer, only
   * while in progress or completed), or null when there is nothing to reach them by.
   */
  contact: { name?: string | null; phone: string | null; fullPhone: string | null; email?: string | null } | null;
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
  /**
   * The overflow (three-dot) menu — production only. Each entry is a real link the
   * server would authorise for this row's status; entries are absent when they do
   * not apply, and the menu is absent when it would only repeat `action`.
   */
  moreActions?: readonly { key: string; label: string; href: string }[];
};

export type WorkTabVM = {
  key: string;
  label: string;
  count: number;
  /** The row statuses this tab shows; null = every row. */
  statuses: readonly string[] | null;
  /** False = reachable by URL (and the summary rail) but not offered in the filter drawer. */
  inFilter?: boolean;
};

/** The filter state a saved search stores: flat strings, nothing transient. */
export type WorkSearchState = {
  tab: string;
  q: string;
  company: string;
  from: string;
  to: string;
  contact: string;
  sort: string;
};

export type SavedWorkSearch = { id: string; name: string; state: WorkSearchState };

/**
 * SERVER-DRIVEN MODE (production). When the route passes `remote`, the View neither
 * filters, orders, counts nor pages the rows it is given: they ARE the requested range
 * of the filtered set, `total` is the database's exact filtered count, and every
 * control reports a new state (a new URL) instead of changing local state. The preview
 * passes no `remote` and keeps filtering its fixtures in the browser.
 */
export type WorkRemote = {
  /** The URL's state: tab, search, company, planned range, contact and sort. */
  state: WorkSearchState;
  /** A changed filter or sort: the route starts again from the first page. */
  onStateChange: (next: WorkSearchState) => void;
  /** The EXACT number of assignments matching `state`. */
  total: number;
  /** The organizations to offer in the Company filter (from the database, not from the rows on screen). */
  companies: readonly string[];
  /** There are more matching rows than the ones given. */
  hasMore: boolean;
  /** Fewer rows than are currently shown could be shown. */
  canShowFewer: boolean;
  onShowMore: () => void;
  onShowFewer: () => void;
  /** A new state, or the next page, is being fetched. */
  pending?: boolean;
  /** The last request for another page failed (the rows already shown are untouched). */
  loadError?: boolean;
};

/**
 * Where saved searches live. The preview keeps its own in-memory list (it has no
 * backend); production passes a store backed by `saved_searches`, so what the View
 * lists, applies and deletes is what the database holds. Both return a finished,
 * localised error message instead of throwing.
 */
export type SavedSearchStore = {
  items: readonly SavedWorkSearch[];
  save: (input: { mode: "new" | "update"; id: string | null; name: string; state: WorkSearchState }) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  remove: (id: string) => Promise<{ ok: true } | { ok: false; message: string }>;
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
