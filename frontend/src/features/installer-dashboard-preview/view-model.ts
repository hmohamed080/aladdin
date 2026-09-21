import type { Bi } from "./mock-data";

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
  paymentEGP: number;
  durationDays: number | null;
  publishedAgo: Bi | null;
  tradeLabel: Bi | null;
  image: string;
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

export type InstallerFeaturedLearningVM = { title: Bi; source: Bi; duration: Bi } | null;

export type InstallerRewardsVM = {
  points: number;
  /** Null on real data — no level/progression system exists in the backend yet. */
  level: { label: Bi; nextLabel: Bi; nextAt: number } | null;
  recentActivity: { title: string; body: string | null; dateLabel: string; deltaLabel: string } | null;
  rating: number | null;
  ratingCount: number;
  completedJobs: number;
};

export type InstallerWelcomeVM = {
  firstName: string;
  nearbyOpportunitiesCount: number;
  points: number;
};

export type InstallerProfileCompletionVM = {
  percent: number;
  hint: Bi;
  verified: boolean;
  verifiedHint: Bi;
  href: string;
} | null;
