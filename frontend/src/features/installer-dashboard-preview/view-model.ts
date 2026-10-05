import type { Bi } from "./localized";

/**
 * THE SHARED VIEW MODEL — the data-adapter boundary between presentation and
 * source. Every section under this folder renders one of these shapes and
 * never imports `mock-data.ts` for its own content; only two call sites are
 * allowed to build one of these: the preview page (from `mock-data.ts`, see
 * `mockInstallerDashboard`) and the real `/home` page (from live Supabase
 * reads, see `features/home/installer-dashboard-data.ts`). That symmetry is
 * what keeps the preview and the production installer dashboard one design
 * instead of two.
 *
 * A field that has no real backend source yet (rewards levels, needs-action
 * items, the brand ecosystem, learning content) is typed so the real adapter
 * can only ever supply an empty collection or `null` for it — never invented
 * content standing in for a real one.
 */

export type InstallerOpportunityVM = {
  id: string;
  title: Bi;
  org: Bi | null;
  place: Bi | null;
  distanceKm: number | null;
  matchPercent: number | null;
  /** Null when the opening states no budget — shown as such, never as 0 EGP. */
  paymentEGP: number | null;
  durationDays: number | null;
  publishedAgo: Bi | null;
  tradeLabel: Bi | null;
  /** A photograph that genuinely belongs to this opening (uploaded for it), or
   *  null. Today no opening carries media, so production always passes null; a
   *  real image, once it exists, takes priority over the illustration. */
  image: string | null;
  /** The canonical `trades.key`. With no image the card draws the generic
   *  illustration for THIS trade (`trade-illustration.tsx`) — never a stock
   *  photo, never chosen by list position. */
  tradeKey: string | null;
  hasApplied: boolean;
  href: string;
};

export type InstallerNeedsActionItemVM = {
  id: string;
  icon: "appointment" | "message" | "upload" | "work";
  title: Bi;
  subtitle: Bi;
  meta: Bi;
  ctaLabel: Bi;
  href?: string;
};

export type InstallerBrandItemVM = {
  id: string;
  brand: string;
  logo: string;
  kindLabel: Bi;
  title: Bi;
  tag?: Bi;
};

export type InstallerLearningItemVM = {
  id: string;
  kindLabel: Bi;
  title: Bi;
  icon: "training" | "video" | "workshop";
};

export type InstallerFeaturedLearningVM = { title: Bi; source: Bi; duration: Bi; image: string } | null;

export type InstallerRewardsVM = {
  points: number;
  /**
   * Null when there is no level to show. On real data this is
   * `derivePointsLevel(balance)` — the approved, presentation-only band derived
   * from the real balance — never a stored value. `nextLabel`/`nextAt` are null
   * at the highest band. `label` is null where the surface shows no current
   * level (the preview).
   */
  level: { label: Bi | null; nextLabel: Bi | null; nextAt: number | null; progressPct: number } | null;
  recentActivity: { title: string; body: string | null; dateLabel: string; deltaLabel: string } | null;
  rating: number | null;
  ratingCount: number;
  completedJobs: number;
  /** Show the real rating / completed-jobs strip under the card. The approved
   *  preview composition omits it; production keeps it, because it is the only
   *  place the dashboard reports the caller's review figures. */
  showReputation: boolean;
};

export type InstallerWelcomeVM = {
  firstName: string;
  /** The finished sentence about open opportunities. Each adapter words it for
   *  what it can honestly claim: only the preview fixture may say "near you". */
  opportunitiesLine: string;
  points: number;
};

export type InstallerProfileCompletionVM = {
  percent: number;
  hint: Bi;
  verified: boolean;
  verifiedHint: Bi;
  href: string;
} | null;
